import path from "node:path";
import { clipOnPc, waitingWorker } from "../clipping.js";
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
    const ai = get("ai", {});
    if (payload.onlineSelection && !ai.pcEndpoint) throw waitingWorker();
    context.report?.("downloading");
    const { file: original } = await withBiliCookie(
      get("favorites", {}).cookie,
      dir,
      (file) =>
        downloadVideo(
          payload.url,
          payload.onlineSelection
            ? path.join(downloads, ".ktv-online", "sources")
            : downloads,
          file,
        ),
    );
    if (payload.clip) context.report?.("clipping");
    const file = await clipOnPc(store, job, payload, original, downloads);
    const info = await stat(file);
    addJob("import", {
      file,
      signature: info.size + ":" + info.mtimeMs,
      title: payload.title,
      artist: payload.artist,
      approved: payload.onlineSelection === true,
      metadata: payload.onlineSelection
        ? {
            title: payload.title,
            artist: payload.artist,
            needs_review: payload.artist ? 0 : 1,
            evidence: [
              {
                kind: "user-selection",
                url: payload.url,
                clip: payload.clip || null,
              },
            ],
          }
        : undefined,
      clip: payload.clip,
      originalFile: original,
      candidate: payload.candidate,
      sourceUrl: payload.url,
      enqueue: payload.enqueue,
      name: payload.name,
      isBacking: payload.isBacking,
    });
  }
}
