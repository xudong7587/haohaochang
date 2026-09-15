# v1.0.7 · NAS 内置分离与统一设置

## 这次更新

- 管理页新增“人声分离”，集中管理 PC、NAS NPU、NAS CPU 的状态和开关，常规使用不再填写分离器地址、密码或密钥。
- 按 PC → NPU → CPU → 已配置的外部 API 尝试。PC 仍独立运行；NAS 主容器内置 CPU 和 Intel NPU 分离器，没有 NPU 也能自己生成伴奏。
- CPU 每次处理一首，限制计算线程并降低进程优先级，允许最多 6 小时。失败结果不会替换已有可用资源；重试优先查询已经提交的任务。
- NAS 安装包只保留一份 `docker-compose.yaml`。保留现有 PC 连接、歌曲、队列和 NAS 任务；旧模型／编译缓存可继续使用。

## 更新步骤

1. 等旧分离任务结束，保留原 data／media／download 目录、管理密码和访问端口。停止原主容器及旧 NPU／CPU 分离容器，不删除数据目录。
2. 使用 `haohaochang-nas-v1.0.7.zip` 中唯一的 Compose，填写原目录与密码。默认 PORT=43210；以前通过 3210 访问则保持 PORT=3210。
3. 拉取 `ghcr.io/xudong7587/haohaochang:v1.0.7` 并启动。进入“人声分离”查看服务状态，CPU 首次使用需要联网下载模型。Intel NPU 仍需 NAS 宿主机已有驱动与设备映射。
4. 本次功能主要在 NAS，已有 v1.0.6 APK 和 PC 可以继续使用。需要新装或统一版本时使用本版 APK／PC 包，覆盖安装时保留配置和模型。

## 验证范围

本地 Node 全量 234 项（233 通过、1 项 Linux 专属跳过）；分离定向和真实 FFmpeg 输出校验通过，包含 PC／NPU／CPU 回退、无效输出、关闭开关与断线续接。统一设置页在电脑、手机布局下完成浏览器验证。Python 协议与 NPU 替身测试通过。

CI 的 Linux amd64、arm64 主容器均通过真实 htdemucs 短音频分离、无 NPU 回退和鉴权验证，网页／Android／Windows／Python 检查通过。用户曾验证旧独立 NPU 容器在其 NAS 正常运行；新版主容器的 NPU 设备访问、音质与耗时仍需该 NAS 实测。
