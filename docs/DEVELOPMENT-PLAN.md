# 功能模块与并行开发分工

更新于 2026-09-09。本文是分工与接口变更的统一入口；[审查报告](ADVERSARIAL-REVIEW.md)保存问题证据，[开发状态](PROJECT-STATUS.md)记录当前功能与实机限制。

NAS 保存资料、任务、队列与资源；PC／云端执行分离；网页、手机和 TV 消费 NAS 状态。第 0 批和第 1 批 T1–T8 已集成，模块按下列边界拆分。

## 模块归属

| 板块 | 功能 | 负责文件 | 边界 |
| --- | --- | --- | --- |
| A 曲库与资源 | 导入、分类、文件、版本、迁移 | server/library.js、song-package.js、song-writes.js、song-metadata.js、resource-*.js、video-replacement.js | 统一资源能力与正式发布；不搜索、不直接操作队列 |
| B 在线获取 | 链接、下载、收藏夹、找歌、补 MV | server/sources.js、acquisition.js、favorites.js、providers/ | 产出候选与下载文件，通过 A 发布 |
| C 资料与歌词 | 元数据、目录、AI、歌词来源与解析 | server/enrichment.js、lyrics-source.js；shared/catalog.js、lyrics.js、tags.js | 输出候选与证据；不分离、不直接写正式资料 |
| D 管理界面 | 三分类、编辑、批量刷新、待核对 | src/library/、library-manager.jsx、organize.jsx、song-editor.jsx、admin-settings.jsx | 管理用户意图和草稿；可用性以服务端为准 |
| E 播放与交互 | 双音频、字幕、频谱、舞台、手机、TV | src/playback/、media-playback.js、background-settings.jsx、lyrics.jsx、spectrum.jsx；android/ | 消费 manifest 和歌房状态；shared/lyrics.js 接口由 C 维护 |
| F PC 与分离 | GPU 环境、任务、面板、云端后备 | pc-worker/、separator/、server/separation/ | 维护 ktv-separation-v1；最终入库由 A 负责 |
| G 平台与集成 | 认证、调度、路由、schema、队列、设置 | server/app.js、routes/、room.js、scheduler.js、job-handlers/、db.js；src/app.jsx、api.js、main.jsx、style.css | 公共文件单一写入负责人，集中集成跨模块变更 |
| Q 验证与发布 | 回归、浏览器、打包、部署 | tests/、scripts/、.github/、Docker、Compose、构建配置 | 功能开发者写针对性测试，Q 整合验收与发布 |

同一人可负责多板块，但一个批次内同一文件只设一个写入负责人。测试按功能新建独立文件，避免大家同时追加同一个大测试文件。

server/visualization.js 是旧格式 FFmpeg 可视化，由 A/E 协调兼容；新格式使用浏览器频谱，新播放器已经支持图片轮播。不要继续把旧生成路径当作新播放器默认实现。

## 先固定接口

以下契约已实现。由 G 集中确定实际字段，再由各模块消费，不能各自定义一套同名结构。

| 契约 | 负责方 | 必须约定 |
| --- | --- | --- |
| Song 更新 | A/G | songId、metadataRevision、资料与来源；请求带 expectedRevision，过期 409 |
| SourceCandidate | B/C | provider、canonicalUrl、page、外部标题、时长、识别结果、证据、核对原因；预览与下载引用同一候选 |
| ResourceManifest | A/E | 资源修订号、video/vocal/backing/lyrics 的能力、URL、时长、偏移、缺失项；验证通过才可用 |
| 资源发布 | A/G | 任务独立暂存，核对后发布；失败保留上一个可唱版本；画面与音频来源独立 |
| 任务 | G，B/C/F 执行 | jobId、kind、songId、阶段、幂等键、预期版本、耗时、失败原因、核对动作；同歌写入互斥 |
| 歌词 | C/A/E | 原始 LRC、逐句／逐字时间、offset 单位、录音版本；旧新保存入口共用服务 |
| 分离协议 | F | 沿用 docs/AI-SEPARATION.md 的 ktv-separation-v1；新增字段兼容或明确升版，不传歌房凭证 |
| 歌房状态 | G/E | entryId、songId、播放状态、revision、租约；统一可见性和可点播检查 |

manifest.version=2 是格式代际，不是资源修订号；playback.revision 也不是资料版本，不能复用。

