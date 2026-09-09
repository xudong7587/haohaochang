import React, { useState } from "react";
import { BackgroundSettings } from "./background-settings.jsx";
import { HardDrive, Check, RefreshCw } from "lucide-react";
import { api } from "./api.js";
import { statusNames } from "./view-constants.js";
import { LyricsSettings } from "./library-manager.jsx";
import { Automation } from "./automation.jsx";
import { Organize } from "./organize.jsx";
export function Settings({ admin, attempt, refresh }) {
  const [url, setUrl] = useState(admin.publicUrl),
    [online, setOnline] = useState(admin.onlineEnabled);
  return (
    <>
      <div className="section-heading">
        <div>
          <h1>每一次开唱，都简单。</h1>
          <p>媒体目录、连接方式和后台处理，都在这里。</p>
        </div>
      </div>
      <div className="stats">
        <div>
          <HardDrive />
          <strong>{admin.songs}</strong>
          <span>已收录歌曲</span>
        </div>
        <div>
          <Check />
          <strong>{admin.ready}</strong>
          <span>可立即点播</span>
        </div>
        <div>
          <RefreshCw />
          <strong>
            {
              admin.jobs.filter((j) => ["queued", "running"].includes(j.status))
                .length
            }
          </strong>
          <span>后台任务</span>
        </div>
      </div>
      <section className="settings-card">
        <h3>NAS 媒体目录</h3>
        {admin.roots.map((r) => (
          <code key={r}>{r}</code>
        ))}
        <p>
          正式曲库需要写入权限以保存整理后的文件，成功的播放版本长期保存在正式曲库的「好好唱播放资源」。页面设置会自动保存为
          settings.json，重启后继续生效。
        </p>
        <button
          onClick={() =>
            attempt(
              () => api("/admin/scan", {}, "POST", true),
              "扫描已加入任务",
            )
          }
        >
          <RefreshCw size={17} />
          扫描曲库
        </button>
      </section>
      <BackgroundSettings
        request={(url, body, method) => api(url, body, method, true)}
        notify={(text) => attempt(() => Promise.resolve(), text)}
      />
      <LyricsSettings
        request={(url, body, method) => api(url, body, method, true)}
        notify={(text) => attempt(() => Promise.resolve(), text)}
      />
      <Automation
        request={(url, body, method) => api(url, body, method, true)}
        notify={(text) => attempt(() => Promise.resolve(), text)}
      />
      <Organize
        request={(url, body, method) => api(url, body, method, true)}
        notify={(text) => attempt(() => Promise.resolve(), text)}
        refresh={refresh}
        downloads={admin.downloads}
        autoImport={admin.autoImport}
      />
      <form
        className="settings-card"
        onSubmit={async (e) => {
          e.preventDefault();
          await attempt(
            () =>
              api(
                "/admin/settings",
                { publicUrl: url, onlineEnabled: online },
                "POST",
                true,
              ),
            "设置已保存到 settings.json，重新打开电视以更新二维码",
          );
          refresh();
        }}
      >
        <h3>连接与在线资源</h3>
        <label>
          NAS 访问地址（内网或 HTTPS 反代）
          <input
            placeholder="https://ktv.example.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            type="url"
          />
        </label>
        <p>
          可填写 http://NAS-IP:3210 或
          https://ktv.example.com；留空时二维码跟随当前页面地址。使用独立域名，不要附加
          /admin、/tv 等路径。TV APK 填写同一地址，使用管理密码登录。
        </p>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={online}
            onChange={(e) => setOnline(e.target.checked)}
          />
          启用 Bilibili / YouTube 在线搜索与入库
        </label>
        <p>
          仅导入你有权保存和使用的资源。平台限制或网络问题会显示在任务记录中。
        </p>
        <button className="primary">保存设置</button>
      </form>
      <section className="settings-card">
        <div className="section-heading">
          <h3>后台任务</h3>
          <button aria-label="刷新任务" onClick={refresh}>
            <RefreshCw size={17} />
          </button>
        </div>
        {admin.jobs.length ? (
          admin.jobs.map((j) => (
            <div className="job" key={j.id}>
              <div>
                <strong>
                  {
                    {
                      "attach-video": "补充视频",
                      acquire: "自动找歌",
                      "find-video": "补充 MTV",
                      "favorite-sync": "检查收藏夹",
                      "favorite-download": "收藏夹下载",
                      enrich: "AI 信息刮削",
                      import: "下载自动入库",
                      scan: "扫描媒体目录",
                      prepare: "准备播放版本",
                      download: "下载在线资源",
                    }[j.kind]
                  }
                </strong>
                <small>
                  {new Date(j.created).toLocaleString()} ·{" "}
                  {statusNames[j.status]}
                  {j.status === "running" &&
                    ({
                      downloading: " · 下载视频",
                      clipping: " · PC 裁剪",
                      separating: " · 伴奏分离",
                      preparing: " · 准备播放资源",
                    }[j.stage] ||
                      "")}
                  {j.started && j.finished
                    ? " · 耗时 " +
                      Math.round((j.finished - j.started) / 1000) +
                      " 秒"
                    : ""}
                </small>
                {j.error && <p className="error">{j.error}</p>}
              </div>
              {["failed", "waiting-worker"].includes(j.status) && (
                <button
                  onClick={async () => {
                    await attempt(() =>
                      api(`/admin/jobs/${j.id}/retry`, {}, "POST", true),
                    );
                    refresh();
                  }}
                >
                  重试
                </button>
              )}
            </div>
          ))
        ) : (
          <p>还没有任务。扫描曲库后，就从这里开始。</p>
        )}
      </section>
    </>
  );
}
