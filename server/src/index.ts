import express from "express";
import { authBorne } from "./auth.js";
import { config } from "./config.js";
import { ping } from "./db.js";
import { consoleApi } from "./routes/console.js";
import { ingest } from "./routes/ingest.js";

/**
 * Serveur de bord de Sola.
 *
 *   POST /ingest/*   ecrit par les bornes de cabine   (jeton requis)
 *   GET  /api/*      lu par la console medicale
 *   GET  /health     supervision
 *
 * Le service ne sert pas les interfaces : la borne et la console restent deux
 * applications distinctes, servies separement. Ce serveur n'est qu'un dos.
 */
const app = express();

app.disable("x-powered-by");

// La borne peut envoyer une journee entiere de mesures d'un coup apres une
// coupure ; 2 Mo couvrent largement 1 440 lignes.
app.use(express.json({ limit: "2mb" }));

// La console est servie depuis un autre port : sans cela, le navigateur bloque
// la lecture. Une seule origine est autorisee, pas `*`.
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", config.consoleOrigin);
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.header("Vary", "Origin");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

app.get("/health", async (_req, res) => {
  const base = await ping();
  res.status(base ? 200 : 503).json({
    service: "sola-server",
    base: base ? "ok" : "injoignable",
    jour_vol: config.jourVol,
  });
});

app.use("/ingest", authBorne, ingest);
app.use("/api", consoleApi);

app.use((_req, res) => {
  res.status(404).json({ erreur: "Route inconnue." });
});

// Gestionnaire d'erreurs. Le detail part dans le journal, jamais dans la
// reponse : un message d'erreur MySQL renvoye au client raconte le schema.
app.use(
  (
    erreur: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error("[sola]", erreur);
    res.status(500).json({ erreur: "Erreur interne." });
  },
);

app.listen(config.port, () => {
  console.log(`[sola] serveur de bord sur http://localhost:${config.port}`);
  console.log(`[sola] console autorisee : ${config.consoleOrigin}`);
});
