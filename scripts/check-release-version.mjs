import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const json = JSON.parse(await readFile("package.json", "utf8")),
  version = json.version;
for (const file of ["README.md", "docs/USER-GUIDE.md"])
  assert.ok(
    (await readFile(file, "utf8")).split("\n")[0].includes("v" + version),
    `${file} must describe v${version}`,
  );
assert.ok(
  (await readFile("pc-worker/version.py", "utf8")).includes(
    `VERSION = '${version}'`,
  ),
  "PC version differs",
);
const tvVersion = (await readFile("android/app/build.gradle", "utf8")).match(
  /versionName '([^']+)'/,
)?.[1];
assert.ok(
  tvVersion === version ||
    new RegExp(`^${version.replaceAll(".", "\\.")}\\.\\d+$`).test(tvVersion),
  "TV version must match the release or be its APK-only patch",
);
assert.equal(
  JSON.parse(await readFile("package-lock.json", "utf8")).version,
  version,
);
console.log(`Release versions and user documentation agree: v${version}`);
const releaseGuide = await readFile("docs/USER-GUIDE.md", "utf8");
for (const asset of [
  `haohaochang-tv-v${tvVersion}.apk`,
  `haohaochang-resource-ai-v${version}.zip`,
  `haohaochang-nas-v${version}.zip`,
  `haohaochang-preprocess-v${version}.zip`,
])
  assert.ok(releaseGuide.includes(asset), `User guide must name ${asset}`);
