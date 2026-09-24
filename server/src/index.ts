import { type NetworkInterfaceInfo, networkInterfaces } from "node:os";
import express from "express";
import { authBorne, authBracelet, exigeAdmin, exigeSoignant, session } from "./auth.js";
import { config } from "./config.js";
import { ping } from "./db.js";
import { adminApi } from "./routes/admin.js";
import { authApi } from "./routes/auth.js";
import { consoleApi } from "./routes/console.js";
import { directApi } from "./routes/direct.js";
import { ingest, recevoirWifi } from "./routes/ingest.js";

/**
 * Serveur de bord de Sola.
 *
 *   POST /ingest/*   ecrit par les bornes de cabine     (jeton borne)
 *   /auth/*          connexion des personnes            (ouvert)
 *   /api/*           console medicale                   (session medecin ou admin)
 *   /admin/*         backoffice : lecture et comptes    (session admin)
 *   GET  /health     supervision
 *
 * Tout cela n'ecoute que sur le poste (localhost). Seul le port reseau
 * (PORT_RESEAU, 5177) se joint depuis le Wi-Fi, et il ne sert que deux routes :
 *
 *   POST /ingest/bracelet   trames ou lecture seule      (jeton bracelet)
 *   GET  /health            supervision
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
      "POST /ingest/bracelet":
        "trames brutes du bracelet, une par seconde, resumees a la minute (jeton requis) ; " +
        "aussi sur le port reseau, avec le jeton du bracelet, ou une lecture seule horodatee a l'arrivee",
      "POST /ingest/nuit": "duree de sommeil estimee (jeton requis)",
      "POST /ingest/conversation": "resume clinique, jamais de verbatim (jeton requis)",
      "POST /ingest/evenement": "chute, secousse, bouton d'urgence (jeton requis)",
      "POST /api/residents/:code/particularites":
        "note de particularite, signee par la session medecin",
      "PATCH /api/signaux/:id":
        "prendre un signal, ou le clore avec un motif de son origine (session medecin)",
    },
    connexion: {
      "POST /auth/connexion": "e-mail et mot de passe, pose le cookie de session",
      "POST /auth/deconnexion": "ferme la session en cours",
      "GET /auth/moi": "compte connecte, ou 401",
    },
    lecture: {
      "GET /api/crew": "ecran 02 — sante de l'equipage",
      "GET /api/residents/:code": "ecran 03 — fiche resident, ex. /api/residents/R-0448",
      "GET /api/residents/:code/direct":
        "ecran 03 — derniere minute du bracelet, heure ecoulee et jour en cours",
      "GET /api/equipage": "ecran 04 — registre des residents, triable et pagine",
      "GET /api/signaux": "ecran 04 — registre des signaux, triable et pagine",
      "GET /api/signaux/stats": "ecran 04 — a traiter, faux positifs, motifs de cloture a revoir",
    },
    backoffice: {
      "GET /admin/apercu": "fraicheur des flux et volume des tables",
      "GET /admin/tables/:nom": "dernieres lignes d'une table, hors comptes et sessions",
      "GET /admin/ecrans": "chaque bloc de la console, sa source et ce qu'elle renvoie",
      "GET /admin/comptes": "soignants et administrateurs, sans adresse ni empreinte",
      "PATCH /admin/comptes/:role/:id": "activer ou desactiver un compte",
    },
    supervision: { "GET /health": "etat du service et de la base" },
  });
});

function sante(_req: express.Request, res: express.Response): void {
  const base = ping();
  res.status(base ? 200 : 503).json({
    service: "sola-server",
    base: base ? "ok" : "injoignable",
    jour_vol: config.jourVol,
  });
}

app.get("/health", sante);

// La session est resolue pour tout le monde, avant les gardes : une route
// ouverte peut vouloir savoir qui appelle sans l'exiger.
app.use(session);

app.use("/ingest", authBorne, ingest);
app.use("/auth", authApi);
app.use("/api", exigeSoignant, consoleApi, directApi);
app.use("/admin", exigeAdmin, adminApi);

function routeInconnue(_req: express.Request, res: express.Response): void {
  res.status(404).json({ erreur: "Route inconnue." });
}

// Un corps qui n'est pas du JSON est une faute de l'appelant : 400, pas 500.
// C'est l'erreur la plus probable d'un bracelet qui assemble son JSON a la
// main, et son moniteur serie ne montre souvent que le code.
function jsonIllisible(
  erreur: unknown,
  _req: express.Request,
  res: express.Response,
  next: express.NextFunction,
): void {
  if ((erreur as { type?: unknown } | null)?.type !== "entity.parse.failed") {
    next(erreur);
    return;
  }
  res.status(400).json({ erreur: "JSON illisible." });
}

// Gestionnaire d'erreurs. Le detail part dans le journal, jamais dans la
// reponse : un message d'erreur MySQL renvoye au client raconte le schema.
function erreurInterne(
  erreur: unknown,
  _req: express.Request,
  res: express.Response,
  _next: express.NextFunction,
): void {
  console.error("[sola]", erreur);
  res.status(500).json({ erreur: "Erreur interne." });
}

app.use(routeInconnue);
app.use(jsonIllisible);
app.use(erreurInterne);

// Le poste seulement : ce port porte la connexion et le backoffice, et rien
// sur le reseau local n'a a les voir. Ce qui vient du reseau passe par le
// port reseau, plus bas.
//
// Les deux boucles locales, et non « localhost » : ce nom ne met a l'ecoute
// qu'une adresse (::1 sous Windows), et le relais de la borne, qui appelle
// 127.0.0.1, trouverait porte close.
//
// Dans un conteneur, ECOUTE les remplace par une seule adresse : ses boucles
// ne se joignent que de lui-meme. La publication du port sur 127.0.0.1, dans
// compose.yaml, garde alors le poste.
app.listen(config.port, config.ecoute ?? "127.0.0.1", () => {
  console.log(`[sola] serveur de bord sur http://localhost:${config.port}`);
  console.log(`[sola] origines autorisees : ${[...ORIGINES].join(", ")}`);
});
if (config.ecoute === null) {
  app.listen(config.port, "::1").on("error", (e: NodeJS.ErrnoException) => {
    // Un poste sans IPv6 n'a pas de ::1 ; 127.0.0.1 suffit alors. Toute autre
    // erreur — un port deja pris — doit arreter le serveur, comme sans ce
    // gestionnaire.
    if (e.code !== "EADDRNOTAVAIL") throw e;
  });
}

// ---------------------------------------------------------------- port reseau -

/**
 * Une ligne par requete venue du reseau : c'est ce qu'on regarde pendant qu'on
 * regle un bracelet, dont le moniteur serie ne montre souvent que le code HTTP.
 * Des comptes et le motif d'un refus, jamais une valeur mesuree.
 */
