好好唱 0.1.0 家庭实机测试版。

仓库和 GHCR 镜像已公开，无需账号即可下载。测试包包含电视 APK、单文件 NAS Compose 及中文部署步骤，不需要 .env。管理密码、端口和目录映射填在 Compose，其余配置在 NAS 后台设置并自动写入 /data/settings.json。主服务镜像为 `ghcr.io/xudong7587/haohaochang:latest`，可选 AI 分离镜像为 `ghcr.io/xudong7587/haohaochang-separator:latest`。

NAS 直接拉取镜像；只启动主服务即可测试本地曲库、电视播放和手机点歌。APK 为本机已验证签名的 debug 包，使用同一个文件便于后续保持安装签名一致。

已完成本机接口和真实 FFmpeg 测试、浏览器联动及 APK 构建；实际 NAS 音响链路和电视解码请按测试包说明验收。

本轮新增：随机原唱 TV 开场、NFO/海报读取与标签整理、独立 /download 自动入库、B 站收藏夹监控、AI 歌曲信息识别和待核对管理接口、PC 优先与备用 API 并行分离。已有部署请增加 /download 映射，并移除曲库映射的 :ro。保留原管理密码、端口和数据目录。

Windows 用户下载 haohaochang-pc-worker.zip，解压后双击 start.cmd，复制地址与密钥到 NAS。首次安装需联网和数 GB 空间。真实 GPU 推理及第三方 API 尚待实机验收；备用分离 API 必须兼容 ktv-separation-v1，信息识别 API 不能代替它。

完整步骤见 [四端使用说明](https://github.com/xudong7587/haohaochang/blob/master/docs/USER-GUIDE.md)，两个 ZIP 包也已附带该说明。平台专用企业微信/TG 机器人尚未内置，目前提供待核对管理接口。

新增独立网页歌房 /play：在 NAS 后台点击“打开网页歌房”，无需 TV APK 也能播放。来宾扫码即可点歌互动，无需手输网址或密码；二维码支持后台配置的反代地址。

全屏二维码固定右上角；已点列表每 30 秒显示约 6 秒，最多展示当前和接下来 3 首；另一设备占用播放器时提供明确提示，关闭原播放页后自动重连。
