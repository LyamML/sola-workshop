#!/usr/bin/env node
/**
 * Interroge la base du serveur de bord depuis le terminal.
 *
 *   npm run db:sql                         -- la liste des tables et des vues
 *   npm run db:sql "SELECT * FROM v_depistage_jour"
 *   npm run db:sql "SELECT code, nom FROM residents LIMIT 5"
 *
 * Aucun client SQLite a installer : Node 24 embarque le moteur. C'est le
 * point important pour ce projet — un vaisseau n'installe pas d'outils, et
 * l'equipe travaille sous Windows ou `sqlite3` n'est pas fourni.
 *
 * La base s'ouvre en LECTURE SEULE. Ce script sert a regarder, et une faute
 * de frappe dans un `UPDATE` tape a la main ne doit pas pouvoir abimer le jeu
 * de demonstration la veille d'une soutenance. Pour ecrire, il y a le
 * backoffice, qui valide ce qu'il ecrit.
 */
import { DatabaseSync } from "node:sqlite";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const brut = process.env.DB_FILE ?? "sola.db";
const FICHIER = isAbsolute(brut) ? brut : resolve(RACINE, brut);

const sql = process.argv.slice(2).join(" ").trim();

let db;
try {
  db = new DatabaseSync(FICHIER, { readOnly: true });
} catch (e) {
  console.error(`\nBase introuvable ou illisible : ${FICHIER}`);
  console.error(`  ${e.message}`);
  console.error("\nChargez-la d'abord :  npm run db:reset\n");
  process.exit(1);
}

// Sans requete, on montre ce qu'il y a a interroger : c'est la question qu'on
// se pose reellement en ouvrant une base qu'on ne connait pas.
if (!sql) {
  const objets = db
    .prepare(
      `SELECT type, name FROM sqlite_master
        WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%'
        ORDER BY type DESC, name`,
    )
    .all();

  console.log(`\n  ${FICHIER}\n`);
  for (const groupe of ["table", "view"]) {
    const noms = objets.filter((o) => o.type === groupe);
    if (noms.length === 0) continue;
    console.log(`  ${groupe === "table" ? "TABLES" : "VUES"} (${noms.length})`);
    for (const { name } of noms) {
      const n = db.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get().n;
      console.log(`    ${name.padEnd(22)} ${n.toLocaleString("fr-FR").padStart(9)} lignes`);
    }
    console.log("");
  }
  console.log('  Exemple :  npm run db:sql "SELECT * FROM v_depistage_jour"\n');
  process.exit(0);
}

let lignes;
try {
  lignes = db.prepare(sql).all();
} catch (e) {
  console.error(`\n  ${e.message}\n`);
  process.exit(1);
}

if (lignes.length === 0) {
  console.log("\n  Aucune ligne.\n");
  process.exit(0);
}

// Tableau aligne a la main : `console.table` tronque les textes longs, et les
// resumes de conversation en font tous les frais.
const colonnes = Object.keys(lignes[0]);
const texte = (v) => (v === null ? "—" : String(v));
const largeur = Object.fromEntries(
  colonnes.map((c) => [
    c,
    Math.min(60, Math.max(c.length, ...lignes.map((l) => texte(l[c]).length))),
  ]),
);
const coupe = (v, n) => (v.length > n ? v.slice(0, n - 1) + "…" : v);

const barre = colonnes.map((c) => "─".repeat(largeur[c] + 2)).join("┼");
console.log("");
console.log(" " + colonnes.map((c) => ` ${c.padEnd(largeur[c])} `).join("│"));
console.log(" " + barre);
for (const l of lignes) {
  console.log(
    " " +
      colonnes
        .map((c) => {
          const v = coupe(texte(l[c]), largeur[c]);
          return typeof l[c] === "number" ? ` ${v.padStart(largeur[c])} ` : ` ${v.padEnd(largeur[c])} `;
        })
        .join("│"),
  );
}
console.log(`\n  ${lignes.length.toLocaleString("fr-FR")} ligne(s)\n`);
