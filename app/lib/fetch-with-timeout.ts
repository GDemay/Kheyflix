export class RequestTimeoutError extends Error {
  constructor(message = "The request timed out.") {
    super(message);
    this.name = "RequestTimeoutError";
  }
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 15_000,
) {
  const controller = new AbortController();
  let abortSource: "caller" | "timeout" | undefined;
  const abort = (source: "caller" | "timeout") => {
    abortSource ||= source;
    controller.abort();
  };
  const abortForCaller = () => abort("caller");
  if (init.signal?.aborted) abortForCaller();
  else init.signal?.addEventListener("abort", abortForCaller, { once: true });
  const timeout = setTimeout(() => {
    abort("timeout");
  }, timeoutMs);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (abortSource === "timeout") throw new RequestTimeoutError();
    throw error;
  } finally {
    clearTimeout(timeout);
    init.signal?.removeEventListener("abort", abortForCaller);
  }
}
