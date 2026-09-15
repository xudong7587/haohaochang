import { createApp } from "./app.js";
import { startTvDiscovery } from "./tv-discovery.js";
import { startEmbeddedSeparation } from "./separation/embedded.js";
import { configureLocalSeparation } from "./separation/local.js";
await configureLocalSeparation();
const embedded = await startEmbeddedSeparation();
let service;
try {
  service = createApp();
} catch (error) {
  await embedded.stop();
  throw error;
}
const { app } = service;
const port = Number(process.env.PORT || 3210);
const server = app.listen(port, "0.0.0.0", () => {
  console.log(`好好唱已启动：http://localhost:${port}`);
  const discovery = startTvDiscovery({
    enabled:
      process.env.KTV_LOCAL_ONLY !== "1" &&
      (process.env.KTV_TV_DISCOVERY_ENABLED === "1" ||
        process.env.KTV_DISCOVERY_ENABLED === "1"),
    httpPort: Number(process.env.KTV_TV_HTTP_PORT || port),
    onError: (error) =>
      console.warn("电视自动发现未启动，可手动连接：" + error.code),
  });
  server.on("close", () => discovery.stop());
});

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  server.close();
  server.closeAllConnections();
  await embedded.stop();
  await service.close();
  process.exit(0);
}
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
server.once("error", async (error) => {
  console.error("好好唱监听失败：" + error.message);
  await embedded.stop();
  await service.close();
  process.exit(1);
});
