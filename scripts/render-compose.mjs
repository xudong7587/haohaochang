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
assert.ok(source.startsWith("services:\n"), "Public Compose must start with services");
assert.ok(!/^x-|<<:|\$\{KTV_|\$\{ADMIN_/m.test(source), "Use direct public settings without templates");
const npuStart = source.indexOf("\n  # 3. Intel NPU");
assert.ok(npuStart > 0, "Keep the NPU section after the CPU section");
const arm = source.slice(0, npuStart)
    .replace("# Intel / AMD x86-64 NAS 使用本文件；ARM64 请用 docker-compose.arm64.yaml。",
      "# ARM64 NAS 使用本文件，包含主程序和 CPU 分离。")
    .replaceAll("docker compose ", "docker compose -f docker-compose.arm64.yaml ")
    .replace("下面 CPU 和 NPU 的两处", "下面 CPU 的一处")
    .replace("      KTV_NPU_ENDPOINT: http://127.0.0.1:18001\n", "");
if (process.argv.includes("--check"))
  assert.equal((await readFile("docker-compose.arm64.yaml", "utf8")).replaceAll("\r\n", "\n"), arm, "Regenerate ARM Compose");
else await writeFile("docker-compose.arm64.yaml", arm);
console.log("Compose variants use the pinned CPU/NPU runtimes");
