# 项目交接入口

- 分工与契约：[docs/DEVELOPMENT-PLAN.md](docs/DEVELOPMENT-PLAN.md)。问题依据：[docs/ADVERSARIAL-REVIEW.md](docs/ADVERSARIAL-REVIEW.md)。当前实现：[docs/PROJECT-STATUS.md](docs/PROJECT-STATUS.md)。
- NAS 保存资料、队列、任务和正式资源；PC／云端返回分离结果，播放端消费状态。
- 新格式为一份画面加独立原唱、伴奏和歌词。补画面不应默默替换音频；失败保留此前可用资源。当前实现与未验范围见开发状态。
- 保留已有未提交改动；并行开发先确定共同 Git 基线和文件负责人。公共路由、schema、main.jsx 与全局样式集中集成，模块内部文件按分工维护。
- 每个任务使用独立测试数据库、媒体目录和端口，不向用户已清空曲库添加示例。公司网络只测试 localhost，不探测局域网或修改防火墙。
- npm test 含真实 FFmpeg 测试，npm run build 构建前端。scripts/ui-check.mjs、scripts/player-check.mjs 和 tests/library-ui.browser.mjs 已纳入 CI；scripts/adversarial-check.mjs 退出 0 仅代表观察完成，不代表缺陷已修复。
- 启动与工具配置见 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)。按改动验证，区分本地通过、实机通过与已发布。
