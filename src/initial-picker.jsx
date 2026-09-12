import React from "react";
import "./initial-picker.css";
export function InitialPicker({ value, onChange, label = "拼音首字母" }) {
  return (
    <aside className="initial-picker" aria-label={label}>
      <strong>{label}</strong>
      <output aria-live="polite">{value || "例如 ZJL"}</output>
      <div className="initial-keys">
        {"ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((letter) => (
          <button
            key={letter}
            type="button"
            aria-label={`首字母 ${letter}`}
            onClick={() => onChange((value + letter).slice(0, 24))}
          >
            {letter}
          </button>
        ))}
      </div>
      <div className="initial-actions">
        <button type="button" onClick={() => onChange(value.slice(0, -1))}>
          退格
        </button>
        <button type="button" onClick={() => onChange("")}>
          清空
        </button>
      </div>
    </aside>
  );
}
