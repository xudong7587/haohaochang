import { timingSafeEqual } from "node:crypto";
export const fail = (status, message) =>
  Object.assign(new Error(message), { status });
export const equal = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  Buffer.byteLength(a) === Buffer.byteLength(b) &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
export const clean = (value, max = 120) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";
