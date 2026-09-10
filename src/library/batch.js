export async function refreshMetadataBatch(
  songs,
  request,
  onProgress = () => {},
  { wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {},
) {
  const snapshots = songs.map((song) => ({ ...song }));
  const results = snapshots.map((song) => ({
    id: song.id,
    title: song.title,
    artist: song.artist,
    status: "pending",
    message: "等待识别",
  }));
  onProgress([...results]);
  for (let start = 0; start < snapshots.length; start += 20) {
    const batch = snapshots.slice(start, start + 20);
    try {
      let response;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          response = await request(
            "/admin/refresh-metadata-batch",
            {
              items: batch.map((song) => ({
                id: song.id,
                expectedRevision: song.metadataRevision,
              })),
            },
            "POST",
          );
          break;
        } catch (error) {
          if (error.status !== 429 || attempt === 2) throw error;
          batch.forEach((song, index) => {
            results[start + index] = {
              ...results[start + index],
              message: "等待限流解除后继续",
            };
          });
          onProgress([...results]);
          await wait(Math.max(1, Math.min(120, error.retryAfter || 60)) * 1000);
        }
      }
      batch.forEach((song, index) => {
        const result = response.results.find((row) => row.id === song.id);
        results[start + index] = {
          ...results[start + index],
          ...(result || { status: "failed", message: "未收到该歌曲处理结果" }),
        };
      });
    } catch (error) {
      batch.forEach((song, index) => {
        results[start + index] = {
          ...results[start + index],
          status: "failed",
          message: error.message,
        };
      });
    }
    onProgress([...results]);
  }
  return results;
}
export async function organizeBatch(
  songs,
  reviews,
  request,
  onProgress = () => {},
) {
  const reviewSongs = new Set(reviews.map((r) => r.songId).filter(Boolean));
  const rows = [
    ...reviews.filter((r) => r.kind !== "find-video"),
    ...songs.filter(
      (s) => ["pending", "audio"].includes(s.tier) && !reviewSongs.has(s.id),
    ),
  ];
  const results = rows.map((row) => ({
    id: row.id,
    title: row.title,
    artist: row.artist,
    ...(row.processing
      ? { status: "skipped", message: "已在整理队列中" }
      : !row.title?.trim() || !row.artist?.trim() || row.artist === "未知歌手"
        ? { status: "review", message: "请先填写歌名和歌手" }
        : { status: "pending", message: "等待提交" }),
  }));
  const pending = rows
    .map((row, index) => ({ row, index }))
    .filter(({ index }) => results[index].status === "pending");
  onProgress([...results]);
  for (let start = 0; start < pending.length; start += 20) {
    const batch = pending.slice(start, start + 20);
    try {
      const response = await request(
        "/admin/organize-batch",
        {
          items: batch.map(({ row }) => ({
            id: row.id,
            title: row.title,
            artist: row.artist,
            file: row.file,
            kind: reviews.includes(row)
              ? row.inbox
                ? "inbox"
                : "review"
              : "song",
            expectedRevision: reviews.includes(row)
              ? row.expectedRevision
              : row.metadataRevision,
          })),
        },
        "POST",
      );
      batch.forEach(({ index }, position) => {
        results[index] = { ...results[index], ...response.results[position] };
      });
    } catch (error) {
      batch.forEach(({ index }) => {
        results[index] = {
          ...results[index],
          status: "failed",
          message: error.message,
        };
      });
    }
    onProgress([...results]);
  }
  return results;
}

export async function standardizeBatch(songs, request, onProgress = () => {}) {
  const rows = songs.filter((song) => song.tier === "standard");
  const results = rows.map((song) => ({
    id: song.id,
    title: song.title,
    artist: song.artist,
    status: "pending",
    message: "等待提交",
  }));
  for (let start = 0; start < rows.length; start += 20) {
    try {
      const response = await request(
        "/admin/standardize-batch",
        {
          items: rows.slice(start, start + 20).map((song) => ({
            id: song.id,
            expectedRevision: song.metadataRevision,
          })),
        },
        "POST",
      );
      response.results.forEach((result, index) => {
        results[start + index] = { ...results[start + index], ...result };
      });
    } catch (error) {
      for (let i = start; i < Math.min(start + 20, rows.length); i++)
        results[i] = {
          ...results[i],
          status: "failed",
          message: error.message,
        };
    }
    onProgress([...results]);
  }
  return results;
}
