import { useEffect, useRef, useState } from "react";

export function usePlayerLease({ request, token, type = "web", activePlayer }) {
  const [playerId] = useState(
    () =>
      `player-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`,
  );
  const revoked = useRef(false),
    owned = useRef(false);
  const activeOwner = useRef(activePlayer);
  activeOwner.current = activePlayer;
  const [lease, setLease] = useState(false),
    [leaseError, setLeaseError] = useState("正在连接 NAS 播放会话");
  const latestRequest = useRef(request);
  latestRequest.current = request;
  useEffect(() => {
    revoked.current = false;
    owned.current = false;
    setLease(false);
    setLeaseError("正在连接 NAS 播放会话");
    let alive = true,
      inFlight = false,
      lastSuccess = 0,
      deadline,
      claiming = true;
    const beat = async () => {
      if (inFlight || !alive || revoked.current) return;
      inFlight = true;
      try {
        const result = await Promise.race([
          latestRequest.current(
            "/player/heartbeat",
            { id: playerId, type, claim: claiming },
            "POST",
          ),
          new Promise((_, reject) => {
            deadline = setTimeout(
              () => reject(new Error("与 NAS 的播放连接超时，正在重连")),
              8000,
            );
          }),
        ]);
        if (alive && !revoked.current) {
          // A later ownership event wins over a delayed successful heartbeat.
          if (
            result?.owner &&
            activeOwner.current?.revision > result.owner.revision &&
            activeOwner.current.id !== playerId
          )
            return;
          claiming = false;
          owned.current = true;
          lastSuccess = Date.now();
          setLease(true);
          setLeaseError("");
        }
      } catch (error) {
        if (alive) {
          setLease(false);
          if (error.code === "PLAYER_REPLACED") revoked.current = true;
          if (["PLAYER_TV_PRIORITY", "PLAYER_BUSY"].includes(error.code))
            claiming = false;
          setLeaseError(error.message);
        }
      } finally {
        clearTimeout(deadline);
        inFlight = false;
      }
    };
    void beat();
    const interval = setInterval(beat, 5000),
      watchdog = setInterval(() => {
        if (
          !revoked.current &&
          lastSuccess &&
          Date.now() - lastSuccess > 10000
        ) {
          setLease(false);
          setLeaseError("与 NAS 的播放连接已中断，正在重连");
        }
      }, 1000);
    return () => {
      alive = false;
      clearInterval(interval);
      clearInterval(watchdog);
      clearTimeout(deadline);
    };
  }, [token, type]);
  useEffect(() => {
    if (owned.current && activePlayer && activePlayer.id !== playerId) {
      revoked.current = true;
      setLease(false);
      setLeaseError(
        activePlayer.type === "tv"
          ? "TV 已接管播放，此页面已停止出声，仍可点歌和控制。"
          : "新播放页面已接管，此页面已停止出声，仍可点歌和控制。",
      );
    }
  }, [activePlayer?.id, activePlayer?.revision]);
  return { playerId: playerId, lease, leaseError };
}
