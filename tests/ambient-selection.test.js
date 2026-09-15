import test from "node:test";
import assert from "node:assert/strict";
import { selectAmbient } from "../server/ambient-selection.js";

test("ambient rounds cover the entire catalogue, survive restart and admit new imports", () => {
  const songs = Array.from({ length: 100 }, (_, id) => ({
    id: String(id),
    created: 0,
  }));
  let history = {},
    played = [];
  for (let i = 0; i < 100; i++) {
    const result = selectAmbient(songs, JSON.parse(JSON.stringify(history)));
    history = result.history;
    played.push(result.song.id);
  }
  assert.equal(new Set(played).size, 100);
  const next = selectAmbient(songs, history);
  assert.notEqual(next.song.id, played.at(-1));
  const imported = { id: "new", created: Date.now() };
  assert.equal(selectAmbient([...songs, imported], history).song.id, "new");
  assert.equal(selectAmbient([songs[0]], history).song.id, "0");
  assert.equal(selectAmbient([], history).song, null);
});

test("new imports get more weight without starving older songs", () => {
  const songs = [
    { id: "old", created: 0 },
    { id: "new", created: 1000000000 },
  ];
  assert.equal(
    selectAmbient(songs, {}, { now: 1000000000, random: () => 0.3 }).song.id,
    "new",
  );
  assert.equal(
    selectAmbient(songs, { seen: ["new"], last: "new" }).song.id,
    "old",
  );
});
