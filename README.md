# 好好唱 · 家庭 KTV

NAS 保存曲库、下载资源、处理伴奏并输出视频流。电视安装轻量 APK，用遥控器点歌和播放。手机连接同一局域网，扫描电视二维码后即可点歌、切歌、送掌声，无需安装应用。

这是可运行的 0.1.0 家庭测试版。前后端和电视 APK 已在开发机构建，真实 FFmpeg 测试及浏览器联动测试已通过。UGOS Pro Docker、雷鸟电视实机和真实第三方 AI 服务尚待现场验收。

## 先在电脑上预览

双击 `start-preview.cmd`，等待资源准备完成后打开 [本机预览台](http://127.0.0.1:3210/simulator)。也可以运行 `npm run build` 和 `npm run preview:local`。预览台自动登录，顶部切换后台、电视和手机界面；右侧提供虚拟遥控器，可以选择 720p、1080p 和手机尺寸。

预览使用真实本地后端和独立的 `data-preview` 数据库，附带六个合成测试资源，支持真实播放、双版本切换、LRC 歌词、首次点歌转码和三端同步。它不会连接或修改正式 NAS 曲库。测试密码为 `preview-ktv-2026`，服务仅监听本机 `127.0.0.1`；预览二维码不能用于另一台手机扫码访问，手机交互可在模拟器或独立浏览器页测试。

电视模拟器运行与 APK 相同的网页和播放器，但不模拟 Android 系统解码器。UI 调整和大多数业务流程可在电脑测试，电视硬件兼容性留到最后验收。

## GitHub 构建、NAS 拉取部署

1. 将源码推送到自己的 GitHub 仓库，运行 `Publish NAS images` 工作流，或推送 `v*` 标签。工作流发布 `ghcr.io/账户/仓库` 和 `ghcr.io/账户/仓库-separator`，当前构建 `linux/amd64`。仓库创建和首次发布尚未执行。
2. NAS 只需要 `compose.yaml` 和 `.env`，不需要源码或编译工具。将 `.env.example` 复制为 `.env`，填写实际发布的镜像地址及下方配置。UGOS 的存储路径随存储池而变化，请从文件管理器取得真实路径。

   ```dotenv
   KTV_IMAGE=ghcr.io/你的账户/你的仓库:latest
   SEPARATOR_IMAGE=ghcr.io/你的账户/你的仓库-separator:latest
   MEDIA_PATH=/volume1/media/ktv
   ADMIN_TOKEN=填写至少12位的管理密码
   PUBLIC_URL=http://192.168.1.100:3210
   ```

3. 在 UGOS Docker 的项目功能中导入 `compose.yaml`，或执行：

   ```sh
   docker compose pull
   docker compose up -d
   ```

4. 打开 `http://NAS-IP:3210/admin`，输入管理密码，点击“扫描曲库”。GHCR 镜像需要设为公开，或者在 NAS 上先完成容器仓库登录。实际镜像地址必须等待仓库创建和 Actions 发布成功后取得。
5. 安装 `release/haohaochang-tv-0.1.0-debug.apk`。可用 U 盘安装，或在已授权 ADB 的电视上执行 `adb install -r 文件路径`。首次启动填写 `http://NAS-IP:3210`，再输入管理密码。菜单键可修改 NAS 地址。
6. 用手机扫描电视二维码。手机与 NAS 必须互通；访客 Wi-Fi 的设备隔离可能阻止连接。

端口只需开放 `3210/tcp` 到家庭局域网。这个版本面向家庭内网，没有设计公网多租户访问。建议给 NAS 设置固定 DHCP 地址。

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

点播尚未准备的歌曲后，NAS 立即建立预处理任务。任务串行执行，完成后加入可播放队列；当前歌曲继续播放。后台可以看到任务状态和错误并重试。进程重新启动后，未完成任务重新执行，已有媒体缓存可复用。

## 在线搜索与音频回退

在“设置与任务”中启用在线资源，点歌端即可搜索 Bilibili 或 YouTube。搜索默认附加“伴奏 KTV”，优先寻找伴奏资源。选中合适版本后才开始下载，避免自动选中翻唱、剪辑片段或错误歌曲。

也可粘贴 Bilibili `/video/BV…` 或 YouTube `watch?v=…` 链接。确认资源是纯伴奏时勾选相应选项，NAS 会跳过 AI 分离。只下载自己有权保存和使用的资源。

下载由 yt-dlp 完成。视频下载失败时会尝试提取音频；音频准备为视频流后可以临时播放，曲库标记“待补视频”。后台可补 LRC，或填写新视频在容器中的路径进行关联，再重新检测音轨、准备播放。只有音频时不能凭空提供原始 MV。

在线搜索、媒体下载都依赖 NAS 的出网能力。YouTube 可能受网络限制；Bilibili 可能返回风控错误。本版不处理账号登录、会员视频、验证码，也不保证任何链接都能下载。搜索失败时可以尝试粘贴公开视频链接，或将合法持有的文件放入本地曲库。

## AI 分离

后台提供地址、模型和 API Key。密钥只保存在 NAS 数据库，不下发给电视或手机；数据卷应当按凭证资料备份和保护。检测只验证服务连通及接口协议，不代表音质或模型推理速度已经验证。

普通聊天模型 API 不能直接做人声分离。本项目定义了 `ktv-separation-v1`，第三方服务需要直接兼容该协议，或通过适配器接入。协议和示例在 [docs/AI-SEPARATION.md](docs/AI-SEPARATION.md)。

项目附带可选 Demucs CPU 服务，可在 NAS 本地试用：

```sh
docker compose --profile ai-local pull
docker compose --profile ai-local up -d
```

后台填写地址 `http://separator:8000`、模型 `htdemucs`。若 `.env` 中设置了 `SEPARATION_API_KEY`，后台填写相同密钥。该服务首次使用会下载模型，CPU 分离可能耗时较长；16 GB 内存并不能使 CPU 分离变成即时操作。默认只处理一个任务，可把兼容服务部署到其他有 GPU 的机器。

开启分离后，第一次点播普通 MV 或原唱音频，会发送音频到指定服务；NAS 保存分离伴奏并复用原始混音作为原唱。两个播放版本永久缓存，后续播放不再请求 AI。AI 失败会保留任务错误供重试，不把失败结果标记为可用伴奏。

## 开发和验证

需要 Node.js 22.13+，推荐 Node 24。媒体处理需要 FFmpeg、ffprobe；在线下载需要 yt-dlp。Dockerfile 已安装这些工具。

```sh
npm ci
# 设置 ADMIN_TOKEN 环境变量后：
npm run dev
npm run build
npm start
npm test
```

开发前端默认在 `5173`，后端在 `3210`。可用 `FFMPEG`、`FFPROBE`、`YTDLP` 指定程序路径，用 `MEDIA_ROOTS` 指定多个媒体目录，目录之间用 `|` 分隔。`PUBLIC_URL` 环境变量优先于后台地址设置。

开发者若需要本地构建 Docker，可使用 `docker compose -f compose.build.yaml up -d --build`。NAS 日常部署使用默认 `compose.yaml` 拉镜像。

`npm test` 包含真实媒体测试，使用开发依赖中的 FFmpeg/ffprobe 二进制。如果包管理器阻止安装脚本，需要先允许 `ffmpeg-static` 的安装脚本或执行 `node node_modules/ffmpeg-static/install.js`。

浏览器联动检查：安装 Playwright 后运行 `node scripts/ui-check.mjs`，可用 `PLAYWRIGHT_MODULE` 指定已有模块路径、`BROWSER_CHANNEL` 指定浏览器，默认使用 Edge。测试使用独立数据库和合成测试曲，不写入正式曲库。截图位于 `test-results/ui/`。

APK 使用 Java 21、Gradle 9.4.1、Android SDK 36 构建：

```sh
gradle -p android assembleDebug
```

最低 Android 6；WebView 需支持现代 JavaScript，建议 Chromium/WebView 90 及以上。APK 是原生连接外壳加 WebView 终端，播放调用系统媒体解码；没有在 TV 端嵌入 FFmpeg 或 AI。当前是 debug 签名测试包，正式分发前需要建立自己的 release 签名和升级策略。

本机验证记录与待验收项见 [docs/VALIDATION.md](docs/VALIDATION.md)，系统决策见 [docs/DESIGN.md](docs/DESIGN.md)。

## 数据与维护

`data/ktv.sqlite` 保存曲库、客厅凭证、队列、配置和任务；`data/downloads` 保存在线原文件；`data/cache` 保存电视播放版本及分离中间文件；可选 AI 服务的数据位于 `data/separator`。原始媒体通过只读挂载保护。

备份前建议停止服务或使用 SQLite 一致性备份，避免只复制正在使用的数据库主文件而遗漏 WAL。任务记录和缓存当前没有自动容量回收策略，管理员需要关注 NAS 剩余空间；普通视频双版本通常占用两份视频存储。首版限制单任务、1080p 输出，尚未接入 Intel QSV/VAAPI 硬件转码。

麦克风接硬件混音器/音响，电视音乐输出也进入同一音响链路。手机只负责点歌，软件没有把麦克风音频绕经浏览器和 NAS；这样可避免网络链路带来的演唱返听延迟。
