import React, { useEffect, useRef } from "react";
export function WorkbenchDialog({ open, onClose, title, children }) {
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const dialog = ref.current;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="workbench-dialog"
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        closeRef.current();
      }}
    >
      {open && (
        <>
          <div className="workbench-dialog-heading">
            <div>
              <small>曲库工作台</small>
              <h2>{title}</h2>
            </div>
            <button autoFocus onClick={onClose} aria-label="关闭歌曲详情">
              关闭
            </button>
          </div>
          <div className="workbench-dialog-body">{children}</div>
        </>
      )}
    </dialog>
  );
}
