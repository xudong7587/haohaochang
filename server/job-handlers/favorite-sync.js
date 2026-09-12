import { favoritePage, favoriteParts } from "../favorites.js";
export async function favorite_sync(job, payload, context) {
  const { db, get, set, addJob, fail } = context;
  const config = get("favorites", {});
  if (!config.favoriteId) throw fail(400, "请先配置收藏夹");
  let page = get("favorite-page:" + config.favoriteId, 1);
  const errors = [];
  for (let n = 0; n < 5; n++) {
    const result = await favoritePage(config, page, context.favoriteFetch);
    for (const item of result.items) {
      try {
        const parts = await favoriteParts(item, config, context.favoriteFetch);
        const old = get("favorite-seen:" + config.favoriteId + ":" + item.bvid);
        for (const part of parts) {
          const key = `favorite-part:${config.favoriteId}:${part.bvid}:${part.cid}`;
          if (get(key)) continue;
          if (part.page === 1 && old) {
            // Previous releases downloaded only P1. Preserve its job/seen marker.
            const previous = db
              .prepare("SELECT * FROM jobs WHERE id=?")
              .get(old);
            if (
              previous &&
              previous.kind === "favorite-download" &&
              ["queued", "failed", "waiting-worker"].includes(previous.status)
            )
              db.prepare("UPDATE jobs SET payload=? WHERE id=?").run(
                JSON.stringify({ ...JSON.parse(previous.payload), ...part }),
                old,
              );
            set(key, old);
          } else set(key, addJob("favorite-download", part));
        }
      } catch (error) {
        errors.push(`${item.bvid}: ${error.message}`);
      }
    }
    page++;
    if (!result.hasMore) {
      page = 1;
      break;
    }
  }
  set("favorite-page:" + config.favoriteId, page);
  set("favorite-last", Date.now());
  set("favorite-errors", errors);
  if (errors.length)
    throw new Error(
      `部分视频分 P 未同步，其他视频已继续处理：${errors.slice(0, 5).join("；")}`,
    );
}
