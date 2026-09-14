# NAS Intel NPU 分离 · v1.0.3

本版把 v0.4.6.rc1 的实验功能合回主程序。需在本版本发布后使用对应镜像；本地构建与协议测试不等于你的 NAS 已通过模型实测。

## 安装与启用

1. 等现有整理任务完成，备份 NAS 的 data。保留原曲库、下载与 data 映射，不另起两套主服务共用数据库。
2. 从同版本 NAS 包中选一份配置：`docker-compose.npu.lan.yaml` 用于 Linux host 网络，主服务端口 43210，NPU 仅发布 `127.0.0.1:8001`；`docker-compose.npu.yaml` 用于桥接，主服务端口 3210，NPU 只在 Compose 网络可见。两份独立使用，不叠加。
3. 设置 `ADMIN_PASSWORD` 和 `NPU_API_KEY`，把目录映射改为现有路径，确认 `/dev/accel/accel0` 是可用的 Intel NPU 设备，然后重建容器。
4. 在“设置与任务 → 备用 AI”找到“NAS NPU · 实验功能”，勾选“启用 NAS NPU 后备”，检测并保存。Compose 中的服务地址与密钥会作为默认值；启用 NPU 同时启用分离调度。
5. 首次启动会检测设备、编译 htdemucs 并运行短音频验证。检测成功后再用一首歌测试伴奏质量；未就绪时查看分离器日志，不要反复重新下载模型。

镜像分别是 `ghcr.io/xudong7587/haohaochang:1.0.3` 与 `ghcr.io/xudong7587/haohaochang-separator-npu:1.0.3`。NPU 使用独立版本标签，不改变普通 CPU／PC 分离器镜像。

## 设备与资源

需要支持 OpenVINO 的 Intel NPU、宿主机驱动和 Docker 设备透传；AMD／高通 NPU 暂未适配。不自动安装驱动。设备能枚举出来，也不代表当前模型一定能编译运行。

建议整机至少 16 GB 内存；默认给分离器 4 GB 内存上限、2 个 CPU 核心等效配额。CPU 用于辅助解码与预处理，模型推理要求 NPU。模型与编译缓存保存在 `data/npu`，可在重启后复用。分离按一首一首运行。

## 执行顺序与失败处理

PC → NAS NPU → 已配置的外部 API。已有 PC 任务断点优先恢复。NPU 未就绪、推理失败或输出无效时尝试后备；全部失败保留旧歌曲资源和失败记录，可修复配置后重试。不偷偷改用 NAS CPU。

NPU 只分离原唱与伴奏；裁剪和显式画面兼容转换仍使用 PC。当前仅支持 htdemucs。模型来源、许可与 SHA 校验见 `separator/INTEL-MODEL-CARD.md`，保留模型的许可证文件。
