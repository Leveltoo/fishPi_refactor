import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { installNativeContextMenuGuard } from "./features/shell/blockNativeContextMenu";
import "./index.css";

installNativeContextMenuGuard();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
