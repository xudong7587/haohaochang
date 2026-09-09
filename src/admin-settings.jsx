import React, { useState, useEffect, useRef } from "react";
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
  const [section, setSection] = useState("tasks");
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    const timer = setInterval(() => refreshRef.current(), 5000);
    return () => clearInterval(timer);
  }, []);
  return (
    <>
      <div className="section-heading">
        <div>
          <h1>设置与任务</h1>
          <p>查看处理进度，按功能管理你的歌房。</p>
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
              admin.jobs.filter((j) =>
                ["queued", "running", "waiting-worker"].includes(j.status),
              ).length
            }
          </strong>
          <span>后台任务</span>
        </div>
      </div>
      <nav className="settings-nav" aria-label="设置功能板块">
        {[
          ["tasks", "后台任务"],
          ["media", "媒体与导入"],
          ["online", "在线资源"],
          ["metadata", "资料与歌词"],
          ["display", "播放画面"],
          ["connection", "连接地址"],
        ].map(([id, label]) => (
          <button
            key={id}
            className={section === id ? "active" : ""}
            aria-pressed={section === id}
            onClick={() => setSection(id)}
          >
            {label}
          </button>
        ))}
      </nav>
      <div hidden={section !== "media"}>
        <section className="settings-card">
          <h3>NAS 媒体目录</h3>
          {admin.scanProgress && (
            <p>
              最近扫描：{admin.scanProgress.running ? "扫描中" : "已结束"}
              ，已检查 {admin.scanProgress.checked} 个媒体，新增{" "}
              {admin.scanProgress.added} 首，读取失败{" "}
              {admin.scanProgress.errors.length} 个。
            </p>
          )}
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
      </div>
      <div hidden={section !== "display"}>
        <BackgroundSettings
          request={(url, body, method) => api(url, body, method, true)}
          notify={(text) => attempt(() => Promise.resolve(), text)}
        />
      </div>
      <div hidden={section !== "metadata"}>
        <LyricsSettings
          request={(url, body, method) => api(url, body, method, true)}
          notify={(text) => attempt(() => Promise.resolve(), text)}
        />
      </div>
      <div hidden={!["online", "metadata"].includes(section)}>
        <Automation
          section={section}
          request={(url, body, method) => api(url, body, method, true)}
          notify={(text) => attempt(() => Promise.resolve(), text)}
        />
      </div>
      <div hidden={section !== "media"}>
        <Organize
          request={(url, body, method) => api(url, body, method, true)}
          notify={(text) => attempt(() => Promise.resolve(), text)}
          refresh={refresh}
          downloads={admin.downloads}
          autoImport={admin.autoImport}
        />
      </div>
      <div hidden={!["online", "connection"].includes(section)}>
        <form
          className="settings-card"
          onSubmit={async (e) => {
            e.preventDefault();
            await attempt(
              () =>
                api(
                  "/admin/settings",
                  section === "online"
                    ? { onlineEnabled: online }
                    : { publicUrl: url },
                  "POST",
                  true,
                ),
              section === "online"
                ? "在线搜索设置已保存"
                : "连接地址已保存，重新打开电视以更新二维码",
            );
            refresh();
          }}
        >
          <h3>{section === "online" ? "在线搜索" : "连接地址"}</h3>
          <div hidden={section !== "connection"}>
            <label>
              NAS 访问地址（内网或 HTTPS 反代）
              <input
                placeholder="https://ktv.example.com"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={section !== "connection"}
                type="url"
              />
            </label>
            <p>
              可填写 http://NAS-IP:3210 或
              https://ktv.example.com；留空时二维码跟随当前页面地址。使用独立域名，不要附加
              /admin、/tv 等路径。TV APK 填写同一地址，使用管理密码登录。
            </p>
          </div>
          <div hidden={section !== "online"}>
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
          </div>
          <button className="primary">保存设置</button>
        </form>
      </div>
      <div hidden={section !== "tasks"}>
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
                        organize: "整理歌曲",
                        scan: "扫描媒体目录",
                        prepare: "准备播放版本",
                        download: "下载在线资源",
                      }[j.kind]
                    }
                  </strong>
                  <p className="task-song">
                    {j.title || "媒体目录"}
                    {j.artist ? " · " + j.artist : ""}
                    {j.priority === "online" ? " · 优先处理" : ""}
                  </p>
                  {Number.isFinite(j.model_progress) && (
                    <div>
                      <progress max="100" value={j.model_progress} />
                      <span>模型当前步骤 {j.model_progress}%</span>
                    </div>
                  )}
                  <small>
                    {new Date(j.created).toLocaleString()} ·{" "}
                    {statusNames[j.status]}
                    {j.status === "running" &&
                      ({
                        downloading: " · 下载视频",
                        clipping: " · PC 裁剪",
                        separating: " · 伴奏分离",
                        decoding: " · 提取音频",
                        validating: " · 校验资源",
                        preparing: " · 准备播放资源",
                      }[j.stage] ||
                        "")}
                    {j.started && !j.finished
                      ? ` · 已处理 ${Math.max(0, Math.round((Date.now() - j.started) / 1000))} 秒`
                      : ""}
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
      </div>
    </>
  );
}
