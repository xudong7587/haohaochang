import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { fail } from "./http-utils.js";

export const LEGACY_ROOM = "legacy";
export function createRoomRegistry(store) {
  const { db, get } = store;
  const legacy = () => ({ id: LEGACY_ROOM, code: "", token: get("roomToken") });
  const byToken = (token) =>
    typeof token === "string" && token
      ? token === get("roomToken")
        ? legacy()
        : db.prepare("SELECT * FROM rooms WHERE token=?").get(token)
      : null;
  const byId = (id = LEGACY_ROOM) =>
    id === LEGACY_ROOM
      ? legacy()
      : db.prepare("SELECT * FROM rooms WHERE id=?").get(id);
  function create() {
    if (db.prepare("SELECT COUNT(*) n FROM rooms").get().n >= 10000)
      throw fail(409, "歌房数量已达上限，请加入已有歌房");
    let code;
    do {
      code = String(randomInt(100000, 1000000));
    } while (db.prepare("SELECT id FROM rooms WHERE code=?").get(code));
    const result = {
      id: randomUUID(),
      code,
      token: randomBytes(24).toString("hex"),
      created: Date.now(),
    };
    db.prepare(
      "INSERT INTO rooms (id,code,token,created) VALUES (?,?,?,?)",
    ).run(result.id, result.code, result.token, result.created);
    return result;
  }
  const byCode = (code) =>
    db.prepare("SELECT * FROM rooms WHERE code=?").get(code);
  return { byToken, byId, byCode, create };
}

export function roomRegistryApi({ app, member, rooms }) {
  const attempts = new Map();
  const limit = (req, res, next) => {
    const now = Date.now();
    for (const [key, value] of attempts)
      if (value.until <= now) attempts.delete(key);
    const key = req.ip;
    const entry = attempts.get(key) || { n: 0, until: now + 60000 };
    attempts.set(key, entry);
    if (++entry.n > 20) {
      res.set(
        "Retry-After",
        String(Math.max(1, Math.ceil((entry.until - now) / 1000))),
      );
      return next(fail(429, "操作较频繁，请稍后再试"));
    }
    next();
  };
  app.get("/api/rooms/current", member, (req, res) => {
    const { id, code } = rooms.byId(req.roomId);
    res.set("Cache-Control", "no-store").json({ id, code });
  });
  app.get("/api/rooms/default", member, (_req, res) => {
    res.set("Cache-Control", "no-store").json(rooms.byId(LEGACY_ROOM));
  });
  app.post("/api/rooms", member, limit, (req, res) =>
    res.set("Cache-Control", "no-store").json(rooms.create()),
  );
  app.post("/api/rooms/join", member, limit, (req, res) => {
    const code = String(req.body.code || "").trim();
    if (!/^\d{6}$/.test(code)) throw fail(400, "请输入 6 位歌房号码");
    // Codes are an invitation within an already authenticated NAS session.
    const found = rooms.byCode(code);
    if (!found) throw fail(404, "歌房号码不存在，请核对后重试");
    res.set("Cache-Control", "no-store").json(found);
  });
}
