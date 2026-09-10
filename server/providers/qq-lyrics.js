import { lyricsTitle } from "../../shared/lyrics-identity.js";
import {
  lyricsJson,
  rankLyricsTracks,
  decodeLyricEntities,
} from "./lyrics-http.js";

const headers = { "User-Agent": "Mozilla/5.0", Referer: "https://y.qq.com/" };
export function qqLyricsProvider(fetcher = fetch) {
  return {
    id: "qqmusic",
    async search(query) {
      async function search(term) {
        const url = new URL(
          "https://c.y.qq.com/soso/fcgi-bin/client_search_cp",
        );
        url.search = new URLSearchParams({
          w: term,
          format: "json",
          p: "1",
          n: "30",
        });
        const body = await lyricsJson(fetcher, url, { headers });
        if (body.code !== 0 || !Array.isArray(body.data?.song?.list))
          throw new Error("QQ 音乐搜索暂不可用");
        return body.data.song.list.map((row) => ({
          title: row.songname,
          artist: (row.singer || []).map((a) => a.name).join("、"),
          duration: Number(row.interval) || 0,
          sourceId: row.songmid,
          album: row.albumname || "",
        }));
      }
      let rows = rankLyricsTracks(
        await search(`${query.artist} ${lyricsTitle(query.title)}`),
        query,
      );
      if (!rows.length)
        rows = rankLyricsTracks(await search(lyricsTitle(query.title)), query);
      const settled = await Promise.allSettled(
        rows.map(async (row) => {
          if (!/^[a-zA-Z0-9]{8,32}$/.test(row.sourceId))
            throw new Error("QQ 歌曲标识无效");
          const url = new URL(
            "https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg",
          );
          url.search = new URLSearchParams({
            songmid: row.sourceId,
            format: "json",
            nobase64: "1",
            g_tk: "5381",
          });
          const body = await lyricsJson(fetcher, url, { headers });
          if (body.code !== 0) throw new Error("QQ 音乐歌词暂不可用");
          const lyrics = decodeLyricEntities(body.lyric);
          return {
            ...row,
            lyrics: lyrics.length <= 25000 ? lyrics : "",
            source: "QQ 音乐",
            sourceUrl: `https://y.qq.com/n/ryqq/songDetail/${row.sourceId}`,
            evidence: [
              {
                kind: "lyrics-provider",
                provider: "qqmusic",
                id: row.sourceId,
                album: row.album,
              },
            ],
          };
        }),
      );
      if (settled.length && settled.every((r) => r.status === "rejected"))
        throw new Error("QQ 音乐歌词暂不可用");
      return settled
        .filter((r) => r.status === "fulfilled")
        .map((r) => r.value);
    },
  };
}
