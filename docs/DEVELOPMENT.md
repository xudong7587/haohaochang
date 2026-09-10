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

## 本地反馈优化验证

新增 `node --test tests/feedback.test.js`、`node tests/feedback.browser.mjs`、`python -m unittest discover -s separator -p test_concurrency.py`。Windows 预处理回归为 `powershell -NoProfile -ExecutionPolicy Bypass -File tools/bili-preprocess/test.ps1`。均已纳入 CI 配置，实际本地结果与发布范围见 VALIDATION.md。

在线搜索首次升级启用后记录 `onlineDefaultMigrated`，后续明确关闭不会在重启时重置。设置接口支持独立提交 `onlineEnabled` 或 `publicUrl`，不会覆盖未提交的另一项。后台任务列表保留全部在途任务及有限最近历史；进度为模型当前步骤，无法报告百分比的阶段只显示名称。


## v0.3.6 在线高清链路

`server/bili-login.js` 管理二维码临时会话与共享登录，`providers/bili-wbi.js` 实现签名，`bili-download.js` 按当前账号选择独立DASH并验证真实媒体。设计参考 [bili-sync取流代码](https://github.com/amtoaer/bili-sync/blob/master/crates/bili_sync/src/bilibili/video.rs) 与 [扫码实现](https://github.com/amtoaer/bili-sync/blob/master/crates/bili_sync/src/bilibili/credential.rs)。未直接依赖或调用bili-sync进程；其他遗留下载用途仍使用yt-dlp。

在线缓存位于 `.ktv-online/dash`，分辨率与凭证隔离；原始音频成为歌曲来源，独立画面通过 `split-video:<id>` 保留。版本回收保护这类来源引用。`upgrade-hd`只接受已记录的在线来源与裁剪区间，不自动覆盖已有音轨。PC裁剪仍使用已有 `video_only` 协议，新增可选 `vocal_activity` 字段不改变旧分离适配器兼容性。

新增契约测试：`bili-hd.test.js`、`pc-flow.test.js`、`metadata-batch.test.js`、`preview-cancel.test.js`、`lyrics-alignment.test.js`。外部平台均用受控传输fixture，真实用户验证只在隔离本机目录进行，不能把其Cookie、登录二维码或原始媒体加入Git。

TV配对由 `/api/tv-pairing` 创建三分钟内存会话，二维码只携带手机确认凭据；手机通过member认证后确认，电视用另一随机凭据轮询并一次性领取roomToken。Android13+使用OnBackInvokedCallback，旧设备用onBackPressed。网页`haohaochangBack()`返回是否消费操作，根页面交由APK双返回退出。`node tests/tv-pairing.browser.mjs`在隔离localhost上验证首次/重复扫码、登录持久化及返回层级，并已纳入CI；原生遥控器退出仍需实机验收。

## v0.3.7 存储与预览

`server/song-storage.js` 在歌曲写锁内将受管来源视频的全部音轨无损保存为 MKA，更新来源指针与指纹后清除重复画面；`resource-cleanup.js` 回收无引用版本，`download-cleanup.js` 根据成功导入记录和文件签名删除下载输入。生产文件只由正式部署后的任务执行清理，测试使用临时目录。当前播放／队列／在途任务均保护歌曲；未知文件和外部来源不参与删除。

`tests/resource-storage.test.js` 包含多视频合一与后续准备回归，`tests/download-cleanup.test.js` 覆盖失败、改动和共享输入保护，`tests/preview-fallback.test.js` 覆盖签名后备及 CDN Range 保留。默认视频只封装并遍历数据包，显式编码由 PC 完整解码并返回 SHA-256；这两种校验级别必须在文档和状态中区别表述。
