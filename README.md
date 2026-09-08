# 好好唱 · 家庭 KTV

NAS 保存曲库、下载资源、处理伴奏并输出视频流。电视安装轻量 APK，用遥控器点歌和播放。手机连接同一局域网，扫描电视二维码后即可点歌、切歌、送掌声，无需安装应用。

这是可运行的 0.1.0 家庭测试版。前后端和电视 APK 已在开发机构建，真实 FFmpeg 测试及浏览器联动测试已通过。UGOS Pro Docker、雷鸟电视实机和真实第三方 AI 服务尚待现场验收。

## 先在电脑上预览

双击 `start-preview.cmd`，等待资源准备完成后打开 [本机预览台](http://127.0.0.1:3210/simulator)。也可以运行 `npm run build` 和 `npm run preview:local`。预览台自动登录，顶部切换后台、电视和手机界面；右侧提供虚拟遥控器，可以选择 720p、1080p 和手机尺寸。

预览使用真实本地后端和独立的 `data-preview` 数据库，附带六个合成测试资源，支持真实播放、双版本切换、LRC 歌词、首次点歌转码和三端同步。它不会连接或修改正式 NAS 曲库。测试密码为 `preview-ktv-2026`，服务仅监听本机 `127.0.0.1`；预览二维码不能用于另一台手机扫码访问，手机交互可在模拟器或独立浏览器页测试。

电视模拟器运行与 APK 相同的网页和播放器，但不模拟 Android 系统解码器。UI 调整和大多数业务流程可在电脑测试，电视硬件兼容性留到最后验收。

## NAS 部署：只需要一个 Compose 文件

公开镜像已经发布：`ghcr.io/xudong7587/haohaochang:latest`。NAS 无需登录，不需要 .env 或手工创建配置文件。直接在 UGOS Docker 项目里粘贴项目根目录的 docker-compose.yaml，修改管理密码、宿主机端口、数据目录、曲库目录和下载目录即可。

默认端口映射为 3210:3210。左侧可换成 NAS 空闲端口，右侧固定 3210。数据目录映射到 /data，曲库映射到 /media。曲库路径须替换成 NAS 的真实路径。

部署文件显式使用容器子网 `10.253.231.0/24`，绕过 Docker 默认地址池耗尽导致的 `all predefined address pools have been fully subnetted`。该地址不需要填入电视或浏览器。如果提示 `Pool overlaps`，或该子网与现有局域网/VPN 重叠，请改为未使用的私有子网；不要删除其他项目的网络。可选 AI 服务合并后也使用此网络。

启动后，浏览器打开 http://NAS-IP:端口/admin，用 Compose 中的管理密码登录。NAS 访问地址、在线搜索开关、AI 地址、模型和密钥都在后台设置。首次运行会自动创建 /data/settings.json；点击保存时原子更新，重启后继续读取。旧版数据库中的设置会自动迁移。

电视安装 release/haohaochang-tv-0.1.0-debug.apk，填写同一个 NAS 地址并登录。手机连接相同局域网，扫描电视二维码即可点歌。更换映射端口后，可在后台填写完整访问地址以更新二维码。

更新镜像可在 UGOS Docker 中重新拉取，也可执行：

```sh
docker compose pull
docker compose up -d
```

源码和发布流程位于 [GitHub 仓库](https://github.com/xudong7587/haohaochang)。目前镜像支持 linux/amd64，适用于当前这台 Intel NAS。

## 仓库中的 YAML 文件是做什么的？

普通 NAS 部署只需要 `docker-compose.yaml`，其余文件不需要导入 UGOS。

| 文件 | 用途 | 什么时候需要 |
| --- | --- | --- |
| `docker-compose.yaml` | 启动 KTV 主服务，包含后台、点歌、曲库和媒体处理 | NAS 部署必需 |
| `docker-compose.ai.yaml` | 额外启动本地 Demucs 人声/伴奏分离容器，消耗 NAS 的 CPU 和内存 | 希望由 NAS 本地运行 AI 分离时，与主文件合并；使用第三方 AI 不需要 |
| `docker-compose.build.yaml` | 从源码构建主服务镜像 | 开发者使用；NAS 拉取现成镜像不需要 |
| `.github/workflows/check.yml` | GitHub 自动检查代码并构建测试 APK | GitHub 自动运行，NAS 不使用 |
| `.github/workflows/publish.yml` | GitHub 自动构建并发布容器镜像 | GitHub 自动运行，NAS 不使用 |

AI 附加文件只负责启动分离服务；是否启用分离、服务地址、模型和密钥仍在后台管理页面设置。

## 使用曲库

文件名建议采用 `歌手 - 歌名.mp4`。也支持 MKV、AVI、MOV、WebM、MPEG、TS，以及 MP3、FLAC、WAV、M4A、OGG、AAC。扫描不会改名、搬移或删除原媒体文件。

同目录同名 `.lrc` 会在扫描时导入，文件应采用 UTF-8 编码。纯音频可以配同名 `.jpg`，也可以用所在目录的 `cover.jpg`。没有封面时显示简洁背景。LRC 有时间戳就同步换行，只有纯文本时显示歌词并提示补时间轴。

资源音频模式如下：

| 资源 | 如何设置 | 播放方式 |
| --- | --- | --- |
| 普通 MV | 原始音频 | 保留原始音频；启用 AI 后首次点歌生成伴奏 |
| 纯伴奏文件 | 纯伴奏 | 默认伴奏，不显示可用的原唱版本 |
| KTV 双音轨 | 检测音轨，指定伴奏和原唱序号 | NAS 分别生成伴奏、原唱文件 |
| KTV 左右声道 | 0 代表左，1 代表右，按实际试听设置 | NAS 将选定声道复制为双声道输出 |
| AI 分离完成 | 自动标记 AI 伴奏 | 原始混音作为原唱，分离结果作为伴奏 |

双音轨的序号从 0 开始，原唱和伴奏的排列没有统一标准。先检测、试听并配置一首样例，避免猜测所有文件的音轨顺序。普通 MV 的立体声不等于“左右声道分别是原唱和伴奏”。

扫描后可在后台提前“保存并准备播放”，也可等第一次点歌再准备。处理完成后，H.264/AAC MP4 保存在 NAS 的 `data/cache` 下，电视按需读取并支持 HTTP Range。相同文件和音轨配置会复用缓存。切换原唱/伴奏会更换播放文件并恢复当前时间，可能有短暂缓冲。

## 点歌与排队

电视方向键切换焦点、确定键选择，返回键关闭弹层或回到歌名点歌。搜索支持中文歌名、歌手、拼音及首字母。电视可以进入全屏播放，保留暂停、原唱/伴奏、切歌控制。

手机与电视共享一个客厅队列。当前歌曲不会被置顶操作打断；后面的歌可以置顶或移除。相同歌曲不会重复入队，过期的切歌请求不会跳过下一首。一个客厅只允许一台活跃播放器。

点播尚未准备的歌曲后，NAS 立即建立预处理任务。同一首歌按阶段执行，最多并行两项任务，完成后加入可播放队列；当前歌曲继续播放。后台可以看到任务状态和错误并重试。进程重新启动后，未完成任务重新执行，已有媒体缓存可复用。

## 在线搜索与音频回退

在“设置与任务”中启用在线资源，点歌端即可搜索 Bilibili 或 YouTube。搜索默认附加“伴奏 KTV”，优先寻找伴奏资源。选中合适版本后才开始下载，避免自动选中翻唱、剪辑片段或错误歌曲。

也可粘贴 Bilibili `/video/BV…` 或 YouTube `watch?v=…` 链接。确认资源是纯伴奏时勾选相应选项，NAS 会跳过 AI 分离。只下载自己有权保存和使用的资源。

下载由 yt-dlp 完成。视频下载失败时会尝试提取音频；音频准备为视频流后可以临时播放，曲库标记“待补视频”。后台可补 LRC，或填写新视频在容器中的路径进行关联，再重新检测音轨、准备播放。只有音频时不能凭空提供原始 MV。

在线搜索、媒体下载都依赖 NAS 的出网能力。YouTube 可能受网络限制；Bilibili 可能返回风控错误。本版不处理账号登录、会员视频、验证码，也不保证任何链接都能下载。搜索失败时可以尝试粘贴公开视频链接，或将合法持有的文件放入本地曲库。

## AI 分离

后台提供地址、模型和 API Key。密钥只保存在 NAS 的 settings.json，不下发给电视或手机；数据卷应当按凭证资料备份和保护。检测只验证服务连通及接口协议，不代表音质或模型推理速度已经验证。

普通聊天模型 API 不能直接做人声分离。本项目定义了 `ktv-separation-v1`，第三方服务需要直接兼容该协议，或通过适配器接入。协议和示例在 [docs/AI-SEPARATION.md](docs/AI-SEPARATION.md)。

项目附带可选 Demucs CPU 服务，可在 NAS 本地试用：

```sh
docker compose -f docker-compose.yaml -f docker-compose.ai.yaml pull
docker compose -f docker-compose.yaml -f docker-compose.ai.yaml up -d
```

后台填写地址 `http://separator:8000`、模型 `htdemucs`。本地分离服务不映射公网端口，默认 API Key 留空。该服务首次使用会下载模型，CPU 分离可能耗时较长；16 GB 内存并不能使 CPU 分离变成即时操作。默认只处理一个任务，可把兼容服务部署到其他有 GPU 的机器。

开启分离后，第一次点播普通 MV 或原唱音频，会发送音频到指定服务；NAS 保存分离伴奏并复用原始混音作为原唱。两个播放版本永久缓存，后续播放不再请求 AI。AI 失败会保留任务错误供重试，不把失败结果标记为可用伴奏。

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

本机验证记录与待验收项见 [docs/VALIDATION.md](docs/VALIDATION.md)，系统决策见 [docs/DESIGN.md](docs/DESIGN.md)。

## 数据与维护

`data/settings.json` 保存后台设置和 AI 密钥；`data/ktv.sqlite` 保存曲库、客厅凭证、队列和任务；`data/downloads` 保存在线原文件；`data/cache` 保存电视播放版本及分离中间文件；可选 AI 服务的数据位于 `data/separator`。下载源文件保留，正式曲库需要可写挂载以接收自动整理结果。

备份前建议停止服务或使用 SQLite 一致性备份，避免只复制正在使用的数据库主文件而遗漏 WAL。任务记录和缓存当前没有自动容量回收策略，管理员需要关注 NAS 剩余空间；普通视频双版本通常占用两份视频存储。当前最多并行两项任务、1080p 输出，尚未接入 Intel QSV/VAAPI 硬件转码。

麦克风接硬件混音器/音响，电视音乐输出也进入同一音响链路。手机只负责点歌，软件没有把麦克风音频绕经浏览器和 NAS；这样可避免网络链路带来的演唱返听延迟。

## TV 连接与 Lucky HTTPS 反代

NAS 根地址默认跳转管理页 /admin，电视点歌页为 /tv。TV APK 首次启动填写服务器根地址，之后按遥控器菜单键修改；连接后输入 Compose 中的管理密码。

Lucky 的外部入口可以使用 https://ktv.example.com:666，后端目标必须填写 http://NAS-IP:宿主机端口。例如端口映射 43210:3210 时，后端端口填 43210。容器自身不提供 HTTPS；如果日志出现 tls: first record does not look like a TLS handshake，请检查后端是否误填为 https。

通过内网进入后台“设置与任务”，把“NAS 访问地址”保存为完整外部地址（包括 HTTPS 和非标准端口，不附加 /admin、/tv）。TV APK 填写相同外部地址，手机二维码也会使用该地址。留空时二维码跟随当前页面地址。

反代应覆盖整个独立域名根路径，保留 Host（包括端口）、Authorization 和 Range 请求头，并允许 /api/events 持续输出 SSE；不要缓冲实时事件或缓存带凭证的接口与媒体。证书需被电视系统信任。API 通过管理密码或客厅凭证验证身份，不限制请求 Origin，避免反代改写地址后误拒绝登录。Nginx 类代理可参考 [官方代理文档](https://nginx.org/en/docs/http/ngx_http_proxy_module.html) 的 proxy_buffering 和 proxy_read_timeout 设置。

外网开唱仍由 NAS 准备媒体，电视接收视频流；流畅度取决于家庭上行和电视网络。同一个后端目前只有一个共享客厅队列、一个活跃播放器，家里和外地不能同时独立开唱。

## 收藏到开唱：自动整理更新

TV 默认进入音乐现场，无人点歌时随机播放原唱，准备好的点歌优先接管。浏览器可能需要第一次点击播放，APK 允许自动播放。扫描后的旧资源可在“整理曲库”预览歌手、歌名和标签，批量准备原唱与伴奏。

Compose 新增独立的 /download 下载目录，/media 改为可写。已有用户需要添加下载映射，并去掉曲库映射的 :ro。自动入库每 30 秒检查，文件连续两次稳定且最后修改超过 60 秒后，复制到 /media/歌手/歌手 - 歌名；保留下载源。启用兼容 AI 后优先 PC 生成伴奏，可与备用 API 并行。

与 bili-sync 共用同一个 NAS 下载文件夹即可对接收藏夹下载，不需要迁移其配置和登录信息。目录不要与正式曲库嵌套。NFO 只从明确字段识别歌手，不把 UP 主当歌手。已实现范围、对接步骤和后续功能见 [后台功能规划](docs/PRODUCT-PLAN.md)。

## 内置收藏夹、信息 AI 和 PC 分离助手

新版可直接监控 B 站收藏夹，无需 bili-sync。在后台填写收藏夹 ID/链接，按需填写自己的 Cookie，启用同步。信息识别与刮削可接 OpenAI Responses API（模型需支持结构化输出，可选联网查证）；不确定的歌曲会进入待核对，填写歌手后继续。

Windows PC 支持包位于 Release 的 haohaochang-pc-worker.zip。解压双击 start.cmd，首次安装独立环境，之后显示局域网地址和密钥；NAS 的分离设置填写 PC 地址、htdemucs 和连接密钥。4070 Super 由本地 Demucs 使用，不需要 OpenAI Key。可以另外设置 ktv-separation-v1 备用 API，PC 忙/离线时使用。详情见 [PC 助手说明](pc-worker/README.md)。
