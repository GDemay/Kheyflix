import { describe, expect, it } from 'vitest';
import {
  COMPLETE_RATIO,
  DEFAULT_PROGRESS_LIMIT,
  findCurrentInQueue,
  isComplete,
  nextInQueue,
  parseWatchProgress,
  resumePosition,
  serializeWatchProgress,
  updateWatchProgress,
  type PlaybackQueueItem,
} from './watch-progress';

const first = { titleId: 'series-mentalist', magnetId: 5, file: 2 };

describe('watch progress', () => {
  it('safely rejects malformed, unknown, and old persisted schemas', () => {
    expect(parseWatchProgress('{bad json')).toEqual({ version: 1, entries: [] });
    expect(parseWatchProgress(JSON.stringify({ version: 0, entries: [] }))).toEqual({ version: 1, entries: [] });
    expect(parseWatchProgress(null)).toEqual({ version: 1, entries: [] });
  });

  it('updates, clamps, and replaces progress by a stable playback identity', () => {
    const initial = parseWatchProgress(null);
    const firstUpdate = updateWatchProgress(initial, { ...first, position: 50, duration: 100, updatedAt: 1000 });
    const updated = updateWatchProgress(firstUpdate, { ...first, position: 150, updatedAt: 2000 });
    expect(updated.entries).toHaveLength(1);
    expect(updated.entries[0]).toMatchObject({ ...first, position: 100, duration: 100, updatedAt: 2000, completed: true });
  });

  it('uses a sensible threshold for completion and resuming', () => {
    expect(isComplete(95, 100)).toBe(true);
    expect(isComplete(91, 120)).toBe(true); // 29 seconds remain
    expect(isComplete(COMPLETE_RATIO * 1200 - 1, 1200)).toBe(false);
    expect(resumePosition({ ...first, position: 8, duration: 900, updatedAt: 1, completed: false })).toBe(0);
    expect(resumePosition({ ...first, position: 124, duration: 900, updatedAt: 1, completed: false })).toBe(124);
    expect(resumePosition({ ...first, position: 899, duration: 900, updatedAt: 1, completed: false })).toBe(0);
  });

  it('deduplicates invalid persisted records and keeps the most recent compact set', () => {
    const payload = JSON.stringify({
      version: 1,
      entries: [
        { ...first, position: 4, duration: 20, updatedAt: 10 },
        { ...first, position: 8, duration: 20, updatedAt: 20 },
        { titleId: '', magnetId: 1, file: 1, position: 2, updatedAt: 10 },
      ],
    });
    const store = parseWatchProgress(payload);
    expect(store.entries).toHaveLength(1);
    expect(store.entries[0].position).toBe(8);
    const capped = updateWatchProgress(store, { titleId: 'movie-a', magnetId: 6, file: 1, position: 10, duration: 100, updatedAt: 30 }, 1);
    expect(capped.entries).toEqual([expect.objectContaining({ titleId: 'movie-a' })]);
    expect(JSON.parse(serializeWatchProgress(capped, DEFAULT_PROGRESS_LIMIT))).toMatchObject({ version: 1 });
  });

  it('resolves the current and next episode from an ordered playback queue', () => {
    const queue: PlaybackQueueItem[] = [
      { ...first, label: 'S01E01', seriesId: 'series-mentalist', season: 1, episode: 1 },
      { titleId: 'series-mentalist', magnetId: 5, file: 3, label: 'S01E02', seriesId: 'series-mentalist', season: 1, episode: 2 },
    ];
    expect(findCurrentInQueue(queue, first)).toBe(0);
    expect(nextInQueue(queue, first)?.label).toBe('S01E02');
    expect(nextInQueue(queue, queue[1])).toBeUndefined();
  });
});
