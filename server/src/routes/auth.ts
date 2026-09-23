import { randomBytes } from "node:crypto";
import { Router } from "express";
import { compte } from "../auth.js";
import { requete } from "../db.js";
import { hacher, verifier } from "../mdp.js";
import {
  effacerCookie,
  fermer,
  jetonDuCookie,
  ouvrir,
  poserCookie,
  purger,
} from "../sessions.js";

/**
 * Connexion des personnes.
 *
 *   POST /auth/connexion    e-mail + mot de passe -> cookie de session
 *   POST /auth/deconnexion  ferme la session en cours
 *   GET  /auth/moi          qui est connecte, ou 401
 *
 * `/auth/moi` est appele au chargement de la console et du backoffice : c'est
 * lui qui decide si on affiche les ecrans ou le formulaire.
 */
export const authApi = Router();

/**
 * Freinage des essais en rafale.
 *
 * Trois essais rates, puis une seconde d'attente qui double a chaque echec,
 * plafonnee a trente. Le compteur est en memoire : il tombe au redemarrage du
 * serveur, et il ne se partage pas entre plusieurs instances. C'est assume —
 * un vaisseau fait tourner un serveur de bord, pas une ferme. Un vrai
 * deploiement rangerait ce compteur en base, avec la limite par compte ET par
 * adresse.
 */
const ESSAIS = new Map<string, { n: number; jusqua: number }>();
const TOLERANCE = 3;

function attente(cle: string): number {
  const e = ESSAIS.get(cle);
  if (!e) return 0;
  return Math.max(0, e.jusqua - Date.now());
}

function echec(cle: string): void {
  const e = ESSAIS.get(cle) ?? { n: 0, jusqua: 0 };
  e.n += 1;
  const delai = e.n <= TOLERANCE ? 0 : Math.min(2 ** (e.n - TOLERANCE - 1), 30) * 1000;
  e.jusqua = Date.now() + delai;
  ESSAIS.set(cle, e);
}

function reussite(cle: string): void {
  ESSAIS.delete(cle);
}

authApi.post("/connexion", (req, res, next) => {
  void (async () => {
    try {
      const email = String(req.body?.email ?? "").trim().toLowerCase();
      const mdp = String(req.body?.mdp ?? "");

      if (!email || !mdp) {
        res.status(422).json({ erreur: "E-mail et mot de passe sont obligatoires." });
        return;
      }

      const reste = attente(email);
      if (reste > 0) {
        res.status(429).json({
          erreur: `Trop d'essais. Reessayez dans ${Math.ceil(reste / 1000)} s.`,
        });
        return;
      }

      // Les deux tables en une requete : le chemin d'execution est le meme
      // quel que soit le role, et une reponse plus rapide d'un cote ne dit pas
      // a l'appelant dans quelle table chercher.
      const ligne = requete<{ role: "medecin" | "admin"; id: number; mdp_hash: string }>(
        `SELECT 'medecin' AS role, id, mdp_hash FROM medecins
          WHERE email = :email AND actif = 1
         UNION ALL
         SELECT 'admin', id, mdp_hash FROM admins
          WHERE email = :email AND actif = 1`,
        { email },
      )[0];

      // Compte inconnu et mot de passe faux donnent le meme refus, et le meme
      // delai : l'ecart de temps entre les deux dirait lesquels de ces
      // e-mails existent a bord.
      const ok = ligne
        ? await verifier(mdp, ligne.mdp_hash)
        : await verifier(mdp, await fausseEmpreinte());

      if (!ligne || !ok) {
        echec(email);
        res.status(401).json({ erreur: "E-mail ou mot de passe incorrect." });
        return;
      }

      reussite(email);
      // Une session par connexion : on profite du passage pour balayer les
      // expirees plutot que d'ajouter une tache planifiee.
      purger();
      poserCookie(res, ouvrir(ligne.role, ligne.id));

      res.json({ compte: lireCompte(ligne.role, ligne.id) });
    } catch (e) {
      next(e);
    }
  })();
});

/**
 * Empreinte d'un mot de passe qui n'ouvre rien.
 *
 * Elle sert a faire travailler argon2 meme quand l'e-mail est inconnu : sans
 * cela, un compte inexistant repondrait en une milliseconde et un compte reel
 * en cent, ce qui suffit a dresser la liste des comptes du vaisseau.
 *
 * Calculee une fois, a la premiere connexion ratee, sur un secret tire au
 * hasard : ecrite en dur, elle serait une empreinte connue de tous, et le
 * temps de verification resterait le bon mais la valeur serait une balise.
 */
let leurre: Promise<string> | null = null;
function fausseEmpreinte(): Promise<string> {
  leurre ??= hacher(randomBytes(24).toString("base64url"));
  return leurre;
}

function lireCompte(role: "medecin" | "admin", id: number) {
  return role === "medecin"
    ? requete(
        `SELECT 'medecin' AS role, id, code, titre, prenom, nom, email, poste
           FROM medecins WHERE id = :id`,
        { id },
      )[0]
    : requete(
        `SELECT 'admin' AS role, id, NULL AS code, NULL AS titre, prenom, nom,
                email, 'Administration' AS poste
           FROM admins WHERE id = :id`,
        { id },
      )[0];
}

authApi.post("/deconnexion", (req, res, next) => {
  try {
    fermer(jetonDuCookie(req));
    effacerCookie(res);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

authApi.get("/moi", (_req, res) => {
  const c = compte(res);
  if (!c) {
    res.status(401).json({ erreur: "Aucune session." });
    return;
  }
  res.json({ compte: c });
});
