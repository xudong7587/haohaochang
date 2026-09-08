import React from "react";
export const validOffset = (value) =>
  String(value).trim() !== "" &&
  Number.isFinite(Number(value)) &&
  Math.abs(Number(value)) <= 600;
export function VideoConfirmation({
  confirmed,
  setConfirmed,
  offset,
  setOffset,
  busy,
}) {
  return (
    <div>
      <label className="checkbox">
        <input
          type="checkbox"
          disabled={busy}
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
        />
        我已试听核对，这是与当前音轨对应的录音版本
      </label>
      <label>
        视频相对音轨偏移（秒）
        <input
          type="number"
          min="-600"
          max="600"
          step="0.1"
          placeholder="核对后输入，例如 0"
          disabled={busy}
          value={offset}
          onChange={(event) => setOffset(event.target.value)}
        />
      </label>
      <p>
        时长接近不能证明节奏一致。请先打开视频试听，再填写偏移；无偏移也需输入
        0。
      </p>
    </div>
  );
}
