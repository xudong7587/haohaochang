# v0.4.6.rc1 · Docker NPU 测试版

这是基于 v0.4.6 的实验性 Docker 版本，不是稳定版，不更新 `latest`。TV 与 PC 继续使用 v0.4.6 的安装包。版本变化见 [Changelog](../CHANGELOG.md)。

## 它能做什么

伴奏分离依次尝试 **PC 连接器 → NAS NPU → 外部 API**。新歌分离和更换录音使用相同顺序；PC 忙碌时沿用原有后备策略，已有 PC 断点优先恢复。NPU 未就绪、无法编译、推理失败或输出校验失败时尝试已配置的外部 API。没有配置外部 API 时保留失败任务，可修复后重试，不凭空创建云服务，也不偷偷改用 NAS CPU。

NPU 服务启动后自动检测 OpenVINO 可用设备，用内置 htdemucs 编译并进行实际音频试运行。全部通过才接收任务。首次编译可能需要数分钟，期间可以使用 PC／外部 API；失败后健康检测可每隔至少一分钟重新尝试。重启后复用持久缓存，不需要每首歌下载模型。

自动匹配仅覆盖已经适配的 **Intel OpenVINO NPU + htdemucs**。暂不支持 htdemucs_ft，也不支持 AMD／高通 NPU。其他 Intel NPU 设备会尝试检测，但通过设备枚举不代表模型一定能运行，不承诺所有带 NPU 的处理器都兼容。不会替 NAS 安装或升级宿主机驱动。

**NPU 只负责音频分离。** 视频下载、裁剪、兼容转换保留已有流程；需要 PC 的裁剪任务仍需 PC，不能把本版理解为完全替代 PC 整理器。

## 安装条件

- Linux x86-64 NAS，Docker；本版镜像仅 linux/amd64。
- 已正常安装 Intel NPU 驱动，有 `/dev/accel/accel0`；仅 CPU 宣传页写有 NPU 不足以确认。
- 目前实测为 Intel Core 3 304、16 GB 内存、Linux 6.18.15、intel_vpu、OpenVINO 2026.3.0。其他型号需要自行通过检测。
- 建议整机 16 GB 内存，为分离器预留至少 4 GB 实际可用内存，NAS 系统及主服务资源另计。示例设置 4 GB 内存上限、禁止额外交换占用、最多 2 CPU 配额、单任务。`cpus: 2` 是辅助解码／预处理／模型编译的 CPU 等效算力上限，不是 NPU 核心数，也不是独占绑核。此为当前测试建议，不是所有设备的最低规格保证。模型和编译缓存另外占用磁盘空间。

## 必须明确指定版本

```sh
docker pull ghcr.io/xudong7587/haohaochang:0.4.6.rc1
docker pull ghcr.io/xudong7587/haohaochang-separator-npu:0.4.6.rc1
```

也提供相同版本的 `v0.4.6.rc1` 标签。不要省略标签，不要填写 `latest`，也不要拉取旧的 CPU 分离器当作 NPU 版。

## 选择一份配置

