/**
 * Fige deux réponses du serveur de bord pour le repli de la console.
 *
 *   npm run db:repli                 écrit web/console/src/data/*.json
 *   npm run db:repli -- --verifier   compare seulement ; code 1 s'ils ont dérivé
 *
 * Serveur éteint, les écrans 02 et 03 s'affichent avec ces deux fichiers. Ils
 * sont écrits par les fonctions mêmes qui servent `/api/crew` et
 * `/api/residents/:code`, puis passent dans la console par le même
 * adaptateur : le repli n'est pas un second jeu de chaînes tenu à la main,
 * c'est une réponse de la base, figée. Il n'y a donc plus rien à accorder
 * entre deux fichiers — seulement à relancer ce script quand la base change.
 *
 * À relancer après `npm run db:reset` ou une modification du générateur ; le
 * mode `--verifier` dit si c'est nécessaire, sans rien écrire. Même sans
 * changer une ligne du générateur : le jeu de démonstration date ses lignes du
 * jour où il est généré, et une base régénérée un autre jour décale toutes les
 * dates du repli.
 *
 * Sur une base fraîche seulement : le repli est commité, dans un dépôt public,
 * et tout ce que la base contient au moment où il est figé — une note d'essai,
 * un signal clos pour voir, les trames d'un bracelet — le serait avec lui.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// La fiche que montrent les maquettes, et la seule que le repli contient.
const FICHE = "R-0448";

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DOSSIER = resolve(RACINE, "web/console/src/data");

// Le TypeScript du serveur se charge tel quel, par tsx : le script lit la base
// avec le code qui la sert, pas avec une copie de ses requêtes.
const { lireCrew, lireResident } = await import("../server/src/routes/console.ts");

const fiche = lireResident(FICHE);
if (!fiche) {
  console.error(`Aucun résident ${FICHE} dans la base : lancez d'abord npm run db:reset.`);
  process.exit(1);
}

const fichiers = [
  ["crew.json", lireCrew()],
  ["resident.json", fiche],
];

const verifier = process.argv.includes("--verifier");
let derives = 0;

for (const [nom, contenu] of fichiers) {
  const chemin = resolve(DOSSIER, nom);
  const texte = `${JSON.stringify(contenu, null, 2)}\n`;
  if (verifier) {
    let actuel = null;
    try {
      actuel = readFileSync(chemin, "utf8");
    } catch {
      // absent : compté comme dérivé ci-dessous
    }
    if (actuel !== texte) {
      derives += 1;
      console.log(`${nom} : ne correspond plus à la base.`);
    } else {
      console.log(`${nom} : à jour.`);
    }
  } else {
    writeFileSync(chemin, texte);
    console.log(`${nom} : ${Math.round(texte.length / 1024)} Ko écrits.`);
  }
}

if (verifier && derives) console.log("Relancez npm run db:repli pour les réécrire.");
// `db.ts` garde la base ouverte : on sort explicitement.
process.exit(verifier && derives ? 1 : 0);
