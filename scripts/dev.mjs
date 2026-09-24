#!/usr/bin/env node
/**
 * Lance les services de developpement dans un seul terminal.
 *
 *   npm run dev                      -- borne, console, serveur, backoffice
 *   npm run dev -- console server    -- seulement ceux-la
 *
 * Chaque ligne porte le nom du service qui l'a ecrite, et Ctrl+C arrete tout.
 * Un port que tient encore un ancien serveur Sola est libere avant le
 * lancement, et la derniere chose affichee est la liste des adresses.
 *
 * Aucune dependance, ni `concurrently` ni `npm-run-all` : le projet installe
 * le moins de choses possible, et lancer quatre processus fils n'en demande pas.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { connect } from "node:net";
import { networkInterfaces } from "node:os";
import { dirname, isAbsolute, resolve } from "node:path";
import { createInterface } from "node:readline";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as attendre } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { parseEnv, stripVTControlCharacters, styleText } from "node:util";

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENV = resolve(RACINE, "server/.env");

/**
 * Ce que ce script lit de server/.env : le fichier de la base, les ports du
 * serveur et si son port reseau s'ouvre. Rien d'autre n'en sort, et surtout
 * pas un jeton, ni ici ni dans l'environnement des quatre services.
 */
function lireEnv() {
  const fichier = existsSync(ENV) ? parseEnv(readFileSync(ENV, "utf8")) : {};
  // L'environnement l'emporte sur le fichier, meme vide, comme pour
  // `node --env-file` ; une valeur vide vaut « absente », comme dans
  // server/src/config.ts.
  const lire = (nom) => (nom in process.env ? process.env[nom] : fichier[nom]) || undefined;
  return {
    base: lire("DB_FILE") ?? "sola.db",
    port: Number(lire("PORT") ?? 5175),
    portReseau: Number(lire("PORT_RESEAU") ?? 5177),
    bracelet: lire("BRACELET_TOKEN") !== undefined,
    nutrition: lire("NUTRITION_TOKEN") !== undefined,
  };
}

const SERVEUR = lireEnv();
// Le port reseau s'ouvre avec l'un ou l'autre jeton, comme dans server/src/index.ts.
const RESEAU = SERVEUR.bracelet || SERVEUR.nutrition;

