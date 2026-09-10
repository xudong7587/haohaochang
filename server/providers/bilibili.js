import { videoQuality, qualityChoices } from "../../shared/video-quality.js";
import { signWbi } from "./bili-wbi.js";
const headers = (cookie) => ({
  "User-Agent": "Mozilla/5.0",
  Referer: "https://www.bilibili.com/",
  ...(cookie ? { Cookie: cookie } : {}),
});
const duration = (value) =>
  typeof value === "number"
    ? value
    : String(value || "")
        .split(":")
        .reduce((total, part) => total * 60 + Number(part), 0) || null;

export const bilibiliProvider = {
  async search(query, cookie = "", fetcher = fetch, page = 1) {
    const url = new URL("https://api.bilibili.com/x/web-interface/search/type");
    url.search = new URLSearchParams({
      search_type: "video",
      keyword: query,
      page: String(page),
    }).toString();
    const response = await fetcher(url, {
      headers: headers(cookie),
      signal: AbortSignal.timeout(15000),
      redirect: "error",
    });
    if (!response.ok)
      throw new Error("Bilibili 搜索暂时不可用，可粘贴视频链接");
    const body = await response.json();
    if (body.code !== 0)
      throw new Error("Bilibili 拒绝了搜索请求，可粘贴视频链接");
    return (body.data?.result || []).slice(0, 20).map((row) => ({
      title: String(row.title || "").replace(/<[^>]*>/g, ""),
      cover: String(row.pic || "").replace(/^\/\//, "https://"),
      artist: row.author,
      uploader: row.author,
      url: `https://www.bilibili.com/video/${row.bvid}`,
      duration: duration(row.duration),
      provider: "bilibili",
    }));
  },
  async metadata(url, cookie = "", fetcher = fetch) {
    const parsed = new URL(url),
      id = parsed.pathname.split("/").filter(Boolean).pop();
    const endpoint = new URL("https://api.bilibili.com/x/web-interface/view");
    endpoint.searchParams.set(
      id.startsWith("BV") ? "bvid" : "aid",
      id.replace(/^av/, ""),
    );
    const response = await fetcher(endpoint, {
      headers: headers(cookie),
      signal: AbortSignal.timeout(20000),
      redirect: "error",
    });
    if (!response.ok) throw new Error("B站信息读取失败");
    const body = await response.json();
    if (body.code !== 0 || !body.data) throw new Error("B站视频不可访问");
    const pageNumber = Number(parsed.searchParams.get("p") || 1),
      pages = body.data.pages || [];
    const page = pages.find((row) => row.page === pageNumber);
    if (!page && (pageNumber > 1 || pages.length))
      throw new Error("请求的 B站分 P 不存在，请重新选择分 P");
    return {
      url,
      cid: page?.cid ?? body.data.cid,
      bvid: body.data.bvid,
      title: page && pages.length > 1 ? page.part : body.data.title,
      videoTitle: body.data.title,
      uploader: body.data.owner?.name,
      duration: page?.duration ?? body.data.duration,
    };
  },
  async preview(
    url,
    cookie = "",
    fetcher = fetch,
    quality = "highest",
    download = false,
  ) {
    quality = videoQuality(quality);
    const info = await this.metadata(url, cookie, fetcher);
    if (!info.cid || !info.bvid) throw new Error("B站视频信息不完整");
    const endpoint = new URL(
      download
        ? "https://api.bilibili.com/x/player/wbi/playurl"
        : "https://api.bilibili.com/x/player/playurl",
    );
    endpoint.search = new URLSearchParams({
      bvid: info.bvid,
      cid: info.cid,
      fnval: "4048",
      qn: "127",
      fourk: "1",
    });
    if (download) {
      const nav = await fetcher(
        "https://api.bilibili.com/x/web-interface/nav",
        {
          headers: headers(cookie),
          signal: AbortSignal.timeout(15000),
          redirect: "error",
        },
      );
      if (!nav.ok) throw new Error("B站登录与签名检测失败，请稍后重试");
      const account = await nav.json();
      if (
        (quality === "highest" || Number(quality) >= 720) &&
        account.data?.isLogin !== true
      )
        throw new Error(
          "B站未登录或凭证已过期。请在“在线资源”扫码登录或更新 bili-sync 凭证后重试高清下载。",
        );
      if (!account.data?.wbi_img)
        throw new Error("B站未提供下载签名，请稍后重试");
      endpoint.search = signWbi(endpoint.searchParams, account.data.wbi_img);
    }
    const response = await fetcher(endpoint, {
      headers: headers(cookie),
      signal: AbortSignal.timeout(15000),
      redirect: "error",
    });
    if (!response.ok) throw new Error("B站取流暂时不可用");
    const body = await response.json();
    if (body.code !== 0 || !body.data?.dash)
      throw new Error("B站未提供可预览的视频流");
    const available = body.data.dash.video || [];
    const limit = quality === "highest" ? Infinity : Number(quality);
    const video = available
      .filter(
        (v) => (download || /^avc1/i.test(v.codecs || "")) && v.height <= limit,
      )
      .sort(
        (a, b) =>
          b.height - a.height ||
          Number(/^avc1/i.test(b.codecs)) - Number(/^avc1/i.test(a.codecs)) ||
          b.bandwidth - a.bandwidth,
      )[0];
    const audio = body.data.dash.audio
      ?.filter((a) => /^mp4a/i.test(a.codecs || ""))
      .sort((a, b) => b.bandwidth - a.bandwidth)[0];
    if (!video || !audio) throw new Error("没有适合浏览器播放的音视频轨道");
    return {
      duration: Number(body.data.timelength) / 1000 || info.duration,
      quality,
      qualities: qualityChoices(available),
      previewHeight: video.height,
      downloadHeight: Math.max(
        ...available.filter((v) => v.height <= limit).map((v) => v.height),
      ),
      video: video.baseUrl || video.base_url,
      audio: audio.baseUrl || audio.base_url,
    };
  },
};
