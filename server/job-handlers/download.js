import { withBiliCookie } from "../sources.js";
import { stat } from "node:fs/promises";
import { downloadVideo } from "../media.js";

export async function download(job, payload, context) {
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
  if (job.kind === "download") {
    const { file } = await withBiliCookie(
      get("favorites", {}).cookie,
      dir,
      (file) => downloadVideo(payload.url, downloads, file),
    );
    const info = await stat(file);
    addJob("import", {
      file,
      signature: info.size + ":" + info.mtimeMs,
      title: payload.title,
      candidate: payload.candidate,
      sourceUrl: payload.url,
      enqueue: payload.enqueue,
      name: payload.name,
      isBacking: payload.isBacking,
    });
  }
}
