import path from "node:path";
import { stat } from "node:fs/promises";
import { currentSong } from "./song-writes.js";
import { resourceManifest, resourceNames } from "./resource-manifest.js";
import { inspectPackage } from "./resource-health.js";
import { safeMedia, probe } from "./media-utils.js";
import { posterBase } from "./song-poster.js";
export function libraryPreviewApi({
  app,
  admin,
  store,
  roots,
  cache,
  downloads,
}) {
  app.get("/api/admin/library/:id/preview", admin, async (req, res) => {
    const song = currentSong(store, req.params.id);
    const directory = store.get("package:" + song.id);
    if (directory && store.get("package-ready:" + song.id))
      await inspectPackage(store, song, directory);
    let manifest = resourceManifest(store, song, cache);
    // A preview is always original vocals; never fall back to an accompaniment.
    if (!manifest.vocal && song.mode === "original") {
      try {
        const source = await safeMedia(song.path, [...roots, downloads]);
        const info = await probe(source);
        if (info.audio.length) {
          const url = `/api/admin/library/${song.id}/preview-source`;
          manifest = {
            ...manifest,
            revision: song.resourceRevision,
            vocal: true,
            video: info.hasVideo,
            resources: {
              vocal: {
                available: true,
                url,
                duration: info.duration,
                offset: 0,
              },
              ...(info.hasVideo
                ? {
                    video: {
                      available: true,
                      url,
                      duration: info.duration,
                      offset: 0,
                    },
                  }
                : {}),
            },
          };
        }
      } catch {}
    }
    manifest = {
      ...manifest,
      backing: false,
      resources: { ...manifest.resources, backing: { available: false } },
    };
    const files = [];
    for (const [kind, name] of Object.entries(resourceNames)) {
      if (!directory) continue;
      try {
        const file = await safeMedia(path.join(directory, name), [cache]);
        const info = await stat(file);
        files.push({ name, kind, size: info.size });
      } catch {}
    }
    if (song.poster) {
      try {
        files.push({
          name: path.basename(song.poster),
          kind: "poster",
          size: (await stat(song.poster)).size,
        });
      } catch {}
    }
    const source = store.get("poster-source:" + song.id, null);
    res.json({
      id: song.id,
      title: song.title,
      artist: song.artist,
      duration: song.duration,
      hasPoster: !!song.poster,
      posterVersion: source?.hash || "",
      posterSource: source,
      manifest,
      folder: directory
        ? posterBase(store, song.id, cache)
        : path.dirname(song.path),
      resourceFolder: directory || "",
      files,
      note: manifest.vocal
        ? "仅在此窗口预览原唱，不会加入歌房队列。"
        : "这首歌还没有可预览的原唱，请先完成歌曲整理。",
    });
  });
  app.get("/api/admin/library/:id/preview-source", admin, async (req, res) => {
    const song = currentSong(store, req.params.id);
    if (song.mode !== "original") throw new Error("请使用已整理的原唱资源预览");
    res.sendFile(await safeMedia(song.path, [...roots, downloads]));
  });
}
