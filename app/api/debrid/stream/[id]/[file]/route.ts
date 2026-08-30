import {
  AllDebridError,
  contentTypeFor,
  resolveVideo,
} from "../../../../../lib/alldebrid";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Agent, buildConnector } from "undici";
import { requireProviderAccess } from "../../../../../lib/access";
import {
  observeApi,
  publicErrorMessage,
  writeLog,
  writeRequestLog,
} from "../../../../../lib/observability";

const DEFAULT_FIRST_BYTE_TIMEOUT_MS = 3_000;
const MIN_FIRST_BYTE_TIMEOUT_MS = 250;
const MAX_FIRST_BYTE_TIMEOUT_MS = 8_000;
const MAX_PROVIDER_REDIRECTS = 3;

type RelayUpstream = {
  response: Response;
  body: ReadableStream<Uint8Array> | null;
  firstByteMs: number;
  cancel: (reason?: unknown) => Promise<void>;
};

type PinnedHttpsTarget = {
  hostname: string;
  addresses: Array<{ address: string; family: 4 | 6 }>;
};

type ProviderResponse = {
  response: Response;
  release: () => Promise<void>;
};

const clientIp = (request: Request) => {
  const value = request.headers.get("x-real-ip")?.trim();
  if (
    !value ||
    value.length > 45 ||
    value.includes(",") ||
    !/^[0-9a-f:.]+$/i.test(value)
  )
    return undefined;
  if (value.includes(":")) return value;
  const octets = value.split(".").map(Number);
  return octets.length === 4 &&
    octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    ? value
    : undefined;
};

const firstByteTimeoutMs = () => {
  const configured = Number(process.env.KHEYFLIX_STREAM_FIRST_BYTE_TIMEOUT_MS);
  return Number.isSafeInteger(configured) &&
    configured >= MIN_FIRST_BYTE_TIMEOUT_MS &&
    configured <= MAX_FIRST_BYTE_TIMEOUT_MS
    ? configured
    : DEFAULT_FIRST_BYTE_TIMEOUT_MS;
};

const privateIpv4 = (address: string) => {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part)))
    return true;
  const [first, second] = octets;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 192 && second === 0) ||
    (first === 192 && second === 2) ||
    (first === 198 && (second === 18 || second === 19 || second === 51)) ||
    (first === 203 && second === 0) ||
    first >= 224
  );
};

const ipv6Hextets = (address: string) => {
  let value = address;
  const lastColon = value.lastIndexOf(":");
  const dottedTail = value.slice(lastColon + 1);
  if (dottedTail.includes(".")) {
    if (isIP(dottedTail) !== 4) return null;
    const [first, second, third, fourth] = dottedTail.split(".").map(Number);
    value = `${value.slice(0, lastColon + 1)}${((first << 8) | second).toString(16)}:${((third << 8) | fourth).toString(16)}`;
  }
  const halves = value.split("::");
  if (halves.length > 2) return null;
  const splitHalf = (half: string) => (half ? half.split(":") : []);
  const leading = splitHalf(halves[0]);
  const trailing = splitHalf(halves[1] || "");
  const groups = [...leading, ...trailing];
  if (groups.some((group) => !/^[0-9a-f]{1,4}$/i.test(group))) return null;
  if (halves.length === 1) {
    if (groups.length !== 8) return null;
    return groups.map((group) => Number.parseInt(group, 16));
  }
  const missing = 8 - groups.length;
  if (missing < 1) return null;
  return [
    ...leading.map((group) => Number.parseInt(group, 16)),
    ...Array<number>(missing).fill(0),
    ...trailing.map((group) => Number.parseInt(group, 16)),
  ];
};

