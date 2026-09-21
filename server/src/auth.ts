import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { config } from "./config.js";

/**
 * Authentification des bornes de cabine.
 *
 * Une borne presente un jeton porteur pour ecrire dans la base. La comparaison
 * est a temps constant : comparer deux chaines avec `===` fuit la longueur du
 * prefixe correct, ce qui suffit a retrouver un jeton octet par octet.
 *
 * Limites assumees du prototype, a lever avant tout usage reel :
 *   · un seul jeton pour toutes les bornes — il faudrait une cle par borne,
 *     revocable individuellement ;
 *   · pas de mTLS, donc rien ne prouve que la borne est bien un materiel de
 *     bord et non un portable branche sur le reseau du vaisseau ;
 *   · pas de limitation de debit — une borne compromise peut noyer la base.
 */
const attendu = Buffer.from(config.borneToken, "utf8");

export function authBorne(req: Request, res: Response, next: NextFunction): void {
  const entete = req.header("authorization") ?? "";
  const presente = entete.startsWith("Bearer ") ? entete.slice(7) : "";
  const fourni = Buffer.from(presente, "utf8");

  // timingSafeEqual exige deux tampons de meme longueur : on teste la longueur
  // d'abord, ce qui ne fuit que la longueur du jeton, pas son contenu.
  const valide = fourni.length === attendu.length && timingSafeEqual(fourni, attendu);

  if (!valide) {
    res.status(401).json({ erreur: "Jeton de borne invalide." });
    return;
  }
  next();
}