// Les ports ne sont pas passes d'ici : chaque interface fixe le sien dans son
// vite.config.ts, sans droit d'en changer, et le serveur lit les siens dans
// server/.env. Ils sont repetes pour deux usages : liberer un port qu'un
// ancien serveur tient encore, et dire a la fin ou tout repond. S'ils
// divergeaient, cette fin le dirait aussitot : un service muet sur son port.
const SERVICES = [
  { nom: "borne", espace: "web/borne", ports: [5173], role: "ecran 01", couleur: "magenta" },
  { nom: "console", espace: "web/console", ports: [5174], role: "ecrans 02 a 04", couleur: "cyan" },
  {
    nom: "server",
    espace: "server",
    ports: RESEAU ? [SERVEUR.port, SERVEUR.portReseau] : [SERVEUR.port],
    role: "l'API, pas une page",
    couleur: "green",
  },
  { nom: "backoffice", espace: "web/backoffice", ports: [5176], role: "exploitation", couleur: "yellow" },
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
// Ce qui a ete demande, pour que la liste finale dise aussi ce qui n'est pas parti.
const voulus = demandes.length > 0 ? SERVICES.filter((s) => demandes.includes(s.nom)) : SERVICES;
let choisis = voulus;

// `npm run` donne le chemin de son propre point d'entree. Relancer npm par
// Node plutot que par `npm.cmd` evite un shell : Node refuse de lancer un
// .cmd sans shell, et un shell de plus est un processus de plus a arreter.
const NPM = process.env.npm_execpath;
if (!NPM) {
  console.error("\n  A lancer par npm :  npm run dev\n");
  process.exit(1);
}

console.log(`\n  Sola : ${voulus.map((s) => s.nom).join(", ")}.\n`);

/**
 * La base existe-t-elle, schema compris ? Le serveur cree un fichier vide
 * quand il n'en trouve pas : qu'il y ait un fichier ne prouve rien.
 */
function baseChargee() {
  const fichier = isAbsolute(SERVEUR.base) ? SERVEUR.base : resolve(RACINE, SERVEUR.base);
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

// ------------------------------------------------------------- ports pris -

/** Quelqu'un ecoute-t-il sur ce port, en IPv4 ou en IPv6 ? */
function repond(port) {
  const essai = (host) =>
    new Promise((ok) => {
      const s = connect({ port, host, timeout: 500 });
      s.once("connect", () => {
        s.destroy();
        ok(true);
      });
      s.once("timeout", () => {
        s.destroy();
        ok(false);
      });
      s.once("error", () => ok(false));
    });
  // Vite n'ecoute que sur ::1 sous Windows, le serveur sur les deux boucles :
  // l'une ou l'autre suffit a prendre le port.
  return Promise.all([essai("127.0.0.1"), essai("::1")]).then((r) => r.includes(true));
}

/** Un port se rend un instant apres son processus : trois secondes au plus. */
async function liberes(ports) {
  for (let i = 0; i < 12; i++) {
    if (!(await Promise.all(ports.map(repond))).includes(true)) return true;
    await attendre(250);
  }
  return false;
}

/**
 * Qui ecoute sur ces ports, et la table des processus pour remonter a qui
 * l'a lance. Get-NetTCPConnection plutot que netstat, qui traduit ses
 * colonnes dans la langue du poste. `null` si PowerShell ne repond pas.
 */
function tenants(ports) {
  const script = [
    "[Console]::OutputEncoding = [Text.Encoding]::UTF8",
    `$ecoute = @(Get-NetTCPConnection -State Listen -LocalPort ${ports.join(",")} -ErrorAction SilentlyContinue |
      ForEach-Object { @{ port = $_.LocalPort; pid = $_.OwningProcess } })`,
    `$proc = @(Get-CimInstance Win32_Process | ForEach-Object { @{ pid = $_.ProcessId;
      parent = $_.ParentProcessId; nom = $_.Name; ligne = $_.CommandLine;
      debut = $(if ($_.CreationDate) { $_.CreationDate.ToString('s') }) } })`,
    "ConvertTo-Json -Compress -Depth 3 -InputObject @{ ecoute = $ecoute; proc = $proc }",
  ].join("\n");
  const r = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  try {
    const { ecoute, proc } = JSON.parse(r.stdout);
    return {
      ecoute: new Map(ecoute.map((e) => [e.port, e.pid])),
      proc: new Map(proc.map((p) => [p.pid, p])),
    };
  } catch {
    return null;
  }
}

const DEPOT = `${RACINE.replaceAll("\\", "/").toLowerCase()}/`;

/**
 * Un serveur Sola : un Node lance depuis ce depot. Ni un editeur ouvert sur
 * le dossier, ni le Node d'un autre projet ne repondent a cette definition.
 */
function deSola(p) {
  return (
    p !== undefined &&
    /^node(\.exe)?$/i.test(p.nom) &&
    (p.ligne ?? "").replaceAll("\\", "/").toLowerCase().includes(DEPOT)
  );
}

/**
 * Le plus haut ancetre qui soit encore un serveur Sola. Le port est tenu par
 * le serveur lui-meme, mais sous `tsx watch` son parent le relancerait a la
 * prochaine sauvegarde : c'est l'arbre entier qu'il faut arreter.
 */
function sommet(p, proc) {
  for (let i = 0; i < 8 && deSola(proc.get(p.parent)); i++) p = proc.get(p.parent);
  return p;
}

/** « a 09:08 » s'il date d'aujourd'hui, « le 22/09 a 17:35 » sinon. */
function quand(iso) {
  const d = new Date(iso ?? "");
  if (Number.isNaN(d.getTime())) return "plus tot";
  const heure = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === new Date().toDateString()) return `a ${heure}`;
  return `le ${d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })} a ${heure}`;
}

/**
 * Un port que tient encore un serveur Sola — un terminal oublie, l'apercu
 * qu'un agent a lance — est libere : c'est ce lancement-ci qu'on demande.
 * Tenu par autre chose, on n'y touche pas, et son service ne part pas.
 */
async function liberer(services) {
  const pris = [];
  for (const service of services) {
    for (const port of service.ports) if (await repond(port)) pris.push({ service, port });
  }
  if (pris.length === 0) return services;

  const refuses = new Set();
  const refuser = (service, raison) => {
    refuses.add(service);
    ecrire(process.stderr, service, `${raison} : service non lance.`);
  };

  const table = process.platform === "win32" ? tenants(pris.map((p) => p.port)) : null;
  // Le serveur tient deux ports : il s'arrete une fois, et on le dit une fois.
  const cibles = new Map();
  for (const { service, port } of pris) {
    const tenant = table?.proc.get(table.ecoute.get(port));
    if (!deSola(tenant)) {
      refuser(
        service,
        tenant
          ? `port ${port} pris par ${tenant.nom} (PID ${tenant.pid}), qui n'est pas un serveur Sola`
          : `port ${port} deja pris, par un processus introuvable`,
      );
      continue;
    }
    const cible = sommet(tenant, table.proc);
    const entree = cibles.get(cible.pid) ?? { cible, service, ports: [] };
    entree.ports.push(port);
    cibles.set(cible.pid, entree);
  }

  for (const { cible, service, ports } of cibles.values()) {
    if (refuses.has(service)) continue;
    const designe = `${ports.length > 1 ? "les ports" : "le port"} ${ports.join(" et ")}`;
    const arret = spawnSync("taskkill", ["/pid", String(cible.pid), "/T", "/F"], {
      stdio: "ignore",
    });
    if (arret.status !== 0 || !(await liberes(ports))) {
      refuser(service, `un serveur Sola (PID ${cible.pid}) tient ${designe} et ne s'arrete pas`);
      continue;
    }
    ecrire(
      process.stderr,
      service,
      `un serveur Sola lance ${quand(cible.debut)} tenait encore ${designe} (PID ${cible.pid}) : arrete.`,
    );
  }
  return services.filter((s) => !refuses.has(s));
}

choisis = await liberer(choisis);
if (choisis.length === 0) process.exit(1);

// ---------------------------------------------------------------- lancement -

// Un service qui ecrit dans un tube se croit redirige vers un fichier et
// eteint ses couleurs. On les lui rend quand ce terminal-ci les affiche.
const env = { ...process.env };
if (process.stdout.isTTY && env.NO_COLOR === undefined && env.FORCE_COLOR === undefined) {
  env.FORCE_COLOR = "1";
}

// Le bandeau de Vite — version, adresse, « use --host » — redit pour chaque
// interface ce que la liste finale dit une fois pour toutes.
const BANDEAU = /^\s*(VITE v\d|➜\s+(Local|Network):)/;

const vivants = new Set();
const lances = [];
let arret = false;
let echec = false;

for (const service of choisis) {
  // --silent : npm tait l'en-tete « > @sola/borne dev » de chaque service, et
  // sa propre plainte quand l'un s'arrete — la ligne « arrete » la dit deja.
  const args = [NPM, "run", "dev", "--silent", `--workspace=${service.espace}`];

  // stdin ignore : quatre services qui liraient le meme clavier se
  // disputeraient chaque touche.
  const enfant = spawn(process.execPath, args, {
    cwd: RACINE,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  vivants.add(enfant);
  lances.push({ service, enfant });

  for (const [flux, sortie] of [
    [enfant.stdout, process.stdout],
    [enfant.stderr, process.stderr],
  ]) {
    createInterface({ input: flux, crlfDelay: Infinity }).on("line", (ligne) => {
      // Vite aere son bandeau de lignes vides ; a quatre, elles ne font
      // qu'etirer le journal.
      if (ligne.trim() === "" || BANDEAU.test(stripVTControlCharacters(ligne))) return;
      ecrire(sortie, service, ligne);
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

// ------------------------------------------------------------ liste finale -

/** `true` quand chaque port du service repond, `false` s'il s'arrete ou tarde. */
async function pret(service, enfant) {
  const limite = Date.now() + 15_000;
  while (enfant.exitCode === null && enfant.signalCode === null && Date.now() < limite) {
    if (!(await Promise.all(service.ports.map(repond))).includes(false)) return true;
    await attendre(250);
  }
  return false;
}

/** Les adresses du poste sur ses reseaux, filtrees comme adressesLocales() du serveur. */
function adressesReseau() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal && !i.address.startsWith("169.254."))
    .map((i) => i.address);
}

const etats = new Map(
  await Promise.all(lances.map(async ({ service, enfant }) => [service, await pret(service, enfant)])),
);

if (!arret) {
  const rangs = [];
  for (const service of voulus) {
    const rang = (nom, adresse, role = "") =>
      rangs.push({ couleur: service.couleur, nom, adresse, role });
    const etat = etats.get(service);
    if (etat === undefined) rang(service.nom, "non lance : voir plus haut");
    else if (!etat) rang(service.nom, "ne repond pas : voir ses lignes plus haut");
    else {
      rang(service.nom, `http://localhost:${service.ports[0]}`, service.role);
      // Le second port du serveur, celui que le bracelet et l'equipe nutrition
      // joignent depuis le Wi-Fi.
      if (service === serveur && RESEAU) {
        const ips = adressesReseau();
        if (ips.length === 0) rang("reseau", `port ${SERVEUR.portReseau}, mais aucun reseau trouve`);
        for (const ip of ips) {
          const base = `http://${ip}:${SERVEUR.portReseau}`;
          if (SERVEUR.bracelet) rang("bracelet", `${base}/ingest/bracelet`, "le meme serveur, depuis le Wi-Fi");
          if (SERVEUR.nutrition) {
            rang("nutrition", `${base}/partenaires/nutrition/bilans`, "moyennes des bilans, pour l'autre equipe");
          }
        }
      }
    }
  }
  const large = Math.max(0, ...rangs.filter((r) => r.role).map((r) => r.adresse.length));
  console.log("\n  Adresses :");
  for (const r of rangs) {
    const nom = styleText(r.couleur, r.nom.padEnd(LARGEUR), { stream: process.stdout });
    const suite = r.role ? `${r.adresse.padEnd(large)}   ${r.role}` : r.adresse;
    console.log(`    ${nom}  ${suite}`);
  }
  console.log("\n  Ctrl+C arrete tout.\n");
}
