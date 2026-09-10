import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
// A modal dialog is in the browser top layer; z-index on the page cannot reach it.
export function FeedbackToast({ message }) {
  const [target, setTarget] = useState(document.body);
  useEffect(() => {
    const sync = () => {
      const dialogs = document.querySelectorAll("dialog[open]");
      setTarget(dialogs[dialogs.length - 1] || document.body);
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["open"],
    });
    return () => observer.disconnect();
  }, []);
  return message
    ? createPortal(
        <div className="toast" role="status">
          {message}
        </div>,
        target,
      )
    : null;
}
