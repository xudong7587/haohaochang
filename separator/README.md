# 分离服务模块

`app.py` 只负责协议路由，`job_store.py` 管理磁盘状态与上传预留，`inference.py` 执行推理和 WAV 校验，`upload_guard.py` 在 multipart 解析前限制并发与上传总量。PC 发布包和容器都必须包含这四个 Python 文件；启动器无需更改。

沿用 `ktv-separation-v1`。现有客户端仍可不带新字段提交。可选请求头 `Idempotency-Key` 接受最多 120 个 ASCII 字母、数字、下划线和短横线；同键同模型返回原任务，同键不同模型返回 409。原上传尚在进行时返回 409，带 `Retry-After: 3`。NAS 在上传前保存键，收到 job ID 后保存状态；重试优先查询原任务。旧第三方适配器若忽略幂等头，在 POST 成功但响应丢失时无法保证去重。

`GET /health` 额外返回 `pending`、`busy` 和 `capabilities`。NAS 可将其他歌曲转到备用服务，但有 checkpoint 的歌曲继续原任务。PC 服务重启后，uploading/queued/running 任务明确标记为 failed、stage=interrupted、retryable=true；在 NAS 重试会创建新请求。完成任务和结果保持可查询。

每次请求使用独立任务目录。服务同时接受最多两次 multipart 上传，排队与推理合计最多 10 个任务（包含正在上传的预留），超限返回 429。单音频上限 100 MB，整个 multipart 请求上限 101 MB。NAS 暂存目录在成功和失败后清理；PC 的 data/jobs 保留任务日志与结果供排查，可在停止服务后清理不再需要的任务目录。

NAS 在发布前用 ffprobe 核对单音轨、无视频、有效时长，并用 FFmpeg 完整解码校验。时长容差是原唱时长的 0.5%，最少 0.25 秒、最多 1 秒。PC 比较实际 WAV 帧数。验证不证明音乐录音版本相同或人声去除质量，仍需试听实机结果。

隔离测试：安装 FastAPI、python-multipart、httpx 后运行 `python -m unittest discover -s separator -p test_protocol.py -v`；无需 torch、Demucs 或 GPU。NAS 测试运行 `node --test tests/separation-recovery.test.js tests/media.test.js`，使用临时数据库、本机 mock 服务和真实 FFmpeg。
