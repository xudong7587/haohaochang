import { startDiscovery } from "./discovery.js";
import { pcApi } from "./routes/pc.js";
import { startBackgroundTasks } from "./background-tasks.js";
import { backgroundApi } from "./background-api.js";
import { publicLibraryApi } from "./routes/public-library.js";
import { mediaApi } from "./routes/media.js";
import { onlineApi } from "./routes/online.js";
import { settingsApi } from "./routes/settings.js";
import { reviewsApi } from "./routes/reviews.js";
import { legacyLibraryApi } from "./routes/legacy-library.js";
import { createRoom } from "./room.js";
import { createScheduler } from "./scheduler.js";
import { libraryApi } from "./library-api.js";
import { libraryDeleteApi } from "./library-delete.js";
import { resourceRoot } from "./assets.js";
import express from "express";
import path from "node:path";
import { mkdirSync, existsSync } from "node:fs";
import { openStore } from "./db.js";

import { fail, equal } from "./http-utils.js";

export function createApp(options = {}) {
  const dir = path.resolve(options.dataDir || process.env.DATA_DIR || "./data");
  const roots = (
    options.roots || (process.env.MEDIA_ROOTS || "./media").split("|")
  ).map((p) => path.resolve(p));
  const downloads = path.resolve(
      options.downloads ||
        process.env.DOWNLOAD_DIR ||
        path.join(dir, "downloads"),
    ),
    cache = resourceRoot(roots[0]),
    legacyCache = path.join(dir, "cache");
  [downloads, cache].forEach((p) => mkdirSync(p, { recursive: true }));
  const store = openStore(dir),
    { db, get, set } = store;
  const adminToken =
    options.adminToken || process.env.ADMIN_PASSWORD || process.env.ADMIN_TOKEN;
  if (!adminToken || adminToken.length < 12)
    throw new Error("请设置至少 12 位的 ADMIN_PASSWORD（管理密码）");
  const app = express();
  const clients = new Set(),
    limits = new Map();
  app.disable("x-powered-by");
  // Validate only the optional QR origin hint; API access uses explicit credentials.
  function allowedOrigin(req, origin) {
    return (
      typeof origin === "string" &&
      [
        `${req.protocol}://${req.get("host")}`,
        `https://${req.get("host")}`,
        get("publicUrl", "").replace(/\/$/, ""),
      ]
        .filter(Boolean)
        .includes(origin)
    );
  }
  app.use(express.json({ limit: "32kb" }));
  app.use((req, res, next) => {
    res.set("X-Content-Type-Options", "nosniff");
    next();
  });
  const token = (req) =>
    req.get("authorization")?.replace(/^Bearer /, "") || req.query.token;
  const admin = (req, res, next) =>
    equal(token(req), adminToken)
      ? next()
      : next(fail(401, "请输入正确的管理密码"));
  const member = (req, res, next) =>
    equal(token(req), get("roomToken")) || equal(token(req), adminToken)
      ? next()
      : next(fail(401, "请扫描电视二维码加入客厅"));
  function rate(req, res, next) {
    const key = req.ip,
      now = Date.now();
    if (limits.size > 1000)
      for (const [k, v] of limits) if (v.until < now) limits.delete(k);
    const value = limits.get(key) || { n: 0, until: now + 60000 };
    if (value.until < now) {
      value.n = 0;
      value.until = now + 60000;
    }
    value.n++;
    limits.set(key, value);
    next(value.n > 120 ? fail(429, "操作太快了，请稍后再试") : undefined);
  }
  app.use("/api", rate);
  function emit(type = "state", data = snapshot()) {
    for (const client of clients)
      client.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  }
  const { snapshot, enqueue } = createRoom({
    app,
    member,
    store,
    cache,
    emit,
    addJob: (...args) => addJob(...args),
  });
  const scheduler = createScheduler(
    {
      db,
      get,
      set,
      store,
      dir,
      roots,
      downloads,
      cache,
      legacyCache,
      emit,
      enqueue,
      fail,
    },
    { enabled: options.worker !== false, onIdle: () => db.close() },
  );
  const { addJob, work } = scheduler;
  const discovery = startDiscovery({
    store,
    work,
    emit,
    enabled:
      options.discovery ??
      (process.env.KTV_DISCOVERY_ENABLED === "1" &&
        process.env.KTV_LOCAL_ONLY !== "1"),
  });
  const routeContext = {
    discovery,
    app,
    admin,
    member,
    store,
    db,
    get,
    set,
    cache,
    legacyCache,
    dir,
    roots,
    downloads,
    addJob,
    work,
    emit,
    enqueue,
    snapshot,
    allowedOrigin,
  };
  libraryApi(routeContext);
  libraryDeleteApi(routeContext);
  backgroundApi(routeContext);
  app.get("/api/health", (req, res) => res.json({ ok: true }));
  app.post("/api/login", admin, (req, res) =>
    res.json({ token: get("roomToken") }),
  );
  app.get("/api/events", member, (req, res) => {
    if (clients.size >= 40) throw fail(429, "连接数过多");
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    clients.add(res);
    res.write(`event: state\ndata: ${JSON.stringify(snapshot())}\n\n`);
    req.on("close", () => clients.delete(res));
  });
  publicLibraryApi(routeContext);
  mediaApi(routeContext);
  onlineApi(routeContext);
  settingsApi(routeContext);
  pcApi(routeContext);
  reviewsApi(routeContext);
  legacyLibraryApi(routeContext);
  app.get("/", (req, res) => res.redirect(302, "/admin"));
  app.use(express.static(path.resolve("dist")));
  app.get(
    ["/", "/tv", "/play", "/mobile", "/control", "/admin", "/pc", "/pc/"],
    (req, res) =>
      existsSync(path.resolve("dist/index.html"))
        ? res.sendFile(path.resolve("dist/index.html"))
        : res.status(503).send("请先运行 npm run build，或访问 Vite 开发服务"),
  );
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    res.status(err.status || 400).json({
      error: err.message || "请求失败",
      code: err.code,
      currentRevision: err.currentRevision,
    });
  });
  const backgroundTasks = startBackgroundTasks({
    store,
    roots,
    downloads,
    cache,
    addJob,
    enabled: options.worker !== false,
  });
  const heartbeat = setInterval(() => {
    for (const client of clients) client.write(": heartbeat\n\n");
  }, 20000);
  heartbeat.unref();
  setImmediate(work);
  return {
    app,
    store,
    addJob,
    close: () => {
      clearInterval(heartbeat);
      discovery.stop();
      backgroundTasks.stop();
      clients.forEach((c) => c.end());
      scheduler.stop();
    },
  };
}
