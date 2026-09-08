import React from "react";
import { Mic2, QrCode, Disc3, ArrowUpRight } from "lucide-react";
export function Stage({ current, songs, add, choose, qr, token }) {
  return (
    <>
      <section className="stage-welcome">
        <p className="eyebrow">WELCOME TO YOUR STAGE</p>
        <h1>
          好歌开场。
          <br />
          下一首，你来唱。
        </h1>
        <p>
          {current?.ambient
            ? "曲库随机播放 · 原唱欣赏"
            : current
              ? "你的点歌正在播放"
              : "正在准备第一首开场音乐"}
        </p>
        <button className="primary" onClick={choose}>
          <Mic2 size={20} />
          我要点歌
        </button>
        <button onClick={qr}>
          <QrCode size={20} />
          手机扫码点歌
        </button>
      </section>
      <section className="stage-picks">
        <div className="section-heading">
          <h2>今晚想唱哪一首</h2>
          <button onClick={choose}>
            查看曲库 <ArrowUpRight size={16} />
          </button>
        </div>
        <div className="stage-cards">
          {songs.slice(0, 6).map((song, i) => (
            <button
              key={song.id}
              onClick={() => add(song)}
              className={"stage-card color-" + (i % 5)}
            >
              <div>
                {song.hasPoster ? (
                  <img
                    src={
                      "/api/poster/" +
                      song.id +
                      "?token=" +
                      encodeURIComponent(token)
                    }
                    alt=""
                  />
                ) : (
                  <Disc3 size={42} />
                )}
              </div>
              <strong>{song.title}</strong>
              <span>{song.artist}</span>
            </button>
          ))}
        </div>
      </section>
    </>
  );
}
