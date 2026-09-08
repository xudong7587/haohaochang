import { randomUUID } from "node:crypto";
import path from "node:path";
import { canEnqueue } from "./resource-manifest.js";
import { inspectPackage } from "./resource-health.js";
import { fail, clean } from "./http-utils.js";
export function createRoom({ app, member, store, cache, emit, addJob }) {
  const { db, get, set } = store;
  let player = null,
    ambient = null;
  function snapshot() {
    const queue = db
      .prepare(
        "SELECT q.*,s.title,s.artist,s.mode,s.duration,s.status,s.needs_video,s.lyrics FROM queue q JOIN songs s ON q.song_id=s.id ORDER BY position",
      )
      .all();
    const pending = db
      .prepare(
        "SELECT id,kind,payload,status FROM jobs WHERE status IN ('queued','running') AND kind!='scan' ORDER BY created",
      )
      .all()
      .map((j) => {
        const p = JSON.parse(j.payload);
        return {
          id: j.id,
          title:
            p.title ||
            (p.id
              ? db.prepare("SELECT title FROM songs WHERE id=?").get(p.id)
                  ?.title
              : path.basename(p.file || "")) ||
            "准备歌曲",
          status: j.status,
        };
      });
    return {
      queue,
      pending,
      ambient: queue.length ? null : ambient,
      playback: get("playback"),
      playerOnline: !!player && Date.now() - player.seen < 15000,
    };
  }
  const revise = (patch = {}) => {
    const old = get("playback");
    set("playback", { ...old, ...patch, revision: old.revision + 1 });
    emit();
  };
  function enqueue(id, name) {
    const song = db.prepare("SELECT * FROM songs WHERE id=?").get(id);
    if (!canEnqueue(store, song, cache))
      throw fail(409, "歌曲尚未就绪，请先在后台准备播放");
    if (db.prepare("SELECT id FROM queue WHERE song_id=?").get(id)) return;
    if (db.prepare("SELECT count(*) AS n FROM queue").get().n >= 100)
      throw fail(409, "已点列表已满");
    const position = db
      .prepare("SELECT COALESCE(MAX(position),0)+1 AS p FROM queue")
      .get().p;
    db.prepare("INSERT INTO queue VALUES (?,?,?,?)").run(
      randomUUID(),
      id,
      name,
      position,
    );
    if (snapshot().queue.length === 1) revise({ paused: false, vocal: false });
    else emit();
  }
  app.get("/api/state", member, (req, res) => res.json(snapshot()));
  app.post("/api/queue", member, async (req, res) => {
    const id = clean(req.body.songId),
      name = clean(req.body.name, 24) || "家人";
    let song = db.prepare("SELECT * FROM songs WHERE id=?").get(id);
    if (!song) throw fail(404, "歌曲不存在");
    if (get("package-ready:" + id) && get("package:" + id))
      await inspectPackage(store, song, get("package:" + id));
    song = db.prepare("SELECT * FROM songs WHERE id=?").get(id);
    if (get("hidden:" + id)) throw fail(409, "歌曲已隐藏，请在后台恢复后点歌");
    if (song.status === "ready" && !canEnqueue(store, song, cache))
      throw fail(409, "播放文件缺失，请先在后台重新整理");
    if (db.prepare("SELECT id FROM queue WHERE song_id=?").get(id))
      return res.json(snapshot());
    if (
      song.status !== "ready" ||
      (song.mode === "original" && get("ai", {}).enabled)
    ) {
      addJob("prepare", { id, enqueue: true, name });
      res.json({ ...snapshot(), preparing: true });
    } else {
      enqueue(id, name);
      res.json(snapshot());
    }
  });
  app.post("/api/queue/:id/top", member, (req, res) => {
    const queue = snapshot().queue;
    if (!queue.some((q) => q.id === req.params.id))
      throw fail(404, "歌曲不在队列中");
    const reordered = [
      queue[0],
      ...queue.slice(1).filter((q) => q.id === req.params.id),
      ...queue.slice(1).filter((q) => q.id !== req.params.id),
    ];
    db.exec("BEGIN");
    try {
      reordered.forEach((q, i) =>
        db.prepare("UPDATE queue SET position=? WHERE id=?").run(i, q.id),
      );
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    emit();
    res.json(snapshot());
  });
  app.delete("/api/queue/:id", member, (req, res) => {
    if (snapshot().queue[0]?.id === req.params.id)
      throw fail(409, "请使用切歌结束当前歌曲");
    db.prepare("DELETE FROM queue WHERE id=?").run(req.params.id);
    emit();
    res.json(snapshot());
  });
  app.post("/api/control", member, (req, res) => {
    const current = snapshot().queue[0],
      action = req.body.action;
    if (!current && ambient && req.body.entryId === ambient.id) {
      if (action === "next") pickAmbient();
      else if (action === "pause") {
        ambient = { ...ambient, paused: !ambient.paused };
        emit();
      } else throw fail(409, "开场音乐固定播放原唱");
      return res.json(snapshot());
    }
    if (!current) throw fail(409, "先点一首歌吧");
    if (req.body.entryId !== current.id)
      throw fail(409, "当前歌曲已改变，请重试");
    if (action === "next") {
      db.prepare("DELETE FROM queue WHERE id=?").run(current.id);
      revise({ paused: false, vocal: false });
    } else if (action === "pause") revise({ paused: !get("playback").paused });
    else if (action === "vocal") {
      if (["original", "instrumental"].includes(current.mode))
        throw fail(
          409,
          current.mode === "instrumental"
            ? "这首歌只有伴奏版本"
            : "这首歌只有原始音频",
        );
      revise({ vocal: !get("playback").vocal });
    } else throw fail(400, "未知控制");
    res.json(snapshot());
  });
  app.post("/api/player/heartbeat", member, (req, res) => {
    const id = clean(req.body.id, 80);
    if (!id) throw fail(400, "缺少播放器标识");
    if (player && player.id !== id && Date.now() - player.seen < 15000)
      throw fail(409, "另一台电视正在播放，请关闭另一台的播放页面后等待 15 秒");
    player = { id, seen: Date.now() };
    if (!snapshot().queue.length && !ambient) pickAmbient();
    res.json({ ok: true });
  });
  app.post("/api/player/ended", member, (req, res) => {
    if (
      !player ||
      player.id !== req.body.playerId ||
      Date.now() - player.seen > 15000
    )
      throw fail(409, "播放器连接已失效");
    if (ambient?.id === req.body.entryId && !snapshot().queue.length) {
      pickAmbient();
      return res.json(snapshot());
    }
    const current = snapshot().queue[0];
    if (current?.id === req.body.entryId) {
      db.prepare("DELETE FROM queue WHERE id=?").run(current.id);
      revise({ paused: false, vocal: false });
    }
    res.json(snapshot());
  });
  function pickAmbient() {
    const song = db
      .prepare(
        "SELECT * FROM songs WHERE status='ready' AND mode!='instrumental' ORDER BY (id=?) ASC,RANDOM()",
      )
      .all(ambient?.song_id || "")
      .find((s) => canEnqueue(store, s, cache));
    ambient = song
      ? {
          ...song,
          song_id: song.id,
          id: "ambient-" + randomUUID(),
          ambient: true,
        }
      : null;
    emit();
    if (
      !song &&
      !db
        .prepare(
          "SELECT id FROM jobs WHERE kind='prepare' AND status IN ('queued','running') LIMIT 1",
        )
        .get()
    ) {
      const candidate = db
        .prepare(
          "SELECT id FROM songs WHERE status='new' AND mode!='instrumental' ORDER BY RANDOM()",
        )
        .all()
        .find((s) => !get("hidden:" + s.id));
      if (candidate) addJob("prepare", { id: candidate.id, ambientOnly: true });
    }
  }
  app.post("/api/reactions", member, (req, res) => {
    if (!["👏", "🎉", "❤️", "🌟"].includes(req.body.emoji))
      throw fail(400, "不支持的互动");
    emit("reaction", { emoji: req.body.emoji, id: randomUUID() });
    res.json({ ok: true });
  });
  return { snapshot, enqueue };
}
