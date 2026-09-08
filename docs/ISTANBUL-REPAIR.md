# 伊斯坦堡画面修复（2026-09-08）

歌曲 837f72164dbba2e7e6b98ea1 的导入与 ambient prepare 重叠运行，共用画面.mp4.tmp，出现 EBUSY 与 H264 NAL 损坏。已从保留的原始 AV1 视频重建 1920×1080 H264 画面，全段 FFmpeg 严格解码通过；原唱、伴奏、歌词 SHA256 前后相同。

源码修复：song-package.js 使用 UUID 临时输出，发布前完整解码；library.js 导入状态 preparing；导入任务取得 song id 后持久化 payload.id。并发修复回归测试通过，导入状态断言通过。全量测试两次遇到另一开发任务正在拆分公共模块的语法错误，完整回归由该任务完成。

真实资源在 HEAD 隔离服务器中验证：正常画面、原唱切换、跳至 101 秒、双音频同步，无页面异常。证据：test-results/istanbul-repair.json、istanbul-playback.json、istanbul-repaired-playback.png。未进行电视硬件验证。

历史视频和处理记录已保留至 data-preview/media/好好唱播放资源/保留记录/837f72164dbba2e7e6b98ea1，数据库来源及歌曲信息 source 已更新。来源仍位于允许的媒体根目录，曲库扫描会跳过整个资源目录。歌曲目录保留画面、原唱、伴奏、歌词、歌曲信息和 NFO 六个文件。

preview3210 暂未恢复，避免加载另一任务施工中的公共代码；已通知“完成第0批和第1批开发发布”在完成后恢复 scripts/preview.mjs，不启用示例。
