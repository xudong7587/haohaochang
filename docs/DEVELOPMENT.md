# 开发说明

先阅读 [模块分工](DEVELOPMENT-PLAN.md) 和 [对抗性审查](ADVERSARIAL-REVIEW.md)。第 0／1 批已完成，验证结果与实机范围见 PROJECT-STATUS.md。

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

浏览器联动检查：安装 Playwright 后运行 `node scripts/ui-check.mjs`，可用 `PLAYWRIGHT_MODULE` 指定已有模块路径、`BROWSER_CHANNEL` 指定浏览器，默认使用 Playwright Chromium，Windows 可设置 BROWSER_CHANNEL=msedge。测试使用独立数据库和合成测试曲，不写入正式曲库。截图位于 `test-results/ui/`。

APK 使用 Java 21、Gradle 9.4.1、Android SDK 36 构建：

```sh
gradle -p android assembleDebug
```

最低 Android 6；WebView 需支持现代 JavaScript，建议 Chromium/WebView 90 及以上。APK 是原生连接外壳加 WebView 终端，播放调用系统媒体解码；没有在 TV 端嵌入 FFmpeg 或 AI。当前是 debug 签名测试包，正式分发前需要建立自己的 release 签名和升级策略。

本机验证记录与待验收项见 [验证记录](VALIDATION.md)，系统决策见 [系统设计](DESIGN.md)。


## 当前检查入口

```sh
npx playwright install chromium
node scripts/ui-check.mjs
node tests/library-ui.browser.mjs
node scripts/player-check.mjs
python -m unittest discover -s separator -p test_protocol.py
```

Python 协议测试需 fastapi==0.115.12、python-multipart==0.0.20 和 httpx，可在独立虚拟环境安装，无需模型或 GPU。浏览器与媒体测试使用临时目录和随机 localhost 端口。

## 本地中文歌词索引

配置 `KTV_LYRICS_INDEX=/data/lyrics/index.json`，文件使用 UTF-8 JSON 数组，LRC 相对索引目录存放。Docker Compose 可在 ktv.environment 中增加同名变量，将索引与歌词放入已映射的 data/lyrics 目录。

```json
[{"id":"my-recording-1","title":"歌名","artist":"歌手","duration":240,"version":"studio","file":"歌曲.lrc","sourceUrl":"https://example.com/source","license":"自有或获授权"}]
```

必须填写真实录音时长和版本；缺失、同名翻唱或歧义不会自动认定匹配。索引最多 20000 项／8 MB，单个 LRC 最多 1 MB，路径不能越出索引目录。支持增强逐字 LRC 与毫秒 offset。失败时回退 LRCLIB；自动匹配仍需试听核对，不保证逐字节奏一致。
