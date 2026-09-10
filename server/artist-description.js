// Wikidata's short structured description is used only for an unambiguous
// exact-name performing artist. No biography is invented or copied wholesale.
export async function findArtistDescription(artist, { fetcher = fetch } = {}) {
  const url = new URL("https://www.wikidata.org/w/api.php");
  url.search = new URLSearchParams({
    action: "wbsearchentities",
    format: "json",
    language: "zh",
    uselang: "zh",
    type: "item",
    limit: "5",
    search: artist,
  }).toString();
  const response = await fetcher(url, {
    redirect: "error",
    signal: AbortSignal.timeout(4500),
    headers: {
      "User-Agent":
        "Haohaochang/0.3 (https://github.com/xudong7587/haohaochang)",
      "Accept-Language": "zh-CN,zh",
    },
  });
  if (!response.ok) throw new Error("歌手介绍来源暂时不可用");
  let size = 0;
  const chunks = [];
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 128 * 1024) throw new Error("歌手介绍响应过大");
    chunks.push(chunk);
  }
  const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  const key = (value) =>
    String(value || "")
      .normalize("NFKC")
      .trim()
      .toLowerCase();
  const matches = (data.search || []).filter(
    (row) =>
      [row.label, row.match?.text, ...(row.aliases || [])].some(
        (value) => key(value) === key(artist),
      ) &&
      /^[Q]\d+$/.test(row.id) &&
      /歌手|歌唱|音乐|音樂|演员|演員|作曲|乐队|樂隊|singer|musician|band|rapper/i.test(
        row.description || "",
      ),
  );
  if (matches.length !== 1) return null;
  return {
    description: String(matches[0].description).slice(0, 500),
    sourceUrl: "https://www.wikidata.org/wiki/" + matches[0].id,
  };
}
