export class ProviderPreflightHttpError extends Error {
  constructor(status: number) {
    super(`Media provider returned HTTP ${status}.`);
    this.name = "ProviderPreflightHttpError";
  }
}

export type ProviderPreflightFailure =
  | { action: "ignore" }
  | { action: "continue" }
  | { action: "fail"; message: string };

export function classifyProviderPreflightFailure(
  reason: unknown,
  aborted: boolean,
): ProviderPreflightFailure {
  if (aborted) return { action: "ignore" };
  if (reason instanceof ProviderPreflightHttpError)
    return { action: "fail", message: reason.message };
  return { action: "continue" };
}
