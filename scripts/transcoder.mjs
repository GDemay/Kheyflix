import http from "node:http";
import { spawn } from "node:child_process";
import { mkdir, readFile, rm, stat, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  audioSyncOptions,
  fixedProfileHeight,
  selectedStreamIndex,
  subtitleTimelineOptions,
  videoOutputOptions,
} from "./transcoder-options.mjs";
import { createWebVttRebaseTransform } from "./subtitle-timeline.mjs";
import {
  hasPlayableHlsWindow,
  hlsSegmentSeconds,
  hlsStartupBurstSeconds,
  hlsStartupSegments,
  hlsNativeVodOptions,
  hlsRetentionOptions,
  hlsProgramDateTimeLeadMs,
  hlsEventPruneBefore,
  isCompleteHlsVodPlaylist,
  normalizeHlsPlaylist,
  reclaimablePlaybackJob,
  remoteMediaInput,
} from "./progressive-streaming.mjs";

const port = Number(process.env.KHEYFLIX_TRANSCODER_PORT || 3101),
  appOrigin = process.env.KHEYFLIX_APP_ORIGIN || "http://localhost:3000";
const ffmpeg = process.env.KHEYFLIX_FFMPEG_PATH || "ffmpeg",
  ffprobe = process.env.KHEYFLIX_FFPROBE_PATH || "ffprobe";
const jobs = new Map(),
  hlsJobs = new Map(),
  bootstrapJobs = new Set(),
  pendingJobs = new Map(),
  cancelledStartupTokens = new Set(),
  stoppingJobs = new Set(),
  jobTouched = new Map(),
  probes = new Map(),
  probeRequests = new Map(),
  playbackStartupGates = new Map(),
  subtitleJobs = new Set();
let capacityRejected = 0,
  capacityReclaimed = 0,
  abandonedStartups = 0;
const hlsMetrics = {
  requests: 0,
  mastersRequested: 0,
  segmentsRequested: 0,
  mastersDelivered: 0,
  segmentsDelivered: 0,
  startupAborted: 0,
  startupTimeouts: 0,
  encoderExited: 0,
  nativeVodChunksStarted: 0,
  nativeVodChunksCompleted: 0,
  nativeVodWarmChunksStarted: 0,
  nativeVodWarmChunksCompleted: 0,
  explicitStops: 0,
  leaseReclaims: 0,
  eventSegmentsPruned: 0,
};
const configuredMaxJobs = (value) => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 2 ? parsed : 2;
};
const configuredTimeout = (value, fallback, minimum, maximum) => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : fallback;
};
const MAX_JOBS = configuredMaxJobs(process.env.KHEYFLIX_MAX_JOBS || 2),
  BOOTSTRAP_CACHE_TTL_MS = 10 * 60_000,
  ABANDONED_JOB_TTL_MS = configuredTimeout(
    process.env.KHEYFLIX_ABANDONED_PLAYBACK_TTL_MS,
    30_000,
    10,
    5 * 60_000,
  ),
  // A reclaimed encoder must actually exit before its slot can admit a
  // successor. Keep the wait far below the first-frame budget so a wedged
  // child still receives the normal retryable busy response.
  CAPACITY_RECLAIM_WAIT_MS = 2_000,
  MAX_CANCELLED_STARTUP_TOKENS = 256,
  HLS_STARTUP_TIMEOUT_MS = configuredTimeout(
    process.env.KHEYFLIX_HLS_STARTUP_TIMEOUT_MS,
    30_000,
    1_000,
    60_000,
  ),
  MAX_PROBE_JOBS = 4,
  MAX_PROBES = 128,
  PROBE_TTL_MS = 30 * 60_000,
  METADATA_STARTUP_GRACE_MS = 350,
  // Keep the metadata probe out of the provider path until the startup
  // encoder either produces bytes or reaches its own bounded recovery path.
  // A shorter timeout recreated the exact cold-start contention this gate is
  // meant to prevent on slower provider/CDN handoffs.
  METADATA_STARTUP_YIELD_MS = 30_000,
  // 320 × 1.5-second segments retain eight minutes of replay cushion while
  // bounding each sustained 480p native session to a fixed working set.
  HLS_EVENT_RETAINED_SEGMENTS = 320,
  // First loads and explicit seeks must be fast. Their 15-second window is
  // immediately followed by one prepared 30-second successor, so sustained
  // playback halves WebKit source replacement without spending cold-start
  // latency on a larger initial encode.
  NATIVE_VOD_CHUNK_SECONDS = 15,
  NATIVE_VOD_WARM_CHUNK_SECONDS = 30,
  TEXT_SUBTITLES = new Set([
    "subrip",
    "srt",
    "ass",
    "ssa",
    "webvtt",
    "mov_text",
  ]);
const activeHlsJobs = () =>
  Array.from(hlsJobs.values()).filter((job) => job.child.exitCode === null).length;
const activeTranscodeJobs = () =>
  Array.from(jobs.values()).filter((child) => child.exitCode === null).length;
