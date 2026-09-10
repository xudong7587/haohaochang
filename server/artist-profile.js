import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { safeMedia } from "./media-utils.js";
import {
  findArtistPoster,
  downloadPoster,
  validatePosterBytes,
} from "./poster-source.js";
import { savePosterImage } from "./poster-image.js";
import { findArtistDescription } from "./artist-description.js";

export const artistId = (name) =>
  createHash("sha256").update(name).digest("hex").slice(0, 24);
export const artistKey = (name) => "artist-profile:" + artistId(name);
export function readArtistProfile(store, name) {
  const value = store.get(artistKey(name), {});
  return {
    artist: name,
    id: artistId(name),
    description: value.description || "",
    descriptionSource: value.descriptionSource || "",
    revision: value.revision || 0,
    hasPhoto: !!value.file && existsSync(value.file),
    photoVersion: value.hash || "",
    photoSource: value.source || null,
  };
}
export function createArtistProfiles({
  store,
  dir,
  emit,
  find = findArtistPoster,
  download = downloadPoster,
  describe = findArtistDescription,
}) {
  const pending = new Map();
  const root = path.join(dir, "artists");
  let stopped = false;
  function locked(name, work) {
    const previous = pending.get(name) || Promise.resolve();
    const result = previous
      .catch(() => {})
      .then(() => {
        if (stopped) throw new Error("服务正在关闭");
        return work();
      });
    pending.set(name, result);
    result
      .finally(() => {
        if (pending.get(name) === result) pending.delete(name);
      })
      .catch(() => {});
    return result;
  }
  function check(name, revision) {
    const old = store.get(artistKey(name), {});
    if (!Number.isInteger(revision) || revision !== (old.revision || 0))
      throw Object.assign(new Error("歌星资料已更新，请重新打开编辑后再保存"), {
        status: 409,
      });
    return old;
  }
  async function savePhoto(name, bytes, source, revision) {
    return locked(name, async () => {
      const old = check(name, revision);
      validatePosterBytes(bytes);
      const folder = path.join(root, artistId(name));
      await mkdir(folder, { recursive: true });
      await safeMedia(folder, [dir]);
      const input = path.join(folder, randomUUID() + ".image"),
        output = path.join(folder, randomUUID() + ".jpg");
      let published = false;
      try {
        await writeFile(input, bytes, { flag: "wx" });
        await savePosterImage(input, output, { crop: false });
        const jpeg = await readFile(output);
        if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8)
          throw new Error("歌手照片转换失败");
        // Store first, then retire the old file. Failed conversions never replace it.
        store.set(artistKey(name), {
          ...old,
          file: output,
          hash: createHash("sha256").update(jpeg).digest("hex"),
          source: {
            provider: source.provider,
            source: source.source,
            sourceUrl: source.sourceUrl || "",
          },
          revision: revision + 1,
        });
        published = true;
        if (old.file && path.dirname(old.file) === folder)
          await rm(old.file, { force: true }).catch(() => {});
        emit("library", {});
        return readArtistProfile(store, name);
      } finally {
        await rm(input, { force: true });
        if (!published) await rm(output, { force: true });
      }
    });
  }
  function saveDescription(name, description, revision, source = "") {
    return locked(name, () => {
      const old = check(name, revision);
      store.set(artistKey(name), {
        ...old,
        description,
        descriptionEdited: true,
        descriptionSource: source,
        revision: revision + 1,
      });
      emit("library", {});
      return readArtistProfile(store, name);
    });
  }
  async function autoPhoto(name, { force = false } = {}) {
    const before = readArtistProfile(store, name);
    if (before.hasPhoto && !force) return before;
    const [source, introduction] = await Promise.all([
      find(name),
      describe(name).catch(() => null),
    ]);
    if (!source)
      throw new Error("暂未找到这位歌手的照片，可以手动上传或去 B站挑选");
    let bytes;
    try {
      bytes = await download(source.imageUrl);
    } catch (error) {
      if (!source.fallbackImageUrl) throw error;
      bytes = await download(source.fallbackImageUrl);
    }
    await savePhoto(name, bytes, source, before.revision);
    if (introduction && !stopped)
      await locked(name, () => {
        const old = store.get(artistKey(name), {});
        if (old.descriptionEdited || old.description) return;
        store.set(artistKey(name), {
          ...old,
          description: introduction.description,
          descriptionSource: introduction.sourceUrl,
          revision: old.revision + 1,
        });
        emit("library", {});
      });
    return readArtistProfile(store, name);
  }
  let timer,
    busy = false;
  function start(enabled) {
    if (!enabled) return;
    async function tick() {
      if (busy || stopped) return;
      busy = true;
      try {
        const names = store.db
          .prepare(
            "SELECT DISTINCT artist FROM songs WHERE artist!='' AND artist!='未知歌手'",
          )
          .all()
          .map((row) => row.artist);
        const missing = names
          .filter(
            (name) =>
              !readArtistProfile(store, name).hasPhoto &&
              Date.now() - store.get("artist-attempt:" + artistId(name), 0) >
                24 * 3600000,
          )
          .slice(0, 3);
        await Promise.allSettled(
          missing.map(async (name) => {
            store.set("artist-attempt:" + artistId(name), Date.now());
            try {
              await autoPhoto(name);
            } catch {} // Manual photos or revisions always win a race.
          }),
        );
      } finally {
        busy = false;
      }
    }
    timer = setInterval(tick, 30000);
    timer.unref();
    setImmediate(tick);
  }
  return {
    savePhoto,
    saveDescription,
    autoPhoto,
    start,
    find,
    describe,
    async stop() {
      stopped = true;
      clearInterval(timer);
      await Promise.allSettled([...pending.values()]);
    },
  };
}
