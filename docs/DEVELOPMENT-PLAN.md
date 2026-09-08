# 功能模块与并行开发分工

更新于 2026-09-08。本文是分工与接口变更的统一入口；[审查报告](ADVERSARIAL-REVIEW.md)保存问题证据，[开发状态](PROJECT-STATUS.md)记录当前功能与实机限制。

NAS 保存资料、任务、队列与资源；PC／云端执行分离；网页、手机和 TV 消费 NAS 状态。下表是现有代码归属和计划边界，尚未进行目录搬迁。

## 模块归属

| 板块 | 功能 | 负责文件 | 边界 |
| --- | --- | --- | --- |
| A 曲库与资源 | 导入、分类、文件、版本、迁移 | server/library.js、media.js、assets.js、song-package.js | 统一资源能力与正式发布；不搜索、不直接操作队列 |
| B 在线获取 | 链接、下载、收藏夹、找歌、补 MV | server/sources.js、acquisition.js、favorites.js | 产出候选与下载文件，通过 A 发布 |
| C 资料与歌词 | 元数据、目录、AI、歌词来源与解析 | server/enrichment.js、lyrics-source.js；shared/catalog.js、lyrics.js、tags.js | 输出候选与证据；不分离、不直接写正式资料 |
| D 管理界面 | 三分类、编辑、批量刷新、待核对 | src/library-manager.jsx、organize.jsx、automation.jsx、request-song.jsx、settings.jsx | 管理用户意图和草稿；可用性以服务端为准 |
| E 播放与交互 | 双音频、字幕、频谱、舞台、手机、TV | src/media-playback.js、lyrics.jsx、spectrum.jsx、stage.jsx；android/ | 消费 manifest 和歌房状态；shared/lyrics.js 接口由 C 维护 |
| F PC 与分离 | GPU 环境、任务、面板、云端后备 | pc-worker/、separator/、server/separation.js | 维护 ktv-separation-v1；最终入库由 A 负责 |
| G 平台与集成 | 认证、调度、路由、schema、队列、设置 | server/app.js、library-api.js、jobs.js、db.js、index.js、process.js；src/main.jsx、style.css | 公共文件单一写入负责人，集中集成跨模块变更 |
| Q 验证与发布 | 回归、浏览器、打包、部署 | tests/、scripts/、.github/、Docker、Compose、构建配置 | 功能开发者写针对性测试，Q 整合验收与发布 |

同一人可负责多板块，但一个批次内同一文件只设一个写入负责人。测试按功能新建独立文件，避免大家同时追加同一个大测试文件。

server/visualization.js 是旧格式 FFmpeg 可视化，由 A/E 协调兼容；新格式使用浏览器频谱，图片轮播尚未迁移。不要继续把旧生成路径当作新播放器默认实现。

## 先固定接口

以下是目标契约，尚未全部实现。由 G 集中确定实际字段，再由各模块消费，不能各自定义一套同名结构。

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

先将现有未提交工作整理为所有任务可访问的共同基线，记录提交号和验证结果。新曲库文件尚未全部进入 Git，直接从旧 HEAD 建工作树会漏掉实现。本次没有创建提交、分支、工作树或新的开发任务。

G/A 优先确定同歌写入协调与独立资源发布。D 可先做草稿冲突界面，B/C/E/F 可并行做模块内部实现和异常测试；依赖新契约的功能使用约定夹具，不各自改公共路由。

### 第 1 批：可直接分派的任务

| 任务 | 主责 | 交付与验收 | 依赖 / 状态 |
| --- | --- | --- | --- |
| T1 同歌互斥与修订校验 | G | R2；expectedRevision、冲突响应、任务暂存标识；异歌仍并行 | 公共契约；待开发 |
| T2 资源完整性与补 MV | A | R1/R3/R5；缺文件降级、统一保存、补画面不换音频、失败保留旧版本 | T1；待开发 |
| T3 在线候选闭环 | B | R4/R7；预览资料传到导入，确认候选不循环重搜 | SourceCandidate；待开发 |
| T4 管理页面草稿与批量操作 | D | R9；后台更新不被旧表单覆盖，批量逐项结果明确 | T1 revision 接口，界面可先并行；待开发 |
| T5 目录与中文歌词来源 | C | provider 适配、同名／翻唱／时长核对、来源记录与测试夹具 | 候选和歌词契约；待开发 |
| T6 播放稳定性与背景画面 | E | 双路加载失败、暂停、切歌、声音授权；歌词频谱同时间轴；图片轮播 | Manifest，异常测试可先行；待开发 |
| T7 PC 恢复与协议 | F | 重启、中断、忙碌／离线、云端后备、输出校验；协议兼容 | 可独立进行，发布与 T2 协作；待开发 |
| T8 队列一致性与验收恢复 | G/Q | R6/R8；隐藏不能入队，新工作台浏览器验收与回归测试 | 能力接口与 UI；待开发 |

这些是分派单，尚未启动。只有三四个开发者时，建议先并行 T3、T4、T7，由 G/A 处理 T1/T2；T5/T6 下一批推进，避免八项同时争用集成入口。

### 第 2 批：集成验收

各任务先完成针对性测试，再由 G 合并公共接口。Q 覆盖空库导入、半标准升级、缺文件、双窗口编辑、同歌任务、核对重试、双路播放、隐藏歌曲。随后安排真实 NAS、手机、TV 与 PC 验收。发布由明确的发布任务执行，文档整理不触发上线。

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

本对话正在整合 A/D/F/G：PC 启动与进度已修复验证；直接整理入口已加；server/video-replacement.js 负责新格式视频替换，tests/video-replacement.test.js 验证原双音频保留、重复替换与失败回滚。T2 的 R3 已在新格式路径完成，T1 增加调度互斥与新接口忙碌检查，其余任务尚未全部完成。新任务开始前读取 PROJECT-STATUS.md，并确认当前未提交代码已包含在所用工作树中。
