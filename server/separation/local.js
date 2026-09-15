import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";

// Compose workers read the same persisted key before starting their private API.
// Restarting only the main container must not rotate worker credentials.
export async function configureLocalSeparation(env = process.env) {
  if (env.KTV_LOCAL_SEPARATION !== "1") return;
  const file = path.join(env.DATA_DIR || "/data", "separation", "internal.key");
  await mkdir(path.dirname(file), { recursive: true });
  try {
    await writeFile(file, randomBytes(32).toString("hex") + "\n", {
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  const key = (await readFile(file, "utf8")).trim();
  if (!/^[a-f0-9]{64}$/.test(key))
    throw new Error("本机分离服务密钥文件无效，请恢复 data/separation/internal.key");
  env.KTV_LOCAL_KEY = key;
}
