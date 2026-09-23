/**
 * Mise en forme des nombres et des dates, partagée par les quatre écrans.
 *
 * Le serveur renvoie des valeurs brutes ; « 6 240 », « J+4 128 » ou « 5 h 18 »
 * sont de la présentation. Une seule définition, pour qu'un même chiffre ne
 * s'écrive pas de deux façons d'un écran à l'autre.
 */

// `toLocaleString` sépare les milliers par une espace fine insécable (U+202F)
// que la police de la console ne rend pas. On la remplace par une espace
// insécable ordinaire : même rôle typographique, mais visible.
const espaces = (t: string) => t.replace(/ /g, " ");

/** « 72,4 », à décimales fixes. Une valeur absente s'écrit « — », jamais 0. */
export function fr(v: number | null | undefined, decimales = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return espaces(
    v.toLocaleString("fr-FR", {
      minimumFractionDigits: decimales,
      maximumFractionDigits: decimales,
    }),
  );
}

/** « 1 240 ». */
export const entier = (v: number | null | undefined) => fr(v, 0);

/**
 * Au plus `decimales` décimales : « 62 », « 61,4 ». Pour une constante que le
 * bracelet donne tantôt entière, tantôt à une décimale : « 62,0 » ferait
 * croire à une précision que la mesure n'a pas.
 */
export function frMax(v: number | null | undefined, decimales = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return espaces(v.toLocaleString("fr-FR", { maximumFractionDigits: decimales }));
}

/** Décimales seulement si la valeur en a : « 0,4 », « 150 », « 4,49 ». */
export function nombreLibre(v: number): string {
  return espaces(v.toLocaleString("fr-FR", { maximumFractionDigits: 3 }));
}

/** « J+4 128 » : le calendrier de bord, celui que tout le monde lit. */
export const jv = (jourVol: number) => `J+${entier(jourVol)}`;

/** Minutes vers « 5 h 18 » : personne ne lit un sommeil en 318 minutes. */
export function duree(min: number | null | undefined): string {
  if (min === null || min === undefined) return "—";
  const m = Math.round(min);
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`;
}

/** « 2026-09-23 16:04:00 » → « 16:04 ». */
export const heure = (iso: string | null | undefined) => (iso ? iso.slice(11, 16) : "—");

/** « 2026-09-23… » → « 23/09 ». */
export function dateCourte(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [, mois, jour] = iso.slice(0, 10).split("-");
  return jour && mois ? `${jour}/${mois}` : iso;
}

/**
 * « 16:04 » le jour même, « 22/09 16:04 » sinon.
 *
 * « Le jour même » est le jour courant de la base, pas l'horloge du poste :
 * le jeu de démonstration doit se lire pareil le lendemain de sa génération.
 */
export function horodatage(iso: string | null | undefined, jourCourant: string): string {
  if (!iso) return "—";
  return iso.slice(0, 10) === jourCourant ? heure(iso) : `${dateCourte(iso)} ${heure(iso)}`;
}

/** Accord d'un nom compté : « 1 nuit », « 5 nuits ». */
export const pluriel = (n: number, mot: string, motPluriel = `${mot}s`) =>
  `${entier(n)} ${n > 1 ? motPluriel : mot}`;