从 [RC1 Release](https://github.com/xudong7587/haohaochang/releases/tag/v0.4.6.rc1) 下载 `haohaochang-nas-npu-v0.4.6.rc1.zip`，解压。两份配置独立使用，不叠加：

| 配置 | 用途 |
| --- | --- |
| `docker-compose.npu-rc1.lan.yaml` | Linux NAS host 网络，沿用 PC／TV 自动发现；主服务 43210，NPU 只映射本机 127.0.0.1:8001 |
| `docker-compose.npu-rc1.yaml` | 普通桥接，主服务 3210；NPU 仅在 Compose 网络内访问，不发布端口 |

先停止原主服务，备份原 `/data/settings.json` 与数据库，并等正在运行的任务完成。保留原 Compose 项目名称和实际数据目录，**不要同时启动两个主服务共用数据库**。将配置里的 `./data`、`./media`、`./download` 左侧路径改为原来的真实路径；升级时不要误用空目录。

在配置同目录创建 `.env`（不要上传 GitHub）：

```dotenv
ADMIN_PASSWORD=替换为原管理密码或至少12位新密码
NPU_API_KEY=替换为自己生成的长随机密钥
```

密钥由两项服务通过环境变量共享；不需要放在公开 URL 中。环境变量只是 NPU 配置默认值，后台保存的 NPU 地址与启用状态优先。若从桥接切换到 LAN，也应检查后台保存的地址是否需要改成 `http://127.0.0.1:8001`。

LAN 启动示例：

```sh
docker compose -f docker-compose.npu-rc1.lan.yaml pull
docker compose -f docker-compose.npu-rc1.lan.yaml up -d
```

普通桥接把命令中的文件名替换为 `docker-compose.npu-rc1.yaml`。已有用户应在原 Docker 管理器项目内更新配置，避免另起不同项目遗留旧主服务。

NPU 服务仅映射 `/dev/accel/accel0`，不需要 `privileged`，不需要挂载 Docker socket，不需要映射 `/dev/dri`。镜像暂以 root 访问设备；主服务不获得 NPU 设备权限。

## 后台如何设置

进入后台“备用 AI”页面：

1. 启用自动整理；此开关由 PC、NPU、外部 API 共用。
2. 在“NAS NPU · RC1 测试版”中启用 NPU 后备，检查 Compose 自动提供的地址。已有配置优先，需要时修改并保存。
3. 点击“检测 NPU 与模型”。成功会显示设备名称和匹配的 htdemucs；正在编译时稍后再检测。
4. PC 连接器继续按原方式自动发现或手动配置。外部 API 最后使用，仅需在已有备用 API 表单配置。

外部 API 必须兼容 `ktv-separation-v1`；阿里云、腾讯云、Replicate 等原始接口仍需协议适配，不能将聊天模型 API 或供应商文档 URL 直接填入。

## 测试范围与边界

RC1 使用 44.1 kHz 双声道、7.8 秒分段、25% 重叠，关闭随机移位集成；只匹配内置固定版本模型。最长音频 30 分钟，输出仍需通过现有时长与解码校验。分离器逐段读写，内存不会随着整首歌线性累积。人声活动分析仍为可选项，失败不丢弃有效伴奏。

早期实机实验：7.8 秒合成音频的 NPU 模型推理约 0.54 秒，CPU（限制两个线程）约 3.03 秒；缓存后加载约 0.15 秒。两种设备的重建波形相对 RMSE 约 1.02%。这些数字不是整首歌处理时间，也不是音质评分。真实歌曲的残留人声、乐器损失与长时间稳定性仍需内测。

集成服务也完成隔离实机验证：在模型就绪后，16.2 秒合成音频经 HTTP 上传、跨段分离、校验与下载约 3.03 秒，输出约 16.2075 秒（AAC 解码边界差异）。测试容器采用上述 2 CPU 配额与 4 GB 上限。这仍不是普通歌曲的速度或音质承诺。

模型固定到 Intel 仓库修订 `efb3d2bc54f93899b13b72b12c57001e19f09ae2`，在镜像构建阶段下载并校验 SHA-256。缓存位于分离器 `/data/npu-cache`；任务与日志在 `/data/jobs`。

参考：[Intel 模型](https://huggingface.co/Intel/demucs-openvino/tree/main/htdemucs_v4) · [OpenVINO NPU 说明](https://docs.openvino.ai/2026/openvino-workflow/running-inference/inference-devices-and-modes/npu-device.html)

## 排错和回退

- 设备不存在：先确认 NAS 系统支持 Intel NPU 驱动。Docker 的设备映射失败时容器无法启动；自动检测无法替宿主机创建设备。
- 显示未就绪：首次编译需等待；查看 `docker compose -f docker-compose.npu-rc1.lan.yaml logs separator-npu`。不匹配的设备、模型或内存不足会使检测失败。
- 任务失败：查看 NPU 挂载目录 `jobs/<任务ID>/worker.log`；后备 API 未配置时可恢复 PC 或修复 NPU 后在 NAS 重试。
- 返回稳定版：等任务结束，停止 RC1 的主服务和 NPU 服务，使用原配置及原数据目录启动 `ghcr.io/xudong7587/haohaochang:v0.4.6`。本版无数据库 schema 迁移；NPU 设置字段在旧版中不参与分离。不要使用 `down -v` 删除数据卷。

RC1 与稳定版分开发布，拉取 `latest` 的用户不会被自动切换到 NPU 测试版。
