import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp } from "../server/app.js";
import { createRoomRegistry } from "../server/room-registry.js";
import { liveEvents } from "../server/live-events.js";
import { createScheduler } from "../server/scheduler.js";
import { deliverJobSong, roomTargets } from "../server/room-targets.js";

test("rooms isolate the same song's queue, controls, offsets, leases and QR credentials", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ktv-rooms-"));
  const service = createApp({
    dataDir: path.join(dir, "db"),
    roots: [path.join(dir, "media")],
    adminToken: "multi-room-password",
    worker: false,
    discovery: false,
  });
  const { store } = service;
  const server = service.app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  store.set("publicUrl", base);
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await service.close();
    await rm(dir, { recursive: true, force: true });
  });
  const call = (url, token = store.get("roomToken"), body) =>
    fetch(base + "/api" + url, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const a = await (await call("/rooms", undefined, {})).json();
  const b = await (await call("/rooms", undefined, {})).json();
  assert.match(a.code, /^\d{6}$/);
  assert.notEqual(a.code, b.code);
  assert.notEqual(a.token, b.token);
  assert.equal((await call("/rooms", "wrong", {})).status, 401);
  assert.equal((await call("/rooms/default", "")).status, 401);
  assert.equal(
    (await (await call("/rooms/default", a.token)).json()).token,
    store.get("roomToken"),
  );
  assert.equal(
    (await (await call("/rooms/join", b.token, { code: a.code })).json()).id,
    a.id,
  );
  assert.equal(
    (await call("/rooms/join", b.token, { code: "abc" })).status,
    400,
  );
  store.db
    .prepare(
      "INSERT INTO songs (id,path,title,artist,mode,status,created) VALUES (?,?,?,?,?,?,?)",
    )
    .run(
      "shared",
      path.join(dir, "song.mp4"),
      "共享歌曲",
      "歌手",
      "tracks",
      "ready",
      Date.now(),
    );
  for (const [entry, room] of [
    ["entry-a", a],
    ["entry-b", b],
  ]) {
    store.db
      .prepare("INSERT INTO queue VALUES (?,?,?,?)")
      .run(entry, "shared", "测试", 0);
    store.db
      .prepare("INSERT INTO queue_rooms VALUES (?,?)")
      .run(entry, room.id);
  }
  const state = async (room) => (await call("/state", room.token)).json();
  store.set("lyrics-offset:shared", 3000);
  assert.deepEqual(
    (await state(a)).queue.map((q) => q.id),
    ["entry-a"],
  );
  assert.equal(
    (await (await call("/state")).json()).queue.length,
    0,
    "legacy clients do not see new rooms",
  );
  await call("/control", a.token, { action: "pause", entryId: "entry-a" });
  await call("/control", a.token, {
    action: "lyrics-offset",
    entryId: "entry-a",
    deltaMs: 500,
  });
  assert.equal((await state(a)).playback.paused, true);
  assert.equal((await state(a)).playback.lyricsOffsetMs, 500);
  assert.equal((await state(b)).playback.paused, false);
  assert.equal((await state(b)).playback.lyricsOffsetMs, 0);
  assert.equal(
    (await call("/control", b.token, { action: "next", entryId: "entry-a" }))
      .status,
    409,
  );
  assert.equal(
    (
      await fetch(base + "/api/queue/entry-a", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${b.token}` },
      })
    ).status,
    404,
  );
  for (const [room, id, type] of [
    [a, "tv-a", "tv"],
    [b, "web-b", "web"],
  ])
    assert.equal(
      (await call("/player/heartbeat", room.token, { id, type, claim: true }))
        .status,
      200,
    );
  assert.equal((await state(a)).player.id, "tv-a");
  assert.equal((await state(b)).player.id, "web-b");
  assert.equal(
    (
      await call("/player/heartbeat", a.token, {
        id: "joined-web",
        type: "web",
        claim: true,
      })
    ).status,
    200,
    "joining can take over a TV in the same room",
  );
  assert.equal(
    (
      await call("/player/ended", a.token, {
        playerId: "tv-a",
        entryId: "entry-a",
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await call("/player/ended", b.token, {
        playerId: "web-b",
        entryId: "entry-a",
      })
    ).status,
    200,
  );
  assert.equal((await state(a)).queue.length, 1);
  const qr = await (await call("/join", b.token)).json();
  assert.equal(new URL(qr.url).hash, "#" + b.token);
  assert.equal(
    createRoomRegistry(store).byCode(a.code).token,
    a.token,
    "room invitations persist in SQLite",
  );
  await call("/control", a.token, { action: "next", entryId: "entry-a" });
  assert.equal((await state(a)).queue.length, 0);
  assert.equal((await state(b)).queue.length, 1);

  const delivered = [];
  const scheduler = createScheduler(
    {
      db: store.db,
      get: store.get,
      set: store.set,
      store,
      emit: () => {},
      enqueue: () => {},
    },
    { enabled: false },
  );
  const jobA = scheduler.addJob("prepare", {
    id: "shared",
    enqueue: true,
    name: "A",
    roomId: a.id,
  });
  const jobB = scheduler.addJob("prepare", {
    id: "shared",
    enqueue: true,
    name: "B",
    roomId: b.id,
  });
  assert.equal(jobA, jobB, "resource preparation is shared");
  assert.equal(
    roomTargets(
      JSON.parse(
        store.db.prepare("SELECT payload FROM jobs WHERE id=?").get(jobA)
          .payload,
      ),
    ).length,
    2,
  );
  deliverJobSong(
    store,
    (id, name, roomId) => delivered.push(roomId),
    { id: jobA },
    "shared",
  );
  deliverJobSong(
    store,
    (id, name, roomId) => delivered.push(roomId),
    { id: jobA },
    "shared",
  );
  assert.deepEqual(
    delivered.sort(),
    [a.id, b.id].sort(),
    "one delivery per destination, including retries",
  );
});

test("SSE room state and reactions never cross rooms; library updates remain shared", () => {
  const a = {
      roomId: "a",
      write: (message) => a.messages.push(message),
      messages: [],
    },
    b = {
      roomId: "b",
      write: (message) => b.messages.push(message),
      messages: [],
    };
  const events = liveEvents(new Set([a, b]), (roomId) => ({ roomId }));
  events.emit();
  assert.match(a.messages[0], /"roomId":"a"/);
  assert.match(b.messages[0], /"roomId":"b"/);
  events.emit("reaction", { emoji: "👏" }, "a");
  assert.equal(a.messages.length, 2);
  assert.equal(b.messages.length, 1);
  events.close();
});
