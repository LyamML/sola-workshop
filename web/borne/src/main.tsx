import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/manrope";
import "@fontsource/ibm-plex-mono/400.css";
// La pastille, les choix et le délai d'arrivée de l'alerte sont en 500, le
// surtitre des questions en 600 : sans ces graisses, tout retombe en 400.
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
import "./styles/borne.css";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
