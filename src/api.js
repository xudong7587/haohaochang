const fromHash = location.hash.slice(1);
if (fromHash && ["/mobile", "/control"].includes(location.pathname)) {
  localStorage.setItem("roomToken", fromHash);
  history.replaceState(null, "", location.pathname);
}
export let roomToken = localStorage.getItem("roomToken") || "";
export let adminToken = sessionStorage.getItem("adminToken") || "";
export async function api(url, body, method = "GET", isAdmin = false) {
  const response = await fetch("/api" + url, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${isAdmin ? adminToken : roomToken}`,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  if (!response.ok)
    throw Object.assign(new Error(result.error || "连接失败"), result, {
      status: response.status,
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
