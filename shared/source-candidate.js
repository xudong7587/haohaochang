import { identifyVideo, recordingVersion } from "./catalog.js";

export function canonicalVideo(input) {
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new Error("请输入完整视频链接");
  }
  if (url.protocol !== "https:" || url.port || url.username || url.password)
    throw new Error("只支持 HTTPS 平台视频链接");
  const host = url.hostname.toLowerCase();
  if (
    ["www.youtube.com", "youtube.com", "m.youtube.com", "youtu.be"].includes(
      host,
    )
  ) {
    const id =
      host === "youtu.be" ? url.pathname.slice(1) : url.searchParams.get("v");
    if (!/^[\w-]{11}$/.test(id || ""))
      throw new Error("请输入 YouTube watch 视频链接");
    return `https://www.youtube.com/watch?v=${id}`;
  }
  if (["www.bilibili.com", "bilibili.com"].includes(host)) {
    const id = url.pathname.match(/^\/video\/(BV[0-9A-Za-z]+|av\d+)\/?$/)?.[1];
    if (!id) throw new Error("请输入 Bilibili /video/BV… 链接");
    const page = url.searchParams.get("p");
    if (page && !/^[1-9]\d{0,3}$/.test(page)) throw new Error("分 P 页码无效");
    return `https://www.bilibili.com/video/${id}${page ? "?p=" + page : ""}`;
  }
  throw new Error("仅支持 Bilibili 和 YouTube 视频");
}

// The same serializable value travels from preview to download and import.
// Uploader names are evidence only, never silently used as the recording artist.
export function createSourceCandidate(info, identity = info.identity) {
  const local = info.provider === "local" && !info.canonicalUrl && !info.url;
  const canonicalUrl = local
    ? null
    : canonicalVideo(info.canonicalUrl || info.url);
  const url = local ? null : new URL(canonicalUrl);
  const externalTitle = String(info.externalTitle || info.title || "").slice(
    0,
    500,
  );
  const parsed = identity || identifyVideo({ ...info, title: externalTitle });
  const version = String(
    parsed.version || recordingVersion(externalTitle) || "",
  ).slice(0, 120);
  const reviewReasons = [
    ...new Set([
      ...(Array.isArray(info.reviewReasons) ? info.reviewReasons : []),
      ...(parsed.reviewReasons || []),
      ...(!parsed.title ||
      !parsed.artist ||
      parsed.artist === "未知歌手" ||
      parsed.needs_review
        ? ["identity-unconfirmed"]
        : []),
      ...(version ? ["recording-version-needs-review"] : []),
    ]),
  ];
  const duration = Number(info.duration);
  return {
    provider: local
      ? "local"
      : url.hostname === "www.bilibili.com"
        ? "bilibili"
        : "youtube",
    canonicalUrl,
    page:
      url?.hostname === "www.bilibili.com"
        ? Number(url.searchParams.get("p") || 1)
        : null,
    externalTitle,
    duration: Number.isFinite(duration) && duration > 0 ? duration : null,
    identity: {
      title: String(parsed.title || "").slice(0, 120),
      artist: String(parsed.artist || "未知歌手").slice(0, 120),
      version,
      needs_review: reviewReasons.length ? 1 : 0,
    },
    evidence: Array.isArray(info.evidence)
      ? info.evidence.slice(0, 20)
      : [
          {
            kind: "platform-metadata",
            url: canonicalUrl,
            title: externalTitle,
            videoTitle: String(info.videoTitle || ""),
            uploader: String(info.uploader || ""),
          },
        ],
    reviewReasons,
  };
}

export function metadataFromCandidate(input) {
  const candidate = createSourceCandidate(input);
  return {
    ...candidate.identity,
    evidence: candidate.evidence,
    metadata_source: `${candidate.provider} 候选`,
    sourceUrl: candidate.canonicalUrl,
    sourceCandidate: candidate,
  };
}
