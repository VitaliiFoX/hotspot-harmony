import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { parseLang, setLanguage, t } from "./i18n";
import "./styles.css";

setLanguage(parseLang(new URLSearchParams(window.location.search).get("lang")));
document.title = t("Hotspot Harmony - burning activity calendar");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
