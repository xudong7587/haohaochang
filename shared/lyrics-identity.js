export const normalizeLyricsIdentity = (value) =>
  String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, "");
export function lyricsTitle(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/\s*[（(\[【]([^）)\]】]+)[）)\]】]\s*$/u, (all, label) =>
      /^(?:(?:live|现场|演唱会|录音室|studio|acoustic|不插电|remix|混音|remaster(?:ed)?|重制|重录|rerecording)[\s\d年版版本-]*)+$/iu.test(
        label.trim(),
      )
        ? ""
        : all,
    )
    .trim();
}
export function lyricsArtist(value) {
  let text = String(value || "").normalize("NFKC");
  if (/^[\p{Script=Han}\s]+$/u.test(text))
    text = text.trim().replace(/\s+/g, "、");
  return text
    .split(/[、&/;,，；+]|\bfeat\.?\s|\bft\.?\s/iu)
    .map(normalizeLyricsIdentity)
    .filter(Boolean)
    .sort()
    .join("|");
}
export const sameLyricsTitle = (a, b) =>
  normalizeLyricsIdentity(lyricsTitle(a)) ===
  normalizeLyricsIdentity(lyricsTitle(b));
