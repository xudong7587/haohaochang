import React, { useEffect, useState } from "react";
import { api, acceptLogin } from "./api.js";

export function TvLoginQr({ onLogin }) {
  const [pair, setPair] = useState(null),
    [error, setError] = useState("");
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    let stopped = false,
      timer;
    setPair(null);
    setError("");
    async function start() {
      try {
        const value = await api(
          "/tv-pairing",
          { origin: location.origin },
          "POST",
        );
        if (stopped) return;
        setPair(value);
        const expires = Date.now() + value.expiresIn * 1000;
        async function poll() {
          try {
            if (Date.now() >= expires) throw new Error("二维码已过期，请刷新");
            const result = await api(
              `/tv-pairing/${value.id}/check`,
              { pollKey: value.pollKey },
              "POST",
            );
            if (stopped) return;
            if (result.status === "approved") {
              acceptLogin(result.token);
              onLogin();
              return;
            }
            timer = setTimeout(poll, 3000);
          } catch (e) {
            if (!stopped) {
              setPair(null);
              setError(e.message);
            }
          }
        }
        timer = setTimeout(poll, 3000);
      } catch (e) {
        if (!stopped) setError(e.message);
      }
    }
    start();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [generation]);
  return (
    <section className="tv-login-qr">
      <h2>手机扫码，电视一起登录</h2>
      {pair ? (
        <>
          <img
            src={pair.qr}
            width="280"
            height="280"
            alt="扫码登录电视并点歌"
          />
          <p>
            连接码 <strong>{pair.code}</strong>
          </p>
          <p className="muted">手机确认后，电视自动进入歌房，手机继续点歌。</p>
        </>
      ) : (
        <p role="status">{error || "正在生成二维码…"}</p>
      )}
      <button type="button" onClick={() => setGeneration((n) => n + 1)}>
        刷新二维码
      </button>
    </section>
  );
}

export function PhonePairing({ pair, done, onAuthRequired }) {
  const [code, setCode] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [id, approvalKey] = pair.split(".");
  useEffect(() => {
    let live = true;
    api(`/tv-pairing/${id}/info`, { approvalKey }, "POST")
      .then((r) => {
        if (live) setCode(r.code);
      })
      .catch((e) => {
        if (live && e.status === 401) {
          onAuthRequired();
          return;
        }
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [pair]);
  async function approve() {
    setBusy(true);
    try {
      await api(`/tv-pairing/${id}/approve`, { approvalKey }, "POST");
      done();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login">
      <div className="login-card">
        <h1>连接这台电视</h1>
        <p>
          请核对电视上的连接码：<strong>{code || "…"}</strong>
        </p>
        <p className="muted">
          确认后电视进入当前歌房，你可以在手机上继续点歌。
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button
          className="primary"
          disabled={!code || busy || !!error}
          onClick={approve}
        >
          {busy ? "正在连接…" : "确认登录电视并点歌"}
        </button>
        <button onClick={done}>取消，直接点歌</button>
      </div>
    </div>
  );
}
