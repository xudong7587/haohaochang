import { createHash } from "node:crypto";
const permutation = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61,
  26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36,
  20, 34, 44, 52,
];
export function signWbi(params, images, now = Date.now()) {
  const filename = (value) =>
    new URL(value).pathname.split("/").pop().split(".")[0];
  const raw = filename(images.img_url) + filename(images.sub_url);
  if (raw.length < 64) throw new Error("B站签名信息不完整，请稍后重试");
  const key = permutation
    .slice(0, 32)
    .map((index) => raw[index])
    .join("");
  const values = { ...Object.fromEntries(params), wts: Math.floor(now / 1000) };
  const query = Object.keys(values)
    .sort()
    .map(
      (k) =>
        `${encodeURIComponent(k)}=${encodeURIComponent(String(values[k]).replace(/[!'()*]/g, ""))}`,
    )
    .join("&");
  return (
    query +
    "&w_rid=" +
    createHash("md5")
      .update(query + key)
      .digest("hex")
  );
}
