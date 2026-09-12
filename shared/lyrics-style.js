export const defaultLyricsStyle = {
  font: "sans-serif",
  size: 48,
  color: "#ffd66e",
  offset: 0,
  x: 50,
  y: 67,
};
const number = (value, fallback, min, max) =>
  Number.isFinite(Number(value)) && value !== null && value !== ""
    ? Math.max(min, Math.min(max, Number(value)))
    : fallback;
export function normalizeLyricsStyle(value = {}) {
  value = value && typeof value === "object" ? value : {};
  return {
    font: String(value.font || "sans-serif")
      .replace(/[^\p{L}\p{N}\s,_-]/gu, "")
      .slice(0, 120),
    size: number(value.size, 48, 24, 90),
    color: /^#[a-f0-9]{6}$/i.test(value.color) ? value.color : "#ffd66e",
    offset: number(value.offset, 0, -10, 10),
    x: number(value.x, 50, 10, 90),
    y: number(value.y, 67, 20, 80),
  };
}
