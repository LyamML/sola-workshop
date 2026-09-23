// =============================================================================
//  Sola — comptes medecin et administrateur
//
//    npm run compte -- liste
//    npm run compte -- medecin
//    npm run compte -- admin
//    npm run compte -- mdp <email>
//
//  POURQUOI AU TERMINAL : il faut un compte pour en creer un, et au premier
//  demarrage il n'y en a aucun. Cette commande est la reponse la plus simple
//  a ce probleme — elle s'execute sur la machine qui porte la base, donc
//  physiquement a bord, et elle n'est exposee sur aucun reseau.
//
//  Le mot de passe se saisit au clavier, sans echo. Il n'est jamais passe en
//  argument : la ligne de commande reste dans l'historique du terminal, et un
//  mot de passe dans un historique n'est plus un mot de passe.
// =============================================================================

import { createInterface } from "node:readline";
import { DatabaseSync } from "node:sqlite";
import { MDP_MIN, hacher } from "./hachage.mjs";

const FICHIER = process.env.DB_FILE ?? "sola.db";

// --------------------------------------------------------------- saisie ---
function demander(question, { masque = false } = {}) {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  return new Promise((resoudre) => {
    if (masque) {
      // On intercepte l'ecriture de la console pour ne rien afficher pendant
      // la frappe : readline n'a pas d'option « mot de passe ».
      const ecrire = rl._writeToOutput.bind(rl);
      rl._writeToOutput = (chaine) => {
        if (chaine.includes(question)) ecrire(chaine);
      };
    }
    rl.question(question, (reponse) => {
      if (masque) process.stdout.write("\n");
      rl.close();
      resoudre(reponse.trim());
    });
  });
}

async function demanderMdp() {
  const mdp = await demander("Mot de passe                : ", { masque: true });
  if (mdp.length < MDP_MIN) {
    throw new Error(`Le mot de passe doit faire au moins ${MDP_MIN} caracteres.`);
  }
  const encore = await demander("Confirmer                   : ", { masque: true });
  if (mdp !== encore) throw new Error("Les deux saisies different.");
  return mdp;
}

function obligatoire(valeur, nom) {
  if (!valeur) throw new Error(`${nom} est obligatoire.`);
  return valeur;
}

// ----------------------------------------------------------------- base ---
const db = new DatabaseSync(FICHIER);
db.exec("PRAGMA foreign_keys = ON");

const [action, argument] = process.argv.slice(2);

try {
  if (action === "liste") {
    const lignes = db
      .prepare(
        `SELECT 'medecin' AS role, code, titre || ' ' || prenom || ' ' || nom AS qui,
                email, actif, derniere_connexion FROM medecins
         UNION ALL
         SELECT 'admin', '—', prenom || ' ' || nom, email, actif, derniere_connexion
           FROM admins
         ORDER BY role, qui`,
      )
      .all();

    if (lignes.length === 0) {
      console.log("\nAucun compte. Creez-en un :\n\n  npm run compte -- admin\n");
    } else {
      console.log("");
      for (const l of lignes) {
        console.log(
          `  ${l.role.padEnd(8)} ${String(l.code).padEnd(7)} ${l.qui.padEnd(28)} ` +
            `${l.email.padEnd(30)} ${l.actif ? "actif" : "DESACTIVE"}` +
            `${l.derniere_connexion ? `  vu le ${l.derniere_connexion}` : ""}`,
        );
      }
      console.log("");
    }
  } else if (action === "medecin" || action === "admin") {
    const prenom = obligatoire(await demander("Prenom                      : "), "Le prenom");
    const nom = obligatoire(await demander("Nom                         : "), "Le nom");
    const email = obligatoire(
      (await demander("E-mail                      : ")).toLowerCase(),
      "L'e-mail",
    );

    let champs = { prenom, nom, email };
    if (action === "medecin") {
      const titre = (await demander("Titre [Dr.] / Inf.          : ")) || "Dr.";
      if (titre !== "Dr." && titre !== "Inf.") throw new Error("Titre : « Dr. » ou « Inf. ».");
      const poste = (await demander("Poste [Medecine de bord]    : ")) || "Medecine de bord";
      // Matricule a la suite du dernier attribue : M-001, M-002…
      const dernier =
        db.prepare("SELECT MAX(CAST(SUBSTR(code, 3) AS INTEGER)) AS n FROM medecins").get().n ?? 0;
      champs = { ...champs, titre, poste, code: `M-${String(dernier + 1).padStart(3, "0")}` };
    }

    const mdp_hash = await hacher(await demanderMdp());

    if (action === "medecin") {
      db.prepare(
        `INSERT INTO medecins (code, prenom, nom, titre, poste, email, mdp_hash)
         VALUES (:code, :prenom, :nom, :titre, :poste, :email, :mdp_hash)`,
      ).run({ ...champs, mdp_hash });
      console.log(`\n  Medecin ${champs.code} cree : ${champs.titre} ${nom} <${email}>\n`);
    } else {
      db.prepare(
        "INSERT INTO admins (prenom, nom, email, mdp_hash) VALUES (:prenom, :nom, :email, :mdp_hash)",
      ).run({ ...champs, mdp_hash });
      console.log(`\n  Administrateur cree : ${prenom} ${nom} <${email}>\n`);
    }
  } else if (action === "mdp") {
    const email = obligatoire(argument, "L'e-mail").toLowerCase();
    const mdp_hash = await hacher(await demanderMdp());

    // Les deux tables, parce qu'on ne demande pas a quelqu'un qui a oublie son
    // mot de passe de se souvenir d'abord dans quelle table il est range.
    const n =
      db.prepare("UPDATE medecins SET mdp_hash = :h WHERE email = :e").run({ h: mdp_hash, e: email })
        .changes +
      db.prepare("UPDATE admins SET mdp_hash = :h WHERE email = :e").run({ h: mdp_hash, e: email })
        .changes;

    if (n === 0) throw new Error(`Aucun compte pour ${email}.`);

    // Les sessions ouvertes tombent : changer un mot de passe sans fermer les
    // sessions en cours laisse ouvert exactement ce qu'on voulait refermer.
    const fermees = db
      .prepare(
        `DELETE FROM sessions
          WHERE medecin_id IN (SELECT id FROM medecins WHERE email = :e)
             OR admin_id   IN (SELECT id FROM admins   WHERE email = :e)`,
      )
      .run({ e: email }).changes;

    console.log(`\n  Mot de passe change pour ${email}. ${fermees} session(s) fermee(s).\n`);
  } else {
    console.log(
      "\n  npm run compte -- liste            les comptes existants\n" +
        "  npm run compte -- medecin          creer un compte medecin\n" +
        "  npm run compte -- admin            creer un compte administrateur\n" +
        "  npm run compte -- mdp <email>      changer un mot de passe\n",
    );
    process.exitCode = 1;
  }
} catch (e) {
  console.error(`\n  ${e.message}\n`);
  process.exitCode = 1;
} finally {
  db.close();
}
