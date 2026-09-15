import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";

const source = (await readFile("docker-compose.yaml", "utf8")).replaceAll("\r\n", "\n");
const images = JSON.parse(await readFile("deploy/separation-images.json", "utf8"));
for (const kind of ["cpu", "npu"]) {
  const item = images[kind];
  assert.match(item.digest, /^sha256:[a-f0-9]{64}$/);
  assert.ok(source.includes(`image: ${item.image}:${item.version}@${item.digest}`),
    `Compose must pin the reviewed ${kind} image`);
}
const arm = "# 自动生成自 docker-compose.yaml；修改后运行 node scripts/render-compose.mjs。\n" +
  source.split("  separator-npu:\n")[0]
    .replace("# 默认适用于 Intel / AMD x86-64 NAS：docker compose up -d\n# ARM NAS 使用 docker-compose.arm64.yaml；详见 NAS安装与升级.md。",
      "# ARM64 NAS：docker compose -f docker-compose.arm64.yaml up -d\n# 包含主程序与 CPU；Intel NPU 镜像仅支持 x86-64。")
    .replace("docker compose pull ktv && docker compose up -d --no-deps ktv",
      "docker compose -f docker-compose.arm64.yaml pull ktv && docker compose -f docker-compose.arm64.yaml up -d --no-deps ktv")
    .replace("      KTV_NPU_ENDPOINT: http://127.0.0.1:18001\n", "");
if (process.argv.includes("--check"))
  assert.equal((await readFile("docker-compose.arm64.yaml", "utf8")).replaceAll("\r\n", "\n"), arm, "Regenerate ARM Compose");
else await writeFile("docker-compose.arm64.yaml", arm);
console.log("Compose variants use the pinned CPU/NPU runtimes");
