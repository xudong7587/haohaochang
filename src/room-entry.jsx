import React, { useState } from "react";
import { Mic2, ArrowRight } from "lucide-react";
import { api, selectRoom } from "./api.js";
import "./room-entry.css";

export function RoomEntry({ onEnter, onCancel }) {
  const [code, setCode] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [previous] = useState(() => {
    try {
      return JSON.parse(sessionStorage.getItem("playRoom"));
    } catch {
      return null;
    }
  });
  async function enter(kind) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const room =
        kind === "previous"
          ? {
              ...previous,
              ...(await api(
                "/rooms/current",
                undefined,
                "GET",
                false,
                previous.token,
              )),
            }
          : kind === "default"
            ? await api("/rooms/default")
            : await api(
                kind === "join" ? "/rooms/join" : "/rooms",
                kind === "join" ? { code } : {},
                "POST",
              );
      selectRoom(room);
      onEnter(room);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="room-entry">
      <section className="room-entry-card">
        <Mic2 size={34} />
        <h1>独立歌房</h1>
        <p>需要分开唱时再开启，曲库共享，播放互不打扰。</p>
        <button disabled={busy} onClick={() => enter("default")}>
          返回家庭默认歌房
        </button>
        <button
          className="primary"
          disabled={busy}
          onClick={() => enter("new")}
        >
          独立开唱 <ArrowRight size={18} />
        </button>
        <small>为当前页面新建歌房，互不打扰。</small>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            enter("join");
          }}
        >
          <label htmlFor="room-code">加入已有歌房</label>
          <div>
            <input
              id="room-code"
              aria-label="歌房号码"
              inputMode="numeric"
              autoComplete="off"
              maxLength={6}
              pattern="[0-9]{6}"
              placeholder="输入 6 位数字"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              required
            />
            <button disabled={busy || code.length !== 6}>加入歌房</button>
          </div>
          <small>共享已点列表，并将播放切换到当前设备。</small>
        </form>
        {previous?.code && (
          <button
            className="room-resume"
            disabled={busy}
            onClick={() => enter("previous")}
          >
            返回上次歌房 {previous.code}
          </button>
        )}
        {busy && <p role="status">正在进入歌房…</p>}
        {error && <p role="alert">{error}</p>}
        <button disabled={busy} onClick={onCancel}>
          取消
        </button>
      </section>
    </main>
  );
}
