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

必须填写真实录音时长和版本；缺失、同名翻唱或版本不符不会自动认定匹配。多份通过歌名、歌手、时长和版本检查的歌词默认选择时长最接近的一份，并保留候选数量。索引最多 20000 项／8 MB，单个 LRC 最多 1 MB，路径不能越出索引目录。支持增强逐字 LRC 与毫秒 offset。失败时回退 LRCLIB；自动匹配仍需试听核对，不保证逐字节奏一致。未找到歌词不阻止整理。

## v0.3.0 局域网与在线视频

`docker-compose.lan.yaml` 是独立的 Linux NAS host 网络部署文件，默认 PORT=43210、KTV_DISCOVERY_ENABLED=1。不要与 bridge 主配置叠加，host 模式也不能使用 Docker 内部的 separator 服务名；可配置实际可达的兼容 API 地址。公司环境测试设置 KTV_LOCAL_ONLY=1，createApp({discovery:false})，仅绑定 localhost。

NAS 从 UDP 回复的源 IPv4 推导 PC 地址，检查发现 nonce，再用绑定源 IP 的一次性 challenge 配对；广播不携带工作密钥。发现只支持 RFC1918 IPv4，不跨 VLAN。PC 默认开放工作监听，测试模式显式关闭。在线预览经 NAS 代理，源 URL 仅允许 HTTPS bilivideo.com/cn 域名及其子域，重定向再次校验，凭证不返回浏览器。

在线任务使用 .ktv-online 隐藏目录保留原始下载与裁剪结果，避免自动入库器抢先处理完整视频。worker 的 /clip、/jobs/:id、/clip-artifacts/:id 共用持久化队列；NAS 复用分离任务的幂等上传与检查点协议。waiting-worker 状态由重新配对唤醒；手动连接可重试。新浏览器检查为 `node tests/online-player.browser.mjs`，LAN 协议检查为 `python -m unittest discover -s pc-worker -p test_lan.py`，均不探测局域网。

B站预览优先使用播放器提供的 AVC/AAC DASH 流，yt-dlp 为后备；协议实现参考其 [Bilibili 提取器](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/bilibili.py)，平台变动仍可能影响可用性。

## v0.3.1 PC 状态与启动

`/pc` 是 NAS 前端入口，`GET /api/admin/pc/status` 使用已有管理员认证。NAS 用已配对的工作密钥访问 `/desktop/status`，筛选字段后返回，禁止缓存；浏览器无需访问 PC 地址。管理设置提供同源 `/pc` 链接。

`node tests/pc-dashboard.browser.mjs` 覆盖登录、代理、隐私字段、断线、桌面/手机布局和管理端名称。`npm test` 中的 pc-flow.test.js 用真实 FFmpeg、临时数据库和 localhost 协议替身验证裁剪→提取音频→分离→入库的顺序，不执行模型推理。Windows 运行 `powershell -ExecutionPolicy Bypass -File scripts/launcher-check.ps1` 验证 start.cmd 的隐藏启动链；安装脚本使用临时替身，不下载模型、不启用 LAN。以上检查均纳入 CI。
