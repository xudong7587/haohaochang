// Isolated component contract test: no real database, downloader, or media requests.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
const { chromium } = createRequire(import.meta.url)(
  process.env.PLAYWRIGHT_MODULE || "playwright",
);
const fixture = `<!doctype html><html><body><div id="root"></div><script type="module">
import React from 'react';
import {createRoot} from 'react-dom/client';
import {LibraryManager} from '/src/library-manager.jsx';
window.songs=[{id:'song-a',title:'初始歌名',artist:'测试歌手',lyrics:'[00:01]测试歌词',metadataRevision:1,tier:'standard',status:'ready',sourceUrl:'',manifest:{vocal:true,backing:true}}];
window.hiddenSongs=[];window.calls=[];window.failSave=false;
window.videoReview={id:'video-review',kind:'find-video',title:'视频候选',artist:'测试歌手',candidatePath:'isolated/candidate.mp4',expectedRevision:7,candidate:{canonicalUrl:'https://www.bilibili.com/video/BV1gF4m1K7Aa?p=14',provider:'bilibili',externalTitle:'第14P',duration:240}};
window.request=async(url,body,method)=>{
 window.calls.push({url,body,method});
 if(url==='/admin/library')return structuredClone(window.songs);
 if(url==='/admin/library?hidden=true')return structuredClone(window.hiddenSongs);
 if(url==='/admin/reviews')return [structuredClone(window.videoReview)];
 if(url==='/admin/inbox')return [];
 if(url==='/admin/lyrics-batch')return {results:(body.all?window.songs.filter(row=>!row.lyrics):body.items.map(item=>window.songs.find(row=>row.id===item.id))).map(row=>({id:row.id,title:row.title,status:'success',message:'已加入歌词补充任务'}))};
 if(url==='/admin/organize-batch')return {results:body.items.map(item=>({id:item.id,status:'success',message:'已加入整理队列'}))};
 if(url==='/admin/standardize-batch')return {results:body.items.map(item=>({id:item.id,status:'success',message:'已排队检查格式并回收旧版本'}))};
 if(url.endsWith('/delete-preview'))return {title:'初始歌名',token:'preview-token',targets:[{path:'/isolated/song-folder',directory:true}]};
 if(url.endsWith('/delete-files')){if(window.failDelete)throw new Error('文件已变化');if(body.token!=='preview-token')throw new Error('无效确认');window.songs=window.songs.filter(row=>row.id!==url.split('/')[3]);window.hiddenSongs=window.hiddenSongs.filter(row=>row.id!==url.split('/')[3]);return {ok:true};}
 if(url==='/admin/source-info')return {title:'可爱女人',artist:'周杰伦',duration:240,candidateId:'retained-preview-id',candidate:{canonicalUrl:body.url,externalTitle:'第14P',page:14}};
 if(url==='/admin/find-lyrics')return {lyrics:'[00:01]本地候选歌词',source:'本地 LRC',provider:'local-lrc',sourceId:'local-1'};
 if(url==='/admin/refresh-metadata')return {title:'识别歌名',artist:'测试歌手',needs_review:body.id==='review'};
 if(url.endsWith('/save')){
  const song=window.songs.find(row=>row.id===url.split('/')[3]);
  if(window.failSave||song.id==='conflict'||body.expectedRevision!==song.metadataRevision){window.failSave=false;throw Object.assign(new Error('资料已更新'),{status:409,code:'REVISION_CONFLICT',currentRevision:song.metadataRevision});}
  if(song.id==='failed')throw new Error('保存失败');
  Object.assign(song,{title:body.title,artist:body.artist,lyrics:body.lyrics,lyricsSource:body.lyricsSource,metadataRevision:song.metadataRevision+1});return {ok:true,metadataRevision:song.metadataRevision};
 }
 if(method==='DELETE'){const id=url.split('/').pop();window.hiddenSongs.push(...window.songs.filter(row=>row.id===id));window.songs=window.songs.filter(row=>row.id!==id);}
 if(url.endsWith('/restore')){const id=url.split('/')[3];window.songs.push(...window.hiddenSongs.filter(row=>row.id===id));window.hiddenSongs=window.hiddenSongs.filter(row=>row.id!==id);}
 return {ok:true};
};
createRoot(document.getElementById('root')).render(React.createElement(LibraryManager,{request:window.request,notify:message=>window.lastNotice=message}));
</script></body></html>`;
const server = await createServer({
  configFile: false,
  plugins: [
    react(),
    {
      name: "isolated-library-fixture",
      configureServer(vite) {
        vite.middlewares.use("/library-fixture", async (_req, res, next) => {
          try {
            res.setHeader("Content-Type", "text/html");
            res.end(await vite.transformIndexHtml("/library-fixture", fixture));
          } catch (error) {
            next(error);
          }
        });
      },
    },
  ],
  server: { host: "127.0.0.1", port: 0, watch: null },
});
await server.listen();
const browser = await chromium.launch({
  ...(process.env.BROWSER_CHANNEL && process.env.BROWSER_CHANNEL !== "chromium"
    ? { channel: process.env.BROWSER_CHANNEL }
    : {}),
  headless: true,
});
try {
  const page = await browser.newPage({
      viewport: { width: 1440, height: 1100 },
    }),
    errors = [];
  page.on("pageerror", (error) => {
    errors.push(error.message);
    console.error(error.message);
  });
  await page.route("**/api/online/preview", (route) =>
    route.fulfill({
      json: {
        id: "refresh-preview",
        duration: 240,
        qualities: [{ value: "highest", label: "最高画质" }],
      },
    }),
  );
  await page.goto(
    "http://127.0.0.1:" + server.httpServer.address().port + "/library-fixture",
  );
  await page
    .getByRole("button", { name: /标准曲库 ·/ })
    .filter({ hasText: /^标准/ })
    .click();
  assert.equal(await page.locator(".artist-library").count(), 0);
  await page.getByText("曲库维护", { exact: true }).click();
  await page
    .getByRole("button", { name: "老版本多视频合一", exact: true })
    .click();
  if ((await page.locator(".batch-results").getAttribute("open")) === null)
    await page.locator(".batch-results summary").click();
  await page.getByText("已排队检查格式并回收旧版本", { exact: true }).waitFor();
  assert.deepEqual(
    await page.evaluate(
      () =>
        window.calls.find((call) => call.url === "/admin/standardize-batch")
          .body.items,
    ),
    [{ id: "song-a", expectedRevision: 1 }],
  );
  assert.equal(
    await page.getByRole("button", { name: "全部整理", exact: true }).count(),
    0,
  );
  assert.equal(await page.getByText("旧曲库工具", { exact: true }).count(), 0);
  let row = page.locator('[data-song-id="song-a"]');
  assert.deepEqual(await row.locator("header button").allTextContents(), [
    "编辑歌曲",
  ]);
  await row.getByRole("button", { name: "编辑歌曲", exact: true }).click();
  await row.getByRole("button", { name: "维护操作", exact: true }).click();
  await row.getByRole("button", { name: "删除", exact: true }).click();
  await row.getByRole("dialog", { name: "确认删除媒体" }).waitFor();
  assert.ok(
    (
      await row
        .getByRole("dialog", { name: "确认删除媒体", exact: true })
        .textContent()
    ).includes("整个目录"),
  );
  await row.getByRole("button", { name: "取消", exact: true }).click();
  assert.equal(await page.evaluate(() => window.songs.length), 1);
  await row.getByRole("button", { name: "关闭歌曲详情", exact: true }).click();
  await row.getByRole("button", { name: "编辑歌曲", exact: true }).click();
  const title = row.getByLabel("歌名", { exact: true });
  await page.evaluate(() =>
    Object.assign(window.songs[0], { title: "后台更新", metadataRevision: 2 }),
  );
  await row.getByRole("button", { name: "关闭歌曲详情", exact: true }).click();
  await page.getByRole("button", { name: "刷新列表", exact: true }).click();
  await row.locator("header strong").filter({ hasText: "后台更新" }).waitFor();
  await row.getByRole("button", { name: "编辑歌曲", exact: true }).click();
  assert.equal(await title.inputValue(), "后台更新");
  await title.fill("保留我的草稿");
  await page.evaluate(() =>
    Object.assign(window.songs[0], {
      title: "另一窗口更新",
      metadataRevision: 3,
    }),
  );
  await row.getByRole("button", { name: "关闭歌曲详情", exact: true }).click();
  await page.getByRole("button", { name: "刷新列表", exact: true }).click();
  await row
    .locator("header strong")
    .filter({ hasText: "另一窗口更新" })
    .waitFor();
  await row.getByRole("button", { name: "编辑歌曲", exact: true }).click();
  await row.getByRole("alert").waitFor();
  assert.equal(await title.inputValue(), "保留我的草稿");
  assert.equal(
    await row
      .getByRole("button", { name: "仅保存信息", exact: true })
      .isDisabled(),
    true,
  );
  await row.getByRole("button", { name: "关闭歌曲详情", exact: true }).click();
  await page.getByRole("button", { name: /^半标准曲库/ }).click();
  await page.getByRole("button", { name: /^标准曲库/ }).click();
  await row.getByRole("button", { name: "编辑歌曲", exact: true }).click();
  assert.equal(await title.inputValue(), "保留我的草稿");
  await row.getByLabel("我已比较最新资料，确认要保存现有草稿").check();
  await row
    .getByRole("button", { name: "保留草稿，按最新修订继续编辑", exact: true })
    .click();
  await row.getByRole("button", { name: "仅保存信息", exact: true }).click();
  await page.waitForFunction(() => window.songs[0].metadataRevision === 4);
  assert.equal(
    (
      await page.evaluate(() =>
        window.calls.filter((call) => call.url.endsWith("/save")).at(-1),
      )
    ).body.expectedRevision,
    3,
  );
  await title.fill("触发服务器冲突");
  await page.evaluate(() =>
    Object.assign(window.songs[0], {
      title: "未刷新后台更新",
      metadataRevision: 5,
    }),
  );
  await row.getByRole("button", { name: "仅保存信息", exact: true }).click();
  await row.getByRole("alert").waitFor();
  assert.equal(await title.inputValue(), "触发服务器冲突");
  await row
    .getByRole("button", { name: "采用最新资料，放弃草稿", exact: true })
    .click();
  assert.equal(await title.inputValue(), "未刷新后台更新");
  await row.getByRole("button", { name: "关闭歌曲详情", exact: true }).click();
  await page.getByRole("button", { name: "添加链接", exact: true }).click();
  await page
    .getByLabel("添加下载链接")
    .fill("https://www.bilibili.com/video/BV1gF4m1K7Aa?p=14");
  await page.getByRole("button", { name: "解析 MV 链接", exact: true }).click();
  await page.getByRole("button", { name: "下载到待整理", exact: true }).click();
  assert.equal(
    (
      await page.evaluate(() =>
        window.calls.find((call) => call.url === "/admin/inbox-link"),
      )
    ).body.candidateId,
    "retained-preview-id",
  );
  await row.getByRole("button", { name: "编辑歌曲", exact: true }).click();
  await row.getByRole("button", { name: "同步歌词", exact: true }).click();
  await row
    .getByRole("button", { name: "自动找歌词", exact: true })
    .first()
    .click();
  await row.getByText(/歌词来源：本地 LRC/).waitFor();
  await row
    .getByLabel("编辑 LRC 歌词")
    .fill("[ar:修改后的歌手]\n[00:01]本地候选歌词");
  await row.getByRole("button", { name: "仅保存信息", exact: true }).click();
  assert.equal(
    (
      await page.evaluate(() =>
        window.calls.filter((call) => call.url.endsWith("/save")).at(-1),
      )
    ).body.lyricsSource.provider,
    "manual",
  );
  assert.equal(
    (
      await page.evaluate(() =>
        window.calls.filter((call) => call.url.endsWith("/save")).at(-1),
      )
    ).body.lyrics,
    "[ar:修改后的歌手]\n[00:01]本地候选歌词",
  );
  await row.getByRole("button", { name: "视频画面", exact: true }).click();
  await row
    .getByRole("button", { name: "在线寻找新视频", exact: true })
    .click();
  await row
    .getByLabel("更新视频链接")
    .fill("https://www.bilibili.com/video/BV1gF4m1K7Aa?p=14");
  await row.getByRole("button", { name: "预览链接", exact: true }).click();
  await page
    .getByRole("button", { name: "更新视频并重新分离", exact: true })
    .click();
  const source = (
    await page.evaluate(() =>
      window.calls.find((call) => call.url.endsWith("/refresh-video")),
    )
  ).body;
  assert.equal(source.url, "https://www.bilibili.com/video/BV1gF4m1K7Aa?p=14");
  assert.equal(source.clip, null);
  assert.equal(source.expectedRevision, 6);
  await page
    .locator(".video-preview-modal")
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  await row.getByRole("button", { name: "关闭歌曲详情", exact: true }).click();
  await page.getByRole("button", { name: /^待整理曲库/ }).click();
  const video = page.locator("article").filter({
    has: page.getByRole("button", { name: "核对视频", exact: true }),
  });
  await video.getByRole("button", { name: "核对视频", exact: true }).click();
  await video.getByLabel("我已试听核对，这是与当前音轨对应的录音版本").check();
  await video.getByLabel("视频相对音轨偏移（秒）").fill("0");
  await video
    .getByRole("button", { name: "确认候选并关联画面", exact: true })
    .click();
  await video.getByRole("button", { name: "拒绝此候选", exact: true }).click();
  await video
    .getByRole("button", { name: "重新搜索视频", exact: true })
    .click();
  assert.deepEqual(
    await page.evaluate(() =>
      window.calls
        .filter((call) => call.url === "/admin/reviews/video-review")
        .map((call) => call.body.action),
    ),
    ["confirm", "reject", "research"],
  );
  await video
    .getByRole("button", { name: "关闭歌曲详情", exact: true })
    .click();
  await page.getByRole("button", { name: /^标准曲库/ }).click();
  await row.getByRole("button", { name: "编辑歌曲", exact: true }).click();
  await row.getByRole("button", { name: "维护操作", exact: true }).click();
  await row.getByRole("button", { name: "移出曲库", exact: true }).click();
  await page.getByRole("button", { name: /^已隐藏/ }).click();
  await page.getByRole("button", { name: "恢复歌曲", exact: true }).click();
  assert.equal(await page.evaluate(() => window.songs.length), 1);
  await page.getByRole("button", { name: /^标准曲库/ }).click();

  await row.getByRole("button", { name: "编辑歌曲", exact: true }).click();
  await row.getByRole("button", { name: "维护操作", exact: true }).click();
  await row.getByRole("button", { name: "删除", exact: true }).click();
  await row.getByRole("button", { name: "确认永久删除", exact: true }).click();
  await page.waitForFunction(() => window.songs.length === 0);
  await page.evaluate(() => {
    window.hiddenSongs = [
      {
        id: "hidden-only",
        title: "隐藏测试",
        artist: "测试歌手",
        videoInfo: { available: true, height: 480 },
      },
    ];
  });
  await page.getByRole("button", { name: "刷新列表", exact: true }).click();
  await page.getByRole("button", { name: /^已隐藏/ }).click();
  const hiddenRow = page.locator('[data-song-id="hidden-only"]');
  assert.ok((await hiddenRow.textContent()).includes("480p"));
  await hiddenRow
    .getByRole("button", { name: "彻底删除", exact: true })
    .click();
  const deleteDialog = page.getByRole("dialog", {
    name: "彻底删除《隐藏测试》",
    exact: true,
  });
  assert.ok(
    (await deleteDialog.textContent()).includes("/isolated/song-folder"),
  );
  await deleteDialog.getByRole("button", { name: "取消", exact: true }).click();
  assert.equal(await page.evaluate(() => window.hiddenSongs.length), 1);
  await hiddenRow
    .getByRole("button", { name: "彻底删除", exact: true })
    .click();
  await page.evaluate(() => {
    window.failDelete = true;
  });
  await deleteDialog
    .getByRole("button", { name: "确认永久删除", exact: true })
    .click();
  await deleteDialog.getByRole("alert").waitFor();
  assert.equal(await page.evaluate(() => window.hiddenSongs.length), 1);
  await deleteDialog
    .getByRole("button", { name: "关闭歌曲详情", exact: true })
    .click();
  await page.evaluate(() => {
    window.failDelete = false;
  });
  await hiddenRow
    .getByRole("button", { name: "彻底删除", exact: true })
    .click();
  await deleteDialog
    .getByRole("button", { name: "确认永久删除", exact: true })
    .click();
  await page.waitForFunction(() => window.hiddenSongs.length === 0);
  await hiddenRow.waitFor({ state: "detached" });
  await page.evaluate(() => {
    window.songs = [
      {
        id: "bulk-no-lyrics",
        title: "无歌词歌曲",
        artist: "测试歌手",
        lyrics: "",
        tier: "pending",
        metadataRevision: 0,
        status: "new",
      },
    ];
  });
  await page.getByRole("button", { name: "刷新列表", exact: true }).click();
  await page.getByRole("button", { name: /^待整理曲库/ }).click();
  await page.locator('[data-song-id="bulk-no-lyrics"]').waitFor();
  await page.getByRole("button", { name: "全部整理", exact: true }).click();
  if ((await page.locator(".batch-results").getAttribute("open")) === null)
    await page.locator(".batch-results summary").click();
  await page.getByText("已加入整理队列", { exact: true }).waitFor();
  assert.equal(
    await page.evaluate(
      () =>
        window.calls
          .filter((call) => call.url === "/admin/organize-batch")
          .at(-1).body.items[0].id,
    ),
    "bulk-no-lyrics",
  );
  await page.evaluate(() => {
    window.songs = Array.from({ length: 45 }, (_, i) => ({
      id: "select-" + i,
      title: "跨页歌曲" + String(i).padStart(2, "0"),
      artist: "测试歌手",
      lyrics: i === 0 ? "[00:01]保留" : "",
      tier: "standard",
      metadataRevision: 0,
      status: "ready",
    }));
    window.songs.push({
      id: "another-tier",
      title: "另一分类",
      artist: "测试歌手",
      lyrics: "",
      tier: "audio",
      metadataRevision: 0,
    });
  });
  await page.getByRole("button", { name: "刷新列表", exact: true }).click();
  await page.getByRole("button", { name: /^标准曲库/ }).click();
  const all = page.getByRole("checkbox", {
    name: "全选当前筛选歌曲（所有分页）",
    exact: true,
  });
  await all.check();
  await page.getByText("已选 45 首（可跨页）", { exact: true }).waitFor();
  await page.getByRole("button", { name: "歌曲下一页", exact: true }).click();
  assert.equal(
    await page
      .getByRole("checkbox", { name: "选择本页歌曲", exact: true })
      .isChecked(),
    true,
  );
  await page
    .getByRole("checkbox", { name: "选择本页歌曲", exact: true })
    .uncheck();
  assert.equal(await all.evaluate((el) => el.indeterminate), true);
  await all.check();
  await page
    .getByRole("button", { name: "补充所选缺失歌词", exact: true })
    .click();
  const chunks = await page.evaluate(() =>
    window.calls
      .filter((c) => c.url === "/admin/lyrics-batch" && c.body.items)
      .map((c) => c.body.items),
  );
  assert.deepEqual(
    chunks.map((items) => items.length),
    [20, 20, 5],
  );
  assert.equal(new Set(chunks.flat().map((item) => item.id)).size, 45);
  await all.uncheck();
  await page.getByRole("button", { name: /^补充全部缺失歌词 · 45$/ }).click();
  assert.deepEqual(
    await page.evaluate(
      () =>
        window.calls.filter((c) => c.url === "/admin/lyrics-batch").at(-1).body,
    ),
    { all: true },
  );
  await page.getByLabel("筛选曲库", { exact: true }).fill("跨页歌曲0");
  await all.check();
  await page.getByText("已选 10 首（可跨页）", { exact: true }).waitFor();
  await page.getByRole("button", { name: /^半标准曲库/ }).click();
  assert.equal(await all.isChecked(), false);
  await page.getByLabel("筛选曲库", { exact: true }).fill("");
  await page.evaluate(() => {
    window.songs = [
      {
        id: "order-a",
        title: "爱",
        artist: "周杰伦",
        created: 30,
        videoInfo: { available: true, height: 480 },
      },
      {
        id: "order-b",
        title: "晴",
        artist: "陈奕迅",
        created: 10,
        videoInfo: { available: true, height: 720 },
      },
      {
        id: "order-c",
        title: "雨",
        artist: "周杰伦",
        created: 20,
        videoInfo: { available: false },
      },
    ].map((row) => ({
      ...row,
      tier: "standard",
      status: "ready",
      metadataRevision: 0,
    }));
  });
  await page.getByRole("button", { name: "刷新列表", exact: true }).click();
  await page.getByRole("button", { name: /^标准曲库/ }).click();
  const sorting = page.getByLabel("歌曲排序", { exact: true });
  for (const [sort, expected] of [
    ["artist", ["b", "a", "c"]],
    ["artist-desc", ["c", "a", "b"]],
    ["title", ["a", "b", "c"]],
    ["title-desc", ["c", "b", "a"]],
    ["created", ["b", "c", "a"]],
    ["created-desc", ["a", "c", "b"]],
  ]) {
    const button = sorting.locator(`[data-sort="${sort.split("-")[0]}"]`);
    await button.click();
    if (
      (await page.evaluate(() =>
        localStorage.getItem("haohaochang.librarySort"),
      )) !== sort
    )
      await button.click();
    assert.equal(await button.getAttribute("aria-pressed"), "true");
    assert.deepEqual(
      await page
        .locator("article[data-song-id]:visible")
        .evaluateAll((rows) => rows.map((row) => row.dataset.songId)),
      expected.map((id) => "order-" + id),
    );
  }
  assert.ok(
    (
      await page.locator('[data-song-id="order-a"] header').textContent()
    ).includes("480p"),
  );
  assert.ok(
    (
      await page.locator('[data-song-id="order-b"] header').textContent()
    ).includes("720p"),
  );
  assert.ok(
    (
      await page.locator('[data-song-id="order-c"] header').textContent()
    ).includes("无视频"),
  );
  await page.getByLabel("视频分辨率筛选").selectOption("720");
  assert.deepEqual(
    await page
      .locator("article[data-song-id]:visible")
      .evaluateAll((rows) => rows.map((row) => row.dataset.songId)),
    ["order-b"],
  );
  await page.getByRole("button", { name: "缺少视频", exact: true }).click();
  assert.equal(await page.locator("article[data-song-id]:visible").count(), 0);
  await page.getByRole("button", { name: "清除资源筛选", exact: true }).click();
  // A background task can finish while a filtered selection is still checked.
  await page.getByRole("button", { name: "缺少歌词", exact: true }).click();
  await all.check();
  await page.evaluate(() => {
    window.songs[0].lyrics = "[00:01]后台已补齐";
  });
  await page.getByRole("button", { name: "刷新列表", exact: true }).click();
  await page.getByText("已选 2 首（可跨页）", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "补充所选缺失歌词", exact: true })
    .click();
  assert.deepEqual(
    (
      await page.evaluate(() =>
        window.calls
          .filter((call) => call.url === "/admin/lyrics-batch")
          .at(-1),
      )
    ).body.items
      .map((item) => item.id)
      .sort(),
    ["order-b", "order-c"],
  );
  await page.getByRole("button", { name: "清除资源筛选", exact: true }).click();
  await page.getByRole("button", { name: "缺少视频", exact: true }).click();
  assert.deepEqual(
    await page
      .locator("article[data-song-id]:visible")
      .evaluateAll((rows) => rows.map((row) => row.dataset.songId)),
    ["order-c"],
  );
  await page.getByRole("button", { name: "清除资源筛选", exact: true }).click();
  await page.addStyleTag({
    content: await readFile(
      new URL("../src/style.css", import.meta.url),
      "utf8",
    ),
  });
  await page.addStyleTag({
    content: await readFile(
      new URL("../src/library/controls.css", import.meta.url),
      "utf8",
    ),
  });
  await page.setViewportSize({ width: 390, height: 844 });
  const labels = await page
    .locator(".collection-selection label")
    .evaluateAll((items) =>
      items.map((item) => item.getBoundingClientRect().y),
    );
  assert.equal(labels[0], labels[1]);
  await page.reload();
  assert.equal(
    await sorting
      .getByRole("button", { name: "时间↓" })
      .getAttribute("aria-pressed"),
    "true",
  );
  assert.deepEqual(errors, []);
  console.log(
    "Library component browser contracts passed: drafts, candidates, lyrics, hide/restore/permanent delete, six sorting orders with persistence, and SD/HD video labels.",
  );
} finally {
  await browser.close();
  await server.close();
}
