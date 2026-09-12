# v0.4.6.rc1 — 仅 Docker / Intel NPU 测试版

基于 v0.4.6，GitHub Pre-release，不更新任何 latest 标签。TV 与 PC 沿用 v0.4.6。

- 伴奏分离顺序：PC 连接器 → NAS NPU → 外部 API；新歌和录音更新一致，失败结果不覆盖原可用资源。
- 自动检测 Intel NPU，匹配内置 htdemucs，完成编译与音频试运行后接收任务；持久缓存、单任务与分段处理。
- 后台提供独立 NPU 开关、地址、密钥与设备／模型检测；保留原有 PC 下载裁剪流程。
- README 回到项目介绍与使用流程；版本变化移到 Changelog，RC1 有独立安装说明。

必须显式拉取：

```sh
docker pull ghcr.io/xudong7587/haohaochang:0.4.6.rc1
docker pull ghcr.io/xudong7587/haohaochang-separator-npu:0.4.6.rc1
```

从附件解压两份 Compose，选择 LAN 或普通桥接其中一份，保留原数据路径与密码；按说明配置设备映射和 NPU 密钥。不要同时运行两个主服务共用数据库。

仅支持已适配的 Intel OpenVINO NPU 路线，其他 Intel 型号需检测通过；AMD／高通 NPU、htdemucs_ft 尚未适配。真实歌曲音质与长期稳定性需要内测，不能保证所有带 NPU 的 CPU 均可用。外部 API 仍须兼容 ktv-separation-v1。

[安装、检测与回退说明](https://github.com/xudong7587/haohaochang/blob/v0.4.6.rc1/docs/NPU-RC1.md)

建议整机 16 GB 内存，分离器预留至少 4 GB 可用内存、最多 2 CPU 核心等效算力、单任务；CPU 配额不是 NPU 核心数量。Compose 已附说明。

验证：本地 182 项 Node 测试、4 项 NPU 数值／分段／检测测试、前端构建及设置页浏览器验证通过；隔离 NAS 完成 16.2 秒合成音频的完整协议分离流程。
