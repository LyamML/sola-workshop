// Cree la base du serveur de bord et charge les fichiers de db/serveur.
//
//   npm run db:load
//
// Ecrase la base existante : c'est un jeu de demonstration, pas des donnees
// de production. Le fichier est dans .gitignore.

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const DOSSIER = "db/serveur";
const FICHIER = process.env.DB_FILE ?? "sola.db";

const db = new DatabaseSync(FICHIER);
db.exec("PRAGMA foreign_keys = ON");

const fichiers = (await readdir(DOSSIER)).filter((f) => f.endsWith(".sql")).sort();

for (const fichier of fichiers) {
  const sql = await readFile(join(DOSSIER, fichier), "utf8");
  process.stdout.write(`${fichier}… `);
  try {
    // `exec` avale un fichier entier, instructions multiples comprises.
    db.exec(sql);
    console.log("ok");
  } catch (e) {
    console.error(`\n  echec dans ${fichier} :\n  ${e.message}\n`);
    db.close();
    process.exit(1);
  }
}

// Petit etat des lieux : si une table est vide alors qu'elle ne devrait pas,
// autant le voir maintenant plutot qu'a la premiere requete de la console.
const tables = db
  .prepare(
    `SELECT name FROM sqlite_master
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name`,
  )
  .all();

console.log(`\nBase ${FICHIER} — ${tables.length} tables\n`);
for (const { name } of tables) {
  const { n } = db.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get();
  console.log(`  ${String(n).padStart(4)}  ${name}`);
}

const depistage = db.prepare("SELECT * FROM v_depistage_jour").get();
console.log(
  `\nControle : ${depistage.residents} residents, indice de bien-etre ` +
    `${depistage.indice_bienetre}, PHQ-9 >= 10 chez ${depistage.pct_phq9} %.`,
);

db.close();
