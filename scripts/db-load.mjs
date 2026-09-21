// Charge les fichiers SQL de db/mysql dans la base, dans l'ordre.
//
//   node --env-file=server/.env scripts/db-load.mjs
//
// Passe par mysql2 plutot que par le client `mysql` en ligne de commande, qui
// n'est pas toujours installe sous Windows. `DELIMITER` est une directive du
// client, pas du serveur : on la traite ici, comme le ferait le client.

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import mysql from "mysql2/promise";

const DOSSIER = "db/mysql";

/** Decoupe un fichier SQL en instructions, en respectant DELIMITER. */
function instructions(sql) {
  const sorties = [];
  let delimiteur = ";";
  let courante = "";

  for (const ligne of sql.split(/\r?\n/)) {
    const change = ligne.match(/^\s*DELIMITER\s+(\S+)\s*$/i);
    if (change) {
      if (courante.trim()) sorties.push(courante.trim());
      courante = "";
      delimiteur = change[1];
      continue;
    }
    courante += ligne + "\n";
    if (courante.trimEnd().endsWith(delimiteur)) {
      const texte = courante.trimEnd().slice(0, -delimiteur.length).trim();
      if (texte) sorties.push(texte);
      courante = "";
    }
  }
  if (courante.trim()) sorties.push(courante.trim());
  return sorties;
}

const connexion = await mysql.createConnection({
  host: process.env.DB_HOST ?? "127.0.0.1",
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  multipleStatements: false,
});

const fichiers = (await readdir(DOSSIER)).filter((f) => f.endsWith(".sql")).sort();

for (const fichier of fichiers) {
  const sql = await readFile(join(DOSSIER, fichier), "utf8");
  const lot = instructions(sql);
  process.stdout.write(`${fichier} — ${lot.length} instructions… `);
  for (const [i, requete] of lot.entries()) {
    try {
      await connexion.query(requete);
    } catch (e) {
      console.error(`\n  echec a l'instruction ${i + 1} de ${fichier} :\n  ${e.message}\n`);
      console.error(requete.slice(0, 400));
      await connexion.end();
      process.exit(1);
    }
  }
  console.log("ok");
}

await connexion.end();
console.log("\nBase chargee. Verifiez avec : SELECT * FROM sola.v_depistage_jour;");
