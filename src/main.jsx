import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  addEventListener("load", () => navigator.serviceWorker.register("/sw.js"));
}

const root = document.getElementById("root");
if (!root) throw new Error("Root element tidak ditemukan");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
