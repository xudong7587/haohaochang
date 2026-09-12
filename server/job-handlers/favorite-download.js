import {
  registerFavoriteBundle,
  finishFavoritePart,
} from "../favorite-bundles.js";
import { prepareTaskDirectory } from "../task-files.js";
import { checkTaskCancellation, taskFetch } from "../task-cancellation.js";
import { favoriteParts, favoriteNfo } from "../favorites.js";
import { moveLocalFile } from "../local-intake.js";
import path from "node:path";
import { stat, writeFile, mkdir } from "node:fs/promises";
import { downloadVideo } from "../media.js";
import { withBiliCookie } from "../sources.js";
const component = (text) =>
  String(text || "视频")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/[. ]+$/g, "")
    .slice(0, 70) || "视频";
export async function favorite_download(job, payload, context) {
  const { store, get, dir, downloads, addJob, db } = context;
  const config = get("favorites", {});
  const parts = await favoriteParts(
    payload,
    config,
    context.favoriteFetch || taskFetch,
  );
  const part = payload.cid
    ? parts.find((p) => p.cid === String(payload.cid))
    : parts.find((p) => p.page === 1);
  if (!part) throw new Error("原分 P 已移除，已停止下载，避免取得其他歌曲");
  if (!payload.bundleId) {
    const group = await registerFavoriteBundle(parts, {
      ...context,
      currentDownload: job.id,
    });
    part.bundleId = group.id;
  }
  checkTaskCancellation();
  db.prepare("UPDATE jobs SET payload=? WHERE id=?").run(
    JSON.stringify({ ...payload, ...part }),
    job.id,
  );
  context.report?.("downloading");
  const workspace = await prepareTaskDirectory(downloads, job.id);
  const { file } = await withBiliCookie(config.cookie, dir, (cookieFile) =>
    (context.favoriteDownload || downloadVideo)(
      part.url,
      workspace,
      cookieFile,
      "highest",
    ),
  );
  checkTaskCancellation();
  const info = await stat(file);
  const folder = path.join(
    workspace,
    component(part.collectionTitle),
    "Season 1",
  );
  await mkdir(folder, { recursive: true });
  const stem =
    component(part.title) + ` - S01E${String(part.page).padStart(2, "0")}`;
  const target = path.join(folder, stem + path.extname(file));
  await writeFile(path.join(folder, stem + ".nfo"), favoriteNfo(part), "utf8");
  await moveLocalFile(
    file,
    target,
    [downloads],
    info.size + ":" + info.mtimeMs,
  );
  checkTaskCancellation();
  const fresh = JSON.parse(
    db.prepare("SELECT payload FROM jobs WHERE id=?").get(job.id).payload,
  );
  await finishFavoritePart(
    { ...part, bundleId: fresh.bundleId || part.bundleId },
    target,
    context,
  );
}
