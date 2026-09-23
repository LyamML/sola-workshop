import { randomBytes } from "node:crypto";
import { argon2Verify, argon2id } from "hash-wasm";

/**
 * Mots de passe des comptes medecin et administrateur.
 *
 * Argon2id, et pas un hachage generique : SHA-256 est concu pour etre rapide,
 * ce qui est exactement le defaut qu'on ne veut pas ici. Argon2id impose a
 * chaque essai un cout en memoire autant qu'en calcul — c'est ce qui rend une
 * attaque par dictionnaire couteuse sur GPU, la ou un SHA-256 sale se teste
 * par milliards.
 *
 * Le paquet est `hash-wasm` : du WebAssembly, pas un module natif. Le depot
 * n'installe rien qui demande un compilateur (voir CLAUDE.md), et l'equipe
 * travaille sous Windows ou `node-gyp` est une soiree perdue.
 *
 * Parametres : ceux que l'OWASP donne comme second profil de reference pour
 * Argon2id — 19 Mio de memoire, deux passes, un fil. Environ 100 ms par essai
 * sur une machine de bureau : imperceptible a la connexion, decourageant en
 * rafale. Ils sont inscrits DANS l'empreinte produite :
 *
 *   $argon2id$v=19$m=19456,t=2,p=1$<sel>$<empreinte>
 *
 * donc les augmenter plus tard ne casse pas les comptes existants — la
 * verification relit les parametres de chaque ligne.
 */
const MEMOIRE_KIO = 19456; // 19 Mio
const PASSES = 2;
const FILS = 1;
const LONGUEUR = 32;

/**
 * Longueur minimale d'un mot de passe choisi par une personne.
 *
 * La regle s'applique la ou un compte se cree — `npm run compte` —, pas ici :
 * `hacher` est une primitive, et une primitive qui refuse son entree empeche
 * aussi le jeu de demonstration d'avoir un compte a mot de passe court, ce
 * qu'on veut pouvoir decider ailleurs.
 */
export const MDP_MIN = 12;

export async function hacher(mdp: string): Promise<string> {
  return argon2id({
    password: mdp,
    // Un sel par compte : sans lui, deux personnes ayant choisi le meme mot
    // de passe auraient la meme empreinte, et une table precalculee les
    // ouvrirait toutes les deux d'un coup.
    salt: randomBytes(16),
    memorySize: MEMOIRE_KIO,
    iterations: PASSES,
    parallelism: FILS,
    hashLength: LONGUEUR,
    outputType: "encoded",
  });
}

/**
 * Verifie un mot de passe contre l'empreinte stockee.
 *
 * Ne leve jamais : une empreinte abimee en base doit refuser la connexion,
 * pas renvoyer une erreur 500 qui apprend a l'appelant que ce compte existe.
 */
export async function verifier(mdp: string, empreinte: string): Promise<boolean> {
  try {
    return await argon2Verify({ password: mdp, hash: empreinte });
  } catch {
    return false;
  }
}
