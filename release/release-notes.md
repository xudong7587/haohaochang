# 好好唱 · Latest 家庭测试版

NAS 镜像：`ghcr.io/xudong7587/haohaochang:latest`，公开拉取，无需登录。

- `docker-compose.yaml`：NAS 部署文件。
- `haohaochang-nas.zip`：Compose、TV APK 和使用手册。
- `haohaochang-resource-ai.zip`：Windows「好好唱资源 AI 整理器」，自动检测硬件，提供任务与资源状态页。
- `haohaochang-tv-0.1.0-debug.apk`：TV 测试 APK，保留原签名。

本轮包含：独立网页歌房、固定二维码和队列预告、收藏夹同步、自动音频找歌与 MTV 候选、频谱/图片轮播/底部歌词、永久正式资源保存、PC 优先与兼容 API 后备，以及独立业务模块。

升级时保留密码、端口与原目录；增加 /download，/media 去掉 :ro。历史 data/cache 不要删除，系统按需复制到正式曲库。PC 默认只监听 127.0.0.1，公司网络测试无需开放局域网。

本机 RTX 5080 已完成真实分离并回传 NAS；18 组自动测试通过。外站下载可用性、真实音乐音质、4070 Super 与电视硬件仍需实机验收。MTV 候选保存后需确认版本；企业微信/TG 仅提供管理接口，未内置机器人。

[使用手册](https://github.com/xudong7587/haohaochang/blob/master/docs/USER-GUIDE.md) · [模块与开发规划](https://github.com/xudong7587/haohaochang/blob/master/docs/DEVELOPMENT-PLAN.md)
