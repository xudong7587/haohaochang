import express from "express";
import { safeMedia } from "./media-utils.js";
import { readArtistProfile, createArtistProfiles } from "./artist-profile.js";
import { validatePosterBytes } from "./poster-source.js";

export function artistApi({
  app,
  member,
  admin,
  store,
  dir,
  emit,
  posterCatalog,
  enabled = false,
  artistOptions = {},
}) {
  const profiles = createArtistProfiles({ store, dir, emit, ...artistOptions });
  function name(value) {
    if (typeof value !== "string" || !value.trim() || value.length > 160)
      throw new Error("歌手名称无效");
    if (
      !store.db
        .prepare("SELECT id FROM songs WHERE artist=? LIMIT 1")
        .get(value)
    )
      throw Object.assign(new Error("这位歌手已不在曲库中"), { status: 404 });
    return value;
  }
  app.get("/api/artist-profile", member, (req, res) =>
    res.json(readArtistProfile(store, name(req.query.artist))),
  );
  app.get("/api/artist-photo/:id", member, async (req, res) => {
    if (!/^[a-f0-9]{24}$/.test(req.params.id)) return res.sendStatus(404);
    const profile = store.get("artist-profile:" + req.params.id, {});
    if (!profile.file) return res.sendStatus(404);
    const file = await safeMedia(profile.file, [dir]);
    res.set("Cache-Control", "private, max-age=3600").sendFile(file);
  });
  app.post("/api/admin/artist-profile", admin, async (req, res) => {
    const artist = name(req.body.artist);
    if (
      typeof req.body.description !== "string" ||
      req.body.description.length > 2000
    )
      throw new Error("简介最多 2000 字");
    const source = /^https:\/\/www\.wikidata\.org\/wiki\/Q\d+$/.test(
      req.body.descriptionSource || "",
    )
      ? req.body.descriptionSource
      : "";
    res.json(
      await profiles.saveDescription(
        artist,
        req.body.description.trim(),
        req.body.expectedRevision,
        source,
      ),
    );
  });
  app.get("/api/admin/artist-description-search", admin, async (req, res) => {
    const result = await profiles.describe(name(req.query.artist));
    if (!result) throw new Error("暂未找到可确认的歌手介绍，可以手动填写");
    res.json(result);
  });
  app.get("/api/admin/artist-photo-search", admin, async (req, res) => {
    const source = await profiles.find(name(req.query.artist));
    if (!source) throw new Error("暂未找到歌手照片，请手动上传或从 B站选择");
    res.json(posterCatalog.register(source));
  });
  app.post("/api/admin/artist-photo/select", admin, async (req, res) => {
    const artist = name(req.query.artist),
      source = posterCatalog.candidate(req.body.candidateId);
    const bytes = validatePosterBytes(
      await posterCatalog.download(source.imageUrl),
    );
    res.json(
      await profiles.savePhoto(
        artist,
        bytes,
        source,
        req.body.expectedRevision,
      ),
    );
  });
  app.post(
    "/api/admin/artist-photo/upload",
    admin,
    express.raw({
      type: [
        "image/jpeg",
        "image/png",
        "image/webp",
        "application/octet-stream",
      ],
      limit: "8mb",
    }),
    async (req, res) => {
      res.json(
        await profiles.savePhoto(
          name(req.query.artist),
          validatePosterBytes(req.body),
          { provider: "manual", source: "手动上传" },
          Number(req.query.expectedRevision),
        ),
      );
    },
  );
  profiles.start(enabled);
  return profiles;
}
