import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  stat,
  rm,
  symlink,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { openStore } from "../server/db.js";
import { createScheduler } from "../server/scheduler.js";
import { taskFetch, withTaskSignal } from "../server/task-cancellation.js";
import {
  taskDirectory,
  prepareTaskDirectory,
  cleanTaskFiles,
} from "../server/task-files.js";
import { run } from "../server/process.js";
const until = async (fn) => {
  const deadline = Date.now() + 6000;
  while (!(await fn())) {
    assert.ok(Date.now() < deadline, "timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
};
async function fixture(t, execute) {
  const root = await mkdtemp(path.join(os.tmpdir(), "ktv-cancel-"));
  const store = openStore(path.join(root, "db")),
    downloads = path.join(root, "downloads");
  await mkdir(downloads);
  const scheduler = createScheduler(
    { ...store, store, downloads, emit: () => {}, enqueue: () => {} },
    { execute },
  );
  t.after(async () => {
    await scheduler.stop();
    store.db.close();
    await rm(root, { recursive: true, force: true });
  });
  return { root, store, downloads, scheduler };
}
test("cancelling a live download kills its writer, deletes files, prevents mobile fallback and releases the queue", async (t) => {
  let started = false;
  const f = await fixture(t, async (job, p, c) => {
    if (p.title === "next") return;
    const folder = await prepareTaskDirectory(c.downloads, job.id);
    await run(
      process.execPath,
      [
        "-e",
        `const fs=require('fs');fs.writeFileSync(process.argv[1],'partial');console.log('ready');setInterval(()=>fs.appendFileSync(process.argv[1],'x'),20)`,
        path.join(folder, "video.part"),
      ],
      60000,
      1024,
      () => {
        started = true;
      },
    );
    c.addJob("import", { file: path.join(folder, "video.part") });
  });
  const id = f.scheduler.addJob("download", {
    url: "https://example.test/song",
    title: "cancel",
    priority: "mobile",
  });
  await until(() => started);
  await Promise.all([f.scheduler.deleteJob(id), f.scheduler.deleteJob(id)]);
  assert.equal(
    f.store.db.prepare("SELECT * FROM jobs WHERE id=?").get(id),
    undefined,
  );
  await assert.rejects(stat(taskDirectory(f.downloads, id)), {
    code: "ENOENT",
  });
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(f.store.db.prepare("SELECT count(*) AS n FROM jobs").get().n, 0);
  const next = f.scheduler.addJob("download", {
    url: "https://example.test/next",
    title: "next",
  });
  await until(
    () =>
      f.store.db.prepare("SELECT status FROM jobs WHERE id=?").get(next)
        .status === "done",
  );
});
test("cancelling during a stalled HTTP response closes the stream", async (t) => {
  let connected = false,
    closed = false;
  const server = http.createServer((req, res) => {
    connected = true;
    res.writeHead(200);
    res.write("partial");
    res.on("close", () => {
      closed = true;
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const f = await fixture(t, async () => {
    const response = await taskFetch(
      `http://127.0.0.1:${server.address().port}`,
    );
    await response.text();
  });
  const id = f.scheduler.addJob("download", {
    url: "https://example.test/hang",
  });
  await until(() => connected);
  await f.scheduler.deleteJob(id);
  await until(() => closed);
  assert.equal(
    f.store.db.prepare("SELECT * FROM jobs WHERE id=?").get(id),
    undefined,
  );
});
test("cleanup preserves referenced media and rejects linked workspaces", async (t) => {
  const f = await fixture(t, async () => {});
  const folder = await prepareTaskDirectory(f.downloads, "owned");
  const file = path.join(folder, "song.mp4");
  await writeFile(file, "keep");
  f.store.db
    .prepare(
      "INSERT INTO songs(id,path,title,artist,created) VALUES('song',?,'title','artist',0)",
    )
    .run(file);
  await assert.rejects(cleanTaskFiles(f.store, f.downloads, "owned"), /引用/);
  assert.equal(await readFile(file, "utf8"), "keep");
  await assert.rejects(
    cleanTaskFiles(f.store, f.downloads, "../escape"),
    /无效/,
  );
  const outside = path.join(f.root, "outside");
  await mkdir(outside);
  await writeFile(path.join(outside, "keep"), "keep");
  await symlink(
    outside,
    taskDirectory(f.downloads, "linked"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await assert.rejects(
    cleanTaskFiles(f.store, f.downloads, "linked"),
    /符号链接/,
  );
  assert.equal(await readFile(path.join(outside, "keep"), "utf8"), "keep");
});
test("restart resumes cancellation cleanup instead of starting the old job", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ktv-cancel-restart-"));
  const store = openStore(path.join(root, "db")),
    downloads = path.join(root, "downloads");
  const folder = await prepareTaskDirectory(downloads, "old-job");
  await writeFile(path.join(folder, "partial"), "partial");
  store.db
    .prepare(
      "INSERT INTO jobs(id,kind,payload,status,created) VALUES('old-job','download','{}','cancelling',0)",
    )
    .run();
  let calls = 0;
  const scheduler = createScheduler(
    { ...store, store, downloads, emit: () => {} },
    {
      execute: async () => {
        calls++;
      },
    },
  );
  await until(
    () => !store.db.prepare("SELECT * FROM jobs WHERE id='old-job'").get(),
  );
  assert.equal(calls, 0);
  await assert.rejects(stat(folder), { code: "ENOENT" });
  await scheduler.stop();
  store.db.close();
  await rm(root, { recursive: true, force: true });
});

test("failed cleanup keeps a non-restartable task and can be retried after a reference is released", async (t) => {
  const f = await fixture(t, async () => {});
  const folder = await prepareTaskDirectory(f.downloads, "waiting");
  const file = path.join(folder, "shared.mp4");
  await writeFile(file, "shared");
  f.store.db
    .prepare(
      "INSERT INTO jobs(id,kind,payload,status,created) VALUES('waiting','download','{}','waiting-worker',0)",
    )
    .run();
  f.store.db
    .prepare(
      "INSERT INTO jobs(id,kind,payload,status,created) VALUES('consumer','import',?,'review',0)",
    )
    .run(JSON.stringify({ file }));
  await assert.rejects(f.scheduler.deleteJob("waiting"), /引用/);
  const row = f.store.db.prepare("SELECT * FROM jobs WHERE id='waiting'").get();
  assert.equal(row.status, "cancelling");
  assert.equal(row.stage, "cleanup-failed");
  assert.equal(await readFile(file, "utf8"), "shared");
  f.store.db.prepare("DELETE FROM jobs WHERE id='consumer'").run();
  await f.scheduler.deleteJob("waiting");
  assert.equal(
    f.store.db.prepare("SELECT * FROM jobs WHERE id='waiting'").get(),
    undefined,
  );
  await assert.rejects(stat(folder), { code: "ENOENT" });
});
test(
  "Linux download cancellation also stops descendant writers",
  { skip: process.platform === "win32" },
  async (t) => {
    let started = false;
    const f = await fixture(t, async (job, p, c) => {
      const folder = await prepareTaskDirectory(c.downloads, job.id);
      const file = path.join(f.root, "child-writes");
      const code = `const fs=require('fs');fs.writeFileSync(process.argv[1],'x');setInterval(()=>fs.appendFileSync(process.argv[1],'x'),15)`;
      await run(
        process.execPath,
        [
          "-e",
          `require('child_process').spawn(process.execPath,['-e',${JSON.stringify(code)},process.argv[1]],{stdio:'ignore'});console.log('ready');setInterval(()=>{},1000)`,
          file,
        ],
        60000,
        1024,
        () => {
          started = true;
        },
      );
    });
    const id = f.scheduler.addJob("download", {
      url: "https://example.test/tree",
    });
    await until(() => started);
    await until(async () => {
      try {
        return (await stat(path.join(f.root, "child-writes"))).size > 1;
      } catch {
        return false;
      }
    });
    await f.scheduler.deleteJob(id);
    const before = (await stat(path.join(f.root, "child-writes"))).size;
    await new Promise((r) => setTimeout(r, 100));
    assert.equal((await stat(path.join(f.root, "child-writes"))).size, before);
  },
);
