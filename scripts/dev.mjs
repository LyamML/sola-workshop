#!/usr/bin/env node
/**
 * Lance les services de developpement dans un seul terminal.
 *
 *   npm run dev                      -- borne, console, serveur, backoffice
 *   npm run dev -- console server    -- seulement ceux-la
 *
 * Chaque ligne porte le nom du service qui l'a ecrite, et Ctrl+C arrete tout.
 * Aucune dependance, ni `concurrently` ni `npm-run-all` : le projet installe
 * le moins de choses possible, et quatre processus fils tiennent en une page.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { createInterface } from "node:readline";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { parseEnv, styleText } from "node:util";

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENV = resolve(RACINE, "server/.env");

// Les ports restent ecrits dans chaque espace de travail : les repeter ici
// ferait deux sources a tenir d'accord.
//
// --strictPort, parce qu'un Vite qui trouve son port pris en prend un autre
// sans rien dire. Une console servie sur 5177 au lieu de 5174 n'est plus une
// origine autorisee par le serveur, et la connexion echoue sans raison
// visible. Un refus net vaut mieux.
const SERVICES = [
  { nom: "borne", espace: "web/borne", args: ["--strictPort"], couleur: "magenta" },
  { nom: "console", espace: "web/console", args: ["--strictPort"], couleur: "cyan" },
  { nom: "server", espace: "server", args: [], couleur: "green" },
  { nom: "backoffice", espace: "web/backoffice", args: ["--strictPort"], couleur: "yellow" },
];

const LARGEUR = Math.max(...SERVICES.map((s) => s.nom.length));

function ecrire(sortie, service, texte) {
  const etiquette = styleText(service.couleur, `${service.nom.padEnd(LARGEUR)} │`, {
    stream: sortie,
  });
  sortie.write(`${etiquette} ${texte}\n`);
}

const demandes = process.argv.slice(2);
const inconnus = demandes.filter((nom) => !SERVICES.some((s) => s.nom === nom));
if (inconnus.length > 0) {
  console.error(
    `\n  Service inconnu : ${inconnus.join(", ")}. ` +
      `Au choix : ${SERVICES.map((s) => s.nom).join(", ")}.\n`,
  );
  process.exit(1);
}
let choisis = demandes.length > 0 ? SERVICES.filter((s) => demandes.includes(s.nom)) : SERVICES;

// `npm run` donne le chemin de son propre point d'entree. Relancer npm par
// Node plutot que par `npm.cmd` evite un shell : Node refuse de lancer un
// .cmd sans shell, et un shell de plus est un processus de plus a arreter.
const NPM = process.env.npm_execpath;
if (!NPM) {
  console.error("\n  A lancer par npm :  npm run dev\n");
  process.exit(1);
}

/**
 * La base existe-t-elle, schema compris ? Le serveur cree un fichier vide
 * quand il n'en trouve pas : qu'il y ait un fichier ne prouve rien.
 */
function baseChargee() {
  // Seul DB_FILE est lu. Le reste de .env ne sort pas de cette fonction, et
  // surtout pas dans l'environnement des quatre services.
  const brut = parseEnv(readFileSync(ENV, "utf8")).DB_FILE ?? "sola.db";
  const fichier = isAbsolute(brut) ? brut : resolve(RACINE, brut);
  if (!existsSync(fichier)) return false;
  try {
    const db = new DatabaseSync(fichier, { readOnly: true });
    const table = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'residents'")
      .get();
    db.close();
    return table !== undefined;
  } catch {
    return false;
  }
}

const serveur = SERVICES.find((s) => s.nom === "server");
if (choisis.includes(serveur)) {
  // Sans .env, Node s'arrete sur un « .env: not found » qui ne dit pas quoi
  // faire. Les interfaces demarrent quand meme : elles n'en ont pas besoin.
  if (!existsSync(ENV)) {
    ecrire(
      process.stderr,
      serveur,
      "server/.env introuvable : serveur non lance. Copier server/.env.example en server/.env.",
    );
    choisis = choisis.filter((s) => s !== serveur);
  } else if (!baseChargee()) {
    ecrire(process.stderr, serveur, "base absente ou vide. Pour la charger : npm run db:reset");
  }
}
if (choisis.length === 0) process.exit(1);

// Un service qui ecrit dans un tube se croit redirige vers un fichier et
// eteint ses couleurs. On les lui rend quand ce terminal-ci les affiche.
const env = { ...process.env };
if (process.stdout.isTTY && env.NO_COLOR === undefined && env.FORCE_COLOR === undefined) {
  env.FORCE_COLOR = "1";
}

console.log(`\n  Sola : ${choisis.map((s) => s.nom).join(", ")}. Ctrl+C arrete tout.\n`);

const vivants = new Set();
let arret = false;
let echec = false;

for (const service of choisis) {
  const args = [NPM, "run", "dev", `--workspace=${service.espace}`];
  if (service.args.length > 0) args.push("--", ...service.args);

  // stdin ignore : quatre services qui liraient le meme clavier se
  // disputeraient chaque touche.
  const enfant = spawn(process.execPath, args, {
    cwd: RACINE,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  vivants.add(enfant);

  for (const [flux, sortie] of [
    [enfant.stdout, process.stdout],
    [enfant.stderr, process.stderr],
  ]) {
    createInterface({ input: flux, crlfDelay: Infinity }).on("line", (ligne) => {
      // Vite aere son bandeau de lignes vides ; a quatre, elles ne font
      // qu'etirer le journal.
      if (ligne.trim() !== "") ecrire(sortie, service, ligne);
    });
  }

  enfant.on("error", (e) => ecrire(process.stderr, service, e.message));

  // `close` plutot que `exit` : il attend que les deux tubes soient vides,
  // donc que la derniere ligne du service soit affichee avant son arret.
  enfant.on("close", (code, signal) => {
    vivants.delete(enfant);
    if (!arret) {
      if (code !== 0) echec = true;
      ecrire(process.stderr, service, `arrete (${signal ?? `code ${code}`})`);
    }
    if (vivants.size === 0) process.exitCode = echec ? 1 : 0;
  });
}

/**
 * Ctrl+C atteint deja chaque service : ils partagent ce terminal. Cet arret
 * est une ceinture de plus, pour celui qui aurait survecu.
 */
function arreter() {
  if (arret) return;
  arret = true;
  for (const enfant of vivants) {
    if (process.platform === "win32") {
      // Tuer npm laisserait vivre le Vite qu'il a lance : /T emporte l'arbre.
      spawnSync("taskkill", ["/pid", String(enfant.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      // npm relaie le signal au script qu'il a lance.
      enfant.kill("SIGTERM");
    }
  }
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, arreter);
