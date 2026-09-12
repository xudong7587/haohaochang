function renderUpdate(s) {
  text("appVersion", s.version ? "v" + s.version : "");
  text("updateStatus", "应用内更新已暂停，请手动下载覆盖安装。");
  for (const id of ["checkUpdate", "installUpdate", "cancelUpdate"])
    $(id).hidden = true;
}
$("shutdownWorker").onclick = async () => {
  try {
    const r = await fetch("/desktop/shutdown", {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
    });
    const value = await r.json();
    if (!r.ok) throw Error(value.detail || "退出失败");
    text("updateStatus", "整理器正在退出，可以关闭此窗口。");
  } catch (e) {
    text("updateStatus", e.message);
  }
};
