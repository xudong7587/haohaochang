import test from "node:test";
import assert from "node:assert/strict";
import { createDraft, draftReducer } from "../src/library/draft.js";
import { refreshMetadataBatch } from "../src/library/batch.js";

const song = {
  id: "isolated",
  title: "原歌名",
  artist: "歌手",
  lyrics: "[00:01]原歌词",
  metadataRevision: 2,
};
test("clean drafts follow refresh, dirty drafts preserve user edits and require explicit conflict resolution", () => {
  let draft = createDraft(song);
  draft = draftReducer(draft, {
    type: "refresh",
    row: { ...song, title: "后台标题", metadataRevision: 3 },
  });
  assert.equal(draft.values.title, "后台标题");
  assert.equal(draft.dirty, false);
  draft = draftReducer(draft, { type: "edit", patch: { title: "用户草稿" } });
  draft = draftReducer(draft, {
    type: "refresh",
    row: { ...song, title: "另一窗口标题", metadataRevision: 4 },
  });
  assert.equal(draft.values.title, "用户草稿");
  assert.equal(draft.revision, 3);
  assert.equal(draft.conflict, true);
  draft = draftReducer(draft, {
    type: "refresh",
    row: { ...song, title: "第三次后台标题", metadataRevision: 5 },
  });
  assert.equal(draft.values.title, "用户草稿");
  assert.equal(draft.conflict, true);
  const adopted = draftReducer(draft, { type: "adopt" });
  assert.equal(adopted.values.title, "第三次后台标题");
  assert.equal(adopted.dirty, false);
  const retained = draftReducer(draft, { type: "rebase" });
  assert.equal(retained.values.title, "用户草稿");
  assert.equal(retained.revision, 5);
  assert.equal(retained.dirty, true);
  assert.equal(retained.conflict, false);
  const saved = draftReducer(retained, {
    type: "saved",
    values: retained.values,
    revision: 6,
  });
  assert.equal(saved.dirty, false);
  assert.equal(saved.revision, 6);
});
test("late refresh and saving an earlier snapshot cannot overwrite newer edits", () => {
  let draft = draftReducer(createDraft(song), {
    type: "edit",
    patch: { title: "先前草稿" },
  });
  const submitted = draft.values;
  draft = draftReducer(draft, {
    type: "edit",
    patch: { lyrics: "[00:02]保存请求发出后的新输入" },
  });
  draft = draftReducer(draft, {
    type: "saved",
    values: submitted,
    revision: 3,
  });
  assert.equal(draft.dirty, true);
  assert.match(draft.values.lyrics, /新输入/);
  const unchanged = draftReducer(draft, { type: "refresh", row: song });
  assert.equal(unchanged, draft);
});
test("batch metadata refresh submits at most 20 items, preserves revisions and handles per-item outcomes", async () => {
  const songs = Array.from({ length: 45 }, (_, i) => ({
    ...song,
    id: String(i),
    metadataRevision: i,
  }));
  const calls = [],
    progress = [];
  const request = async (url, body) => {
    calls.push({ url, body });
    songs[44].metadataRevision = 999;
    return {
      results: body.items.map((item) => ({
        id: item.id,
        status:
          item.id === "2" ? "conflict" : item.id === "3" ? "review" : "success",
      })),
    };
  };
  const results = await refreshMetadataBatch(songs, request, (value) =>
    progress.push(value),
  );
  assert.equal(calls.length, 3);
  assert.ok(
    calls.every(
      (c) =>
        c.url === "/admin/refresh-metadata-batch" && c.body.items.length <= 20,
    ),
  );
  assert.equal(calls[2].body.items.at(-1).expectedRevision, 44);
  assert.equal(results[2].status, "conflict");
  assert.equal(results[3].status, "review");
  assert.equal(results[44].status, "success");
  assert.equal(progress.length, 4);
});
test("metadata batch respects Retry-After on 429 without retrying revision conflicts", async () => {
  let attempts = 0;
  const waits = [];
  const results = await refreshMetadataBatch(
    [song],
    async () => {
      if (++attempts === 1)
        throw Object.assign(new Error("限流"), { status: 429, retryAfter: 12 });
      return {
        results: [{ id: song.id, status: "conflict", message: "保留当前资料" }],
      };
    },
    () => {},
    { wait: async (ms) => waits.push(ms) },
  );
  assert.deepEqual(waits, [12000]);
  assert.equal(attempts, 2);
  assert.equal(results[0].status, "conflict");
});
