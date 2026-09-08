# 对抗性审查 · 2026-09-08

基线：`ba220b1945d7550839a2e5d04e1777c38f9fe575` 加审查开始时已有的未提交改动。范围包括 NAS 曲库、获取任务、分离协议、管理页面、播放器、PC、Android 外壳与验证入口。本轮只增加诊断与交接文档，没有修复以下业务缺陷，没有访问生产 NAS 或修改用户曲库。

确认 9 个问题：3 个 P1，6 个 P2。资源发布、任务互斥和资料更新是并行开发前需要先统一的边界。

## P1：优先处理

### R2：同一首歌的不同任务缺少互斥

[调度器](../server/app.js#L81)、[编辑与补视频接口](../server/library-api.js#L68)、[固定临时文件](../server/song-package.js#L23)。

复现：歌曲 prepare 已 running，新接口保存资料和提交 attach-video 都返回 200。调度允许两个任务运行，仅对部分同类任务去重，没有跨任务的 songId 写入协调。资源和分离过程使用固定临时文件名。

影响：准备、补 MV、分离和编辑可能覆盖结果或使用过期资料。已实测冲突操作同时获准；资源损坏的具体时序是代码推断，没有对真实歌曲执行破坏性竞争测试。

修复：G 主导、A 配合。同歌写操作串行、每个任务独立暂存、发布时核对预期版本。验收须包含异歌仍可并行、重启重试不会重复发布。

### R3：补 MV 会替换音源并破坏已有可唱状态

[attach-video](../server/jobs.js#L25)、[资源准备](../server/song-package.js#L24)。

复现：已分离歌曲补等时长 MV 后，path 改为新视频，mode 变 original，status 变 new。继续准备会提取新视频的原唱，旧伴奏仍在原位置，manifest 同时报告两份音频存在。诊断用伴奏标记文件证明其未被替换，不涉及音质判断。

影响：补画面会更换录音并要求重新分离。PC 不可用或分离失败时不能维持原有能力。时长相近也不能证明版本与起始时间对齐。

修复：A 主导、B 配合。音频来源和视频来源独立保存，默认只添加画面候选，核对版本与偏移后发布。验收：只补 MV 后原唱、伴奏和歌词哈希不变，失败时旧版本继续可唱。

### R9：刷新后的旧表单能覆盖新资料

[ResourceRow](../src/library-manager.jsx#L11)、[保存接口](../server/library-api.js#L68)。

浏览器复现：打开编辑后，后台修改标题，再刷新列表。行标题变新，输入框仍旧；点击仅保存信息，数据库被旧标题覆盖。表单只初始化一次，保存没有 expectedRevision。

修复：D 主导、G 提供修订校验。未编辑表单可跟随更新，有草稿时提示冲突，过期保存返回 409。不能无条件刷新输入框，否则会丢掉用户正在输入的草稿。验收覆盖两窗口、批量刷新、后台元数据更新。

## P2：其他确认问题

| 编号 | 复现结果 | 代码依据 | 归属与验收 |
| --- | --- | --- | --- |
| R1 | 媒体全部缺失，数据库 ready/separated 且有歌词，仍返回 standard；manifest 三项全 false | [分类](../server/song-package.js#L14)、[曲库接口](../server/library-api.js#L21) | A：统一文件能力校验，缺文件降级并显示原因，不允许不可播放资源入队 |
| R4 | find-video 收到用户 URL/candidatePath 后仍重新搜索并返回 review | [findVideo](../server/acquisition.js#L63)、[核对提交](../server/app.js#L229) | B：明确候选优先；确认、拒绝、重新搜索分开，确认后不循环搜索 |
| R5 | 旧歌词 PUT 更新数据库，却未更新歌词.lrc | [旧入口](../server/app.js#L255)、[新入口](../server/library-api.js#L68) | A/C：统一保存服务，数据库、播放与导出歌词一致 |
| R6 | 隐藏后用已有 ID 点歌，返回 200 并入队；catalog localId 也未过滤隐藏 | [队列](../server/app.js#L124)、[目录](../server/library-api.js#L22) | G/A：统一可见性与可点播规则，并提供明确恢复操作。这是功能一致性问题，不把隐藏视为权限隔离 |
| R7 | 预览识别可爱女人／周杰伦，下载导入却退回未知歌手 | [inbox-link](../server/library-api.js#L46)、[导入](../server/jobs.js#L64) | B/C：传递同一候选的分 P、识别结果和证据，避免预览与导入重复计算且相互矛盾 |
| R8 | 浏览器验收脚本仍寻找旧编辑按钮，实跑第 32 行超时；CI 未执行该脚本 | [UI 脚本](../scripts/ui-check.mjs#L32)、[CI](../.github/workflows/check.yml#L11) | Q：更新新工作台行为与夹具，纳入浏览器验收 |

## 验证证据

新增 [scripts/adversarial-check.mjs](../scripts/adversarial-check.mjs)，使用全新临时目录、真实本地 FFmpeg、B 站响应 mock。默认覆盖 R1–R7；设置 PLAYWRIGHT_MODULE 后增加浏览器 R9。本次实际取得 8 项隔离观察，结果在 `test-results/adversarial-review.json`。另运行原 UI 脚本，确认 R8 的 30 秒超时。

运行：`node scripts/adversarial-check.mjs`。浏览器附加验证需将 PLAYWRIGHT_MODULE 指向 playwright 模块，BROWSER_CHANNEL 默认 msedge。

诊断脚本退出 0 表示观察完成，不代表业务正确；修复时须把场景转为断言正确行为的正式回归测试。此前 23 项测试通过不能覆盖这些场景。本轮没有更改生产代码，未为文档重复运行全量测试。

PC、Android、发布配置做了静态检查，未重跑真实 GPU、APK、Docker 或发布。仍需验证音频单路失败、声音授权、分离中断恢复、上传并发限流、反代多人共享限流及任务磁盘占用；未将这些未验证项计入已确认缺陷。

模块与任务状态以 [DEVELOPMENT-PLAN.md](DEVELOPMENT-PLAN.md) 为准，本报告保存问题依据。
