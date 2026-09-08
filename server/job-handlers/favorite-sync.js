import { favoritePage } from "../favorites.js";

export async function favorite_sync(job, payload, context) {
  const {
    db,
    get,
    set,
    store,
    dir,
    roots,
    downloads,
    cache,
    legacyCache,
    emit,
    addJob,
    enqueue,
    fail,
  } = context;
  {
    const config = get("favorites", {});
    if (!config.favoriteId) throw fail(400, "请先配置收藏夹");
    let page = get("favorite-page:" + config.favoriteId, 1);
    for (let n = 0; n < 5; n++) {
      const result = await favoritePage(config, page);
      for (const item of result.items) {
        const key = "favorite-seen:" + config.favoriteId + ":" + item.bvid;
        if (!get(key)) {
          const id = addJob("favorite-download", item);
          set(key, id);
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
  }
}
