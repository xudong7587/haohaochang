import path from "node:path";
import { mkdir, realpath, lstat, rm } from "node:fs/promises";
export function taskDirectory(downloads, id) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new Error("无效任务编号");
  return path.join(downloads, ".ktv-jobs", id);
}
export async function prepareTaskDirectory(downloads, id) {
  const directory = taskDirectory(downloads, id);
  await mkdir(downloads, { recursive: true });
  const root = await realpath(downloads);
  const parent = path.join(downloads, ".ktv-jobs");
  await mkdir(parent, { recursive: true });
  if ((await realpath(parent)) !== path.join(root, ".ktv-jobs"))
    throw new Error("任务目录包含符号链接，拒绝写入");
  await mkdir(directory, { recursive: true });
  if ((await realpath(directory)) !== path.join(root, ".ktv-jobs", id))
    throw new Error("任务目录包含符号链接，拒绝写入");
  return directory;
}
function containsPath(value, directory) {
  if (typeof value === "string" && path.isAbsolute(value)) {
    const relative = path.relative(directory, path.resolve(value));
    return (
      relative === "" ||
      (!relative.startsWith(".." + path.sep) &&
        relative !== ".." &&
        !path.isAbsolute(relative))
    );
  }
  return (
    value &&
    typeof value === "object" &&
    Object.values(value).some((v) => containsPath(v, directory))
  );
}
export async function cleanTaskFiles(store, downloads, id) {
  const owned = taskDirectory(downloads, id);
  // Older downloads recorded the job id only for PC clipping output.
  for (const directory of [
    owned,
    path.join(downloads, ".ktv-online", "clips", id),
  ]) {
    try {
      await lstat(directory);
    } catch (e) {
      if (e.code === "ENOENT") continue;
      throw e;
    }
    const root = await realpath(downloads);
    if (
      (await realpath(directory)) !==
      path.join(root, path.relative(downloads, directory))
    )
      throw new Error("任务目录包含符号链接，拒绝清理");
    const references = [
      ...store.db.prepare("SELECT path FROM songs").all(),
      ...store.db
        .prepare("SELECT payload FROM jobs WHERE id<>?")
        .all(id)
        .map((r) => JSON.parse(r.payload)),
      ...store.db
        .prepare(
          "SELECT value FROM settings WHERE key LIKE 'package:%' OR key LIKE 'video-source:%' OR key LIKE 'split-video:%'",
        )
        .all()
        .map((r) => JSON.parse(r.value)),
    ];
    if (references.some((value) => containsPath(value, directory)))
      throw new Error("任务文件已被歌曲或其他任务引用，已停止任务但保留文件");
    await rm(directory, { recursive: true, force: true });
  }
}
