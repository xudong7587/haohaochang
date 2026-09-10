import path from "node:path";
import { clipOnPc, waitingWorker } from "../clipping.js";
import { withBiliCookie } from "../sources.js";
import { stat } from "node:fs/promises";
import { downloadVideo } from "../media.js";
import { downloadBiliTracks } from "../bili-download.js";
import { encodeResource } from "../song-package.js";

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
    const split =
      payload.onlineSelection &&
      new URL(payload.url).hostname === "www.bilibili.com";
    const downloaded = split
      ? await downloadBiliTracks(
          payload.url,
          path.join(downloads, ".ktv-online", "dash"),
          get("favorites", {}).cookie,
          payload.quality,
          payload.expectedHeight,
        )
      : await withBiliCookie(get("favorites", {}).cookie, dir, (file) =>
          downloadVideo(
            payload.url,
            payload.onlineSelection
              ? path.join(downloads, ".ktv-online", "sources")
              : downloads,
            file,
            payload.quality,
          ),
        );
    const original = downloaded.file;
    if (payload.clip) context.report?.("clipping");
    let file = original,
      videoFile = downloaded.videoFile;
    if (split) {
      videoFile = await clipOnPc(
        store,
        job,
        payload,
        videoFile,
        downloads,
        true,
      );
      if (payload.clip) {
        file = path.join(path.dirname(videoFile), "clip-audio.m4a");
        await encodeResource(
          [
            "-i",
            original,
            "-ss",
            String(payload.clip.start),
            "-t",
            String(payload.clip.end - payload.clip.start),
            "-vn",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
          ],
          file,
        );
      }
    } else file = await clipOnPc(store, job, payload, original, downloads);
    const info = await stat(file);
    addJob("import", {
      file,
      videoFile,
      downloadedHeight: downloaded.height,
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
