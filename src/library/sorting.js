export const librarySorts = [
  ["artist", "歌手 · 正序"],
  ["artist-desc", "歌手 · 倒序"],
  ["title", "歌名 · 正序"],
  ["title-desc", "歌名 · 倒序"],
  ["created", "加入时间 · 最早优先"],
  ["created-desc", "加入时间 · 最新优先"],
];
const compareText = (a, b) =>
  (a || "").localeCompare(b || "", "zh-CN", { numeric: true });
function created(row) {
  if (row.created == null || row.created === "") return null;
  const value = Number(row.created);
  const time = Number.isFinite(value) ? value : Date.parse(row.created);
  return Number.isFinite(time) ? time : null;
}
export function compareLibraryEntries(a, b, sort, grouped = false) {
  const [field, order] = sort.split("-");
  const direction = order === "desc" ? -1 : 1;
  const artist = compareText(
    a.row.artist || "未知歌手",
    b.row.artist || "未知歌手",
  );
  if (grouped && artist) return artist * (field === "artist" ? direction : 1);
  let comparison;
  if (field === "created") {
    const at = created(a.row),
      bt = created(b.row);
    // Undated imports remain at the end in either direction.
    if (at === null || bt === null) {
      if (at !== bt) return at === null ? 1 : -1;
      comparison = 0;
    } else comparison = at - bt;
  } else
    comparison =
      field === "artist" ? artist : compareText(a.row.title, b.row.title);
  return (
    direction *
      (comparison || compareText(a.row.title, b.row.title) || artist) ||
    compareText(a.key, b.key)
  );
}
