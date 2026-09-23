import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { config } from "./config.js";
import { type Compte, jetonDuCookie, lire } from "./sessions.js";

/**
 * Deux portes, et elles ne se ressemblent pas.
 *
 *   · une BORNE est une machine : elle presente un jeton porteur, elle n'a ni
 *     mot de passe a saisir ni session a ouvrir ;
 *   · un MEDECIN ou un ADMINISTRATEUR est une personne : il ouvre une session,
 *     et c'est cette session qui signe ce qu'il ecrit.
 *
 * Le jeton d'administration partage a disparu avec la table `admins`. Il
 * prouvait qu'on connaissait une cle, jamais qu'on etait quelqu'un — et il
 * vivait dans le `sessionStorage` du navigateur, lisible par n'importe quel
 * script injecte dans la page.
 */

/** Verifie un jeton porteur a temps constant. */
function porteurValide(entete: string, attendu: Buffer): boolean {
  const presente = entete.startsWith("Bearer ") ? entete.slice(7) : "";
  const fourni = Buffer.from(presente, "utf8");
  // timingSafeEqual exige deux tampons de meme longueur : on teste la longueur
  // d'abord, ce qui ne fuit que la longueur du jeton, pas son contenu.
  return fourni.length === attendu.length && timingSafeEqual(fourni, attendu);
}

const jetonBorne = Buffer.from(config.borneToken, "utf8");

/**
 * Authentification des bornes de cabine.
 *
 * La comparaison est a temps constant : comparer deux chaines avec `===` fuit
 * la longueur du prefixe correct, ce qui suffit a retrouver un jeton octet
 * par octet.
 *
 * Limites assumees du prototype, a lever avant tout usage reel :
 *   · un seul jeton pour toutes les bornes — il faudrait une cle par borne,
 *     revocable individuellement ;
 *   · pas de mTLS, donc rien ne prouve que la borne est bien un materiel de
 *     bord et non un portable branche sur le reseau du vaisseau ;
 *   · pas de limitation de debit — une borne compromise peut noyer la base.
 */
export function authBorne(req: Request, res: Response, next: NextFunction): void {
  if (!porteurValide(req.header("authorization") ?? "", jetonBorne)) {
    res.status(401).json({ erreur: "Jeton de borne invalide." });
    return;
  }
  next();
}

const jetonBracelet = config.braceletToken ? Buffer.from(config.braceletToken, "utf8") : null;

/**
 * Authentification du bracelet qui envoie lui-meme en Wi-Fi, sur le port
 * reseau.
 *
 * Un jeton a part plutot que celui des bornes : celui-ci est aussi ecrit dans
 * le code du bracelet, et un bracelet se perd plus facilement qu'une borne.
 * Il n'ouvre donc que l'ecriture des trames, jamais une conversation ni un
 * evenement.
 */
export function authBracelet(req: Request, res: Response, next: NextFunction): void {
  if (!jetonBracelet || !porteurValide(req.header("authorization") ?? "", jetonBracelet)) {
    res.status(401).json({ erreur: "Jeton de bracelet invalide." });
    return;
  }
  next();
}

/**
 * Le compte de la requete en cours.
 *
 * Range dans `res.locals` plutot que sur `req` : pas d'augmentation du type
 * d'Express a maintenir, et l'acces passe par une fonction typee.
 */
export function compte(res: Response): Compte | null {
  return (res.locals.compte as Compte | undefined) ?? null;
}

/** Resout la session si elle existe, sans jamais refuser la requete. */
export function session(req: Request, res: Response, next: NextFunction): void {
  res.locals.compte = lire(jetonDuCookie(req)) ?? undefined;
  next();
}

/**
 * Console medicale : un medecin, ou un administrateur.
 *
 * L'administrateur y entre parce qu'il doit pouvoir constater a l'ecran ce
 * qu'il corrige en base — mais il n'y signe rien : `auteur_id` n'accepte
 * qu'un medecin, et c'est le schema qui le dit, pas une condition.
 */
export function exigeSoignant(req: Request, res: Response, next: NextFunction): void {
  if (!compte(res)) {
    res.status(401).json({ erreur: "Session requise." });
    return;
  }
  next();
}

/** Backoffice : administrateurs seuls. */
export function exigeAdmin(req: Request, res: Response, next: NextFunction): void {
  const c = compte(res);
  if (!c) {
    res.status(401).json({ erreur: "Session requise." });
    return;
  }
  if (c.role !== "admin") {
    // 403 et non 401 : la session est valable, c'est le compte qui n'a rien a
    // faire ici. Renvoyer 401 ferait reafficher un formulaire de connexion a
    // quelqu'un qui est deja connecte.
    res.status(403).json({ erreur: "Reserve aux administrateurs." });
    return;
  }
  next();
}
