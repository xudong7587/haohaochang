import { assertSongIdle, checkRevision, currentSong } from "./song-writes.js";
import { findLyrics } from "./lyrics-source.js";
import { saveSongMetadata } from "./song-metadata.js";

export function queueMissingLyrics(store, addJob, items) {
  const rows =
    items ||
    store.db
      .prepare("SELECT * FROM songs ORDER BY created")
      .all()
      .filter((song) => !store.get("hidden:" + song.id) && !song.lyrics?.trim())
      .map((song) => ({
        id: song.id,
        expectedRevision: song.metadataRevision,
      }));
  return rows.map((item) => {
    let song;
    try {
      song = currentSong(store, item?.id);
      checkRevision(song, item.expectedRevision);
      const result = { id: song.id, title: song.title, artist: song.artist };
      if (store.get("hidden:" + song.id) || song.lyrics?.trim())
        return {
          ...result,
          status: "skipped",
          message: "已隐藏或已有歌词，保留原内容",
        };
      assertSongIdle(store, song.id);
      if (store.db.prepare("SELECT id FROM queue WHERE song_id=?").get(song.id))
        return {
          ...result,
          status: "skipped",
          message: "已在播放队列，请播放结束后重试",
        };
      if (
        !song.title?.trim() ||
        !song.artist?.trim() ||
        song.artist === "未知歌手"
      )
        return {
          ...result,
          status: "review",
          message: "请先确认歌名和实际演唱者",
        };
      const jobId = addJob("lyrics", {
        id: song.id,
        expectedRevision: song.metadataRevision,
      });
      return {
        ...result,
        status: "success",
        jobId,
        message: "已加入歌词补充任务",
      };
    } catch (error) {
      return {
        id: item?.id,
        title: song?.title,
        artist: song?.artist,
        status:
          error.code === "REVISION_CONFLICT"
            ? "conflict"
            : error.code === "SONG_BUSY"
              ? "skipped"
              : "failed",
        message: error.message,
      };
    }
  });
}

export async function supplementLyrics(_job, payload, context) {
  const { store, cache, report } = context;
  const song = currentSong(store, payload.id);
  checkRevision(song, payload.expectedRevision);
  if (store.get("hidden:" + song.id) || song.lyrics?.trim()) return;
  if (
    context.isPlaying?.(song.id) ||
    store.db.prepare("SELECT id FROM queue WHERE song_id=?").get(song.id)
  )
    throw new Error("歌曲已在播放队列，请播放结束后重试歌词补充");
  report("lyrics-search");
  const match = await (context.findLyrics || findLyrics)(
    song.title,
    song.artist,
    song.duration,
  );
  report("lyrics-save");
  await saveSongMetadata(
    store,
    song.id,
    {
      expectedRevision: song.metadataRevision,
      lyrics: match.lyrics,
      lyricsSource: match,
    },
    cache,
  );
}
