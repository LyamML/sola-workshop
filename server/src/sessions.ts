import { createHash, randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import { ecrire, requete } from "./db.js";

/**
 * Sessions des comptes medecin et administrateur.
 *
 *  Le navigateur recoit un jeton de 32 octets dans un cookie `httpOnly`. La
 *  base, elle, ne garde que son empreinte SHA-256 : une copie du fichier
 *  `sola.db` ne donne donc aucune session ouverte, exactement comme une copie
 *  ne donne aucun mot de passe. C'est la meme idee que `mdp_hash`, appliquee
 *  a la cle de session.
 *
 *  SHA-256 suffit ici, la ou il ne suffirait pas pour un mot de passe : le
 *  jeton est tire au hasard sur 256 bits, il n'y a pas de dictionnaire a
 *  essayer. Ce qu'argon2 achete — la lenteur — n'aurait aucun sens.
 *
 *  `httpOnly` : aucun script de la page ne peut lire le cookie, contrairement
 *  au jeton d'administration qu'il remplace et qui vivait dans le
 *  `sessionStorage`.
 */

/** Douze heures : un quart. Au-dela, on se reconnecte. */
const DUREE_H = 12;

export const COOKIE = "sola_session";

export type Role = "medecin" | "admin";

export interface Compte {
  role: Role;
  id: number;
  prenom: string;
  nom: string;
  email: string;
  /** Matricule M-007 — les medecins seuls en ont un. */
  code: string | null;
  titre: string | null;
}

function empreinte(jeton: string): string {
  return createHash("sha256").update(jeton).digest("hex");
}

/**
 * Ouvre une session et renvoie le jeton BRUT, le seul moment ou il existe en
 * clair. L'appelant le pose dans le cookie et l'oublie.
 */
export function ouvrir(role: Role, id: number): string {
  const jeton = randomBytes(32).toString("base64url");
  ecrire(
    `INSERT INTO sessions (id, medecin_id, admin_id, expire_at)
     VALUES (:id, :medecin, :admin, datetime('now', :duree))`,
    {
      id: empreinte(jeton),
      medecin: role === "medecin" ? id : null,
      admin: role === "admin" ? id : null,
      duree: `+${DUREE_H} hours`,
    },
  );
  ecrire(
    role === "medecin"
      ? "UPDATE medecins SET derniere_connexion = datetime('now') WHERE id = :id"
      : "UPDATE admins SET derniere_connexion = datetime('now') WHERE id = :id",
    { id },
  );
  return jeton;
}

/**
 * Resout un jeton de cookie en compte, ou `null`.
 *
 * Les jointures portent `actif = 1` : desactiver un compte ferme ses sessions
 * en cours, sans avoir a les retrouver une par une.
 */
export function lire(jeton: string | null): Compte | null {
  if (!jeton) return null;
  const id = empreinte(jeton);

  const ligne = requete<{
    role: Role;
    compte_id: number;
    prenom: string;
    nom: string;
    email: string;
    code: string | null;
    titre: string | null;
  }>(
    `SELECT 'medecin' AS role, m.id AS compte_id, m.prenom, m.nom, m.email,
            m.code, m.titre
       FROM sessions s JOIN medecins m ON m.id = s.medecin_id
      WHERE s.id = :id AND s.expire_at > datetime('now') AND m.actif = 1
     UNION ALL
     SELECT 'admin', a.id, a.prenom, a.nom, a.email, NULL, NULL
       FROM sessions s JOIN admins a ON a.id = s.admin_id
      WHERE s.id = :id AND s.expire_at > datetime('now') AND a.actif = 1`,
    { id },
  )[0];

  if (!ligne) return null;

  // Trace de derniere activite : utile pour lister les sessions ouvertes sans
  // avoir a interroger chaque navigateur.
  ecrire("UPDATE sessions SET vue_at = datetime('now') WHERE id = :id", { id });

  return {
    role: ligne.role,
    id: ligne.compte_id,
    prenom: ligne.prenom,
    nom: ligne.nom,
    email: ligne.email,
    code: ligne.code,
    titre: ligne.titre,
  };
}

export function fermer(jeton: string | null): void {
  if (!jeton) return;
  ecrire("DELETE FROM sessions WHERE id = :id", { id: empreinte(jeton) });
}

/** Les sessions expirees ne servent plus a rien : on ne les garde pas. */
export function purger(): number {
  return ecrire("DELETE FROM sessions WHERE expire_at <= datetime('now')").changes;
}

// ----------------------------------------------------------------- cookie ---
/**
 * Lecture du cookie a la main plutot qu'avec `cookie-parser` : une dependance
 * de plus pour dix lignes, sur un projet qui en installe le moins possible.
 */
export function jetonDuCookie(req: Request): string | null {
  const brut = req.headers.cookie;
  if (!brut) return null;
  for (const morceau of brut.split(";")) {
    const separateur = morceau.indexOf("=");
    if (separateur === -1) continue;
    if (morceau.slice(0, separateur).trim() !== COOKIE) continue;
    return decodeURIComponent(morceau.slice(separateur + 1).trim());
  }
  return null;
}

/**
 * `sameSite: "strict"` suffit bien que la console soit servie sur un autre
 * port : le port n'entre pas dans le calcul du « meme site », seul le nom de
 * domaine compte, et tout tourne sur `localhost`. Le cookie part donc avec
 * les requetes de la console et du backoffice, et avec rien d'autre.
 *
 * `secure` est laisse a l'appreciation de l'environnement : en developpement
 * le serveur est en clair sur `localhost`, et un cookie `Secure` n'y serait
 * jamais envoye. Derriere HTTPS, `COOKIE_SECURE=1`.
 */
export function poserCookie(res: Response, jeton: string): void {
  res.cookie(COOKIE, jeton, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.COOKIE_SECURE === "1",
    path: "/",
    maxAge: DUREE_H * 3600 * 1000,
  });
}

export function effacerCookie(res: Response): void {
  res.clearCookie(COOKIE, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.COOKIE_SECURE === "1",
    path: "/",
  });
}
