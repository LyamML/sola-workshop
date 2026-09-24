// Démarre le serveur de bord dans son conteneur.
//
// Au premier démarrage, le volume est vide : on y crée la base comme
// `npm run db:reset` le ferait sur un poste — schéma, vues, jeu de
// démonstration. Ensuite on n'y touche plus : redémarrer un conteneur ne doit
// jamais effacer ce qu'on y a saisi. Pour repartir de zéro, on supprime le
// volume (`docker compose down --volumes`) ; ce script ne réécrit jamais une
// base qui existe.

import { spawnSync } from "node:child_process";
import { existsSync, renameSync, rmSync } from "node:fs";

const base = process.env.DB_FILE ?? "sola.db";

if (!existsSync(base)) {
  // Construite à côté, puis renommée d'un coup : un conteneur arrêté pendant
  // la génération laisse un brouillon qu'on recommence, jamais une base à
  // moitié remplie que le serveur servirait comme si de rien n'était.
  const brouillon = `${base}.brouillon`;
  for (const suffixe of ["", "-wal", "-shm"]) rmSync(brouillon + suffixe, { force: true });

  for (const script of ["scripts/db-load.mjs", "scripts/db-demo.mjs"]) {
    const { status } = spawnSync(process.execPath, [script], {
      stdio: "inherit",
      env: { ...process.env, DB_FILE: brouillon },
    });
    if (status !== 0) process.exit(status ?? 1);
  }
  renameSync(brouillon, base);
}

await import("../server/dist/index.js");
