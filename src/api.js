const fromHash = location.hash.slice(1);
export function tvPairFromHash(hash) {
  return /^pair=[a-f0-9]{48}\.[a-f0-9]{48}$/.test(hash) ? hash.slice(5) : "";
}
export const pendingTvPair = tvPairFromHash(fromHash);
if (
  fromHash &&
  !fromHash.startsWith("pair=") &&
  ["/mobile", "/control"].includes(location.pathname)
) {
  localStorage.setItem("roomToken", fromHash);
  history.replaceState(null, "", location.pathname);
}
export let roomToken = localStorage.getItem("roomToken") || "";
export let adminToken = sessionStorage.getItem("adminToken") || "";
export async function api(url, body, method = "GET", isAdmin = false) {
  const binary = typeof Blob !== "undefined" && body instanceof Blob;
  const response = await fetch("/api" + url, {
    method,
    headers: {
      "Content-Type": binary
        ? body.type || "application/octet-stream"
        : "application/json",
      Authorization: `Bearer ${isAdmin ? adminToken : roomToken}`,
    },
    ...(body !== undefined
      ? { body: binary ? body : JSON.stringify(body) }
      : {}),
  });
  const result = await response.json();
  if (!response.ok)
    throw Object.assign(new Error(result.error || "连接失败"), result, {
      status: response.status,
      retryAfter: Number(response.headers.get("Retry-After")) || 60,
    });
  return result;
}

export function setAdminToken(value) {
  adminToken = value;
}
export function acceptLogin(value) {
  roomToken = value;
  localStorage.setItem("roomToken", value);
  sessionStorage.setItem("adminToken", adminToken);
}
export function logout() {
  localStorage.removeItem("roomToken");
  sessionStorage.removeItem("adminToken");
  location.reload();
}
