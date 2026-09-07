好好唱 0.1.0 家庭实机测试版。

仓库和 GHCR 镜像已公开，无需账号即可下载。测试包包含电视 APK、NAS Compose、配置示例及中文部署步骤。主服务镜像为 `ghcr.io/xudong7587/haohaochang:latest`，可选 AI 分离镜像为 `ghcr.io/xudong7587/haohaochang-separator:latest`。

NAS 直接拉取镜像；只启动主服务即可测试本地曲库、电视播放和手机点歌。APK 为本机已验证签名的 debug 包，使用同一个文件便于后续保持安装签名一致。

已完成本机接口和真实 FFmpeg 测试、浏览器联动及 APK 构建；实际 NAS 音响链路和电视解码请按测试包说明验收。
