# TV 0.4.4.1 · 基于 v0.4.4 的原生 APK 补丁

仅更新 Android APK；NAS、PC、网页版本保持 0.4.4，沿用现有 API。APK versionCode 为 23，版本为 0.4.4.1，合入 main 后沿用仓库持久签名构建，替换 v0.4.4 Release 的 TV 附件，不发布新 Release 或 Docker 镜像。

## 使用

普通模式视频占满左侧栏右侧、底部栏上方，点歌内容以半透明遮罩和卡片叠在视频之上，不显示歌词。NAS 队列优先，无人点歌时沿用服务器随机播放。全屏隐藏导航与点歌页面；歌词开关、左侧延后箭头、统一播放控制、右侧提前箭头、退出全屏组成底部控制栏。微调按 0.1、0.5、3、10 秒保存到 NAS。

歌名搜索、歌星、分类歌单、队列操作、在线完整视频点歌、连接发现、扫码／密码登录与更新均为 Android View。在线结果可填写歌名和歌手，提交 NAS／PC 完整视频准备任务；精细预览裁剪、曲库编辑继续在 NAS 管理网页完成。首次从 WebView 版本覆盖升级保留 NAS 地址，需要重新扫码一次，后续原生登录按服务器保存。旧版更新器无法发现同一 Release 的补丁，本次需手动下载覆盖。

## 实现

- `NativePlayback` 保留 0.4.4 的 ExoPlayer、MergingMediaSource、解码后备和 SurfaceView，只删除 WebView 传输／坐标映射，由原生容器确定范围。保持源分辨率、音频时钟、无周期 seek。
- `NativeLyricsView` 缓存文字测量，30 Hz 原生 Canvas 裁切高亮，只读取播放器时钟；`LyricsTimeline` 在后台解析 LRC，以二分查找定位逐句／逐字歌词。普通模式不绘制歌词。
- `NativeCatalogue` 复用 GridView 卡片，后台缩采样封面，12 MB 图片缓存与有界下载队列。页面只在数据变化时更新，不跟随歌词帧刷新。
- `RoomSession` 独立处理控制、状态、媒体读取和租约；旧歌曲／旧控制响应作废，播放权撤销不能被迟到心跳恢复；后台立即停止出声，回到前台重新验证租约。
- `RoomApi` 只访问当前 NAS，凭据按服务器隔离，禁止携带认证自动跟随重定向，并限制超时和响应大小。NAS 不可达时停止出声，菜单可重试或重新连接。
- 更新器识别同一三段 Release 内的四段 APK 补丁版本，仍核对 SHA-256、包名、versionCode 与安装签名。

## 验证边界

2026-09-11 本地 `testDebugUnitTest lintDebug assembleDebug` 通过：22 项测试、Android 6（API 23）原生启动、Android 9（API 28）原生绘图和控制栏截图；lint 0 error，保留库版本提示、原生程序化 View 构造与中文文案等非阻断 warning。版本独立补丁检查 `node scripts/check-release-version.mjs` 通过。截图由实际 Android View / Canvas 在 Robolectric 原生图形运行环境生成，未将其描述为电视实机截图。

使用 JVM 单元测试与 Robolectric Android 原生运行环境，覆盖歌词时间线、全屏几何与隐藏、共享按钮、遥控唤醒、微调方向、原生截图、媒体响应竞态、租约撤销、请求限制和更新版本。所有 HTTP 测试为 localhost 合成数据，不访问用户 NAS 或局域网设备。

编译、自动测试和截图不能代替电视实机测试；真实硬解、遥控器厂商键值、音轨切换和长时间播放需在安装后确认。此前用户反馈 0.4.4 视频播放已经流畅，本次保留其核心播放链路。
