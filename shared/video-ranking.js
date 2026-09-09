export function rankVideos(rows, duration) {
  return rows
    .map((row, i) => ({
      ...row,
      durationDifference:
        duration > 0 && row.duration > 0
          ? Math.abs(row.duration - duration)
          : null,
      order: i,
    }))
    .sort(
      (a, b) =>
        (a.durationDifference ?? Infinity) -
          (b.durationDifference ?? Infinity) || a.order - b.order,
    )
    .map(({ order, ...row }) => row);
}
