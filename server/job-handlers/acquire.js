import { replaceVideo } from "../video-replacement.js";
import { acquireSong, findVideo } from "../acquisition.js";
import { metadata } from "../library.js";

export async function acquire(job, payload, context) {
  const {
    db,
    get,
    set,
    store,
    dir,
    roots,
    downloads,
    cache,
    legacyCache,
    emit,
    addJob,
    enqueue,
    fail,
  } = context;
  if (job.kind === "acquire" || job.kind === "find-video") {
    const result = await (job.kind === "acquire" ? acquireSong : findVideo)(
      payload,
      { store, downloads, roots, outputs: cache },
    );
    if (result.review) {
      db.prepare(
        "UPDATE jobs SET status='review',payload=?,error=? WHERE id=?",
      ).run(
        JSON.stringify({
          ...payload,
          metadata: result.metadata,
          candidatePath: result.candidatePath,
          candidate: result.candidate,
        }),
        result.review,
        job.id,
      );
      emit("library", {});
      emit();
      return "review";
    }
    if (job.kind === "find-video" && result.file) {
      const song = db.prepare("SELECT * FROM songs WHERE id=?").get(payload.id);
      await replaceVideo(
        store,
        song,
        result.file,
        result.sourceUrl || "",
        cache,
        { confirmed: true, offset: result.offset },
      );
    }
    if (result.id) {
      if (payload.enqueue) enqueue(result.id, payload.name || "在线点歌");
      addJob("find-video", {
        id: result.id,
        title: result.title,
        artist: result.artist,
      });
    }
  }
}
