import { existsSync, readFileSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type ProxyOptions } from "vite";
import react from "@vitejs/plugin-react";

const ici = dirname(fileURLToPath(import.meta.url));

/**
 * Le jeton des bornes vit dans `server/.env` (ou dans l'environnement du
 * process). Il ne doit jamais arriver au navigateur : les proxies `/bord` et
 * `/ingest` l'ajoutent côté serveur Vite, comme `/ollama` masque l'adresse
 * du modèle.
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
    "[borne] BORNE_TOKEN introuvable : les résumés et les trames du bracelet " +
      "ne partiront pas vers le serveur de bord. Renseignez server/.env ou exportez BORNE_TOKEN.",
  );
}

/**
 * Le relais prête le jeton de la borne : il ne le prête qu'à elle. Une
 * requête POST, venue de ce poste, envoyée par une page de cette origine —
 * un navigateur joint toujours `Origin` à un POST, même vers sa propre
 * origine. Sans cela, n'importe quel onglet ouvert sur la machine, ou avec
 * `--host` n'importe quel appareil du réseau, écrirait dans les dossiers.
 */
function depuisLaBorne(req: IncomingMessage): boolean {
  const adresse = req.socket.remoteAddress ?? "";
  const locale = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(adresse);
  let memeOrigine = false;
  try {
    memeOrigine = new URL(req.headers.origin ?? "").host === req.headers.host;
  } catch {
    /* pas d'Origin, ou illisible */
  }
  return req.method === "POST" && locale && memeOrigine;
}

const ollama: Record<string, ProxyOptions> = {
  "/ollama": {
    target: "http://127.0.0.1:11434",
    changeOrigin: true,
    rewrite: (chemin) => chemin.replace(/^\/ollama/, ""),
  },
};

const bord: Record<string, ProxyOptions> = borneToken
  ? {
      "/bord": {
        target: bordCible,
        changeOrigin: true,
        rewrite: (chemin) => chemin.replace(/^\/bord/, ""),
        configure(proxy) {
          proxy.on("proxyReq", (req) => {
            req.setHeader("Authorization", `Bearer ${borneToken}`);
          });
        },
      },
      "^/ingest/bracelet$": {
        target: bordCible,
        bypass: (req) => (depuisLaBorne(req) ? undefined : false),
        // Posé à chaque requête plutôt que dans `headers` : ainsi le jeton ne
        // figure dans aucun objet de configuration qu'un journal de débogage
        // de Vite pourrait afficher.
        configure: (proxy) => {
          proxy.on("proxyReq", (req) => {
            req.setHeader("Authorization", `Bearer ${borneToken}`);
            // La page n'a rien d'autre à dire au serveur de bord que ses trames.
            req.removeHeader("Cookie");
          });
        },
      },
    }
  : {};

export default defineConfig({
  plugins: [react()],
  // Web Bluetooth exige un contexte sécurisé : localhost en fait partie,
  // donc le serveur de développement suffit, sans certificat.
  //
  // strictPort : un port pris fait échouer Vite au lieu de le décaler d'un
  // cran sans rien dire. Décalée sur 5178, la borne laisserait 5173 à l'ancien
  // serveur qui le tient encore, et c'est lui qu'on ouvrirait. `vite preview`
  // hérite du refus : preview.strictPort vaut server.strictPort par défaut.
  server: { port: 5173, strictPort: true, proxy: { ...ollama, ...bord } },
  preview: { port: 5173, proxy: { ...ollama, ...bord } },
});
