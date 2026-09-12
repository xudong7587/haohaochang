import { createHash } from "node:crypto";
import { stat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { favoriteNfo } from "./favorites.js";
import {
  completeLocalMetadata,
  nfoIdentity,
  intakeKey,
  stageLocalFile,
  intakeCleanupSources,
  fileHash,
} from "./local-intake.js";
import { withKeyLock } from "./song-writes.js";
import { saveSongMetadata } from "./song-metadata.js";
import { safeMedia } from "./media-utils.js";

export const bundleKey = (id) => "favorite-bundle:" + id;
const identity = (fid, bvid) =>
  createHash("sha256")
    .update(fid + ":" + bvid)
    .digest("hex")
    .slice(0, 24);
const signature = (s) => s.size + ":" + s.mtimeMs;
const usable = (meta) =>
  !!meta?.title?.trim() && !!meta?.artist?.trim() && meta.artist !== "未知歌手";
function samePart(url, part) {
  try {
    const u = new URL(url);
    return (
      /(^|\.)bilibili\.com$/.test(u.hostname) &&
      u.pathname.split("/").filter(Boolean).at(-1) === part.bvid &&
      Number(u.searchParams.get("p") || 1) === part.page
    );
  } catch {
    return false;
  }
}
function analyzeLater(group, context) {
  if (group.parts.every((p) => p.file || p.legacySongId))
    context.addJob("favorite-analyze", {
      bundleId: group.id,
      title: group.title,
      idempotencyKey: `favorite-analyze:${group.id}:${group.revision}`,
    });
}

// Collection records coordinate files; they are never inserted into songs.
export async function registerFavoriteBundle(parts, context) {
  const { store, addJob } = context;
  const fid = store.get("favorites", {}).favoriteId || "legacy";
  const id = identity(fid, parts[0].bvid);
  return withKeyLock(store, bundleKey(id), async () => {
    const previous = store.get(bundleKey(id));
    const rows = store.db
      .prepare(
        "SELECT * FROM jobs WHERE kind IN ('favorite-download','local-intake','import')",
      )
      .all()
      .map((j) => ({ ...j, p: JSON.parse(j.payload) }));
    const group = {
      ...previous,
      id,
      title: parts[0].collectionTitle,
      bvid: parts[0].bvid,
      revision: previous?.revision || 1,
      status: previous?.status || "downloading",
      parts: [],
    };
    for (const part of parts) {
      const old = previous?.parts.find((p) => p.cid === part.cid);
      if (old) {
        group.parts.push({ ...old, ...part, bundleId: id });
        continue;
      }
      const entry = { ...part, bundleId: id };
      // Resume 1.0.1 staged files, or reuse an explicitly attributed old P1.
      const imported = rows.find(
        (j) =>
          j.kind === "import" &&
          j.status === "done" &&
          j.p.id &&
          samePart(j.p.sourceUrl, part) &&
          store.db.prepare("SELECT id FROM songs WHERE id=?").get(j.p.id),
      );
      if (imported && imported.p.favoriteCid === part.cid)
        entry.legacySongId = imported.p.id;
      else if (imported) entry.candidateSongId = imported.p.id;
      else {
        const local = rows.find(
          (j) => j.kind === "local-intake" && samePart(j.p.sourceUrl, part),
        );
        if (local && ["running", "queued"].includes(local.status))
          entry.intakeJob = local.id;
        if (local && !["running", "queued"].includes(local.status)) {
          const intake = store.get(intakeKey(local.p.file));
          const file = intake?.file || local.p.file;
          try {
            entry.signature = signature(await stat(file));
            entry.file = file;
          } catch {}
        }
      }
      const marker =
        store.get(`favorite-part:${fid}:${part.bvid}:${part.cid}`) ||
        (part.page === 1 && store.get(`favorite-seen:${fid}:${part.bvid}`));
      const active = rows.find(
        (j) =>
          (j.id === marker ||
            (j.id === context.currentDownload &&
              (j.p.cid
                ? String(j.p.cid) === part.cid
                : samePart(
                    j.p.url ||
                      `https://www.bilibili.com/video/${j.p.bvid}?p=${j.p.page || 1}`,
                    part,
                  )))) &&
          ["queued", "running", "failed", "waiting-worker"].includes(j.status),
      );
      if (active) {
        entry.downloadJob = active.id;
        store.db
          .prepare("UPDATE jobs SET payload=? WHERE id=?")
          .run(JSON.stringify({ ...active.p, ...entry }), active.id);
      }
      group.parts.push(entry);
    }
    if (
      previous &&
      group.parts.some((p) => !previous.parts.some((old) => old.cid === p.cid))
    ) {
      group.revision++;
      group.status = "downloading";
    }
    store.set(bundleKey(id), group);
    for (const part of group.parts) {
      if (
        !part.file &&
        !part.legacySongId &&
        !part.intakeJob &&
        !part.downloadJob
      )
        part.downloadJob = addJob("favorite-download", part);
      store.set(
        `favorite-part:${fid}:${part.bvid}:${part.cid}`,
        part.downloadJob || "bundle:" + id,
      );
    }
    store.set(bundleKey(id), group);
    analyzeLater(group, context);
    return group;
  });
}

export async function finishFavoritePart(part, file, context) {
  const { store } = context;
  await withKeyLock(store, bundleKey(part.bundleId), async () => {
    const group = store.get(bundleKey(part.bundleId));
    const entry = group?.parts.find((p) => p.cid === part.cid);
    if (!entry) throw new Error("合集分 P 已变化，请重新同步收藏夹");
    Object.assign(entry, { file, signature: signature(await stat(file)) });
    store.set(bundleKey(group.id), group);
    analyzeLater(group, context);
  });
}

export async function analyzeFavoriteBundle(_job, payload, context) {
  const { store } = context;
  return withKeyLock(store, bundleKey(payload.bundleId), async () => {
    const group = store.get(bundleKey(payload.bundleId));
    if (!group || !group.parts.every((p) => p.file || p.legacySongId)) return;
    group.status = "analyzing";
    store.set(bundleKey(group.id), group);
    for (const part of group.parts) {
      if (part.processJob) continue;
      const meta = part.legacySongId
        ? nfoIdentity(favoriteNfo(part), part.title)
        : await completeLocalMetadata(
            part.file,
            context.downloads,
            store,
            context.localMetadataSearch,
          );
      // Per-P titles must never silently become the collection name.
      if (group.parts.length > 1 && meta.title === group.title)
        meta.title = part.title;
      if (group.artist && (!usable(meta) || part.artistConfirmed))
        meta.artist = group.artist;
      if (part.titleOverride) meta.title = part.titleOverride;
      part.metadata = meta;
    }
    if (group.parts.some((p) => !p.processJob && !usable(p.metadata))) {
      group.status = "review";
    } else {
      group.status = "processing";
      // Persist before scheduling so crash/retry finds the same per-CID operation.
      store.set(bundleKey(group.id), group);
      for (const part of group.parts) {
        if (!part.processJob)
          part.processJob = context.addJob("favorite-process", {
            bundleId: group.id,
            cid: part.cid,
            ...(part.file ? { file: part.file } : {}),
            title: part.metadata.title,
            artist: part.metadata.artist,
            idempotencyKey: `favorite-process:${group.id}:${part.cid}`,
          });
      }
    }
    store.set(bundleKey(group.id), group);
    context.emit?.("library", {});
  });
}

export async function processFavoritePart(job, payload, context) {
  const { store, downloads } = context;
  const group = store.get(bundleKey(payload.bundleId));
  const part = group?.parts.find((p) => p.cid === payload.cid);
  if (!part || !usable(part.metadata))
    throw new Error("请先补充该歌曲的歌名与歌手");
  if (part.legacySongId) {
    const song = store.db
      .prepare("SELECT * FROM songs WHERE id=?")
      .get(part.legacySongId);
    if (!song) throw new Error("旧歌曲已删除，请重新同步对应分 P");
    return;
  }
  if (
    part.candidateSongId &&
    (await fileHash(await safeMedia(part.file, [downloads]))).slice(0, 24) ===
      part.candidateSongId
  ) {
    const song = store.db
      .prepare("SELECT * FROM songs WHERE id=?")
      .get(part.candidateSongId);
    if (
      song &&
      song.title === group.title &&
      song.title !== part.metadata.title
    )
      await saveSongMetadata(
        store,
        song.id,
        {
          title: part.metadata.title,
          artist: part.metadata.artist,
          expectedRevision: song.metadataRevision,
        },
        context.cache,
      );
  }
  const original = part.file;
  let saved = store.get(intakeKey(original));
  if (
    saved?.status === "staged" &&
    saved.metadata.artist !== part.metadata.artist
  ) {
    const current = saved.file;
    await stageLocalFile(
      job,
      {
        file: current,
        signature: signature(await stat(current)),
        artistOverride: part.metadata.artist,
      },
      context,
    );
    saved = store.get(intakeKey(current));
  }
  if (saved?.status !== "staged")
    await stageLocalFile(
      job,
      {
        file: original,
        signature: part.signature,
        artistOverride: part.metadata.artist,
      },
      context,
    );
  const staged =
    saved?.status === "staged" ? saved : store.get(intakeKey(original));
  if (!staged?.file) throw new Error("歌曲整理记录缺失，请重试");
  const file = await safeMedia(staged.file, [downloads]);
  const info = await stat(file);
  const metadata = {
    ...staged.metadata,
    ...part.metadata,
    poster: staged.metadata.poster,
    albumPoster: staged.metadata.albumPoster,
    needs_review: 0,
  };
  const importJob = context.addJob("import", {
    file,
    signature: signature(info),
    sourceUrl: part.url,
    favoriteCid: part.cid,
    approved: true,
    metadata,
    localIntake: true,
    cleanupSources: await intakeCleanupSources(store, file, downloads),
    idempotencyKey: `favorite-import:${group.id}:${part.cid}`,
  });
  await withKeyLock(store, bundleKey(group.id), async () => {
    const fresh = store.get(bundleKey(group.id));
    Object.assign(
      fresh.parts.find((p) => p.cid === part.cid),
      { file, importJob },
    );
    store.set(bundleKey(group.id), fresh);
  });
}

export function favoriteBundles(store) {
  return store.db
    .prepare("SELECT value FROM settings WHERE key LIKE 'favorite-bundle:%'")
    .all()
    .map((r) => JSON.parse(r.value));
}
export function favoriteBundlesApi({
  app,
  admin,
  store,
  addJob,
  emit,
  work = () => {},
}) {
  app.get("/api/admin/favorite-bundles", admin, (_req, res) => {
    res.json(
      favoriteBundles(store)
        .filter((g) => g.status !== "processing")
        .map((g) => ({
          id: g.id,
          title: g.title,
          status: g.status,
          artist: g.artist || "",
          total: g.parts.length,
          downloaded: g.parts.filter((p) => p.file || p.legacySongId).length,
          parts: g.parts.map((p) => ({
            cid: p.cid,
            page: p.page,
            title: p.metadata?.title || p.title,
            artist: p.metadata?.artist || "",
            downloaded: !!(p.file || p.legacySongId),
            jobId: p.downloadJob,
          })),
        })),
    );
  });
  app.post("/api/admin/favorite-bundles/:id/retry", admin, async (req, res) => {
    if (store.readOnlyMedia) throw new Error("只读模式不能处理收藏夹文件");
    await withKeyLock(store, bundleKey(req.params.id), async () => {
      const group = store.get(bundleKey(req.params.id));
      if (!group || group.status !== "downloading")
        throw new Error("此合集不在下载阶段");
      for (const part of group.parts) {
        if (part.file || part.legacySongId || part.intakeJob) continue;
        const job = store.db
          .prepare("SELECT status FROM jobs WHERE id=?")
          .get(part.downloadJob);
        if (job?.status === "failed")
          store.db
            .prepare("UPDATE jobs SET status='queued',error='' WHERE id=?")
            .run(part.downloadJob);
        else if (!job || job.status === "cancelled")
          part.downloadJob = addJob("favorite-download", part);
      }
      store.set(bundleKey(group.id), group);
      setImmediate(work);
      emit?.("tasks", {});
      res.json({ ok: true });
    });
  });
  app.post(
    "/api/admin/favorite-bundles/:id/confirm",
    admin,
    async (req, res) => {
      if (store.readOnlyMedia) throw new Error("只读模式不能处理收藏夹文件");
      await withKeyLock(store, bundleKey(req.params.id), async () => {
        const group = store.get(bundleKey(req.params.id));
        if (!group || group.status !== "review")
          throw new Error("请等待全部分 P 下载与识别完成，再补充资料");
        const artist = String(req.body.artist || "").trim();
        if (
          !artist ||
          artist === "未知歌手" ||
          artist.length > 120 ||
          /[\x00-\x1f]/.test(artist)
        )
          throw new Error("请填写有效的歌手名字");
        if (
          group.parts.length === 1 &&
          req.body.title !== undefined &&
          !String(req.body.title).trim()
        )
          throw new Error("请填写歌名");
        group.artist = artist;
        group.revision++;
        for (const part of group.parts) {
          // An album may contain duets: retain explicitly recognized performers.
          if (!usable(part.metadata)) part.artistConfirmed = true;
          if (group.parts.length === 1 && req.body.title)
            part.titleOverride = String(req.body.title).trim().slice(0, 120);
        }
        group.status = "analyzing";
        store.set(bundleKey(group.id), group);
        analyzeLater(group, { addJob });
        emit?.("library", {});
        res.json({ ok: true, count: group.parts.length });
      });
    },
  );
}

// Recover receipts saved before a shutdown and adopt 1.0.1 intake jobs after they finish.
export async function resumeFavoriteBundles(context) {
  for (const snapshot of favoriteBundles(context.store)) {
    if (snapshot.status === "processing") continue;
    await withKeyLock(context.store, bundleKey(snapshot.id), async () => {
      const group = context.store.get(bundleKey(snapshot.id));
      for (const part of group.parts) {
        if (!part.intakeJob || part.file) continue;
        const row = context.store.db
          .prepare("SELECT payload,status FROM jobs WHERE id=?")
          .get(part.intakeJob);
        if (!row || ["running", "queued"].includes(row.status)) continue;
        const payload = JSON.parse(row.payload),
          saved = context.store.get(intakeKey(payload.file));
        const file = saved?.status === "staged" ? saved.file : payload.file;
        try {
          part.signature = signature(await stat(file));
          part.file = file;
        } catch {
          continue;
        }
      }
      context.store.set(bundleKey(group.id), group);
      analyzeLater(group, context);
    });
  }
}

// bili-sync folders have no completion API: wait until every media file is stable
// across scans and no partial download remains before grouping the visible set.
export async function discoverLocalFavoriteBundles(files, settled, context) {
  const claimed = new Set(),
    directories = new Map();
  for (const file of files) {
    const directory = path.dirname(file);
    if (/^Season\s*\d+$/i.test(path.basename(directory))) {
      const list = directories.get(directory) || [];
      list.push(file);
      directories.set(directory, list);
    }
  }
  for (const [directory, members] of directories) {
    let xml;
    try {
      const nfo = await safeMedia(path.join(directory, "..", "tvshow.nfo"), [
        context.downloads,
      ]);
      if ((await stat(nfo)).size > 262144) continue;
      xml = await readFile(nfo, "utf8");
    } catch {
      continue;
    }
    members.forEach((file) => claimed.add(file));
    if (!members.every((file) => settled.has(file))) continue;
    if (
      (await readdir(directory)).some((name) =>
        /\.(part|tmp|aria2|download)$/i.test(name),
      )
    )
      continue;
    const id = identity("bili-sync-local", directory);
    await withKeyLock(context.store, bundleKey(id), async () => {
      const previous = context.store.get(bundleKey(id));
      const group = previous || {
        id,
        external: true,
        title: nfoIdentity(xml, path.basename(path.dirname(directory))).title,
        revision: 1,
        status: "downloading",
        parts: [],
      };
      let added = 0;
      for (const file of members) {
        if (group.parts.some((p) => p.originalFile === file)) continue;
        const info = await stat(file);
        const meta = await completeLocalMetadata(
          file,
          context.downloads,
          context.store,
          async () => [],
        );
        group.parts.push({
          cid: identity("file", file),
          page:
            Number(path.basename(file).match(/S\d+E(\d+)/i)?.[1]) ||
            group.parts.length + 1,
          title: meta.title,
          collectionTitle: group.title,
          file,
          originalFile: file,
          signature: signature(info),
          bundleId: id,
          url: "",
        });
        added++;
      }
      if (!added) return;
      if (previous) group.revision++;
      group.status = "downloading";
      context.store.set(bundleKey(id), group);
      analyzeLater(group, context);
    });
  }
  return claimed;
}
