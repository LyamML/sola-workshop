// Hachage des mots de passe, pour les scripts du terminal.
//
// Les memes parametres que server/src/mdp.ts — profil argon2id de reference
// de l'OWASP : 19 Mio, deux passes, un fil. Le serveur ne peut pas importer ce
// fichier (il est en TypeScript et compile ailleurs), et les scripts ne
// peuvent pas importer le sien : d'ou cette duplication de quatre lignes,
// assumee et signalee des deux cotes.

import { randomBytes } from "node:crypto";
import { argon2id } from "hash-wasm";

// La longueur minimale est une regle de CREATION de compte : elle est
// appliquee par db-compte.mjs, qui demande le mot de passe au clavier. Elle
// n'est pas appliquee ici, sinon le jeu de demonstration ne pourrait pas
// avoir de compte a mot de passe court.
export const MDP_MIN = 12;

export async function hacher(mdp) {
  return argon2id({
    password: mdp,
    salt: randomBytes(16),
    memorySize: 19456,
    iterations: 2,
    parallelism: 1,
    hashLength: 32,
    outputType: "encoded",
  });
}
