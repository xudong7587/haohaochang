# 好好唱 PC 分离助手

适用于 Windows 10/11 x64。推荐你的 RTX 4070 Super，安装 NVIDIA 驱动后使用。无需 Docker、云端 API Key，也不用手动安装 Python。

1. 将支持包解压到固定文件夹，双击 `start.cmd`。
2. 首次下载独立 Python、PyTorch CUDA 和依赖，需联网且需要数 GB 空间。网络失败可再次启动继续安装。后续启动会复用环境。
3. 窗口显示设备、PC 地址和连接密钥。在 NAS 的“AI 伴奏分离 → 优先使用局域网 PC”中填写地址、`htdemucs` 和密钥。
4. Windows 防火墙提示时允许专用网络访问；NAS 与 PC 应能互通。保留窗口运行，关闭窗口就停止服务。

配置自动保存在 `worker.json`，可修改端口。模型和任务保存在 `data`，分离失败的详情在 `data/jobs/任务ID/worker.log`。不上传任何音频至云端，NAS 的备用 API 是另外配置的服务。

助手串行使用 GPU。NAS 最多并行处理两项任务：PC 空闲时优先 PC，PC 忙时可将另一首交给备用 API；PC 离线或请求失败也会尝试备用 API。API 必须兼容项目的分离协议，不能填 OpenAI 聊天模型地址。

默认模型先用 `htdemucs` 验证流程；想比较音质可用 `htdemucs_ft`，所需时间更长。先试听几首常用歌曲，确定伴奏中人声残留、乐器损失和耗时是否合适。

Windows GPU 实机推理仍需在你的 4070 Super 上验收。CPU 回退可以运行，但不会有 GPU 的速度。安装包不包含 CUDA 模型与 Python 环境，以免下载一个数 GB 的压缩包；第一次启动会自动获取它们。
