import React from "react";
import { ArrowLeft, Trash2 } from "lucide-react";
import "./initial-picker.css";
export function InitialPicker({
  value,
  onChange,
  label = "拼音首字母",
  children,
}) {
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
        <button
          type="button"
          aria-label="退格"
          onClick={() => onChange(value.slice(0, -1))}
        >
          <ArrowLeft size={18} />
        </button>
        <button type="button" aria-label="清空" onClick={() => onChange("")}>
          <Trash2 size={18} />
        </button>
      </div>
      {children}
    </aside>
  );
}
