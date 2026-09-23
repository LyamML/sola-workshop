import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type ProxyOptions } from "vite";
import react from "@vitejs/plugin-react";

const ici = dirname(fileURLToPath(import.meta.url));

/**
 * Le jeton des bornes vit dans `server/.env` (ou dans l'environnement du
 * process). Il ne doit jamais arriver au navigateur : le proxy `/bord` l'ajoute
 * côté serveur Vite, comme `/ollama` masque l'adresse du modèle.
 */
function lireBorneToken(): string | undefined {
  if (process.env.BORNE_TOKEN) return process.env.BORNE_TOKEN;
  const chemin = resolve(ici, "../../server/.env");
  if (!existsSync(chemin)) return undefined;
  for (const ligne of readFileSync(chemin, "utf8").split(/\r?\n/)) {
    const m = /^\s*BORNE_TOKEN\s*=\s*(.*)$/.exec(ligne);
    if (!m) continue;
    return m[1].replace(/^["']|["']$/g, "").trim();
  }
  return undefined;
}

const borneToken = lireBorneToken();
const bordCible = process.env.BORD_URL ?? "http://127.0.0.1:5175";

if (!borneToken) {
  console.warn(
    "[borne] BORNE_TOKEN introuvable : les résumés ne partiront pas vers le " +
      "serveur de bord. Renseignez server/.env ou exportez BORNE_TOKEN.",
  );
}

const ollama: Record<string, ProxyOptions> = {
  "/ollama": {
    target: "http://127.0.0.1:11434",
    changeOrigin: true,
    rewrite: (chemin) => chemin.replace(/^\/ollama/, ""),
  },
};

const bord: Record<string, ProxyOptions> = {
  "/bord": {
    target: bordCible,
    changeOrigin: true,
    rewrite: (chemin) => chemin.replace(/^\/bord/, ""),
    configure(proxy) {
      proxy.on("proxyReq", (req) => {
        if (borneToken) req.setHeader("Authorization", `Bearer ${borneToken}`);
      });
    },
  },
};

export default defineConfig({
  plugins: [react()],
  // Web Bluetooth exige un contexte sécurisé : localhost en fait partie,
  // donc le serveur de développement suffit, sans certificat.
  server: { port: 5173, proxy: { ...ollama, ...bord } },
  preview: { port: 5173, proxy: { ...ollama, ...bord } },
});
