import { readFileSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { parseEnv } from "node:util";
import { defineConfig, type ProxyOptions } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Le relais des trames du bracelet vers le serveur de bord.
 *
 * /ingest exige le jeton des bornes, et une page web ne garde aucun secret :
 * le jeton reste donc ici, côté Node, et s'ajoute à la requête en passant.
 * Il est lu dans server/.env, comme le serveur le lit, et l'environnement
 * l'emporte sur le fichier, comme pour `node --env-file`.
 */
function relais(): Record<string, ProxyOptions> | undefined {
  let fichier: Record<string, string | undefined> = {};
  try {
    fichier = parseEnv(readFileSync(new URL("../../server/.env", import.meta.url), "utf8"));
  } catch {
    /* pas de server/.env : on s'en tient à l'environnement */
  }
  const env = { ...fichier, ...process.env };
  const jeton = env.BORNE_TOKEN;
  if (!jeton) {
    console.warn(
      "[borne] BORNE_TOKEN introuvable dans server/.env : les trames du bracelet ne partiront pas.",
    );
    return undefined;
  }

  return {
    "^/ingest/bracelet$": {
      target: `http://localhost:${env.PORT ?? 5175}`,
      bypass: (req) => (depuisLaBorne(req) ? undefined : false),
      // Posé à chaque requête plutôt que dans `headers` : ainsi le jeton ne
      // figure dans aucun objet de configuration qu'un journal de débogage
      // de Vite pourrait afficher.
      configure: (proxy) => {
        proxy.on("proxyReq", (requete) => {
          requete.setHeader("Authorization", `Bearer ${jeton}`);
          // La page n'a rien d'autre à dire au serveur de bord que ses trames.
          requete.removeHeader("Cookie");
        });
      },
    },
  };
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

export default defineConfig(({ command }) => ({
  plugins: [react()],
  // Web Bluetooth exige un contexte sécurisé : localhost en fait partie,
  // donc le serveur de développement suffit, sans certificat. `vite preview`
  // reprend le même relais : preview.proxy vaut server.proxy par défaut.
  server: { port: 5173, proxy: command === "serve" ? relais() : undefined },
}));
