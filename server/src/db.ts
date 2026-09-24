import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { config } from "./config.js";

/**
 * Base du serveur de bord, en SQLite.
 *
 * SQLite plutot que MySQL parce que le vaisseau n'a pas d'administrateur de
 * base de donnees : un fichier qui se sauvegarde par copie vaut mieux qu'un
 * service a maintenir. Node 24 embarque `node:sqlite`, donc zero dependance.
 *
 * L'API est SYNCHRONE. Ce n'est pas un oubli : SQLite lit depuis un fichier
 * local, et l'asynchronisme n'apporterait ici que de la complexite.
 */
export const db = new DatabaseSync(config.dbFile);

// Les cles etrangeres sont desactivees par defaut dans SQLite — sans cette
// ligne, toutes les contraintes du schema seraient decoratives.
db.exec("PRAGMA foreign_keys = ON");
// WAL : un lecteur (la console) ne bloque plus un ecrivain (une borne).
db.exec("PRAGMA journal_mode = WAL");
// Laisse 5 s a une ecriture concurrente avant d'abandonner, au lieu d'echouer
// immediatement quand deux bornes ecrivent en meme temps.
db.exec("PRAGMA busy_timeout = 5000");

export type Params = Record<string, SQLInputValue>;

// `prepare` recompile la requete a chaque appel : on garde les instructions
// preparees, elles sont reutilisables telles quelles.
const cache = new Map<string, ReturnType<DatabaseSync["prepare"]>>();

function prepare(sql: string) {
  let stmt = cache.get(sql);
  if (!stmt) {
    stmt = db.prepare(sql);
    cache.set(sql, stmt);
  }
  return stmt;
}

/**
 * SQLite n'a pas de type booleen : `true` leve une erreur a la liaison. On
 * convertit en 0/1 ici plutot que dans chaque appelant, ou l'oubli serait
 * silencieux jusqu'a l'execution.
 */
export function lier(params: Record<string, unknown>): Params {
  const sortie: Params = {};
  for (const [cle, valeur] of Object.entries(params)) {
    if (typeof valeur === "boolean") sortie[cle] = valeur ? 1 : 0;
    else if (valeur === undefined) sortie[cle] = null;
    else sortie[cle] = valeur as SQLInputValue;
  }
  return sortie;
}

export function requete<T>(sql: string, params: Record<string, unknown> = {}): T[] {
  return prepare(sql).all(lier(params)) as T[];
}

export function ecrire(
  sql: string,
  params: Record<string, unknown> = {},
): { changes: number; lastInsertRowid: number } {
  const r = prepare(sql).run(lier(params));
  return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
}

/**
 * Execute `travail` dans une transaction. Tout ou rien : une conversation dont
 * les etiquettes echouent ne doit pas rester en base a moitie enregistree.
 */
export function transaction<T>(travail: () => T): T {
  db.exec("BEGIN");
  try {
    const resultat = travail();
    db.exec("COMMIT");
    return resultat;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export function ping(): boolean {
  try {
    db.prepare("SELECT COUNT(*) AS n FROM residents").get();
    return true;
  } catch {
    return false;
  }
}

/**
 * 'YYYY-MM-DD HH:MM:SS' a l'heure locale du serveur : l'heure de bord.
 *
 * La chronologie clinique — signaux, conversations, evenements, clotures —
 * s'ecrit ainsi, comme le jeu de demonstration, et la console l'affiche telle
 * quelle. En UTC, une alerte remontee a 11:34 s'affichait 09:34, et passait
 * dans la file avant des signaux ouverts plus tot qu'elle. Les minutes du
 * bracelet (`mesures`, `synchro_at`) restent en UTC : `direct.ts` les sert
 * avec leur « Z ».
 */
export function heureDeBord(quand: Date | string = new Date()): string {
  const d = typeof quand === "string" ? new Date(quand) : quand;
  const p = (x: number) => String(x).padStart(2, "0");
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  );
}

/**
 * Le statut d'un resident suit ses signaux ouverts : critique s'il en reste
 * un critique, surveillance s'il en reste un autre, ok sinon. Des EXISTS et
 * non un MIN sur les gravites : sur un ensemble vide, MIN rend NULL, et un
 * resident sans signal serait retombe en surveillance.
 *
 * Appele a chaque ouverture comme a chaque cloture : sans cela, un resident
 * pour qui la borne vient d'ouvrir un signal critique restait « ok » a
 * l'ecran 04.
 */
export function recalculerStatut(residentId: number): void {
  ecrire(
    `UPDATE residents
        SET statut = CASE
              WHEN EXISTS (SELECT 1 FROM signaux
                            WHERE resident_id = :rid AND statut <> 'clos'
                              AND severite = 'critique') THEN 'critique'
              WHEN EXISTS (SELECT 1 FROM signaux
                            WHERE resident_id = :rid AND statut <> 'clos') THEN 'surveillance'
              ELSE 'ok'
            END,
            updated_at = datetime('now')
      WHERE id = :rid`,
    { rid: residentId },
  );
}

/** Resout un code resident ("R-0448") en identifiant interne. */
export function residentId(code: string): number | null {
  const ligne = requete<{ id: number }>(
    "SELECT id FROM residents WHERE code = :code",
    { code },
  )[0];
  return ligne?.id ?? null;
}
