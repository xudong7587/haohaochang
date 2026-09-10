// Only Bilibili media hosts returned by its player API are accepted. MCDN and
// PCDN also serve HTTPS on 4483; this is not a general-purpose URL proxy.
export function biliStreamUrl(value) {
  const url = new URL(value);
  const mediaHost =
    /(^|\.)bilivideo\.(com|cn)$/.test(url.hostname) ||
    /\.v1d\.szbdyd\.com$/.test(url.hostname);
  if (
    url.protocol !== "https:" ||
    !mediaHost ||
    (url.port && url.port !== "4483") ||
    url.username ||
    url.password
  )
    throw new Error("B站未返回可用的直连视频流");
  return url.href;
}

export function biliStreamCandidates(primary, backups = []) {
  const valid = [];
  for (const value of [primary, ...backups]) {
    try {
      valid.push(biliStreamUrl(value));
    } catch {}
  }
  const rank = (value) =>
    /\.mcdn\.|\.szbdyd\.com/.test(new URL(value).hostname) ? 1 : 0;
  const result = [...new Set(valid)]
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, 6);
  if (!result.length) throw new Error("B站未返回可用的直连视频流");
  return result;
}

export async function openBiliStream(
  value,
  { fetcher = fetch, headers = {}, signal } = {},
) {
  let url = biliStreamUrl(value);
  for (let count = 0; count < 4; count++) {
    const response = await fetcher(url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Referer: "https://www.bilibili.com/",
        "Accept-Encoding": "identity",
        ...headers,
      },
      signal,
      redirect: "manual",
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    await response.body?.cancel();
    if (!location) throw new Error("B站线路重定向缺少目标地址");
    url = biliStreamUrl(new URL(location, url).href);
  }
  throw new Error("B站线路重定向次数过多");
}
