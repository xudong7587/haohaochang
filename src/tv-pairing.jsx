import React, { useEffect, useState } from "react";
import { api, acceptLogin } from "./api.js";
import {
  Mic2,
  Smartphone,
  Check,
  RefreshCw,
  Monitor,
  ArrowRight,
} from "lucide-react";
import "./tv-welcome.css";

export function TvLoginQr({ onLogin, children }) {
  const handheld =
    location.pathname === "/play" &&
    window.matchMedia(
      "(max-width: 700px), (max-width: 950px) and (max-height: 500px)",
    ).matches;
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
            if (Date.now() >= expires) {
              if (!stopped) setGeneration((n) => n + 1);
              return;
            }
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
    <main className="tv-welcome login">
      <header className="tv-welcome-brand">
        <Mic2 size={24} />
        <strong>好好唱</strong>
        <span>HOME KARAOKE</span>
      </header>
      <div className="tv-welcome-body">
        <section className="tv-welcome-copy">
          <div className="tv-server-state">
            <Check size={16} /> 已连接家庭歌房 <span>{location.host}</span>
          </div>
          <h1>
            {handheld ? (
              <>
                你的音乐，
                <br />
                随身开唱。
              </>
            ) : (
              <>
                把客厅，
                <br />
                变成你的主场。
              </>
            )}
          </h1>
          <p className="tv-welcome-description">
            {handheld ? (
              <>
                在这台手机上，点歌也能直接唱。
                <br />
                输入歌房密码，开启你的音乐现场。
              </>
            ) : (
              <>
                电视负责大画面，手机负责点歌。
                <br />
                扫一扫，让今晚的第一首开始。
              </>
            )}
          </p>
          <ol className="tv-welcome-steps">
            <li>
              <span>1</span>
              <div>
                <strong>手机扫描右侧二维码</strong>
                <small>连接与电视相同的家庭网络</small>
              </div>
            </li>
            <li>
              <span>2</span>
              <div>
                <strong>核对连接码，确认登录</strong>
                <small>首次连接，在手机输入歌房管理密码</small>
              </div>
            </li>
            <li>
              <span>3</span>
              <div>
                <strong>挑一首喜欢的，开唱</strong>
                <small>电视自动进入歌房，手机继续点歌</small>
              </div>
            </li>
          </ol>
          {/HaohaochangTV/.test(navigator.userAgent) && (
            <a className="tv-change-server" href="haohaochang://connection">
              更换服务器 <ArrowRight size={16} />
            </a>
          )}
        </section>
        <section
          className={`tv-pair-card tv-login-qr ${handheld ? "handheld-login" : ""}`}
          aria-label="电视扫码登录"
        >
          <div className="tv-pair-card-title">
            <Smartphone size={22} />
            <h2>
              {handheld ? "也可用另一台手机扫码" : "手机扫码，电视一起登录"}
            </h2>
          </div>
          <div className="tv-qr-frame">
            {pair ? (
              <img
                src={pair.qr}
                width="280"
                height="280"
                alt="扫码登录电视并点歌"
              />
            ) : (
              <div className="tv-qr-status" role="status">
                <Monitor size={40} />
                <p>{error || "正在生成二维码…"}</p>
              </div>
            )}
          </div>
          <div className="tv-pair-code">
            <span>连接码</span>
            <strong>{pair?.code || "······"}</strong>
          </div>
          <p className="tv-pair-hint">请确认手机与电视显示的数字相同</p>
          <button
            type="button"
            className="tv-refresh-qr"
            onClick={() => setGeneration((n) => n + 1)}
          >
            <RefreshCw size={16} />
            刷新二维码
          </button>
          {children && (
            <details className="tv-password-fallback" open={handheld}>
              <summary>
                {handheld ? "在本机登录并播放" : "改用密码登录"}
              </summary>
              {children}
            </details>
          )}
        </section>
      </div>
      <footer className="tv-welcome-footer">
        <span>音乐留在 NAS，快乐留在客厅。</span>
        <span>二维码到期自动更新 · 手机确认后自动进入</span>
      </footer>
    </main>
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
