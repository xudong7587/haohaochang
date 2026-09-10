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
assert.ok(
  (await readFile("android/app/build.gradle", "utf8")).includes(
    `versionName '${version}'`,
  ),
  "TV version differs",
);
assert.equal(
  JSON.parse(await readFile("package-lock.json", "utf8")).version,
  version,
);
console.log(`Release versions and user documentation agree: v${version}`);
