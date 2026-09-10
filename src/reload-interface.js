export function reloadInterface() {
  const url = new URL(window.location.href);
  url.searchParams.set("refresh", String(Date.now()));
  window.location.replace(url.href);
}
