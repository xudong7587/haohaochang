let updateState = {},
  updating = false;
const updateLabels = {
  idle: "尚未检查新版",
  checking: "正在检查新版",
  available: "发现新版",
  current: "已是最新版本",
  downloading: "正在下载",
  waiting: "等待当前任务完成",
  installing: "正在安装",
  restarting: "正在重新启动",
  complete: "更新完成",
  failed: "更新失败",
  cancelled: "已取消更新",
};
function renderUpdate(s) {
  updateState = s.update || {};
  text("appVersion", "v" + s.version);
  text(
    "updateStatus",
    (updateLabels[updateState.phase] || "请先手动安装支持更新的版本") +
      (updateState.latest ? " · v" + updateState.latest : "") +
      (updateState.phase === "downloading"
        ? " · " + updateState.progress + "%"
        : "") +
      (updateState.error ? " · " + updateState.error : ""),
  );
  $("checkUpdate").disabled =
    updating ||
    ["checking", "downloading", "waiting", "installing", "restarting"].includes(
      updateState.phase,
    );
  $("installUpdate").hidden = updateState.phase !== "available";
  $("cancelUpdate").hidden = !["downloading", "waiting"].includes(
    updateState.phase,
  );
}
async function updateAction(action) {
  if (updating) return;
  updating = true;
  try {
    const response = await fetch("/desktop/update/" + action, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ version: updateState.latest }),
    });
    const data = await response.json();
    if (!response.ok) throw Error(data.detail || "更新失败");
    await refresh();
  } catch (e) {
    text("updateStatus", e.message);
  } finally {
    updating = false;
    $("checkUpdate").disabled = false;
  }
}
$("checkUpdate").onclick = () => updateAction("check");
$("installUpdate").onclick = () => updateAction("install");
$("cancelUpdate").onclick = () => updateAction("cancel");
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
