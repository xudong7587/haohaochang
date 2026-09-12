import { clean } from "../http-utils.js";
import { readArtistProfile } from "../artist-profile.js";
import { matchesInitials } from "../../shared/initials.js";
import { searchText } from "../media-utils.js";

export function orderSongs(rows, mode) {
  if (mode === "title")
    rows.sort(
      (a, b) =>
        a.title.localeCompare(b.title, "zh-CN") || a.id.localeCompare(b.id),
    );
  if (mode === "random") {
    for (let i = rows.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [rows[i], rows[j]] = [rows[j], rows[i]];
    }
  }
  return rows;
}

export function publicLibraryApi({
  app,
  admin,
  member,
  store,
  db,
  get,
  set,
  cache,
  legacyCache,
  dir,
  roots,
  downloads,
  addJob,
  work,
  emit,
  enqueue,
  snapshot,
  allowedOrigin,
}) {
  app.get("/api/songs", member, (req, res) => {
    const q = clean(req.query.q).toLowerCase().replace(/[%_!]/g, "!$&");
    const artist = clean(req.query.artist);
    res.json(
      orderSongs(
        db
          .prepare(
            "SELECT id,title,artist,duration,mode,status,error,source,backing,vocal,audio,metadataRevision,resourceRevision,needs_video,lyrics,metadata_source,needs_review,tags,CASE WHEN poster!='' THEN 1 ELSE 0 END AS hasPoster FROM songs WHERE search LIKE ? ESCAPE '!' AND (?='' OR artist=?) AND (?='' OR EXISTS (SELECT 1 FROM json_each(songs.tags) WHERE value=?)) ORDER BY created DESC",
          )
          .all(
            `%${q}%`,
            artist,
            artist,
            clean(req.query.tag),
            clean(req.query.tag),
          )
          .filter((s) => !get("hidden:" + s.id))
          .filter((s) => matchesInitials(s.title, req.query.initials)),
        req.query.sort,
      )
        .slice(0, 300)
        .map((s) => ({
          ...s,
          posterVersion: get("poster-source:" + s.id)?.hash || "",
        })),
    );
  });
  app.get("/api/artists", member, (req, res) => {
    const counts = new Map();
    for (const s of db.prepare("SELECT id,artist FROM songs").all())
      if (!get("hidden:" + s.id))
        counts.set(s.artist, (counts.get(s.artist) || 0) + 1);
    res.json(
      [...counts]
        .filter(
          ([artist]) =>
            matchesInitials(artist, req.query.initials) &&
            searchText(artist, "").includes(clean(req.query.q).toLowerCase()),
        )
        .map(([artist, count]) => ({
          ...readArtistProfile(store, artist),
          count,
        }))
        .sort((a, b) => a.artist.localeCompare(b.artist)),
    );
  });
}
