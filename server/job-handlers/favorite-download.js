import path from "node:path";
import { stat, writeFile } from "node:fs/promises";
import { downloadVideo } from "../media.js";
import { withBiliCookie } from "../sources.js";

export async function favorite_download(job, payload, context) {
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
  {
    const { file } = await withBiliCookie(
      get("favorites", {}).cookie,
      dir,
      (cookieFile) => downloadVideo(payload.url, downloads, cookieFile),
    );
    const info = await stat(file);
    addJob("import", {
      file,
      signature: info.size + ":" + info.mtimeMs,
      title: payload.title,
      sourceUrl: payload.url,
      enqueue: payload.enqueue,
      name: payload.name,
    });
  }
}
