import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app.jsx";
import { PcDashboard } from "./pc-dashboard.jsx";
import "./style.css";
createRoot(document.getElementById("root")).render(
  /^\/pc\/?$/.test(location.pathname) ? <PcDashboard /> : <App />,
);
