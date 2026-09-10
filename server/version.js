import { readFileSync } from "node:fs";
export const appVersion = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
).version;
export const githubUrl = "https://github.com/xudong7587/haohaochang";
