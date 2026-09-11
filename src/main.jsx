import React from "react";
import "abortcontroller-polyfill/dist/abortcontroller-polyfill-only";
import { createRoot } from "react-dom/client";
import { App } from "./app.jsx";
import { PcDashboard } from "./pc-dashboard.jsx";
import "./style.css";
import "./player-adaptive.css";
import "./playback/tv-experience.css";
function BootReady({ children }) {
  React.useEffect(() => {
    if (window.haohaochangBoot) window.haohaochangBoot.ready();
    else document.getElementById("boot-screen")?.remove();
  }, []);
  return children;
}
createRoot(document.getElementById("root"), {
  onUncaughtError(error) {
    console.error(error);
    window.haohaochangBoot?.fail(
      "页面运行遇到问题，请重试；若仍失败，请更新电视系统的 Android System WebView。",
    );
  },
}).render(
  <BootReady>
    {/^\/pc\/?$/.test(location.pathname) ? <PcDashboard /> : <App />}
  </BootReady>,
);
