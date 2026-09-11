# 好好唱 v0.4.4 · PC 更新限流修复

本次更新 PC 整理器即可；已使用 v0.4.3 的 NAS 和 TV 不必重装。音视频处理逻辑保持不变。

旧版如果提示 `HTTP Error 403: rate limit exceeded`，需手动下载 `haohaochang-resource-ai-v0.4.4.zip` 一次：等待任务结束，点击“退出整理器”，将 ZIP 解压覆盖到原安装目录，再运行 `start.cmd`。保留 `worker.json`、`runtime`、`.venv` 和 `data`，无需重装环境或重新下载模型。只关闭窗口会隐藏到托盘，不等于退出。

- 新版优先通过 Release 附件读取更新清单，避免依赖 GitHub 匿名 API 配额；API 仍作为后备。
- 五分钟内重复检查复用结果；遇到限流，按 GitHub 提供的恢复时间等待，并显示重试提示。
- 窗口和详细页面增加“手动下载更新包”入口。
- 下载固定到所选版本，保留大小、SHA-256、包内文件清单校验，以及空闲安装和失败回滚。

附件包括版本化的 NAS、TV、PC、重命名工具包，`SHA256SUMS-v0.4.4.txt`，以及供更新器读取的 `haohaochang-pc-update.json`。无需配置 GitHub 令牌。

本地 16 项 PC 更新测试、PC 网页回归和托盘脚本语法检查通过。未操作用户的实际 PC；发布结果以 [Actions](https://github.com/xudong7587/haohaochang/actions) 为准。
