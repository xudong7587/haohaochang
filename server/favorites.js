export function favoriteConfig(input, old = {}) {
  let id = String(input.favoriteId || "").trim();
  if (id.startsWith("http")) {
    const url = new URL(id);
    id = url.searchParams.get("fid") || "";
  }
  if (id && !/^\d{1,24}$/.test(id))
    throw new Error("请填写收藏夹 ID 或带 fid 的收藏夹链接，不是用户 UID");
  if (input.enabled && !id) throw new Error("请填写要监控的收藏夹");
  const fields = [
    "sessdata",
    "bili_jct",
    "buvid3",
    "dedeuserid",
    "ac_time_value",
  ];
  const credentials = Object.fromEntries(
    fields.map((k) => [
      k,
      input.clearCookie
        ? ""
        : String(input[k] || old.credentials?.[k] || "").trim(),
    ]),
  );
  const supplied = Object.values(credentials).some(Boolean);
  const cookie = input.clearCookie
    ? ""
    : String(input.cookie || old.cookie || "").slice(0, 16000);
  if (/[\r\n]/.test(cookie)) throw new Error("Cookie 不能包含换行");
  if (Object.values(credentials).some((v) => /[;\r\n\t]/.test(v)))
    throw new Error("凭证字段不能包含分号或换行");
  const assembled = input.cookie
    ? cookie
    : supplied
      ? `SESSDATA=${credentials.sessdata}; bili_jct=${credentials.bili_jct}; buvid3=${credentials.buvid3}; DedeUserID=${credentials.dedeuserid}`
      : cookie;
  return {
    enabled: input.enabled === true,
    favoriteId: id,
    cookie: assembled,
    credentials,
    intervalMinutes: Math.max(
      5,
      Math.min(1440, Number(input.intervalMinutes) || 10),
    ),
  };
}
export async function favoritePage(config, page = 1, fetcher = fetch) {
  const url = new URL("https://api.bilibili.com/x/v3/fav/resource/list");
  for (const [k, v] of Object.entries({
    media_id: config.favoriteId,
    pn: page,
    ps: 20,
    order: "mtime",
    type: 0,
    tid: 0,
  }))
    url.searchParams.set(k, String(v));
  const r = await fetcher(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Referer: "https://www.bilibili.com/",
      ...(config.cookie ? { Cookie: config.cookie } : {}),
    },
    signal: AbortSignal.timeout(20000),
    redirect: "error",
  });
  if (!r.ok) throw new Error("收藏夹访问失败（" + r.status + "）");
  const body = await r.json();
  if (body.code !== 0)
    throw new Error("收藏夹不可访问，请检查权限或 Cookie（" + body.code + "）");
  return {
    items: (body.data?.medias || [])
      .filter((m) => /^BV[0-9a-z]+$/i.test(m.bvid || ""))
      .map((m) => ({
        bvid: m.bvid,
        title: String(m.title || "").slice(0, 200),
        url: "https://www.bilibili.com/video/" + m.bvid,
      })),
    hasMore: body.data?.has_more === true,
  };
}

export async function favoriteParts(item, config, fetcher = fetch) {
  if (!/^BV[0-9a-z]+$/i.test(item.bvid || "")) throw new Error("无效 BV 号");
  const response = await fetcher(
    `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(item.bvid)}`,
    {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Referer: "https://www.bilibili.com/",
        ...(config.cookie ? { Cookie: config.cookie } : {}),
      },
      signal: AbortSignal.timeout(20000),
      redirect: "error",
    },
  );
  if (!response.ok) throw new Error(`获取分 P 失败（${response.status}）`);
  const body = await response.json();
  if (
    body.code !== 0 ||
    !Array.isArray(body.data?.pages) ||
    !body.data.pages.length
  )
    throw new Error("视频已失效或分 P 信息不可用");
  const pages = body.data.pages;
  const seen = new Set(),
    pageNumbers = new Set();
  return pages.map((p) => {
    const page = Number(p.page),
      cid = String(p.cid || "");
    if (
      !Number.isInteger(page) ||
      page < 1 ||
      page > 9999 ||
      !/^\d+$/.test(cid) ||
      seen.has(cid) ||
      pageNumbers.has(page)
    )
      throw new Error("分 P 信息无效，请稍后重试");
    seen.add(cid);
    pageNumbers.add(page);
    return {
      ...item,
      page,
      cid,
      pageCount: pages.length,
      collectionTitle: String(body.data.title || item.title || "").slice(
        0,
        200,
      ),
      title: String(
        p.part || body.data.title || item.title || `P${page}`,
      ).slice(0, 200),
      url: `https://www.bilibili.com/video/${item.bvid}?p=${page}`,
    };
  });
}
export function favoriteNfo(part) {
  const escape = (text) =>
    String(text || "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&apos;",
        })[c],
    );
  return `<?xml version="1.0" encoding="UTF-8"?>\n<episodedetails><title>${escape(part.title)}</title><showtitle>${escape(part.collectionTitle)}</showtitle><season>1</season><episode>${part.page}</episode><uniqueid type="bilibili">${escape(part.bvid + ":" + part.cid)}</uniqueid><url>${escape(part.url)}</url></episodedetails>\n`;
}
