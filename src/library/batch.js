export async function refreshMetadataBatch(
  songs,
  request,
  onProgress = () => {},
) {
  const results = [];
  // Capture revisions before asynchronous work, including items later in the batch.
  const snapshots = songs.map((song) => ({ ...song }));
  for (const song of snapshots) {
    let result = {
      id: song.id,
      title: song.title,
      artist: song.artist,
      expectedRevision: song.metadataRevision,
    };
    try {
      const parsed = await request(
        "/admin/refresh-metadata",
        { id: song.id, expectedRevision: song.metadataRevision },
        "POST",
      );
      if (parsed.needs_review)
        result = {
          ...result,
          status: "review",
          message: parsed.note || "请手动核对歌名、歌手与录音版本",
        };
      else {
        await request(
          "/admin/library/" + song.id + "/save",
          {
            title: parsed.title,
            artist: parsed.artist,
            lyrics: song.lyrics || "",
            lyricsSource: song.lyricsSource,
            expectedRevision: song.metadataRevision,
          },
          "POST",
        );
        result = { ...result, status: "success", message: "资料已更新" };
      }
    } catch (error) {
      result = {
        ...result,
        status: error.code === "REVISION_CONFLICT" ? "conflict" : "failed",
        message: error.message,
      };
    }
    results.push(result);
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
          items: rows
            .slice(start, start + 20)
            .map((song) => ({
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