function journal(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const json = res.json.bind(res);
  res.json = (corps?: unknown) => {
    res.locals.corps = corps;
    return json(corps);
  };
  res.on("finish", () => {
    const c = res.locals.corps as
      | {
          erreur?: string;
          trames?: number;
          minutes?: number;
          ecartees?: Record<string, number[]>;
          detail?: { path: (string | number)[]; message: string }[];
        }
      | undefined;
    const probleme = c?.detail?.[0];
    // Combien de valeurs hors plage, et lesquelles : la reponse porte les
    // valeurs elles-memes, le journal seulement leur nombre.
    const horsPlage = Object.entries(c?.ecartees ?? {})
      .map(([champ, valeurs]) => `${valeurs.length} ${champ}`)
      .join(", ");
    const suite =
      c?.trames !== undefined
        ? ` · ${c.trames} trame${c.trames > 1 ? "s" : ""}, ${c.minutes} min` +
          (horsPlage ? ` · ${horsPlage} hors plage` : "")
        : c?.erreur
          ? ` · ${c.erreur}${probleme ? ` (${probleme.path.join(".")} : ${probleme.message})` : ""}`
          : "";
    const origine = (req.socket.remoteAddress ?? "?").replace(/^::ffff:/, "");
    console.log(`[reseau] ${req.method} ${req.path} ${res.statusCode} · ${origine}${suite}`);
  });
  next();
}

/** Les adresses IPv4 du poste sur ses reseaux : celles a ecrire dans le bracelet. */
function adressesLocales(): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .filter(
      (i): i is NetworkInterfaceInfo =>
        i !== undefined &&
        i.family === "IPv4" &&
        !i.internal &&
        // 169.254 : adresse que Windows s'attribue faute de reseau, injoignable.
        !i.address.startsWith("169.254."),
    )
    .map((i) => i.address);
}

// Une seconde application plutot qu'un filtre sur la premiere : ce qui n'est
// pas monte ici n'existe pas pour le reseau, quoi qu'on ajoute plus tard a
// l'autre. Pas d'en-tetes CORS : un bracelet n'est pas un navigateur, et une
// page ouverte sur le reseau n'a rien a lire ici.
if (config.braceletToken) {
  const reseau = express();
  reseau.disable("x-powered-by");
  // Le journal avant le lecteur de JSON : un corps illisible doit laisser sa
  // ligne lui aussi, c'est justement celle qu'on cherche.
  reseau.use(journal);
  reseau.use(express.json({ limit: "2mb" }));
  reseau.get("/health", sante);
  reseau.post("/ingest/bracelet", authBracelet, recevoirWifi);
  reseau.use(routeInconnue);
  reseau.use(jsonIllisible);
  reseau.use(erreurInterne);

  reseau.listen(config.portReseau, () => {
    const adresses = adressesLocales();
    if (adresses.length === 0) {
      console.log(`[sola] port reseau ${config.portReseau} ouvert, mais aucun reseau trouve`);
    }
    for (const ip of adresses) {
      console.log(`[sola] bracelet en Wi-Fi : POST http://${ip}:${config.portReseau}/ingest/bracelet`);
    }
  });
} else {
  console.log("[sola] port reseau ferme : BRACELET_TOKEN absent de server/.env");
}