const embeddedIpv4 = (address: string) => {
  const groups = ipv6Hextets(address);
  if (!groups) return null;
  const tail = (first: number, second: number) =>
    `${first >> 8}.${first & 0xff}.${second >> 8}.${second & 0xff}`;
  const allZero = (from: number, to: number) =>
    groups.slice(from, to).every((group) => group === 0);

  // IPv4-compatible, IPv4-mapped, IPv4-translated, and the RFC 6052
  // well-known NAT64 prefix all preserve an IPv4 address in their tail. The
  // URL parser canonicalizes dotted mapped forms (for example
  // ::ffff:127.0.0.1) to hexadecimal, so compare the 128-bit address rather
  // than relying on text notation.
  if (
    (allZero(0, 6) ||
      (allZero(0, 5) && groups[5] === 0xffff) ||
      (allZero(0, 4) && groups[4] === 0xffff && groups[5] === 0) ||
      (groups[0] === 0x64 && groups[1] === 0xff9b && allZero(2, 6)))
  )
    return tail(groups[6], groups[7]);

  // 6to4 and Teredo encode an IPv4 endpoint in otherwise global-looking
  // IPv6 space. Reject an embedded private endpoint just like a literal one.
  if (groups[0] === 0x2002) return tail(groups[1], groups[2]);
  if (groups[0] === 0x2001 && groups[1] === 0)
    return tail(groups[6] ^ 0xffff, groups[7] ^ 0xffff);
  return null;
};

const privateIp = (address: string) => {
  const normalized = address.replace(/^\[|\]$/g, "").toLowerCase();
  if (isIP(normalized) === 4) return privateIpv4(normalized);
  const mappedIpv4 = embeddedIpv4(normalized);
  if (mappedIpv4) return privateIpv4(mappedIpv4);
  return (
    !isIP(normalized) ||
    normalized === "::" ||
    normalized === "::1" ||
    /^(?:fc|fd|fe[89ab]|ff)/.test(normalized) ||
    normalized.startsWith("2001:db8:")
  );
};

const normalizedHostname = (hostname: string) =>
  hostname.replace(/^\[|\]$/g, "").toLowerCase();

const resolvePinnedHttpsTarget = async (value: string) => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const hostname = normalizedHostname(url.hostname);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    !hostname ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    (isIP(hostname) !== 0 && privateIp(hostname))
  )
    return null;
  if (isIP(hostname) !== 0)
    return {
      hostname,
      addresses: [{ address: hostname, family: isIP(hostname) as 4 | 6 }],
    };
  try {
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    if (
      !addresses.length ||
      addresses.some(
        ({ address, family }) =>
          (family !== 4 && family !== 6) || privateIp(address),
      )
    )
      return null;
    return {
      hostname,
      addresses: addresses.map(({ address, family }) => ({
        address,
        family: family as 4 | 6,
      })),
    };
  } catch {
    return null;
  }
};

const secureMediaUrl = async (value: string) =>
  Boolean(await resolvePinnedHttpsTarget(value));

const singleByteRange = (value: string | null) => {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(value.trim());
  if (!match || (!match[1] && !match[2]) || value.length > 64)
    throw new AllDebridError(
      "A single valid byte range is required.",
      "INVALID_RANGE",
      416,
    );
  const start = match[1] ? Number(match[1]) : undefined;
  const end = match[2] ? Number(match[2]) : undefined;
  if (
    (start !== undefined && !Number.isSafeInteger(start)) ||
    (end !== undefined && !Number.isSafeInteger(end)) ||
    (start === undefined && end === 0) ||
    (start !== undefined && end !== undefined && start > end)
  )
    throw new AllDebridError(
      "A single valid byte range is required.",
      "INVALID_RANGE",
      416,
    );
  return `bytes=${match[1]}-${match[2]}`;
};

const nonIdentityEncoding = (response: Response) => {
  const encoding = response.headers.get("content-encoding")?.trim();
  return Boolean(encoding && encoding.toLowerCase() !== "identity");
};

