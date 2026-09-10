import path from "node:path";
import { readFile, realpath, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { sameLyricsTitle, lyricsArtist } from "../../shared/lyrics-identity.js";

const normalize = (value) =>
  String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, "");
const inside = (root, file) => {
  const relative = path.relative(root, file);
  return (
    relative &&
    !relative.startsWith(".." + path.sep) &&
    relative !== ".." &&
    !path.isAbsolute(relative)
  );
};

// Operator-managed JSON: [{id,title,artist,duration,version,file,sourceUrl}].
// UTF-8 LRC files (including enhanced Chinese LRC) stay beside/below the index.
export function localLyricsProvider(indexPath) {
  return {
    id: "local-lrc",
    async search(query) {
      const index = await realpath(path.resolve(indexPath)),
        root = path.dirname(index);
      if ((await stat(index)).size > 8 * 1024 * 1024)
        throw new Error("本地歌词索引超过 8 MB");
      const records = JSON.parse(
        (await readFile(index, "utf8")).replace(/^\uFEFF/, ""),
      );
      if (!Array.isArray(records) || records.length > 20000)
        throw new Error("本地歌词索引必须为最多 20000 项的 JSON 数组");
      const matches = records.filter(
        (row) =>
          row &&
          sameLyricsTitle(row.title, query.title) &&
          lyricsArtist(row.artist) === lyricsArtist(query.artist),
      );
      const results = [];
      for (const row of matches.slice(0, 200)) {
        if (typeof row.file !== "string" || path.isAbsolute(row.file))
          throw new Error("本地歌词路径必须相对索引目录");
        const file = await realpath(path.resolve(root, row.file));
        if (!inside(root, file) || path.extname(file).toLowerCase() !== ".lrc")
          throw new Error("本地歌词文件必须位于索引目录内且为 LRC");
        if ((await stat(file)).size > 1024 * 1024)
          throw new Error("本地 LRC 超过 1 MB");
        const lyrics = (await readFile(file, "utf8")).replace(/^\uFEFF/, "");
        results.push({
          title: row.title,
          artist: row.artist,
          duration: Number(row.duration) || 0,
          version: String(row.version || ""),
          lyrics,
          source: "本地 LRC",
          sourceId: String(row.id || row.file),
          sourceUrl:
            typeof row.sourceUrl === "string" &&
            /^https?:\/\//.test(row.sourceUrl)
              ? row.sourceUrl
              : "",
          evidence: [
            {
              kind: "local-import",
              file: row.file,
              sha256: createHash("sha256").update(lyrics).digest("hex"),
              license: String(row.license || ""),
            },
          ],
        });
      }
      return results;
    },
  };
}
