# 项目交接入口

- 分工与契约：[docs/DEVELOPMENT-PLAN.md](docs/DEVELOPMENT-PLAN.md)。问题依据：[docs/ADVERSARIAL-REVIEW.md](docs/ADVERSARIAL-REVIEW.md)。当前实现：[docs/PROJECT-STATUS.md](docs/PROJECT-STATUS.md)。
- NAS 保存资料、队列、任务和正式资源；PC 返回裁剪／分离结果，云端可后备分离，播放端消费状态。
- 新格式为一份画面加独立原唱、伴奏和歌词。补画面不应默默替换音频；失败保留此前可用资源。当前实现与未验范围见开发状态。
- 保留已有未提交改动；并行开发先确定共同 Git 基线和文件负责人。公共路由、schema、main.jsx 与全局样式集中集成，模块内部文件按分工维护。
- 每个任务使用独立测试数据库、媒体目录和端口，不向用户已清空曲库添加示例。公司网络只测试 localhost，不探测局域网或修改防火墙。
- npm test 含真实 FFmpeg 测试，npm run build 构建前端。scripts/ui-check.mjs、scripts/player-check.mjs、tests/library-ui.browser.mjs 和 tests/online-player.browser.mjs 已纳入 CI；scripts/adversarial-check.mjs 退出 0 仅代表观察完成，不代表缺陷已修复。
- 启动与工具配置见 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)。按改动验证，区分本地通过、实机通过与已发布。
- 每次推送 Git 前同步 README 的相关功能和当前版本号；涉及用户操作时一并更新 docs/USER-GUIDE.md。版本、安装包名称和更新步骤应与当次发布一致，从使用者的操作流程组织说明。
- 主程序、NAS CPU 和 Intel NPU 使用独立镜像。Python、FFmpeg、下载工具留在主程序；PyTorch、Demucs、OpenVINO 与模型留在各自分离镜像。日常主程序 Release 只构建／推广主镜像，不重建或改写 CPU、NPU 标签。
- CPU／NPU 的固定版本和摘要以 deploy/separation-images.json 为准，Compose 自动连接同机服务并生成共享鉴权密钥。只有明确的分离器改动才手动发布独立 runtime 版本，验证后单独修改该文件和 Compose。修改默认 Compose 后运行 node scripts/render-compose.mjs，同步 ARM 版本。
- 公共 Compose 必须从 services 开头，使用直接可改的值，不使用 x-worker、YAML 引用合并或 .env 变量模板；用中文 # 注释标清密码、端口、目录及必须同步的映射，自动参数标为无需修改。NAS 三个服务使用 host 网络，CPU／NPU 仅监听回环地址，不新建 bridge 子网。
