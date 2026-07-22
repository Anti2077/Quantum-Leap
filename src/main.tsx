import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
import "./themes.css";
import { applyTheme, initializeTheme } from "./lib/theme";

const previewParameters = import.meta.env.DEV ? new URLSearchParams(window.location.search) : null;
const requestedColorTheme = previewParameters?.get("colorTheme") ?? null;
if (requestedColorTheme === "light" || requestedColorTheme === "dark") {
  applyTheme(requestedColorTheme);
} else {
  initializeTheme();
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
