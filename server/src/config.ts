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
  borneToken: requis("BORNE_TOKEN"),
  db: {
    host: process.env.DB_HOST ?? "127.0.0.1",
    port: entier("DB_PORT", 3306),
    user: requis("DB_USER"),
    password: requis("DB_PASSWORD"),
    database: process.env.DB_NAME ?? "sola",
  },
} as const;

if (config.borneToken.length < 32) {
  throw new Error("BORNE_TOKEN doit faire au moins 32 caracteres.");
}
