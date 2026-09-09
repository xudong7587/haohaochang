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
  const results = [];
  const reviewSongs = new Set(reviews.map((r) => r.songId).filter(Boolean));
  for (const row of [
    ...reviews.filter((r) => r.kind !== "find-video"),
    ...songs.filter((s) => s.tier === "pending" && !reviewSongs.has(s.id)),
  ]) {
    let result = { id: row.id, title: row.title, artist: row.artist };
    try {
      if (row.processing) {
        result = { ...result, status: "skipped", message: "已在整理队列中" };
      } else if (
        !row.title?.trim() ||
        !row.artist?.trim() ||
        row.artist === "未知歌手"
      ) {
        result = { ...result, status: "review", message: "请先填写歌名和歌手" };
      } else {
        const review = reviews.includes(row);
        await request(
          review
            ? row.inbox
              ? "/admin/inbox"
              : "/admin/reviews/" + row.id
            : "/admin/library/" + row.id + "/organize",
          review
            ? {
                title: row.title,
                artist: row.artist,
                lyrics: row.lyrics || "",
                file: row.file,
                action: "confirm",
                expectedRevision: row.expectedRevision,
              }
            : { expectedRevision: row.metadataRevision },
          "POST",
        );
        result = { ...result, status: "success", message: "已加入整理队列" };
      }
    } catch (error) {
      result = { ...result, status: "failed", message: error.message };
    }
    results.push(result);
    onProgress([...results]);
  }
  return results;
}
