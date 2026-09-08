# 开发说明

先阅读 [模块分工](DEVELOPMENT-PLAN.md) 和 [对抗性审查](ADVERSARIAL-REVIEW.md)。当前 UI 脚本有已知失败 R8，不能把历史通过记录当作新工作台验收。

## 开发和验证

需要 Node.js 22.13+，推荐 Node 24。媒体处理需要 FFmpeg、ffprobe；在线下载需要 yt-dlp。Dockerfile 已安装这些工具。

```sh
npm ci
# 设置 ADMIN_PASSWORD 环境变量后：
npm run dev
npm run build
npm start
npm test
```

开发前端默认在 `5173`，后端在 `3210`。可用 `FFMPEG`、`FFPROBE`、`YTDLP` 指定程序路径，用 `MEDIA_ROOTS` 指定多个媒体目录，目录之间用 `|` 分隔。二维码地址在后台配置并保存到 settings.json。

开发者若需要本地构建 Docker，可使用 `docker compose -f docker-compose.yaml -f docker-compose.build.yaml up -d --build`。NAS 日常部署使用默认 `docker-compose.yaml` 拉镜像。

`npm test` 包含真实媒体测试，使用开发依赖中的 FFmpeg/ffprobe 二进制。如果包管理器阻止安装脚本，需要先允许 `ffmpeg-static` 的安装脚本或执行 `node node_modules/ffmpeg-static/install.js`。

浏览器联动检查：安装 Playwright 后运行 `node scripts/ui-check.mjs`，可用 `PLAYWRIGHT_MODULE` 指定已有模块路径、`BROWSER_CHANNEL` 指定浏览器，默认使用 Edge。测试使用独立数据库和合成测试曲，不写入正式曲库。截图位于 `test-results/ui/`。

APK 使用 Java 21、Gradle 9.4.1、Android SDK 36 构建：

```sh
gradle -p android assembleDebug
```

最低 Android 6；WebView 需支持现代 JavaScript，建议 Chromium/WebView 90 及以上。APK 是原生连接外壳加 WebView 终端，播放调用系统媒体解码；没有在 TV 端嵌入 FFmpeg 或 AI。当前是 debug 签名测试包，正式分发前需要建立自己的 release 签名和升级策略。

本机验证记录与待验收项见 [验证记录](VALIDATION.md)，系统决策见 [系统设计](DESIGN.md)。

