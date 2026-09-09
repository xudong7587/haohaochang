import React, { useRef, useEffect } from "react";
import { Search, X } from "lucide-react";
export function SearchBox({ query, setQuery }) {
  return (
    <div className="search-box">
      <Search size={20} />
      <input
        aria-label="搜索歌名或歌手"
        placeholder="搜索歌名、歌手或拼音首字母…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {query && (
        <button
          type="button"
          aria-label="清空搜索"
          onClick={() => setQuery("")}
        >
          <X size={17} />
        </button>
      )}
    </div>
  );
}
export function Empty({ icon: Icon, title, text, action }) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon size={31} />
      </div>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}
export function Modal({ title, close, children, className }) {
  const ref = useRef();
  useEffect(() => {
    const prior = document.activeElement;
    const dialog = ref.current;
    dialog.showModal();
    return () => {
      dialog.close();
      prior?.focus();
    };
  }, []);
  return (
    <dialog
      className={className}
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <div className="modal-head">
        <h2>{title}</h2>
        <button aria-label="关闭" onClick={close}>
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
