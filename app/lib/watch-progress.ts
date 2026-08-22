/**
 * A small, browser-storage friendly domain model for playback progress.
 *
 * This module deliberately has no `window` or `localStorage` dependency. The
 * player can use it with localStorage, IndexedDB, or a future account API and
 * the important migration/validation rules remain testable on the server.
 */
export const WATCH_PROGRESS_VERSION = 1;
export const DEFAULT_PROGRESS_LIMIT = 120;
export const MIN_RESUME_SECONDS = 10;
export const COMPLETE_RATIO = 0.95;
export const COMPLETE_REMAINING_SECONDS = 30;

export type PlaybackIdentity = {
  /** Stable title id used by the catalog. */
  titleId: string;
  magnetId: number;
  file: number;
};

export type WatchProgress = PlaybackIdentity & {
  /** Current absolute position, in seconds. */
  position: number;
  /** Known media duration, in seconds (0 when not known yet). */
  duration: number;
  updatedAt: number;
  completed: boolean;
};

export type WatchProgressStore = {
  version: typeof WATCH_PROGRESS_VERSION;
  entries: WatchProgress[];
};

export type ProgressUpdate = PlaybackIdentity & {
  position: number;
  duration?: number;
  updatedAt?: number;
};

export type PlaybackQueueItem = PlaybackIdentity & {
  label: string;
  seriesId?: string;
  seriesTitle?: string;
  season?: number;
  episode?: number;
};

const emptyStore = (): WatchProgressStore => ({ version: WATCH_PROGRESS_VERSION, entries: [] });
const finiteNumber = (value: unknown, fallback = 0) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const nonNegative = (value: unknown) => Math.max(0, finiteNumber(value));
const nonEmptyString = (value: unknown) => typeof value === 'string' && value.trim().length > 0 ? value.trim() : '';

export const playbackKey = (identity: PlaybackIdentity) => `${identity.titleId}:${identity.magnetId}:${identity.file}`;

export function isComplete(position: number, duration: number): boolean {
  if (!(duration > 0)) return false;
  const safePosition = nonNegative(position);
  return safePosition / duration >= COMPLETE_RATIO || duration - safePosition <= COMPLETE_REMAINING_SECONDS;
}

function parseEntry(value: unknown): WatchProgress | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<WatchProgress>;
  const titleId = nonEmptyString(candidate.titleId);
  const magnetId = nonNegative(candidate.magnetId);
  const file = nonNegative(candidate.file);
  const updatedAt = nonNegative(candidate.updatedAt);
  if (!titleId || !Number.isInteger(magnetId) || !Number.isInteger(file) || !updatedAt) return null;
  const duration = nonNegative(candidate.duration);
  const position = duration > 0 ? Math.min(nonNegative(candidate.position), duration) : nonNegative(candidate.position);
  return { titleId, magnetId, file, position, duration, updatedAt, completed: Boolean(candidate.completed) || isComplete(position, duration) };
}

/** Safely reads a persisted JSON payload, rejecting malformed or old schemas. */
export function parseWatchProgress(value: string | null | undefined): WatchProgressStore {
  if (!value) return emptyStore();
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || (parsed as { version?: unknown }).version !== WATCH_PROGRESS_VERSION) return emptyStore();
    const rawEntries = (parsed as { entries?: unknown }).entries;
    if (!Array.isArray(rawEntries)) return emptyStore();
    const byKey = new Map<string, WatchProgress>();
    for (const rawEntry of rawEntries) {
      const entry = parseEntry(rawEntry);
      if (!entry) continue;
      const key = playbackKey(entry);
      const existing = byKey.get(key);
      if (!existing || entry.updatedAt > existing.updatedAt) byKey.set(key, entry);
    }
    return { version: WATCH_PROGRESS_VERSION, entries: [...byKey.values()].sort((a, b) => b.updatedAt - a.updatedAt) };
  } catch {
    return emptyStore();
  }
}

/** Produces a compact, deterministic payload appropriate for browser storage. */
export function serializeWatchProgress(store: WatchProgressStore, limit = DEFAULT_PROGRESS_LIMIT): string {
  const compacted = compactWatchProgress(store, limit);
  return JSON.stringify(compacted);
}

export function compactWatchProgress(store: WatchProgressStore, limit = DEFAULT_PROGRESS_LIMIT): WatchProgressStore {
  const maximum = Math.max(1, Math.floor(finiteNumber(limit, DEFAULT_PROGRESS_LIMIT)));
  const byKey = new Map<string, WatchProgress>();
  for (const rawEntry of store.entries) {
    const entry = parseEntry(rawEntry);
    if (!entry) continue;
    const key = playbackKey(entry);
    const existing = byKey.get(key);
    if (!existing || entry.updatedAt > existing.updatedAt) byKey.set(key, entry);
  }
  return { version: WATCH_PROGRESS_VERSION, entries: [...byKey.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, maximum) };
}

export function updateWatchProgress(store: WatchProgressStore, update: ProgressUpdate, limit = DEFAULT_PROGRESS_LIMIT): WatchProgressStore {
  const titleId = nonEmptyString(update.titleId);
  if (!titleId || !Number.isInteger(update.magnetId) || update.magnetId < 0 || !Number.isInteger(update.file) || update.file < 0) return compactWatchProgress(store, limit);
  const existing = findWatchProgress(store, update);
  const duration = nonNegative(update.duration ?? existing?.duration);
  const position = duration > 0 ? Math.min(nonNegative(update.position), duration) : nonNegative(update.position);
  const updatedAt = nonNegative(update.updatedAt) || Date.now();
  const next: WatchProgress = {
    titleId,
    magnetId: update.magnetId,
    file: update.file,
    position,
    duration,
    updatedAt,
    completed: isComplete(position, duration),
  };
  const key = playbackKey(next);
  return compactWatchProgress({ version: WATCH_PROGRESS_VERSION, entries: [next, ...store.entries.filter(entry => playbackKey(entry) !== key)] }, limit);
}

export function findWatchProgress(store: WatchProgressStore, identity: PlaybackIdentity): WatchProgress | undefined {
  const key = playbackKey(identity);
  return store.entries.find(entry => playbackKey(entry) === key);
}

/** Returns 0 for completed/nearly-new media, otherwise a safe resume position. */
export function resumePosition(entry: WatchProgress | undefined): number {
  if (!entry || entry.completed || entry.position < MIN_RESUME_SECONDS) return 0;
  if (entry.duration > 0 && isComplete(entry.position, entry.duration)) return 0;
  return entry.duration > 0 ? Math.min(entry.position, Math.max(0, entry.duration - 1)) : entry.position;
}

export function findCurrentInQueue(queue: PlaybackQueueItem[], identity: PlaybackIdentity): number {
  const key = playbackKey(identity);
  return queue.findIndex(item => playbackKey(item) === key);
}

/**
 * Finds the next item in the same ordered queue. Queue construction is owned
 * by the catalog/detail layer, so this works for both movies and seasons.
 */
export function nextInQueue(queue: PlaybackQueueItem[], identity: PlaybackIdentity): PlaybackQueueItem | undefined {
  const index = findCurrentInQueue(queue, identity);
  return index >= 0 ? queue[index + 1] : undefined;
}
