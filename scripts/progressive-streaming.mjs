export const remoteMediaInput = (appOrigin, id, file) =>
  `${appOrigin}/api/debrid/stream/${id}/${file}`;

export const reclaimablePlaybackJob = (
  bootstrap,
  touchedAt,
  now,
  abandonedAfterMs = 30_000,
) => bootstrap || touchedAt < now - abandonedAfterMs;

export const hlsRetentionOptions = (bootstrap) =>
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
        "8",
        "-hls_delete_threshold",
        "4",
        "-hls_flags",
        "independent_segments+temp_file+delete_segments",
      ];
