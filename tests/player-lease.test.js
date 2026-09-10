import test from "node:test";
import assert from "node:assert/strict";
import { createPlayerLease } from "../server/player-lease.js";

test("TV priority and fresh peer claims revoke previous pages permanently", () => {
  let time = 0;
  const lease = createPlayerLease({ now: () => time });
  const beat = (id, type = "web", claim = true) =>
    lease.heartbeat({ id, type, claim });
  beat("web1");
  beat("web2");
  assert.throws(() => beat("web1"), { code: "PLAYER_REPLACED" });
  beat("tv1", "tv");
  assert.throws(() => beat("web2", "web", false), { code: "PLAYER_REPLACED" });
  assert.throws(() => beat("web3"), { code: "PLAYER_TV_PRIORITY" });
  beat("tv2", "tv");
  assert.throws(() => beat("tv1", "tv", false), { code: "PLAYER_REPLACED" });
  assert.equal(lease.snapshot().id, "tv2");
  time = 15000;
  assert.equal(lease.snapshot(), null);
  assert.equal(lease.owns("tv2"), false);
  beat("web3", "web", false);
  assert.equal(lease.snapshot().id, "web3");
  assert.throws(() => beat("web1"), { code: "PLAYER_REPLACED" });
});

test("renewals and delayed retries cannot displace another player", () => {
  const lease = createPlayerLease();
  lease.heartbeat({ id: "web", type: "web" });
  assert.throws(() => lease.heartbeat({ id: "waiting", type: "web" }), {
    code: "PLAYER_BUSY",
  });
  assert.throws(
    () => lease.heartbeat({ id: "waiting", type: "web", claim: true }),
    { code: "PLAYER_BUSY" },
  );
  const revision = lease.snapshot().revision;
  lease.heartbeat({ id: "web", type: "tv", claim: true });
  assert.deepEqual(lease.snapshot(), { id: "web", type: "web", revision });
});
