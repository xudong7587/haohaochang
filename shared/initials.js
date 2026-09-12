import { pinyin } from "pinyin-pro";

const cache = new Map();
export function initials(text) {
  text = String(text || "");
  if (cache.has(text)) return cache.get(text);
  const result = pinyin(String(text || ""), {
    pattern: "first",
    toneType: "none",
  })
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (cache.size >= 4096) cache.delete(cache.keys().next().value);
  cache.set(text, result);
  return result;
}
export function matchesInitials(text, query) {
  const value = String(query || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  return !value || initials(text).startsWith(value);
}
