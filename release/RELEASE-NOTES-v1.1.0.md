# v1.1.0 · 主程序与分离容器拆分、歌手卡片铺满

主程序恢复独立轻量镜像，保留 Python、FFmpeg 和下载工具。CPU／NPU 分离使用各自容器，沿用已验证的 1.0.8 镜像并锁定摘要。本次不重新发布 CPU、NPU 镜像。

Compose 自动连接同机服务并持久化内部鉴权密钥；PC → NPU → CPU 的调度和原有开关继续保留。以后日常发布只更新 ktv，两个分离镜像仅在明确需要时单独发布。

`/play` 清除歌手照片旧外边距，图片铺满卡片。APK 的歌手卡片也改为铺满图片、底部叠加姓名和歌曲数，保留遥控焦点边框。

## 这次如何更新

1. 下载 `haohaochang-nas-v1.1.0.zip`，阅读包内《NAS安装与升级.md》。x86 NAS 用 `docker-compose.yaml`，ARM64 用 `docker-compose.arm64.yaml`。
2. 等任务完成，沿用原 Compose 项目、密码、端口和 data／曲库／下载目录，替换配置并启动整套服务。这次需要创建独立 CPU／NPU 容器，不能仅拉取主镜像。
3. 安装 `haohaochang-tv-v1.1.0.apk`，获得原生歌手卡片修正。同签名覆盖保留登录。
4. 现有 PC 整理器仍兼容；本版重新生成 `haohaochang-resource-ai-v1.1.0.zip`、`haohaochang-preprocess-v1.1.0.zip` 和完整 NAS 附件。

以后更新主程序只执行：

```sh
docker compose pull ktv
docker compose up -d --no-deps ktv
```

ARM64 在 `compose` 后增加 `-f docker-compose.arm64.yaml`。主镜像地址仍为 `ghcr.io/xudong7587/haohaochang:latest`，也可使用固定版本 `1.1.0`。

本地回归、USB 卡片检查及云端 Compose 验证的结果见本版 Actions。没有修改生产 NAS；实际 Intel NPU 设备访问仍需在 NAS 更新后确认。