const inlineFilename = (name: string) => {
  const normalized = name
    .normalize("NFKC")
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/["\\]/g, "")
    .replaceAll("/", "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
  return normalized || "video";
};

const cancelBody = async (
  body: ReadableStream<Uint8Array> | null,
  reason?: unknown,
) => {
  try {
    await body?.cancel(reason);
  } catch {
    // A response can already be canceled when a client navigates away.
  }
};

const redirectStatus = (status: number) =>
  [301, 302, 303, 307, 308].includes(status);

// Pin the exact public addresses that passed validation to this one outbound
// connection. Keeping the URL hostname intact preserves HTTP Host, TLS SNI,
// and certificate validation while preventing a second DNS resolution from
// turning an approved provider hostname into an internal-address connection.
export const createPinnedHttpsConnector = (
  target: PinnedHttpsTarget,
  connect = buildConnector({}),
) => {
  const expectedHostname = normalizedHostname(target.hostname);
  return (
    options: Parameters<typeof connect>[0],
    callback: Parameters<typeof connect>[1],
  ) => {
    if (
      options.protocol !== "https:" ||
      normalizedHostname(options.hostname) !== expectedHostname
    ) {
      callback(new Error("Pinned provider connector received an unexpected origin."), null);
      return;
    }
    const connectAddress = (index: number) => {
      const candidate = target.addresses[index];
      connect(
        {
          ...options,
          host: candidate.address,
          hostname: candidate.address,
          // Do not let the numeric socket address replace the TLS identity of
          // a hostname-backed signed provider URL.
          servername:
            isIP(expectedHostname) === 0 ? expectedHostname : options.servername,
        },
        (error, socket) => {
          if (error && index + 1 < target.addresses.length) {
            connectAddress(index + 1);
            return;
          }
          callback(error, socket);
        },
      );
    };
    connectAddress(0);
  };
};

const pinnedHttpsDispatcher = (target: PinnedHttpsTarget) => {
  const agent = new Agent({ connect: createPinnedHttpsConnector(target) });
  let released = false;
  return {
    dispatcher: agent,
    release: async () => {
      if (released) return;
      released = true;
      try {
        await agent.close();
      } catch {
        agent.destroy();
      }
    },
  };
};

const rangeMatchesResponse = (range: string, response: Response) => {
  if (response.status !== 206) return false;
  const requested = /^bytes=(\d*)-(\d*)$/i.exec(range);
  const received = /^bytes (\d+)-(\d+)\/(\d+|\*)$/i.exec(
    response.headers.get("content-range") || "",
  );
  if (!requested || !received) return false;
  const start = Number(received[1]);
  const end = Number(received[2]);
  const total = received[3] === "*" ? undefined : Number(received[3]);
  const contentLength = response.headers.get("content-length");
  const responseLength = contentLength === null ? undefined : Number(contentLength);
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    end < start ||
    (contentLength !== null &&
      (!/^\d+$/.test(contentLength) ||
        !Number.isSafeInteger(responseLength) ||
        responseLength !== end - start + 1)) ||
    (total !== undefined &&
      (!Number.isSafeInteger(total) || total <= end))
  )
    return false;
  const requestedStart = requested[1] ? Number(requested[1]) : undefined;
  const requestedEnd = requested[2] ? Number(requested[2]) : undefined;
  if (requestedStart !== undefined && start !== requestedStart) return false;
  if (
    requestedStart !== undefined &&
    requestedEnd !== undefined &&
    end > requestedEnd
  )
    return false;
  if (requestedStart === undefined) {
    if (total === undefined || end !== total - 1) return false;
    if (requestedEnd !== undefined && end - start + 1 > requestedEnd)
      return false;
  }
  return true;
};

const fetchProviderResponse = async (
  initialUrl: string,
  request: Request,
  range: string | null,
  signal: AbortSignal,
): Promise<ProviderResponse> => {
  let url = initialUrl;
  const headers = {
    "Accept-Encoding": "identity",
    ...(range ? { Range: range } : {}),
  };
  for (let redirect = 0; redirect <= MAX_PROVIDER_REDIRECTS; redirect += 1) {
    const target = await resolvePinnedHttpsTarget(url);
    if (!target)
      throw new AllDebridError(
        "The media service returned an unsafe stream URL.",
        "STREAM_URL_UNSAFE",
        502,
      );
    const pinned = pinnedHttpsDispatcher(target);
    let response: Response;
    try {
      response = await fetch(url, {
        method: request.method,
        headers,
        redirect: "manual",
        signal,
        // Node's fetch passes this request-scoped Undici dispatcher through
        // without changing the public Fetch API used by browser code.
        dispatcher: pinned.dispatcher,
      } as RequestInit & { dispatcher: Agent });
    } catch (error) {
      await pinned.release();
      throw error;
    }
    if (!redirectStatus(response.status))
      return { response, release: pinned.release };
    const location = response.headers.get("location");
    await cancelBody(response.body);
    await pinned.release();
    if (!location)
      throw new AllDebridError(
        "The media source returned an invalid redirect.",
        "STREAM_REDIRECT_INVALID",
        502,
      );
    try {
      url = new URL(location, url).toString();
    } catch {
      throw new AllDebridError(
        "The media service returned an unsafe stream URL.",
        "STREAM_URL_UNSAFE",
        502,
      );
    }
  }
  throw new AllDebridError(
    "The media source redirected too many times.",
    "STREAM_REDIRECT_LIMIT",
    502,
  );
};

const retryableUpstreamStatus = (status: number) =>
  status === 401 ||
  status === 403 ||
  status === 404 ||
  status === 408 ||
  status === 410 ||
  status >= 500;

const retryablePreForwardFailure = (error: unknown) =>
  error instanceof AllDebridError && error.retryable;

const upstreamErrorHeaders = (upstream: Response) => {
  const headers = new Headers({ "Cache-Control": "private, no-store" });
  for (const key of ["content-range", "retry-after"]) {
    const value = upstream.headers.get(key);
    if (value) headers.set(key, value);
  }
  return headers;
};

const primedBody = (
  reader: ReadableStreamDefaultReader<Uint8Array>,
  first: ReadableStreamReadResult<Uint8Array>,
  onSettled: () => void,
) => {
  let canceled = false;
  let settled = false;
  const settle = () => {
    if (settled) return;
    settled = true;
    onSettled();
  };
  const cancel = async (reason?: unknown) => {
    if (canceled) return;
    canceled = true;
    try {
      await reader.cancel(reason);
    } catch {
      // The source can close between the viewer canceling and this callback.
    } finally {
      settle();
    }
  };
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      if (first.done) controller.close();
      else controller.enqueue(first.value);
    },
    async pull(controller) {
      try {
        const next = await reader.read();
        if (next.done) {
          canceled = true;
          controller.close();
          settle();
        } else controller.enqueue(next.value);
      } catch (error) {
        canceled = true;
        controller.error(error);
        settle();
      }
    },
    cancel,
  });
  return { body, cancel };
};

