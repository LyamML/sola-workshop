import mysql from "mysql2/promise";
import type { ExecuteValues } from "mysql2";
import { config } from "./config.js";

/**
 * Pool de connexions MySQL.
 *
 * `namedPlaceholders` permet d'ecrire `:resident` dans les requetes : les
 * valeurs passent toujours par le protocole prepare, jamais par concatenation.
 * C'est la seule protection contre l'injection SQL qui tienne, et elle est
 * active par defaut ici pour qu'on n'ait pas a y penser a chaque requete.
 */
export const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  waitForConnections: true,
  connectionLimit: 10,
  namedPlaceholders: true,
  timezone: "Z",
  // La borne envoie des nombres, on veut des nombres en retour : sans cela
  // mysql2 rend les DECIMAL sous forme de chaines et les graphiques cassent.
  decimalNumbers: true,
});

/**
 * Valeurs nommees d'une requete preparee. `ExecuteValues` est le type que
 * mysql2 accepte reellement : s'y tenir evite d'avoir a caster, et refuse a la
 * compilation un `undefined` qui deviendrait un NULL silencieux en base.
 */
export type Params = Record<string, ExecuteValues>;

export async function requete<T>(sql: string, params: Params = {}): Promise<T[]> {
  const [lignes] = await pool.execute(sql, params);
  return lignes as T[];
}

export async function ping(): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

/** Resout un code resident ("R-0448") en identifiant interne. */
export async function residentId(code: string): Promise<number | null> {
  const lignes = await requete<{ id: number }>(
    "SELECT id FROM residents WHERE code = :code",
    { code },
  );
  return lignes[0]?.id ?? null;
}
