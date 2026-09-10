import { useEffect, useRef, useState } from "react";

export function useIdleControls({
  container,
  enabled,
  immersive,
  resetKey,
  idleMs = 4000,
}) {
  const [visible, setVisible] = useState(true);
  const shown = useRef(true);
  useEffect(() => {
    let timer,
      restoringFocus = false;
    shown.current = true;
    setVisible(true);
    if (!enabled) return;
    const arm = () => {
      clearTimeout(timer);
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
      shown.current = true;
      setVisible(true);
      arm();
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
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    for (const type of ["keydown", "pointerdown", "pointermove", "focusin"])
      document.addEventListener(type, reveal, true);
    arm();
    return () => {
      clearTimeout(timer);
      for (const type of ["keydown", "pointerdown", "pointermove", "focusin"])
        document.removeEventListener(type, reveal, true);
    };
  }, [enabled, immersive, resetKey, idleMs]);
  return visible;
}