const activeJobs = () =>
  activeTranscodeJobs() +
  activeHlsJobs() +
  subtitleJobs.size +
  pendingJobs.size +
  stoppingJobs.size;
let capacityAdmissionTail = Promise.resolve();
const withCapacityAdmission = async (operation) => {
  const previous = capacityAdmissionTail;
  let release;
  capacityAdmissionTail = new Promise((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
};
const waitForReclaimedPlaybackStop = async (token) => {
  let timeout;
  try {
    return await Promise.race([
      stopJob(token, true).then(() => true),
      new Promise((resolve) => {
        timeout = setTimeout(() => resolve(false), CAPACITY_RECLAIM_WAIT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
};
const reclaimPlaybackCapacity = async () => {
  while (activeJobs() >= MAX_JOBS) {
    const now = Date.now();
    const candidateToken = [
      ...Array.from(hlsJobs.entries())
        .filter(
          ([token, job]) =>
            job.child.exitCode === null &&
            reclaimablePlaybackJob(
              job.cacheable,
              jobTouched.get(token) || 0,
              now,
              ABANDONED_JOB_TTL_MS,
            ),
      )
      .map(([token]) => token),
      ...Array.from(jobs.entries())
        .filter(
          ([token, child]) =>
            child.exitCode === null &&
            reclaimablePlaybackJob(
              bootstrapJobs.has(token),
              jobTouched.get(token) || 0,
              now,
              ABANDONED_JOB_TTL_MS,
            ),
        )
        .map(([token]) => token),
    ].sort(
      (left, right) =>
        (jobTouched.get(left) || 0) - (jobTouched.get(right) || 0),
    )[0];
    if (!candidateToken) return false;
    // `stoppingJobs` deliberately remains counted until the child closes. An
    // eager next reservation would oversubscribe the service; an eager
    // rejection turns a reclaimable stale session into a false 429 instead.
    if (!(await waitForReclaimedPlaybackStop(candidateToken))) return false;
    capacityReclaimed += 1;
  }
  return true;
};
const reservePlaybackCapacity = (token, isCancelled = () => false) =>
  withCapacityAdmission(async () => {
    if (isCancelled()) return undefined;
    if (pendingJobs.has(token)) {
      capacityRejected += 1;
      return undefined;
    }
    if (!(await reclaimPlaybackCapacity())) {
      capacityRejected += 1;
      return undefined;
    }
    if (isCancelled()) return undefined;
    let resolve;
    const reservation = {
      cancelled: false,
      settled: new Promise((complete) => {
        resolve = complete;
      }),
      resolve,
    };
    pendingJobs.set(token, reservation);
    return reservation;
  });
const reservationIsCurrent = (token, reservation) =>
  Boolean(reservation) &&
  pendingJobs.get(token) === reservation &&
  !reservation.cancelled;
const releasePlaybackReservation = (token, reservation) => {
  if (!reservation || pendingJobs.get(token) !== reservation) return;
  pendingJobs.delete(token);
  reservation.resolve();
};
const cancelPlaybackReservation = (token) => {
  const reservation = pendingJobs.get(token);
  if (!reservation) return undefined;
  reservation.cancelled = true;
  releasePlaybackReservation(token, reservation);
  return reservation;
};
const rememberCancelledStartup = (token) => {
  cancelledStartupTokens.add(token);
  while (cancelledStartupTokens.size > MAX_CANCELLED_STARTUP_TOKENS)
    cancelledStartupTokens.delete(cancelledStartupTokens.values().next().value);
};
const consumeCancelledStartup = (token) => {
  if (!cancelledStartupTokens.has(token)) return false;
  cancelledStartupTokens.delete(token);
  return true;
};
const requestClosed = (request, response) =>
  request.aborted || request.destroyed || response.destroyed || response.writableEnded;
const nonNegativeNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
};
const inputFor = (id, file) => remoteMediaInput(appOrigin, id, file);
const mediaKey = (id, file) => `${id}:${file}`;
const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
const beginPlaybackStartup = (key) => {
  const existing = playbackStartupGates.get(key);
  if (existing) return existing;
  let resolve;
  const gate = {
    ready: new Promise((complete) => {
      resolve = complete;
    }),
    resolve,
  };
  playbackStartupGates.set(key, gate);
  return gate;
};
const settlePlaybackStartup = (key, gate) => {
  if (!gate || playbackStartupGates.get(key) !== gate) return;
  playbackStartupGates.delete(key);
  gate.resolve();
};
const yieldMetadataToPlaybackStartup = async (id, file) => {
  // Metadata is useful for tracks and quality controls, but an ffprobe input
  // competes with the first compatible encoder for the same provider link.
  // Let a just-started, zero-offset rendition deliver its first bytes first.
  await wait(METADATA_STARTUP_GRACE_MS);
  const gate = playbackStartupGates.get(mediaKey(id, file));
  if (!gate) return;
  await Promise.race([gate.ready, wait(METADATA_STARTUP_YIELD_MS)]);
};
const internalInputHeaders = () => {
  const token = process.env.KHEYFLIX_INTERNAL_TRANSCODER_TOKEN?.trim();
  const headers = [...(token ? [`X-Kheyflix-Internal: ${token}`] : [])];
  return headers.length ? ["-headers", `${headers.join("\r\n")}\r\n`] : [];
};
const stopChild = (child) => {
  if (child.exitCode !== null) return Promise.resolve();
  stoppingJobs.add(child);
  return new Promise((resolve) => {
    const complete = () => {
      stoppingJobs.delete(child);
      resolve();
    };
    child.once("close", complete);
    if (!child.killed) child.kill("SIGKILL");
  });
};
const stopJob = (token, force = false) => {
  cancelPlaybackReservation(token);
  const stopping = [];
  const child = jobs.get(token);
  if (child) stopping.push(stopChild(child));
  jobs.delete(token);
  bootstrapJobs.delete(token);
  const hls = hlsJobs.get(token);
  if (hls) {
    if (hls.cacheable && !force) return Promise.all(stopping);
    stopping.push(stopChild(hls.child));
    hlsJobs.delete(token);
    void rm(hls.directory, { recursive: true, force: true });
  }
  jobTouched.delete(token);
  return Promise.all(stopping);
};
const waitForStoppedJob = async (token) => {
  const reservation = pendingJobs.get(token),
    completion = Promise.all([
      stopJob(token, true),
      reservation?.settled || Promise.resolve(),
    ]);
  let timeout;
  try {
    await Promise.race([
      completion,
      new Promise((resolve) => {
        timeout = setTimeout(resolve, 2_500);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
};
const hlsStartupError = () =>
  new Error("The HLS encoder exited before the stream was ready.");
const waitForFile = async (path, timeout = 30_000, job) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const details = await stat(path);
      if (details.size) return details;
    } catch {}
    if (job && job.child.exitCode !== null) throw hlsStartupError(job);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("The HLS stream did not become ready.");
};
const waitForPlaylist = async (
  path,
  segments = 1,
  timeout = 30_000,
  job,
  requiresProgramDateTime = false,
  requiresCompleteVod = false,
) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const body = normalizeHlsPlaylist(await readFile(path, "utf8"));
      if (
        hasPlayableHlsWindow(body, segments, requiresProgramDateTime) &&
        (!requiresCompleteVod || isCompleteHlsVodPlaylist(body))
      )
        return;
    } catch {}
    if (job && job.child.exitCode !== null) throw hlsStartupError(job);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("The HLS playlist did not become ready.");
};
const hlsSegmentSequence = (asset) => {
  const match = /^segment(\d+)\.ts$/i.exec(asset);
  return match ? Number(match[1]) : undefined;
};
const hlsSegmentPath = (directory, sequence, extension) =>
  join(directory, `segment${String(sequence).padStart(5, "0")}.${extension}`);
const pruneDeliveredEventSegments = async (job, asset) => {
  if (job.cacheable || job.nativeVod) return;
  const latest = hlsSegmentSequence(asset);
  if (!Number.isSafeInteger(latest) || latest === undefined) return;
  const before = hlsEventPruneBefore(latest, HLS_EVENT_RETAINED_SEGMENTS);
  const from = job.nextEventSegmentPrune || 0;
  if (before <= from) return;
  job.nextEventSegmentPrune = before;
  const removals = Array.from({ length: before - from }, (_, offset) =>
    unlink(hlsSegmentPath(job.directory, from + offset, job.segmentExtension)).then(
      () => 1,
      () => 0,
    ),
  );
  const removed = (await Promise.all(removals)).reduce(
    (total, value) => total + value,
    0,
  );
  hlsMetrics.eventSegmentsPruned += removed;
};
const json = (response, status, value, extraHeaders = {}) => {
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "private, no-store",
    ...extraHeaders,
  });
  response.end(JSON.stringify(value));
};
const playbackBusy = (response) =>
  json(
    response,
    429,
    { error: "The playback service is busy. Try again shortly." },
    { "Retry-After": "2" },
  );
const runJson = (binary, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "",
      error = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Media probe timed out."));
    }, 30000);
    child.stdout.on("data", (chunk) => {
      if (out.length < 2_000_000) out += chunk;
    });
    child.stderr.on("data", (chunk) => {
      if (error.length < 16_000) error += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code) reject(new Error("Media probe failed."));
      else
        try {
          resolve(JSON.parse(out));
        } catch {
          reject(new Error("Media probe returned invalid data."));
        }
    });
  });
async function probeMedia(id, file) {
  const key = `${id}:${file}`,
    cached = probes.get(key);
  const now = Date.now();
  for (const [probeKey, entry] of probes)
    if (now - entry.updatedAt >= PROBE_TTL_MS) probes.delete(probeKey);
  if (cached && now - cached.updatedAt < PROBE_TTL_MS) {
    probes.delete(key);
    probes.set(key, cached);
    return cached.value;
  }
  const pending = probeRequests.get(key);
  if (pending) return pending;
  if (probeRequests.size >= MAX_PROBE_JOBS)
    throw new Error("The media probe service is busy. Try again shortly.");
  const request = runJson(ffprobe, [
    "-v",
    "error",
    "-show_format",
    "-show_streams",
    "-of",
    "json",
    ...internalInputHeaders(),
    inputFor(id, file),
  ]).then((raw) => normalizeProbe(raw));
  probeRequests.set(key, request);
  try {
    const value = await request;
    probes.set(key, { value, updatedAt: Date.now() });
    while (probes.size > MAX_PROBES) probes.delete(probes.keys().next().value);
    return value;
  } finally {
    probeRequests.delete(key);
  }
}

function normalizeProbe(raw) {
  const streams = Array.isArray(raw.streams) ? raw.streams : [];
  const language = (stream) => stream.tags?.language || "und",
    title = (stream) => stream.tags?.title || "";
  const value = {
    duration:
      Number(raw.format?.duration) ||
      Math.max(0, ...streams.map((stream) => Number(stream.duration) || 0)),
    format: raw.format?.format_name || "",
    video: streams
      .filter((stream) => stream.codec_type === "video")
      .map((stream) => ({
        index: stream.index,
        codec: stream.codec_name,
        width: stream.width,
        height: stream.height,
      })),
    audio: streams
      .filter((stream) => stream.codec_type === "audio")
      .map((stream) => ({
        index: stream.index,
        codec: stream.codec_name,
        language: language(stream),
        title: title(stream),
        channels: stream.channels || 0,
        default: Boolean(stream.disposition?.default),
      })),
    subtitles: streams
      .filter((stream) => stream.codec_type === "subtitle")
      .map((stream) => ({
        index: stream.index,
        codec: stream.codec_name,
        language: language(stream),
        title: title(stream),
        supported: TEXT_SUBTITLES.has(stream.codec_name),
      })),
  };
  return value;
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host}`);
    if (url.pathname === "/health") {
      const appOriginReachable = await fetch(`${appOrigin}/`, {
        method: "HEAD",
        signal: AbortSignal.timeout(1_500),
      })
        .then((upstream) => upstream.ok)
        .catch(() => false);
      const inUse = activeJobs(),
        transcodes = activeTranscodeJobs(),
        hls = activeHlsJobs(),
        subtitles = subtitleJobs.size,
        pending = pendingJobs.size,
        stopping = stoppingJobs.size;
      return json(response, 200, {
        ok: appOriginReachable,
        appOrigin: appOriginReachable,
        service: "kheyflix-transcoder",
        internalAccessConfigured: Boolean(
          process.env.KHEYFLIX_INTERNAL_TRANSCODER_TOKEN?.trim(),
        ),
        jobs: inUse,
        capacity: {
          maxJobs: MAX_JOBS,
          inUse,
          available: Math.max(0, MAX_JOBS - inUse),
          atCapacity: inUse >= MAX_JOBS,
          activeTranscodes: transcodes,
          activeHls: hls,
          activeSubtitles: subtitles,
          pending,
          stopping,
          rejected: capacityRejected,
          reclaimed: capacityReclaimed,
          abandonedStartups,
        },
        cachedBootstraps: Array.from(hlsJobs.values()).filter(
          (job) => job.cacheable && job.child.exitCode === null,
        ).length,
        probes: probeRequests.size,
        hls: { ...hlsMetrics },
      });
    }
    const stop = url.pathname.match(/^\/stop\/([a-z0-9-]+)$/i);
    if (stop) {
      const token = stop[1];
      if (hlsJobs.has(token)) hlsMetrics.explicitStops += 1;
      // A replacement request can be queued behind another session's
      // reclamation before it has a reservation or child of its own. Record
      // this explicit stop so that late admission cannot revive a session the
      // player has already released. Existing reservations and live jobs are
      // cancelled directly below and intentionally remain retryable.
      if (!jobs.has(token) && !hlsJobs.has(token) && !pendingJobs.has(token))
        rememberCancelledStartup(token);
      await waitForStoppedJob(token);
      response.writeHead(204).end();
      return;
    }
    const touch = url.pathname.match(/^\/touch\/([a-z0-9-]+)$/i);
    if (touch) {
      if (jobs.has(touch[1]) || hlsJobs.has(touch[1]))
        jobTouched.set(touch[1], Date.now());
      response.writeHead(204).end();
      return;
    }
    const probe = url.pathname.match(/^\/probe\/(\d+)\/(\d+)$/);
    if (probe) {
      await yieldMetadataToPlaybackStartup(probe[1], probe[2]);
      return json(response, 200, await probeMedia(probe[1], probe[2]));
    }
    const hls = url.pathname.match(
      /^\/hls\/(\d+)\/(\d+)\/([a-z0-9-]+)\/(master\.m3u8|segment\d+\.ts)$/i,
    );
    if (hls) {
      const [, id, file, token, asset] = hls;
      hlsMetrics.requests += 1;
      if (asset === "master.m3u8") hlsMetrics.mastersRequested += 1;
      else hlsMetrics.segmentsRequested += 1;
      let job = hlsJobs.get(token);
      let created = false,
        startupAborted = false,
        startupCancelled = false,
        reservation,
        startupGate;
      const startupKey = mediaKey(id, file);
      const isStartupCancelled = () => {
        if (startupAborted || requestClosed(request, response)) return true;
        if (startupCancelled) return true;
        startupCancelled = consumeCancelledStartup(token);
        return startupCancelled;
      };
      const abortStartup = () => {
        if (!startupAborted) hlsMetrics.startupAborted += 1;
        startupAborted = true;
        settlePlaybackStartup(startupKey, startupGate);
        cancelPlaybackReservation(token);
        if (created && job && hlsJobs.get(token) === job)
          void stopJob(token, true);
      };
      const abortOnResponseClose = () => {
        if (!response.writableEnded) abortStartup();
      };
      request.once("aborted", abortStartup);
      response.once("close", abortOnResponseClose);
      try {
        if (!job) {
          if (asset !== "master.m3u8")
            return json(response, 404, { error: "HLS session not found." });
          if (isStartupCancelled()) {
            abandonedStartups += 1;
            return;
          }
          reservation = await reservePlaybackCapacity(
            token,
            isStartupCancelled,
          );
          if (!reservation) {
            if (isStartupCancelled()) {
              abandonedStartups += 1;
              return;
            }
            return playbackBusy(response);
          }
          try {
          if (
            isStartupCancelled() ||
            !reservationIsCurrent(token, reservation)
          ) {
            abandonedStartups += 1;
            return;
          }
          const start = nonNegativeNumber(url.searchParams.get("start") || 0),
            audio = selectedStreamIndex(url.searchParams.get("audio")),
            audioSync = url.searchParams.get("sync"),
            quality = new Set(["bootstrap", "480", "720", "1080", "original"]).has(
              url.searchParams.get("quality"),
            )
              ? url.searchParams.get("quality")
              : "480",
            nativeVodMode = url.searchParams.get("mode"),
            nativeVod =
              nativeVodMode === "native-vod" ||
              nativeVodMode === "native-vod-warm",
            nativeVodWarm = nativeVodMode === "native-vod-warm",
            nativeVodChunkSeconds = nativeVodWarm
              ? NATIVE_VOD_WARM_CHUNK_SECONDS
              : NATIVE_VOD_CHUNK_SECONDS,
            segmentExtension = "ts",
            fixedProfile = new Set(["bootstrap", "480", "720", "1080"]).has(
              quality,
            ),
            bootstrapHls = quality === "bootstrap",
            segmentSeconds = hlsSegmentSeconds(bootstrapHls),
            startupProfile = start === 0 && fixedProfile,
            playlistSegments = nativeVod ? 1 : hlsStartupSegments(bootstrapHls),
            media = fixedProfile
              ? { video: [{ codec: "", height: fixedProfileHeight(quality) }] }
              : await probeMedia(id, file),
            directory = join(tmpdir(), `kheyflix-hls-${token}`);
          if (
            isStartupCancelled() ||
            !reservationIsCurrent(token, reservation)
          ) {
            abandonedStartups += 1;
            return;
          }
          // The player requests media metadata immediately after attaching the
          // native HLS source.  Its ffprobe request reads the same remote
          // provider link, so give the fixed first-frame rendition exclusive
          // access until a usable playlist exists.  This is the HLS analogue
          // of the progressive startup gate below; without it, iPhone Safari
          // can time out while two cold reads compete upstream.
          if (startupProfile) startupGate = beginPlaybackStartup(startupKey);
          // Tokens are unique per player session, but a process restart can
          // leave an interrupted session directory behind. Never serve a
          // stale playlist or segment to a new encoder that happens to reuse
          // that token.
          await rm(directory, { recursive: true, force: true });
          await mkdir(directory, { recursive: true });
          if (
            isStartupCancelled() ||
            !reservationIsCurrent(token, reservation)
          ) {
            abandonedStartups += 1;
            return;
          }
          const args = ["-hide_banner", "-loglevel", "error"];
          if (start) args.push("-ss", String(start));
          if (!bootstrapHls && !nativeVod)
            args.push(
              "-readrate",
              "1",
              "-readrate_initial_burst",
              String(hlsStartupBurstSeconds(false)),
            );
          args.push(
            ...internalInputHeaders(),
            "-i",
            inputFor(id, file),
            "-map",
            "0:v:0",
            "-map",
            `0:${audio}?`,
            ...videoOutputOptions(
              media.video[0]?.codec || "",
              media.video[0]?.height || 0,
              false,
              quality,
              start > 0,
            ),
            "-c:a",
            "aac",
            "-b:a",
            quality === "bootstrap" ? "64k" : "192k",
            "-ac",
            quality === "bootstrap" ? "1" : "2",
            ...audioSyncOptions(audioSync),
            "-sn",
            "-force_key_frames",
            `expr:gte(t,n_forced*${segmentSeconds})`,
            ...(nativeVod
              ? ["-t", String(nativeVodChunkSeconds)]
              : quality === "bootstrap"
                ? ["-t", "30"]
                : []),
            "-f",
            "hls",
            "-hls_time",
            String(segmentSeconds),
            ...(nativeVod ? hlsNativeVodOptions() : hlsRetentionOptions(quality === "bootstrap")),
            "-hls_segment_filename",
            join(directory, `segment%05d.${segmentExtension}`),
            join(directory, "master.m3u8"),
          );
          const child = spawn(ffmpeg, args, { stdio: ["ignore", "ignore", "pipe"] });
          job = {
            child,
            directory,
            stderrObserved: false,
            cacheable: bootstrapHls,
            nativeVod,
            nativeVodWarm,
            playlistSegments,
            start,
            segmentExtension,
          };
          created = true;
          hlsJobs.set(token, job);
          if (nativeVod) hlsMetrics.nativeVodChunksStarted += 1;
          if (nativeVodWarm) hlsMetrics.nativeVodWarmChunksStarted += 1;
          jobTouched.set(token, Date.now());
          child.stderr.on("data", (chunk) => {
            if (chunk.length) job.stderrObserved = true;
          });
          child.once("close", (code) => {
            settlePlaybackStartup(startupKey, startupGate);
            if (code) hlsMetrics.encoderExited += 1;
            if (code === 0 && job.nativeVod)
              hlsMetrics.nativeVodChunksCompleted += 1;
            if (code === 0 && job.nativeVodWarm)
              hlsMetrics.nativeVodWarmChunksCompleted += 1;
            if (code && job.stderrObserved)
              console.error("[hls] encoder exited", {
                code,
                activeJobs: activeJobs(),
              });
            if (code && hlsJobs.get(token) === job) {
              hlsJobs.delete(token);
              jobTouched.delete(token);
              void rm(job.directory, { recursive: true, force: true });
            }
          });
          } finally {
            releasePlaybackReservation(token, reservation);
          }
        }
        if (isStartupCancelled()) {
          if (created && job && hlsJobs.get(token) === job)
            await stopJob(token, true);
          return;
        }
      jobTouched.set(token, Date.now());
      const path = join(job.directory, asset);
      if (asset === "master.m3u8") {
        // Event sessions need a complete live window; finite native VOD chunks
        // must be fully closed before Safari sees the VOD tag and fetches any
        // segment. Bootstrap can begin with one complete segment.
        await waitForPlaylist(
          path,
          job.playlistSegments || 1,
          HLS_STARTUP_TIMEOUT_MS,
          job,
          !job.cacheable && !job.nativeVod,
          job.nativeVod,
        );
        // A playable HLS window is the first point at which native HLS can
        // begin decoding. Release metadata work immediately afterwards rather
        // than holding it until a later segment request.
        settlePlaybackStartup(startupKey, startupGate);
      }
      await waitForFile(
        path,
        asset === "master.m3u8" ? HLS_STARTUP_TIMEOUT_MS : 10_000,
        job,
      );
      const rawBody = await readFile(path);
      if (
        asset === "master.m3u8" &&
        !job.nativeVod && job.programDateTimeShiftMs === undefined
      )
        job.programDateTimeShiftMs = hlsProgramDateTimeLeadMs(
          rawBody.toString("utf8"),
        );
      const body = asset === "master.m3u8"
        ? Buffer.from(
            job.nativeVod
              ? rawBody.toString("utf8")
              : normalizeHlsPlaylist(
                  rawBody.toString("utf8"),
                  job.programDateTimeShiftMs || 0,
                ),
          )
        : rawBody;
      response.writeHead(200, {
        "Content-Type": asset.endsWith(".m3u8")
          ? "application/vnd.apple.mpegurl"
          : "video/mp2t",
        // The encoder can update a rolling manifest between stat() and
        // readFile(). Always describe the body actually sent; a mismatched
        // manifest length can make native HLS clients reject the playlist.
        "Content-Length": String(body.byteLength),
        "Cache-Control": asset.endsWith(".m3u8")
          ? "private, no-store"
          : "private, max-age=60",
      });
      response.end(body);
      if (asset === "master.m3u8") hlsMetrics.mastersDelivered += 1;
      else {
        hlsMetrics.segmentsDelivered += 1;
        void pruneDeliveredEventSegments(job, asset);
      }
      return;
      } catch (error) {
        settlePlaybackStartup(startupKey, startupGate);
        if (
          error instanceof Error &&
          error.message === "The HLS stream did not become ready."
        )
          hlsMetrics.startupTimeouts += 1;
        // A playlist which never becomes usable must not remain reserved until
        // the lease sweeper runs. This includes encoders that hang without
        // exiting, which otherwise starve the two-slot playback service.
        if (created && job && hlsJobs.get(token) === job)
          await stopJob(token, true);
        throw error;
      } finally {
        request.off("aborted", abortStartup);
        response.off("close", abortOnResponseClose);
      }
    }
    const subtitle = url.pathname.match(
      /^\/subtitle\/(\d+)\/(\d+)\/(\d+)\.vtt$/,
    );
    if (subtitle) {
      const reservationToken = `subtitle-${crypto.randomUUID()}`;
      let startupAborted = false;
      const abortStartup = () => {
        startupAborted = true;
        cancelPlaybackReservation(reservationToken);
      };
      const abortOnResponseClose = () => {
        if (!response.writableEnded) abortStartup();
      };
      const isStartupCancelled = () =>
        startupAborted || requestClosed(request, response);
      request.once("aborted", abortStartup);
      response.once("close", abortOnResponseClose);
      const reservation = await reservePlaybackCapacity(
        reservationToken,
        isStartupCancelled,
      );
      if (!reservation) {
        request.off("aborted", abortStartup);
        response.off("close", abortOnResponseClose);
        if (isStartupCancelled()) {
          abandonedStartups += 1;
          return;
        }
        return playbackBusy(response);
      }
      try {
        if (
          isStartupCancelled() ||
          !reservationIsCurrent(reservationToken, reservation)
        ) {
          abandonedStartups += 1;
          return;
        }
        const subtitleStart = nonNegativeNumber(
          url.searchParams.get("start") || 0,
        ),
          subtitleTimeline = subtitleTimelineOptions(subtitleStart);
        const info = await probeMedia(subtitle[1], subtitle[2]),
          track = info.subtitles.find(
            (item) => item.index === Number(subtitle[3]),
          );
        if (
          isStartupCancelled() ||
          !reservationIsCurrent(reservationToken, reservation)
        ) {
          abandonedStartups += 1;
          return;
        }
        if (!track?.supported)
          return json(response, 415, {
            error: "This subtitle format cannot be displayed in a web player.",
          });
        const child = spawn(
          ffmpeg,
          [
            "-hide_banner",
            "-loglevel",
            "error",
            ...subtitleTimeline.input,
            ...internalInputHeaders(),
            "-i",
            inputFor(subtitle[1], subtitle[2]),
            ...subtitleTimeline.output,
            "-map",
            `0:${subtitle[3]}`,
            "-f",
            "webvtt",
            "pipe:1",
          ],
          { stdio: ["ignore", "pipe", "pipe"] },
        );
        subtitleJobs.add(child);
        response.writeHead(200, {
          "Content-Type": "text/vtt; charset=utf-8",
          "Cache-Control": "private, max-age=86400",
        });
        child.stdout
          .pipe(createWebVttRebaseTransform(subtitleStart))
          .pipe(response);
        child.once("close", () => subtitleJobs.delete(child));
        child.once("error", () => subtitleJobs.delete(child));
        response.on("close", () => {
          if (!child.killed) child.kill("SIGKILL");
          subtitleJobs.delete(child);
        });
        return;
      } finally {
        releasePlaybackReservation(reservationToken, reservation);
        request.off("aborted", abortStartup);
        response.off("close", abortOnResponseClose);
      }
    }
    const match = url.pathname.match(/^\/transcode\/(\d+)\/(\d+)$/);
    if (!match) {
      response.writeHead(404).end();
      return;
    }
    const token = url.searchParams.get("token") || crypto.randomUUID();
    let child,
      startupAborted = false,
      startupCancelled = false;
    const isStartupCancelled = () => {
      if (startupAborted || requestClosed(request, response)) return true;
      if (startupCancelled) return true;
      startupCancelled = consumeCancelledStartup(token);
      return startupCancelled;
    };
    const abortStartup = () => {
      startupAborted = true;
      cancelPlaybackReservation(token);
      if (child && jobs.get(token) === child) void stopJob(token, true);
    };
    const abortOnResponseClose = () => {
      if (!response.writableEnded) abortStartup();
    };
    request.once("aborted", abortStartup);
    response.once("close", abortOnResponseClose);
    const existing = jobs.get(token);
    if (existing) await waitForStoppedJob(token);
    const reservation = await reservePlaybackCapacity(
      token,
      isStartupCancelled,
    );
    if (!reservation) {
      request.off("aborted", abortStartup);
      response.off("close", abortOnResponseClose);
      if (isStartupCancelled()) {
        abandonedStartups += 1;
        return;
      }
      return playbackBusy(response);
    }
    let startupGate;
    try {
      if (
        isStartupCancelled() ||
        !reservationIsCurrent(token, reservation)
      ) {
        abandonedStartups += 1;
        releasePlaybackReservation(token, reservation);
        return;
      }
      const start = nonNegativeNumber(url.searchParams.get("start") || 0),
        audio = selectedStreamIndex(url.searchParams.get("audio")),
        audioSync = url.searchParams.get("sync"),
        subtitleStream = url.searchParams.get("subtitle"),
        copyVideo = url.searchParams.get("video") === "copy",
        quality = new Set(["bootstrap", "480", "720", "1080", "original"]).has(
          url.searchParams.get("quality"),
        )
          ? url.searchParams.get("quality")
          : "original",
        media =
          quality === "bootstrap" ||
          quality === "480" ||
          quality === "720" ||
          quality === "1080"
            ? { video: [{ codec: "", height: fixedProfileHeight(quality) }] }
            : await probeMedia(match[1], match[2]),
        videoCodec = media.video[0]?.codec || "",
        videoHeight = media.video[0]?.height || 0;
      if (
        isStartupCancelled() ||
        !reservationIsCurrent(token, reservation)
      ) {
        abandonedStartups += 1;
        releasePlaybackReservation(token, reservation);
        return;
      }
      const args = ["-hide_banner", "-loglevel", "error"];
      if (start) args.push("-ss", String(start));
      const startupProfile =
        start === 0 &&
        (quality === "bootstrap" ||
          quality === "480" ||
          quality === "720" ||
          quality === "1080"),
        startupKey = mediaKey(match[1], match[2]);
      if (startupProfile) startupGate = beginPlaybackStartup(startupKey);
      args.push(
        ...internalInputHeaders(),
        "-i",
        inputFor(match[1], match[2]),
        "-map",
        "0:v:0",
        "-map",
        `0:${audio}?`,
        ...(subtitleStream && /^\d+$/.test(subtitleStream)
          ? ["-map", `0:${subtitleStream}?`]
          : []),
        ...videoOutputOptions(videoCodec, videoHeight, copyVideo, quality, start > 0),
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-ac",
        "2",
        ...audioSyncOptions(audioSync),
        ...(subtitleStream && /^\d+$/.test(subtitleStream)
          ? ["-c:s", "mov_text", "-disposition:s:0", "default"]
          : ["-sn"]),
        ...(quality === "bootstrap" ? ["-t", "30"] : []),
        "-movflags",
        "frag_keyframe+empty_moov+default_base_moof",
        "-frag_duration",
        "1000000",
        "-flush_packets",
        "1",
        "-f",
        "mp4",
        "pipe:1",
      );
      child = spawn(ffmpeg, args, { stdio: ["ignore", "pipe", "pipe"] });
      jobs.set(token, child);
      releasePlaybackReservation(token, reservation);
      if (quality === "bootstrap") bootstrapJobs.add(token);
      jobTouched.set(token, Date.now());
      let started = false,
        stderrObserved = false;
      const startup = setTimeout(() => {
        if (!started) child.kill("SIGKILL");
      }, 30000);
      child.stdout.on("data", (chunk) => {
        if (!started) {
          started = true;
          settlePlaybackStartup(startupKey, startupGate);
          clearTimeout(startup);
          response.writeHead(200, {
            "Content-Type": "video/mp4",
            "Cache-Control": "private, no-store",
            "X-Kheyflix-Audio": "aac",
            "X-Kheyflix-Quality": quality,
          });
        }
        if (!response.write(chunk)) child.stdout.pause();
      });
      response.on("drain", () => child.stdout.resume());
      child.stdout.on("end", () => response.end());
      child.stderr.on("data", (chunk) => {
        if (chunk.length) stderrObserved = true;
      });
      child.on("error", () => {
        settlePlaybackStartup(startupKey, startupGate);
        clearTimeout(startup);
        if (!response.headersSent)
          json(response, 503, {
            error: "The compatible stream could not start.",
          });
        else response.end();
      });
      child.on("close", (code) => {
        settlePlaybackStartup(startupKey, startupGate);
        clearTimeout(startup);
        if (jobs.get(token) !== child) return;
        jobs.delete(token);
        bootstrapJobs.delete(token);
        jobTouched.delete(token);
        if (!started && !response.writableEnded)
          json(response, code === null ? 504 : 502, {
            error: stderrObserved
              ? "The compatible stream could not start."
              : "The compatible stream ended before it could start.",
          });
      });
    } catch (error) {
      settlePlaybackStartup(mediaKey(match[1], match[2]), startupGate);
      releasePlaybackReservation(token, reservation);
      throw error;
    } finally {
      if (!child) {
        request.off("aborted", abortStartup);
        response.off("close", abortOnResponseClose);
      }
    }
  } catch {
    if (!response.headersSent && !response.destroyed)
      json(response, 502, {
        error: "Playback service error.",
      });
    else response.end();
  }
});
server.listen(port, "127.0.0.1", () =>
  console.log(`Kheyflix media compatibility service: http://127.0.0.1:${port}`),
);
const leaseSweep = setInterval(() => {
  const now = Date.now();
  for (const [token, touchedAt] of jobTouched) {
    const cacheable = hlsJobs.get(token)?.cacheable;
    const ttl = cacheable ? BOOTSTRAP_CACHE_TTL_MS : 60_000;
    if (now - touchedAt < ttl) continue;
    if (hlsJobs.has(token)) hlsMetrics.leaseReclaims += 1;
    stopJob(token, true);
  }
}, 15_000);
leaseSweep.unref();
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    clearInterval(leaseSweep);
    for (const child of jobs.values()) if (!child.killed) child.kill("SIGKILL");
    for (const { child, directory } of hlsJobs.values()) {
      if (!child.killed) child.kill("SIGKILL");
      void rm(directory, { recursive: true, force: true });
    }
    for (const child of subtitleJobs) if (!child.killed) child.kill("SIGKILL");
    server.close(() => process.exit(0));
  });