const openRelayUpstream = async (
  url: string,
  request: Request,
  range: string | null,
): Promise<RelayUpstream> => {
  const controller = new AbortController();
  let timedOut = false;
  let clientAborted = request.signal.aborted;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let provider: ProviderResponse | undefined;
  let transferredClientAbort = false;
  let cancelAfterStartup: ((reason?: unknown) => Promise<void>) | undefined;
  const abortForClient = () => {
    clientAborted = true;
    controller.abort(request.signal.reason);
    if (cancelAfterStartup) void cancelAfterStartup(request.signal.reason);
  };
  if (clientAborted) abortForClient();
  else request.signal.addEventListener("abort", abortForClient, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, firstByteTimeoutMs());
  const startedAt = performance.now();

  try {
    provider = await fetchProviderResponse(
      url,
      request,
      range,
      controller.signal,
    );
    const { response } = provider;
    if (range && response.ok && !rangeMatchesResponse(range, response)) {
      await cancelBody(response.body);
      await provider.release();
      provider = undefined;
      throw new AllDebridError(
        "The media source returned an invalid byte range.",
        "STREAM_UPSTREAM_RANGE",
        502,
        true,
      );
    }
    if (request.method !== "GET" || !response.ok)
      return {
        response,
        body: response.body,
        firstByteMs: performance.now() - startedAt,
        cancel: async (reason) => {
          await cancelBody(response.body, reason);
          await provider?.release();
        },
      };
    if (nonIdentityEncoding(response)) {
      await cancelBody(response.body);
      await provider.release();
      provider = undefined;
      throw new AllDebridError(
        "The media source returned an unsupported encoding.",
        "STREAM_UPSTREAM_ENCODING",
        502,
        true,
      );
    }
    if (!response.body) {
      await provider.release();
      provider = undefined;
      throw new AllDebridError(
        "The media source returned no playable data.",
        "STREAM_UPSTREAM_EMPTY",
        502,
        true,
      );
    }

    reader = response.body.getReader();
    let first = await reader.read();
    // A compliant stream may emit an empty chunk before payload bytes. Keep
    // waiting within the same bounded first-byte deadline rather than calling
    // an empty stream a successful startup.
    while (!first.done && !first.value.byteLength) first = await reader.read();
    if (first.done) {
      await reader.cancel();
      await provider.release();
      provider = undefined;
      throw new AllDebridError(
        "The media source returned no playable data.",
        "STREAM_UPSTREAM_EMPTY",
        502,
        true,
      );
    }
    const replay = primedBody(reader, first, () => {
      request.signal.removeEventListener("abort", abortForClient);
      void provider?.release();
    });
    reader = undefined;
    cancelAfterStartup = replay.cancel;
    if (clientAborted || request.signal.aborted) {
      await replay.cancel(request.signal.reason);
      throw new AllDebridError(
        "The playback request was canceled.",
        "STREAM_REQUEST_ABORTED",
        499,
      );
    }
    transferredClientAbort = true;
    return {
      response,
      body: replay.body,
      firstByteMs: performance.now() - startedAt,
      cancel: async (reason) => {
        await replay.cancel(reason);
        await provider?.release();
      },
    };
  } catch (error) {
    if (reader) void reader.cancel().catch(() => undefined);
    if (provider) {
      await cancelBody(provider.response.body);
      await provider.release();
    }
    if (clientAborted || request.signal.aborted)
      throw new AllDebridError(
        "The playback request was canceled.",
        "STREAM_REQUEST_ABORTED",
        499,
      );
    if (timedOut)
      throw new AllDebridError(
        "The media source is taking too long to respond.",
        "STREAM_UPSTREAM_TIMEOUT",
        504,
        true,
      );
    if (error instanceof AllDebridError) throw error;
    throw new AllDebridError(
      "The media source is temporarily unavailable.",
      "STREAM_UPSTREAM_FAILED",
      502,
      true,
    );
  } finally {
    clearTimeout(timer);
    if (!transferredClientAbort)
      request.signal.removeEventListener("abort", abortForClient);
  }
};

