/* ES5 by design: this recovery screen must work even when the app cannot parse. */
(function () {
  var screen = document.getElementById("boot-screen");
  var message = document.getElementById("boot-message");
  var actions = document.getElementById("boot-actions");
  var tv = /^\/(tv|play)\/?$/.test(location.pathname);
  if (tv) document.body.className = "boot-tv";
  var timeout = setTimeout(function () {
    fail("页面加载时间较长，请检查服务器连接后重试。");
  }, 20000);
  function fail(text) {
    clearTimeout(timeout);
    window.haohaochangBoot.failed = true;
    screen.style.display = "flex";
    message.textContent = text;
    actions.style.display = "block";
  }
  window.haohaochangBoot = {
    loaded: false,
    failed: false,
    ready: function () {
      clearTimeout(timeout);
      this.failed = false;
      this.loaded = true;
      screen.style.display = "none";
    },
    fail: fail,
  };
  document.getElementById("boot-retry").onclick = function () {
    location.reload();
  };
  document.getElementById("boot-address").style.display = /HaohaochangTV/.test(
    navigator.userAgent,
  )
    ? "inline-block"
    : "none";
  window.addEventListener(
    "error",
    function (event) {
      if (
        !window.haohaochangBoot.loaded &&
        (event.error || event.target.tagName === "SCRIPT")
      )
        fail(
          "播放页面未能启动。请重试，或更新电视系统的 Android System WebView 后重新打开。",
        );
    },
    true,
  );
})();
