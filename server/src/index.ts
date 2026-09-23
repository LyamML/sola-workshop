import express from "express";
import { authBorne, exigeAdmin, exigeSoignant, session } from "./auth.js";
import { config } from "./config.js";
import { ping } from "./db.js";
import { adminApi } from "./routes/admin.js";
import { authApi } from "./routes/auth.js";
import { consoleApi } from "./routes/console.js";
import { ingest } from "./routes/ingest.js";

/**
 * Serveur de bord de Sola.
 *
 *   POST /ingest/*   ecrit par les bornes de cabine     (jeton borne)
 *   /auth/*          connexion des personnes            (ouvert)
 *   GET  /api/*      console medicale                   (session medecin ou admin)
 *   /admin/*         backoffice : lecture et correction (session admin)
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

// La console et le backoffice sont servis depuis d'autres ports : sans cela,
// le navigateur bloque la lecture. Deux origines nommees, jamais `*` — avec
// `*` n'importe quelle page ouverte a bord pourrait lire les dossiers.
const ORIGINES = new Set([config.consoleOrigin, config.backofficeOrigin]);

app.use((req, res, next) => {
  const origine = req.header("origin");
  if (origine && ORIGINES.has(origine)) {
    res.header("Access-Control-Allow-Origin", origine);
  }
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  // Le cookie de session ne traverse une origine differente que si le serveur
  // l'autorise explicitement. C'est pour cela que la liste d'origines est
  // nommee et jamais `*` : les deux vont ensemble, le navigateur refuse
  // `Allow-Credentials` avec une origine joker.
  res.header("Access-Control-Allow-Credentials", "true");
  res.header("Vary", "Origin");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

// Racine : personne ne devrait l'appeler en fonctionnement, mais quelqu'un
// finit toujours par ouvrir l'adresse du serveur dans un navigateur. Autant
// qu'il y trouve la liste des routes plutot qu'une erreur.
app.get("/", (_req, res) => {
  res.json({
    service: "sola-server",
    ecriture: {
      "POST /ingest/mesure": "lot de constantes du bracelet (jeton requis)",
      "POST /ingest/nuit": "duree de sommeil estimee (jeton requis)",
      "POST /ingest/conversation": "resume clinique, jamais de verbatim (jeton requis)",
      "POST /ingest/evenement": "chute, secousse, bouton d'urgence (jeton requis)",
      "POST /api/residents/:code/particularites":
        "note de particularite, signee par la session medecin",
    },
    connexion: {
      "POST /auth/connexion": "e-mail et mot de passe, pose le cookie de session",
      "POST /auth/deconnexion": "ferme la session en cours",
      "GET /auth/moi": "compte connecte, ou 401",
    },
    lecture: {
      "GET /api/crew": "ecran 02 — sante de l'equipage",
      "GET /api/residents/:code": "ecran 03 — fiche resident, ex. /api/residents/R-0448",
      "GET /api/equipage": "ecran 04 — registre des residents, triable et pagine",
      "GET /api/signaux": "ecran 04 — registre des signaux, triable et pagine",
    },
    backoffice: {
      "GET /admin/apercu": "compteurs par table et fraicheur des flux",
      "GET /admin/ecrans": "correspondance bloc d'interface <-> requete",
      "GET /admin/residents": "recherche, filtres module et statut",
      "PATCH /admin/residents/:code": "statut, poste, cabine",
      "GET /admin/signaux": "file de triage complete",
      "PATCH /admin/signaux/:id": "assigner ou clore",
      "POST /admin/residents/:code/particularites": "ajouter une allergie ou un antecedent",
      "DELETE /admin/particularites/:id": "retirer une particularite",
      "GET /admin/tables/:nom": "lecture brute d'une table",
    },
    supervision: { "GET /health": "etat du service et de la base" },
  });
});

app.get("/health", (_req, res) => {
  const base = ping();
  res.status(base ? 200 : 503).json({
    service: "sola-server",
    base: base ? "ok" : "injoignable",
    jour_vol: config.jourVol,
  });
});

// La session est resolue pour tout le monde, avant les gardes : une route
// ouverte peut vouloir savoir qui appelle sans l'exiger.
app.use(session);

app.use("/ingest", authBorne, ingest);
app.use("/auth", authApi);
app.use("/api", exigeSoignant, consoleApi);
app.use("/admin", exigeAdmin, adminApi);

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
  console.log(`[sola] origines autorisees : ${[...ORIGINES].join(", ")}`);
});
