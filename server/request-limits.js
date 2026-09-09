// Independent budgets keep background polling and range requests from starving
// the player, including clients behind the same NAS reverse proxy.
export function requestLimits({ authenticated, now = Date.now } = {}) {
  const limits = new Map();
  return (req, res, next) => {
    const path = req.path;
    const read = ["GET", "HEAD"].includes(req.method);
    const scope = !authenticated(req)
      ? "auth"
      : path.startsWith("/player/")
        ? "player"
        : path === "/control"
          ? "control"
          : read &&
              /^\/(media|poster|assets|resources|backgrounds)\//.test(path)
            ? "media"
            : read && /^\/online\/preview\/[^/]+\/(video|audio)$/.test(path)
              ? "media"
              : read
                ? "read"
                : "write";
    const budget = {
      auth: 120,
      player: 600,
      control: 360,
      media: 2400,
      read: 1200,
      write: 120,
    }[scope];
    const time = now(),
      key = `${req.ip}:${scope}`;
    if (limits.size > 1000)
      for (const [key, value] of limits)
        if (value.until <= time) limits.delete(key);
    let value = limits.get(key);
    if (!value || value.until <= time) value = { n: 0, until: time + 60000 };
    limits.set(key, value);
    if (++value.n <= budget) return next();
    res.set(
      "Retry-After",
      String(Math.max(1, Math.ceil((value.until - time) / 1000))),
    );
    next(Object.assign(new Error("操作太快了，请稍后再试"), { status: 429 }));
  };
}