async function handle(
  request: Request,
  { params }: { params: Promise<{ id: string; file: string }> },
) {
  const blocked = await requireProviderAccess(request);
  if (blocked) return blocked;
  try {
    const { id, file } = await params;
    const mediaId = Number(id);
    const fileIndex = Number(file);
    const range = singleByteRange(request.headers.get("range"));
    // Relay by default so one account is never unlocked against every
    // viewer's changing phone, laptop, VPN, or mobile-network IP address.
    // Direct mode is an explicit opt-in for deployments with provider-safe
    // network controls.
    const relay = process.env.KHEYFLIX_STREAM_MODE !== "direct";
    const ip = relay ? undefined : clientIp(request);
    let media = await resolveVideo(mediaId, fileIndex, ip);
    if (!relay) {
      if (!(await secureMediaUrl(media.url)))
        throw new AllDebridError(
          "The media service returned an unsafe stream URL.",
          "STREAM_URL_UNSAFE",
          502,
        );
      return new Response(null, {
        status: 307,
        headers: {
          Location: media.url,
          "Cache-Control": "private, no-store",
          "Referrer-Policy": "no-referrer",
          "X-Kheyflix-Stream": "direct",
        },
      });
    }

    const refreshLink = async () => {
      media = await resolveVideo(mediaId, fileIndex, ip, true);
    };
    let upstream: RelayUpstream;
    let recoveryReason: string | undefined;
    let recoveryUsed = false;
    try {
      upstream = await openRelayUpstream(media.url, request, range);
    } catch (error) {
      if (!retryablePreForwardFailure(error)) throw error;
      recoveryUsed = true;
      recoveryReason =
        error instanceof AllDebridError
          ? error.code
          : "STREAM_UPSTREAM_RETRY";
      await refreshLink();
      upstream = await openRelayUpstream(media.url, request, range);
    }

    // Temporary provider links can expire between resolution and the first
    // upstream response. A single fresh unlock is safe before any bytes have
    // reached the viewer; afterward the stream remains immutable.
    if (
      !recoveryUsed &&
      !upstream.response.ok &&
      retryableUpstreamStatus(upstream.response.status)
    ) {
      recoveryUsed = true;
      recoveryReason = `status_${upstream.response.status}`;
      await upstream.cancel();
      await refreshLink();
      upstream = await openRelayUpstream(media.url, request, range);
    }
    const unusableGetResponse =
      request.method === "GET" &&
      (upstream.response.status === 204 ||
        upstream.response.status === 205 ||
        upstream.response.status === 304 ||
        (upstream.response.ok && !upstream.body));
    if (
      unusableGetResponse ||
      !upstream.response.ok ||
      (!upstream.body && request.method !== "HEAD")
    ) {
      await upstream.cancel();
      return Response.json(
        {
          error: {
            code: "STREAM_UPSTREAM_FAILED",
            message: "The media source is temporarily unavailable.",
          },
        },
        {
          status: unusableGetResponse ? 502 : upstream.response.status || 502,
          headers: upstreamErrorHeaders(upstream.response),
        },
      );
    }
    if (recoveryReason)
      writeLog("warn", "debrid.stream.recovered", {
        reason: recoveryReason,
        attempts: 2,
        firstByteMs: Number(upstream.firstByteMs.toFixed(1)),
      });

    const headers = new Headers();
    const responseIsIdentityEncoded = !nonIdentityEncoding(upstream.response);
    for (const key of [
      ...(responseIsIdentityEncoded ? ["content-length"] : []),
      "content-range",
      "accept-ranges",
      "etag",
      "last-modified",
      "retry-after",
    ]) {
      const value = upstream.response.headers.get(key);
      if (value) headers.set(key, value);
    }
    headers.set(
      "Content-Type",
      contentTypeFor(media.name),
    );
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Cache-Control", "private, no-store");
    headers.set(
      "Content-Disposition",
      `inline; filename="${inlineFilename(media.name)}"`,
    );
    headers.set(
      "Server-Timing",
      `provider;dur=${upstream.firstByteMs.toFixed(1)};desc="first-byte"`,
    );
    if (request.method === "HEAD") {
      await upstream.cancel();
      return new Response(null, { status: upstream.response.status, headers });
    }
    return new Response(upstream.body, {
      status: upstream.response.status,
      headers,
    });
  } catch (error) {
    const known =
      error instanceof AllDebridError
        ? error
        : new AllDebridError("Unexpected streaming error.");
    writeRequestLog(
      known.status >= 500 ? "error" : "warn",
      "debrid.stream.failed",
      request,
      {
        code: known.code,
        status: known.status,
        error: error instanceof Error ? error : new Error(String(error)),
      },
    );
    return Response.json(
      {
        error: {
          code: known.code,
          message: publicErrorMessage(
            known.message,
            "The media source is temporarily unavailable.",
          ),
        },
      },
      { status: known.status },
    );
  }
}

export const GET = observeApi("/api/debrid/stream/:id/:file", handle);
export const HEAD = observeApi("/api/debrid/stream/:id/:file", handle);
