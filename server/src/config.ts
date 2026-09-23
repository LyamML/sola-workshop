import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Configuration lue dans l'environnement. Aucun secret en dur dans le code :
 * `.env` n'est pas versionne, `.env.example` l'est.
 *
 * On echoue au demarrage plutot qu'a la premiere requete. Un serveur de bord
 * qui demarre a moitie configure est pire qu'un serveur qui ne demarre pas.
 */

function requis(nom: string): string {
  const valeur = process.env[nom];
  if (!valeur) {
    throw new Error(
      `Variable d'environnement manquante : ${nom}. ` +
        `Copiez server/.env.example en server/.env et renseignez-la.`,
    );
  }
  return valeur;
}

/** Racine du depot : ce fichier est dans server/src ou server/dist. */
const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function cheminBase(valeur: string): string {
  return isAbsolute(valeur) ? valeur : resolve(RACINE, valeur);
}

function entier(nom: string, defaut: number): number {
  const brut = process.env[nom];
  if (!brut) return defaut;
  const n = Number.parseInt(brut, 10);
  if (!Number.isFinite(n)) throw new Error(`${nom} doit etre un entier, recu : ${brut}`);
  return n;
}

export const config = {
  port: entier("PORT", 5175),
  jourVol: entier("JOUR_VOL", 4128),
  consoleOrigin: process.env.CONSOLE_ORIGIN ?? "http://localhost:5174",
  backofficeOrigin: process.env.BACKOFFICE_ORIGIN ?? "http://localhost:5176",
  // Seul jeton restant, et il est porte par des MACHINES : une borne de
  // cabine n'a pas de mot de passe a saisir. Les personnes — medecins et
  // administrateurs — ouvrent une session (table `sessions`), et l'ancien
  // ADMIN_TOKEN a disparu avec elle.
  borneToken: requis("BORNE_TOKEN"),
  // Porte par le bracelet quand il envoie lui-meme en Wi-Fi. Facultatif :
  // sans lui, le port reseau reste ferme et tout le serveur n'ecoute que sur
  // le poste. `||` et non `??` : la ligne vide du modele vaut « absent ».
  braceletToken: process.env.BRACELET_TOKEN || null,
  portReseau: entier("PORT_RESEAU", 5177),
  // Fichier SQLite du serveur de bord. Il se sauvegarde par copie.
  //
  // Resolu depuis la racine du depot, PAS depuis le repertoire courant : le
  // serveur demarre dans server/ et les scripts a la racine. Sans cela les
  // deux ouvrent deux fichiers differents, et le serveur lit une base vide.
  dbFile: cheminBase(process.env.DB_FILE ?? "sola.db"),
} as const;

if (config.borneToken.length < 32) {
  throw new Error("BORNE_TOKEN doit faire au moins 32 caracteres.");
}

if (config.braceletToken !== null) {
  if (config.braceletToken.length < 32) {
    throw new Error("BRACELET_TOKEN doit faire au moins 32 caracteres.");
  }
  // Le jeton du bracelet est aussi ecrit dans son code : s'il valait celui des
  // bornes, un bracelet perdu ouvrirait toutes les routes d'ecriture.
  if (config.braceletToken === config.borneToken) {
    throw new Error("BRACELET_TOKEN doit differer de BORNE_TOKEN.");
  }
}
