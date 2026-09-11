// Inspect a small preview only. Require matching, near-black bars on both sides
// so a dark stage or a one-sided shadow does not become an aggressive crop.
export function horizontalPhotoBounds({ data, width, height }) {
  const dark = (y) => {
    let count = 0;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (
        data[i] < 24 &&
        data[i + 1] < 24 &&
        data[i + 2] < 24 &&
        data[i + 3] > 240
      )
        count++;
    }
    return count >= width * 0.98;
  };
  let top = 0,
    bottom = 0;
  const limit = Math.floor(height * 0.3);
  while (top < limit && dark(top)) top++;
  while (bottom < limit && dark(height - 1 - bottom)) bottom++;
  if (
    top < 2 ||
    bottom < 2 ||
    top === limit ||
    bottom === limit ||
    Math.abs(top - bottom) > height * 0.04
  )
    return { top: 0, bottom: 0 };
  return { top, bottom };
}

export function cropPhotoBars(img) {
  const preview = document.createElement("canvas");
  const ratio = 160 / Math.max(img.naturalWidth, img.naturalHeight);
  preview.width = Math.max(1, Math.round(img.naturalWidth * ratio));
  preview.height = Math.max(1, Math.round(img.naturalHeight * ratio));
  const context = preview.getContext("2d", { willReadFrequently: true });
  context.drawImage(img, 0, 0, preview.width, preview.height);
  const bounds = horizontalPhotoBounds(
    context.getImageData(0, 0, preview.width, preview.height),
  );
  if (!bounds.top) return null;
  const top = Math.round((bounds.top / preview.height) * img.naturalHeight);
  const height =
    img.naturalHeight -
    top -
    Math.round((bounds.bottom / preview.height) * img.naturalHeight);
  const output = document.createElement("canvas");
  output.width = Math.min(1200, img.naturalWidth);
  output.height = Math.max(
    1,
    Math.round((output.width * height) / img.naturalWidth),
  );
  output
    .getContext("2d")
    .drawImage(
      img,
      0,
      top,
      img.naturalWidth,
      height,
      0,
      0,
      output.width,
      output.height,
    );
  return output.toDataURL("image/jpeg", 0.92);
}
