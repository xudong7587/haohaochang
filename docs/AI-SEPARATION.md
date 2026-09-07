# AI 分离服务协议

服务地址是管理员主动配置的可信地址，可以是 Docker 内网或局域网 GPU 机器。启用该功能意味着管理员允许将点播音频发送到此服务。

NAS 使用 `Authorization: Bearer <API Key>` 调用；密钥为空则不加该头。所有路径相对于配置地址。服务不应重定向请求。结果文件也必须与服务地址同源，以免凭证流向其他主机。

检测：`GET /health` 返回：

```json
{"protocol":"ktv-separation-v1","models":["htdemucs"]}
```

提交：`POST /separate` 使用 `multipart/form-data`，字段 `file` 为 M4A 音频文件，字段 `model` 为用户填写的模型标识。NAS 上传前已从视频抽出音频，最大 100 MB。可以直接返回完成结果：

```json
{"status":"done","instrumental_url":"/artifacts/example"}
```

也可返回异步任务：

```json
{"id":"example","status":"queued"}
```

NAS 每三秒请求 `GET /jobs/example`，直到 `status` 为 `done` 或 `failed`，最长等待 30 分钟。`running` 表示仍在处理。任务 ID 只能由英文字母、数字、下划线和短横线组成，最长 100 字符。

完成状态必须带 `instrumental_url`。它应指向与原音频起点对齐的完整 WAV/FLAC/MP3 等 FFmpeg 可读音频，不能裁掉静音或前奏。NAS 把该音频与原画面封装为伴奏版本，原混音继续作为原唱。接口无需返回孤立的人声轨道。

NAS 不自动适配聊天补全接口、Gradio 的任意应用或各家私有任务协议。若服务商返回云存储签名地址、回调或不同的字段，请在适配器中转换，并由适配器代理读取结果。不要把 OpenAI 兼容聊天地址误当成分离地址。

附带的 `separator/` 服务使用 Demucs，模型和说明可参考 [Demucs 官方仓库](https://github.com/adefossez/demucs)。远程供应商未指定，因此开发验证使用兼容协议的模拟服务完成 HTTP 上传、结果下载及真实 FFmpeg 封装；尚未验证任何收费服务商的推理结果。
