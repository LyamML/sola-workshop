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
  borneToken: requis("BORNE_TOKEN"),
  // Jeton du backoffice. Distinct de celui des bornes : le backoffice peut
  // modifier des dossiers, une borne ne peut qu'ecrire des mesures. Un seul
  // jeton pour les deux donnerait a chaque cabine le droit de reassigner un
  // signal.
  adminToken: requis("ADMIN_TOKEN"),
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
if (config.adminToken.length < 32) {
  throw new Error("ADMIN_TOKEN doit faire au moins 32 caracteres.");
}
if (config.adminToken === config.borneToken) {
  throw new Error("ADMIN_TOKEN et BORNE_TOKEN doivent etre differents.");
}
