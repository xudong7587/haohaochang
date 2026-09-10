import { lyricsTitle } from "../../shared/lyrics-identity.js";
import { lyricsJson, rankLyricsTracks } from "./lyrics-http.js";

const headers = {
  "User-Agent": "Mozilla/5.0",
  Referer: "https://music.163.com/",
};
export function neteaseLyricsProvider(fetcher = fetch) {
  return {
    id: "netease",
    async search(query) {
      async function search(term) {
        const body = await lyricsJson(
          fetcher,
          "https://music.163.com/api/search/get/web",
          {
            method: "POST",
            headers: {
              ...headers,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
              s: term,
              type: "1",
              limit: "30",
              offset: "0",
            }),
          },
        );
        if (body.code !== 200) throw new Error("网易云音乐搜索暂不可用");
        return (body.result?.songs || []).map((row) => ({
          title: row.name,
          artist: (row.artists || row.ar || []).map((a) => a.name).join("、"),
          duration: Number(row.duration || row.dt || 0) / 1000,
          sourceId: String(row.id),
          album: row.album?.name || row.al?.name || "",
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
          if (!/^\d{1,20}$/.test(row.sourceId))
            throw new Error("网易云歌曲标识无效");
          const url = new URL("https://music.163.com/api/song/lyric");
          url.search = new URLSearchParams({
            id: row.sourceId,
            lv: "-1",
            kv: "-1",
            tv: "-1",
          });
          const body = await lyricsJson(fetcher, url, { headers });
          if (body.code !== 200) throw new Error("网易云音乐歌词暂不可用");
          const lyrics = String(body.lrc?.lyric || "");
          return {
            ...row,
            lyrics: lyrics.length <= 25000 ? lyrics : "",
            source: "网易云音乐",
            sourceUrl: `https://music.163.com/#/song?id=${row.sourceId}`,
            evidence: [
              {
                kind: "lyrics-provider",
                provider: "netease",
                id: row.sourceId,
                album: row.album,
              },
            ],
          };
        }),
      );
      if (settled.length && settled.every((r) => r.status === "rejected"))
        throw new Error("网易云音乐歌词暂不可用");
      return settled
        .filter((r) => r.status === "fulfilled")
        .map((r) => r.value);
    },
  };
}
