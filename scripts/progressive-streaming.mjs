export const remoteMediaInput = (appOrigin, id, file) =>
  `${appOrigin}/api/debrid/stream/${id}/${file}`;

// FFmpeg's integer HLS cadence can write a segment a few milliseconds longer
// than the advertised target duration (for example 2.002s under a 2s target).
// Native Apple HLS validates that invariant before it asks for a media segment,
// so use fractional cadences whose rounded target safely exceeds the segment.
export const hlsSegmentSeconds = (bootstrap) => (bootstrap ? 0.75 : 1.5);

// Sustained Apple sessions must expose a complete live window. Bootstrap can
// begin at its first complete segment because it is finite and used only for
// initial compatibility recovery.
export const hlsStartupSegments = (bootstrap) => (bootstrap ? 1 : 6);

export const hlsStartupBurstSeconds = (bootstrap) =>
  hlsSegmentSeconds(bootstrap) * hlsStartupSegments(bootstrap);

// FFmpeg writes PROGRAM-DATE-TIME between EXTINF and the URI. Apple HLS
// expects a segment's date tag before its EXTINF tag, so normalize the
// generated playlist before it crosses the playback boundary. Event playback
// must also begin at the requested stream start rather than chasing its live
// edge; otherwise Safari can wait indefinitely or skip through the title.
// Segment bytes remain untouched.
export const hlsProgramDateTimeLeadMs = (playlist, now = Date.now()) => {
  const lines = playlist.split(/\r?\n/);
  let latestEnd = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < lines.length; index += 1) {
    const timestamp = lines[index].match(/^#EXT-X-PROGRAM-DATE-TIME:(.+)$/)?.[1];
    if (!timestamp) continue;
    const time = Date.parse(timestamp);
    const duration = Number(
      lines[index - 1]?.match(/^#EXTINF:([0-9]+(?:\.[0-9]+)?)/)?.[1] ||
        lines[index + 1]?.match(/^#EXTINF:([0-9]+(?:\.[0-9]+)?)/)?.[1] ||
        0,
    );
    if (Number.isFinite(time) && Number.isFinite(duration))
      latestEnd = Math.max(latestEnd, time + duration * 1000);
  }
  return Number.isFinite(latestEnd) ? Math.max(0, latestEnd - now) : 0;
};

export const normalizeHlsPlaylist = (
  playlist,
  programDateTimeShiftMs = 0,
  includeEventStart = true,
) => {
  const ordered = playlist.replace(
    /(#EXTINF:[^\r\n]*(?:\r?\n))(#EXT-X-PROGRAM-DATE-TIME:[^\r\n]*(?:\r?\n))/g,
    "$2$1",
  );
  const shifted = programDateTimeShiftMs
    ? ordered.replace(
        /^(#EXT-X-PROGRAM-DATE-TIME:)(.+)$/gm,
        (_line, prefix, timestamp) => {
          const parsed = Date.parse(timestamp);
          return Number.isFinite(parsed)
            ? `${prefix}${new Date(parsed - programDateTimeShiftMs).toISOString()}`
            : `${prefix}${timestamp}`;
        },
      )
    : ordered;
  if (
    !includeEventStart ||
    !/^#EXT-X-PLAYLIST-TYPE:EVENT$/m.test(shifted) ||
    /^#EXT-X-START:/m.test(shifted)
  )
    return shifted;
  return shifted.replace(
    /(#EXT-X-INDEPENDENT-SEGMENTS\r?\n)/,
    "$1#EXT-X-START:TIME-OFFSET=0,PRECISE=YES\n",
  );
};

export const hasPlayableHlsWindow = (
  playlist,
  minimumSegments = 1,
  requiresProgramDateTime = false,
) => {
  const target = Number(
      playlist.match(/^#EXT-X-TARGETDURATION:(\d+(?:\.\d+)?)$/m)?.[1],
    ),
    durations = Array.from(
      playlist.matchAll(/^#EXTINF:([0-9]+(?:\.\d+)?)/gm),
      (match) => Number(match[1]),
    );
  return (
    /^#EXTM3U$/m.test(playlist) &&
    Number.isFinite(target) &&
    target > 0 &&
    durations.length >= minimumSegments &&
    (!requiresProgramDateTime ||
      playlist
        .split(/\r?\n/)
        .every(
          (line, index, lines) =>
            !line.startsWith("#EXTINF:") ||
            /^#EXT-X-PROGRAM-DATE-TIME:/.test(lines[index - 1] || ""),
        )) &&
    durations.every(
      (duration) => Number.isFinite(duration) && duration > 0 && duration <= target,
    )
  );
};

export const reclaimablePlaybackJob = (
  _bootstrap,
  touchedAt,
  now,
  abandonedAfterMs = 30_000,
) => touchedAt < now - abandonedAfterMs;

// Event playlists preserve their timeline so Safari can keep decoding, but a
// viewer only needs a bounded replay cushion after a segment was delivered.
// Seeking starts a fresh server session at the requested position.
export const hlsEventPruneBefore = (latestSequence, retainedSegments) =>
  Math.max(0, latestSequence - retainedSegments);

// Native Apple playback uses finite chunks rather than a mutable Event
// timeline. A VOD playlist is valid only after FFmpeg has closed it with an
// end marker; serving it earlier can make WebKit accept the manifest but never
// request a segment.
export const isCompleteHlsVodPlaylist = (playlist) =>
  /^#EXT-X-PLAYLIST-TYPE:VOD$/m.test(playlist) &&
  /^#EXT-X-ENDLIST$/m.test(playlist) &&
  hasPlayableHlsWindow(playlist);

export const hlsNativeVodOptions = () => [
  "-hls_list_size",
  "0",
  "-hls_playlist_type",
  "vod",
  "-hls_flags",
  "independent_segments+temp_file",
];

export const hlsRetentionOptions = (
  bootstrap,
) =>
  bootstrap
    ? [
        "-hls_list_size",
        "0",
        "-hls_playlist_type",
        "event",
        "-hls_flags",
        "independent_segments+temp_file",
      ]
    : [
        "-hls_list_size",
        "0",
        "-hls_playlist_type",
        "event",
        "-hls_flags",
        "independent_segments+temp_file+program_date_time",
      ];