## 开发批次

### 第 0 批：共同基线与公共接口

共同基线为 `8280461`，在原 `ba220b1` 上保留全部既有未提交工作。开发分支为 `codex/batch-0-1`，各模块通过独立工作树开发，公共路由和 schema 集中集成。主分支原名 master，本次发布建立 main，保留 master 历史。

公共层已经实现资料／资源独立修订、同歌互斥、任务阶段检查点和不可变资源版本；HTTP 路由、调度器、任务处理器、播放器及管理工作台分别拆分。

### 第 1 批：可直接分派的任务

| 任务 | 主责 | 交付与验收 | 依赖 / 状态 |
| --- | --- | --- | --- |
| T1 同歌互斥与修订校验 | G | R2；expectedRevision、冲突响应、任务暂存标识；异歌仍并行 | 公共契约；已完成 |
| T2 资源完整性与补 MV | A | R1/R3/R5；缺文件降级、统一保存、补画面不换音频、失败保留旧版本 | T1；已完成 |
| T3 在线候选闭环 | B | R4/R7；预览资料传到导入，确认候选不循环重搜 | SourceCandidate；已完成 |
| T4 管理页面草稿与批量操作 | D | R9；后台更新不被旧表单覆盖，批量逐项结果明确 | T1 revision 接口，界面可先并行；已完成 |
| T5 目录与中文歌词来源 | C | provider 适配、同名／翻唱／时长核对、来源记录与测试夹具 | 候选和歌词契约；已完成 |
| T6 播放稳定性与背景画面 | E | 双路加载失败、暂停、切歌、声音授权；歌词频谱同时间轴；图片轮播 | Manifest，异常测试可先行；已完成 |
| T7 PC 恢复与协议 | F | 重启、中断、忙碌／离线、云端后备、输出校验；协议兼容 | 可独立进行，发布与 T2 协作；已完成 |
| T8 队列一致性与验收恢复 | G/Q | R6/R8；隐藏不能入队，新工作台浏览器验收与回归测试 | 能力接口与 UI；已完成 |

所有任务均已完成代码集成与本地验收。T5 提供本地中文／增强 LRC 索引适配器和 LRCLIB 后备，未接入 QQ／网易云等商业歌词接口；完整曲目覆盖不属于本批交付。

### 集成验收与发布

本地 69 项 Node 测试、11 项工作台联动、独立管理组件与播放器异常浏览器测试通过。CI 执行相同的主要检查、Python 协议测试、Docker 和 APK 构建。v0.2.0 的最终发布与实机范围见 [开发状态](PROJECT-STATUS.md) 和 [验证记录](VALIDATION.md)。

## 任务交接模板

```text
任务：T编号 + 目标
共同基线：明确提交号
负责文件：实际文件或新增目录
依赖接口：字段、错误码、版本
交给集成人的修改：公共路由 / schema / main.jsx / 全局样式
验收：正常路径 + 失败路径 + 并发或重试
交付：实际变更、测试结果、未覆盖范围、接口变更说明
```

并行任务使用独立工作树、数据库、媒体目录和端口，不共享 data-preview、PC 工作目录或真实曲库。公共 schema、路由、状态、全局样式由 G 集中合并；每项交付记录实际提交和测试结果。

## 接续实施状态

本批已完成 T1–T8。后续重点为 NAS、手机、TV 实机兼容、长期播放、真实平台下载成功率与音乐分离音质。历史诊断脚本保留为观察工具，正确行为由断言式回归测试保证。新任务先读取 PROJECT-STATUS.md，并保留工作区内新增改动。

## v0.3.0 接续交付

本轮由单一集成任务维护公共路由、调度器和全局界面：server/discovery.js 与 pc-worker/lan.py 管自动发现；server/online-preview.js、online-search.js 与 src/online-songs.jsx 管视频搜索预览；server/clipping.js 与 separator/clipping.py 管 PC 裁剪；shared/lyrics.js、server/room.js 与播放器管歌词微调。独立测试新增 tests/online-flow.test.js、tests/online-player.browser.mjs、tests/lyrics-tuning.test.js、pc-worker/test_lan.py。公开接口继续兼容 ktv-separation-v1，新增 video-clip-v1 能力；LAN 配置必须明确启用。当前发布与实机边界见 PROJECT-STATUS.md。
