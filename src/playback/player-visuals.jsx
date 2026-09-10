import React, { useEffect, useState } from "react";
import { Lyrics } from "../lyrics.jsx";
import { Spectrum } from "../spectrum.jsx";
import { Background } from "./background.jsx";

// Reading the audio clock animates lyrics only. It never changes media time,
// and it does not rerender the player, queue, QR code or remote-control menu.
export function PlayerVisuals({
  video,
  current,
  manifest,
  background,
  token,
  lyricsVisible,
  audioStage,
  offsetMs,
}) {
  const [time, setTime] = useState(0);
  useEffect(() => {
    setTime(0);
    if (!current || (!lyricsVisible && !audioStage)) return;
    let raf,
      last = 0;
    const tick = (now) => {
      if (now - last >= 50) {
        setTime(
          video.current?._playback?.getTime() ??
            video.current?.currentTime ??
            0,
        );
        last = now;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [current?.id, lyricsVisible, audioStage, video]);
  return (
    <>
      {audioStage && (
        <>
          <Background
            background={background || manifest.background}
            token={token}
            time={time}
          />
          <Spectrum video={video} />
        </>
      )}
      {current && lyricsVisible && (
        <Lyrics
          song={current}
          time={time}
          token={token}
          resource={manifest?.resources?.lyrics}
          offsetMs={offsetMs}
        />
      )}
    </>
  );
}
