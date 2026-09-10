import { currentSong, checkRevision, assertSongIdle } from "./song-writes.js";
import { posterName } from "./song-poster.js";
import path from "node:path";
import { existsSync } from "node:fs";
export function posterApi({ app, admin, store, addJob, emit }) {
  function submit(item) {
    const song = currentSong(store, item.id);
    checkRevision(song, item.expectedRevision);
    assertSongIdle(store, song.id);
    if (
      !item.force &&
      song.poster &&
      existsSync(song.poster) &&
      path.basename(song.poster) === posterName
    )
      return { id: song.id, status: "skipped", message: "已有歌曲封面" };
    const jobId = addJob("poster", { id: song.id, force: item.force === true });
    return {
      id: song.id,
      status: "success",
      message: "已加入封面任务，原唱和伴奏保持可用",
      jobId,
    };
  }
  app.post("/api/admin/library/:id/poster", admin, (req, res) => {
    const result = submit({ ...req.body, id: req.params.id });
    emit("library", {});
    res.json(result);
  });
  app.post("/api/admin/poster-batch", admin, (req, res) => {
    if (
      !Array.isArray(req.body.items) ||
      !req.body.items.length ||
      req.body.items.length > 20
    )
      throw new Error("每批需包含 1 至 20 首歌曲");
    const results = req.body.items.map((item) => {
      try {
        return submit(item);
      } catch (error) {
        return {
          id: item?.id,
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
    emit("library", {});
    res.json({ results });
  });
}
