import { useEffect, useLayoutEffect, useRef, useState } from "react";

export function useIdleControls({
  container,
  enabled,
  immersive,
  resetKey,
  idleMs = 4000,
}) {
  const [visible, setVisible] = useState(true);
  const [focusRequest, setFocusRequest] = useState(0);
  const shown = useRef(true);
  useLayoutEffect(() => {
    if (!visible || !focusRequest) return;
    const panel = container.current?.querySelector(".video-caption");
    (
      panel?.querySelector('[data-player-action="pause"]') ||
      panel?.querySelector("button:not(:disabled)")
    )?.focus({ preventScroll: true });
  }, [visible, focusRequest]);
  useEffect(() => {
    let timer,
      restoringFocus = false,
      wakeKey = "";
    shown.current = true;
    setVisible(true);
    if (!enabled && !immersive) return;
    const arm = () => {
      clearTimeout(timer);
      if (!enabled) return;
      timer = setTimeout(() => {
        if (document.querySelector("dialog[open]")) {
          arm();
          return;
        }
        if (
          container.current
            ?.querySelector(".video-caption")
            ?.contains(document.activeElement)
        ) {
          restoringFocus = true;
          container.current
            .querySelector(".video-stage")
            ?.focus({ preventScroll: true });
          restoringFocus = false;
        }
        shown.current = false;
        setVisible(false);
      }, idleMs);
    };
    const reveal = (event) => {
      if (
        restoringFocus ||
        !container.current?.getClientRects().length ||
        document.querySelector("dialog[open]")
      )
        return;
      const wasHidden = !shown.current;
      const keydown = event.type === "keydown";
      // Back toggles this panel, including while paused. Only the explicit
      // fullscreen button may leave the picture; Android uses this same event.
      if (
        immersive &&
        keydown &&
        ["Escape", "BrowserBack"].includes(event.key)
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.repeat) return;
        const inPanel = container.current
          .querySelector(".video-caption")
          ?.contains(document.activeElement);
        if (wasHidden || !inPanel) {
          shown.current = true;
          setVisible(true);
          setFocusRequest((n) => n + 1);
          arm();
        } else {
          clearTimeout(timer);
          restoringFocus = true;
          container.current
            .querySelector(".video-stage")
            ?.focus({ preventScroll: true });
          restoringFocus = false;
          shown.current = false;
          setVisible(false);
        }
        return;
      }
      const opening =
        immersive &&
        keydown &&
        ["ArrowDown", "Enter", " "].includes(event.key) &&
        (wasHidden ||
          !container.current
            .querySelector(".video-caption")
            ?.contains(document.activeElement));
      if (keydown && event.repeat && wakeKey === event.key) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      shown.current = true;
      setVisible(true);
      arm();
      if (opening) {
        wakeKey = event.key;
        setFocusRequest((n) => n + 1);
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      // The first remote press wakes controls without changing lyrics or
      // playback. Navigation outside the picture keeps its behavior.
      if (
        wasHidden &&
        event.type === "keydown" &&
        (immersive || container.current.contains(document.activeElement)) &&
        [
          "ArrowLeft",
          "ArrowRight",
          "ArrowUp",
          "ArrowDown",
          "Enter",
          " ",
        ].includes(event.key)
      ) {
        wakeKey = event.key;
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    const released = (event) => {
      if (event.key !== wakeKey) return;
      wakeKey = "";
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    for (const type of ["keydown", "pointerdown", "pointermove", "focusin"])
      document.addEventListener(type, reveal, true);
    document.addEventListener("keyup", released, true);
    arm();
    return () => {
      clearTimeout(timer);
      for (const type of ["keydown", "pointerdown", "pointermove", "focusin"])
        document.removeEventListener(type, reveal, true);
      document.removeEventListener("keyup", released, true);
    };
  }, [enabled, immersive, resetKey, idleMs]);
  return visible;
}
