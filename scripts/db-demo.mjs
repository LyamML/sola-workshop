// =============================================================================
//  Sola — generateur de donnees de test
//
//    npm run db:demo
//
//  A lancer APRES `npm run db:load`. Le chargement pose les 13 residents
//  scriptes (Lyam et la file de triage) ; ce script complete l'equipage
//  jusqu'aux 1 240 personnes du Meridien.
//
//  POURQUOI : tant que l'ecran 02 affiche "8,4 %" ecrit en dur dans un
//  fichier TypeScript, personne ne peut verifier que le schema porte
//  reellement l'interface. Avec 1 240 residents en base, chaque chiffre de
//  l'ecran devient le resultat d'une requete — et une erreur de modele se
//  voit immediatement a l'ecran.
//
//  Les cibles ci-dessous sont EXACTEMENT les valeurs des maquettes. Le script
//  ne tire pas au hasard en esperant tomber juste : il tire une population
//  plausible, puis corrige le dernier ecart pour atteindre la cible. Le
//  generateur est deterministe (graine fixe) — deux executions donnent la
//  meme base, donc la meme demonstration le jour de la soutenance.
// =============================================================================

import { DatabaseSync } from "node:sqlite";
import { hacher } from "./hachage.mjs";

const FICHIER = process.env.DB_FILE ?? "sola.db";
const JOUR_VOL = Number(process.env.JOUR_VOL ?? 4128);
const EQUIPAGE = 1240;

// ------------------------------------------------------------------ cibles --
// Population par module et nombre de signaux ouverts, choisis pour que
// v_signaux_module rende les pourcentages de MODULE_BARS.
const MODULES = [
  { code: "A", nom: "Commandement", residents: 119, signaux: 11 }, //  9,2 %
  { code: "B", nom: "Habitat 1", residents: 280, signaux: 18 }, //  6,4 %
  { code: "C", nom: "Hydroponie", residents: 229, signaux: 34 }, // 14,8 %
  { code: "D", nom: "Habitat 2", residents: 269, signaux: 16 }, //  5,9 %
  { code: "E", nom: "Maintenance", residents: 174, signaux: 15 }, //  8,6 %
  { code: "F", nom: "Recherche", residents: 169, signaux: 7 }, //  4,1 %
];

// Depistage. Les sept dernieres valeurs sont les sparklines de l'ecran 02 ;
// avant cela on interpole depuis l'etat de l'equipage il y a un an. Ordre :
// PHQ-9, GAD-7, ISI, en pourcentage de l'equipage.
const SPARK_DEPISTAGE = {
  6: [7.1, 6.6, 11.4],
  5: [7.3, 6.5, 11.9],
  4: [7.4, 6.4, 12.4],
  3: [7.8, 6.5, 13.0],
  2: [8.0, 6.3, 13.5],
  1: [8.2, 6.2, 13.9],
  0: [8.4, 6.1, 14.2],
};
const DEPISTAGE_IL_Y_A_UN_AN = [6.2, 6.9, 9.8];

// Alertes physiologiques d'hier — les six barres du bas de l'ecran 02.
// Les seuils sont ceux de la vue v_alertes_physio, pas des valeurs choisies
// ici : si la vue change, ce script doit changer avec elle.
const PHYSIO = {
  rmssdBas: 140, //  rmssd_ms     < 30   -> 11,3 %
  sommeilCourt: 120, //  sommeil_min  < 360  ->  9,7 %
  peuActif: 97, //  pas          < 4000 ->  7,8 %
  fcHaute: 52, //  fc_repos_bpm > 75   ->  4,2 %
  spo2Bas: 20, //  spo2_pct     < 95   ->  1,6 %
  chutes: 4, //  evenement chute     ->  0,3 %
};

// Motifs de conversation sur 30 jours — les barres de droite.
const MOTIFS = [
  ["Troubles du sommeil", 312],
  ["Humeur basse", 187],
  ["Anxiété, stress chronique", 141],
  ["Isolement social", 96],
  ["Désynchronisation circadienne", 74],
  ["Dépendance au compagnon", 27],
];

// Courbe de l'indice de bien-etre : onze points mensuels sur l'annee, onze
// points sur le mois, six sur la semaine, puis aujourd'hui. Ce sont les
// series des trois onglets de l'ecran 02.
const COURBE_ANNEE = [78.1, 77.4, 76.9, 77.8, 75.2, 74.0, 71.1, 69.8, 72.6, 74.3, 75.1];
const COURBE_MOIS = [75.1, 74.8, 74.2, 73.9, 74.4, 73.6, 73.1, 72.8, 73.3, 72.6, 72.9];
const COURBE_SEMAINE = [74.1, 73.6, 73.2, 72.9, 73.4, 72.7];
const INDICE_AUJOURDHUI = 72.4;

// ------------------------------------------------------------------ hasard --
// Generateur deterministe : la demonstration doit etre reproductible.
function graine(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = graine(4128);
const entre = (min, max) => min + rnd() * (max - min);
const entier = (min, max) => Math.floor(entre(min, max + 1));
const piocher = (liste) => liste[entier(0, liste.length - 1)];
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const arrondi = (v, n = 1) => Math.round(v * 10 ** n) / 10 ** n;

/**
 * Part de l'equipage au-dessus du seuil de depistage, a J moins `o`.
 * Les sept derniers jours sont les valeurs affichees sur l'ecran 02 ; au-dela,
 * on interpole lineairement depuis l'etat d'il y a un an.
 */
function pctDepistage(o) {
  const spark = SPARK_DEPISTAGE[o];
  if (spark) return spark;
  const debut = DEPISTAGE_IL_Y_A_UN_AN;
  const fin = SPARK_DEPISTAGE[6];
  const t = clamp((360 - o) / (360 - 6), 0, 1);
  return debut.map((v, i) => v + (fin[i] - v) * t);
}

// Loi normale, pour que la population ressemble a une population : une
// majorite autour de la moyenne, des extremes rares.
function normale(moyenne, ecart) {
  const u = Math.max(rnd(), 1e-9);
  const v = rnd();
  return moyenne + ecart * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ------------------------------------------------------------------- noms --
const PRENOMS = [
  "Aya", "Ilan", "Mei", "Tarek", "Sofia", "Noam", "Kenji", "Lucia", "Omar",
  "Freya", "Diego", "Anouk", "Rashid", "Elin", "Hugo", "Naima", "Viktor",
  "Yara", "Mateo", "Ingrid", "Selim", "Clara", "Jonas", "Aminata", "Rafael",
  "Lena", "Idris", "Siri", "Paulo", "Zahra", "Emil", "Adrien", "Keiko",
  "Milos", "Theo", "Amina", "Iker", "Sana", "Pavel", "Maya", "Eitan", "Noor",
  "Luca", "Agnes", "Karim", "Elsa", "Tobias", "Rania", "Anton", "Line",
  "Youssef", "Petra", "Nils", "Dalia", "Marek", "Alma", "Hakim", "Vera",
];
const NOMS = [
  "Almeida", "Bakker", "Cisse", "Doric", "Engel", "Farouk", "Gronlund",
  "Haddad", "Ibarra", "Jansen", "Kowal", "Larsen", "Mbeki", "Novak",
  "Petrov", "Quintana", "Rahman", "Svensson", "Tanaka", "Ukena", "Varga",
  "Wallin", "Ximenes", "Yilmaz", "Zamora", "Bergstrom", "Costa", "Dubois",
  "Eriksen", "Goretti", "Hansen", "Ishida", "Jurkovic", "Keita", "Moreau",
  "Okonkwo", "Pereira", "Rossi", "Sandoval", "Thorne", "Vidal", "Weiss",
];
const POSTES = {
  A: ["Officier de quart", "Navigation", "Commandement", "Communications"],
  B: ["Vie de bord", "Éducation", "Restauration", "Équipage"],
  C: ["Technicien hydroponie", "Agronomie", "Gestion de l'eau", "Recyclage"],
  D: ["Vie de bord", "Sport et remise en forme", "Équipage", "Atelier"],
  E: ["Maintenance", "Électrotechnique", "Propulsion", "Support de vie"],
  F: ["Recherche", "Laboratoire", "Médecine de bord", "Archives"],
};
const SANGS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];

// ---------------------------------------------------------------- comptes --
//
//  Les cinq soignants etaient six chaines de caracteres dans `assigne_a`, sans
//  rien derriere. Ils deviennent des lignes de `medecins` — sauf la sixieme,
//  « Equipe d'intervention », qui n'est pas une personne et reste du texte
//  libre. C'est exactement ce que la colonne `assigne_a` garde comme role.
//
//  MOTS DE PASSE DE DEMONSTRATION. Ils sont ecrits ici parce que cette base
//  est synthetique et locale, qu'aucun de ces comptes n'existe ailleurs, et
//  qu'une soutenance ou personne ne peut se connecter n'a pas lieu. Pour tout
//  autre usage : `npm run compte`, qui demande le mot de passe au clavier.
//
const MEDECINS = [
  { code: "M-001", titre: "Dr.",  prenom: "Candice", nom: "Oyelaran", poste: "Psychologue de bord" },
  { code: "M-002", titre: "Dr.",  prenom: "Ines",    nom: "Ferreira", poste: "Medecine generale" },
  { code: "M-003", titre: "Dr.",  prenom: "Bob",     nom: "Nakamura", poste: "Medecin de bord" },
  { code: "M-004", titre: "Inf.", prenom: "Jonas",   nom: "Bakker",   poste: "Soins infirmiers" },
  { code: "M-005", titre: "Inf.", prenom: "Naima",   nom: "Haddad",   poste: "Soins infirmiers" },
];
const MDP_DEMO = "meridien-4128";

//  Le compte passe-partout de l'equipe. Il est administrateur, et c'est le
//  role qui ouvre TOUT : le backoffice l'exige, la console se contente d'une
//  session ouverte quelle qu'elle soit. Un compte medecin, lui, n'ouvrirait
//  que la console.
//
//  Ce qu'il ne fait pas : signer une note. `particularites.auteur_id` pointe
//  sur `medecins`, et une note clinique porte le nom d'un soignant — pas celui
//  de l'administration. Pour voir une note signee, se connecter avec un des
//  cinq comptes medecin ci-dessus.
//
//  Son mot de passe est court et evident. C'est voulu pour une demonstration
//  locale, et c'est exactement ce qu'il ne faut pas deployer : sur une
//  instance accessible a d'autres, supprimer cette ligne.
const ADMINS = [
  { prenom: "Root", nom: "Meridien", email: "root@root.com", mdp: "admin" },
  { prenom: "George", nom: "Abadi", email: "george.abadi@meridien.vol" },
  { prenom: "Alice", nom: "Rousseau", email: "alice.rousseau@meridien.vol" },
];

/** Ce qui n'est pas une personne : une equipe, donc pas de compte. */
const EQUIPE = "Équipe d'intervention";

// --------------------------------------------------------------- calendrier --
const MS_JOUR = 86400000;
const AUJOURDHUI = new Date();
AUJOURDHUI.setHours(12, 0, 0, 0);

/** Date ISO (AAAA-MM-JJ) a J moins `n` jours. */
function jour(n) {
  return new Date(AUJOURDHUI.getTime() - n * MS_JOUR).toISOString().slice(0, 10);
}
/** Horodatage SQLite d'aujourd'hui, a `m` minutes apres minuit. */
function aujourdhuiA(m) {
  const d = new Date();
  d.setHours(0, Math.min(m, 1439), 0, 0);
  const p = (x) => String(x).padStart(2, "0");
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:00`
  );
}

/** Horodatage SQLite a `n` minutes dans le passe. */
function ilYAMinutes(n) {
  const d = new Date(Date.now() - n * 60000);
  const p = (x) => String(x).padStart(2, "0");
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:00`
  );
}

/** Horodatage SQLite ("AAAA-MM-JJ HH:MM:SS") a J moins `n` jours. */
function instant(n, heure, minute) {
  const d = new Date(AUJOURDHUI.getTime() - n * MS_JOUR);
  d.setHours(heure, minute, 0, 0);
  const p = (x) => String(x).padStart(2, "0");
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:00`
  );
}

// =============================================================================
const db = new DatabaseSync(FICHIER);
db.exec("PRAGMA foreign_keys = ON");
db.exec("PRAGMA journal_mode = WAL");

const debut = Date.now();
const etapes = [];
const etape = (titre, n) => etapes.push(`  ${String(n).padStart(6)}  ${titre}`);

const existants = db.prepare("SELECT COUNT(*) AS n FROM residents").get().n;
if (existants === 0) {
  console.error("Base vide. Lancez d'abord : npm run db:load");
  process.exit(1);
}
if (existants >= EQUIPAGE) {
  console.error(
    `La base contient deja ${existants} residents.\n` +
      "Relancez `npm run db:load` pour repartir du jeu scripte.",
  );
  process.exit(1);
}

// Argon2 est lent par construction — c'est tout son interet — et il est
// asynchrone : on calcule les empreintes AVANT d'ouvrir la transaction,
// plutot que de la laisser ouverte une seconde pour rien. Un sel par compte,
// donc un appel par compte meme quand le mot de passe est le meme.
const EMPREINTES = await Promise.all(
  [...MEDECINS, ...ADMINS].map((c) => hacher(c.mdp ?? MDP_DEMO)),
);

db.exec("BEGIN");
try {
  // -------------------------------------------------------------- comptes --
  const insMedecin = db.prepare(`
    INSERT INTO medecins (code, prenom, nom, titre, poste, email, mdp_hash)
    VALUES (:code, :prenom, :nom, :titre, :poste, :email, :hash)`);
  const insAdmin = db.prepare(`
    INSERT INTO admins (prenom, nom, email, mdp_hash)
    VALUES (:prenom, :nom, :email, :hash)`);

  // Nom affiche -> identifiant, pour que les signaux plus bas pointent sur un
  // compte au lieu de recopier une chaine.
  const medecinParNom = new Map();
  MEDECINS.forEach((m, i) => {
    const email = `${m.prenom}.${m.nom}@meridien.vol`.toLowerCase();
    const { lastInsertRowid } = insMedecin.run({ ...m, email, hash: EMPREINTES[i] });
    medecinParNom.set(`${m.titre} ${m.nom}`, Number(lastInsertRowid));
  });
  // `mdp` est retire : il a servi a calculer l'empreinte, et node:sqlite
  // refuse un parametre nomme que la requete ne connait pas.
  ADMINS.forEach(({ mdp: _mdp, ...a }, i) =>
    insAdmin.run({ ...a, hash: EMPREINTES[MEDECINS.length + i] }),
  );
  etape("comptes (medecins et administrateurs)", MEDECINS.length + ADMINS.length);

  // Les six signaux du seed SQL nomment leur soignant en toutes lettres : ce
  // fichier se charge avant que les comptes existent, il ne peut pas pointer
  // sur un identifiant. On raccroche ici, maintenant qu'ils existent — sans
  // quoi la console afficherait « Dr. Ferreira » sans savoir de qui il s'agit.
  const rattacher = db.prepare(
    "UPDATE signaux SET assigne_id = :id, assigne_a = NULL WHERE assigne_a = :nom",
  );
  let nRattaches = 0;
  for (const [nom, id] of medecinParNom) {
    nRattaches += rattacher.run({ id, nom }).changes;
  }
  if (nRattaches) etape("signaux du seed rattaches a un compte", nRattaches);

  /** Tire un soignant : une personne cinq fois sur six, l'equipe sinon. */
  const tirerSoignant = () => {
    const noms = [...medecinParNom.keys()];
    return rnd() < noms.length / (noms.length + 1)
      ? { assigne_id: medecinParNom.get(piocher(noms)), assigne_a: null }
      : { assigne_id: null, assigne_a: EQUIPE };
  };

  // ------------------------------------------------------------- equipage --
  // Les residents scriptes gardent leur module ; on complete chaque module
  // jusqu'a sa population cible.
  const parModule = Object.fromEntries(
    db
      .prepare("SELECT SUBSTR(cabine,1,1) AS m, COUNT(*) AS n FROM residents GROUP BY 1")
      .all()
      .map((r) => [r.m, r.n]),
  );

  const insResident = db.prepare(`
    INSERT INTO residents
      (code, prenom, nom, date_naissance, poste, cabine, groupe_sanguin,
       embarque_jour_vol, statut)
    VALUES (:code, :prenom, :nom, :naissance, :poste, :cabine, :sang, 0, 'ok')`);
  const insBracelet = db.prepare(`
    INSERT INTO bracelets (serie, resident_id, firmware, batterie_pct, synchro_at)
    VALUES (:serie, :rid, 'bracelet-i2c', :batterie, :synchro)`);

  // Codes deja pris : on numerote a la suite sans jamais collisionner.
  const pris = new Set(db.prepare("SELECT code FROM residents").all().map((r) => r.code));
  let prochain = 1;
  function codeLibre() {
    let code;
    do {
      code = "R-" + String(prochain++).padStart(4, "0");
    } while (pris.has(code));
    pris.add(code);
    return code;
  }

  let crees = 0;
  for (const mod of MODULES) {
    const manque = mod.residents - (parModule[mod.code] ?? 0);
    for (let i = 0; i < manque; i++) {
      const code = codeLibre();
      // Une population de vaisseau : ni tres jeune ni tres age, le tri a eu
      // lieu au depart. 19 a 71 ans, centre sur 38.
      const age = Math.round(clamp(normale(38, 12), 19, 71));
      const naissance = new Date(AUJOURDHUI.getTime() - age * 365.25 * MS_JOUR)
        .toISOString()
        .slice(0, 10);
      const { lastInsertRowid } = insResident.run({
        code,
        prenom: piocher(PRENOMS),
        nom: piocher(NOMS),
        naissance,
        poste: piocher(POSTES[mod.code]),
        cabine: `${mod.code}-${String(entier(1, 140)).padStart(2, "0")}`,
        sang: piocher(SANGS),
      });
      insBracelet.run({
        serie: "BR-" + code.slice(2),
        rid: Number(lastInsertRowid),
        batterie: entier(18, 100),
        // Dans les dernieres minutes, jamais dans le futur : l'interface
        // affiche « synchro il y a 4 min », et une date a venir donnerait
        // « a l'instant » pour tout le monde.
        synchro: ilYAMinutes(entier(1, 240)),
      });
      crees++;
    }
  }
  etape("residents crees (equipage complete a 1 240)", crees);

  const equipage = db
    .prepare(
      `SELECT id, code, SUBSTR(cabine,1,1) AS module, cabine,
              CAST((julianday('now') - julianday(date_naissance)) / 365.25 AS INTEGER) AS age
         FROM residents ORDER BY id`,
    )
    .all();

  // --------------------------------------------------- medecins traitants --
  //
  //  Chaque resident est rattache a un soignant, en tourniquet sur l'ordre des
  //  identifiants. Repartir par module aurait ete plus joli a lire, mais les
  //  modules vont de 119 a 280 residents : cinq soignants n'y tiennent pas a
  //  charge egale. Le tourniquet en donne 248 a chacun et melange les modules,
  //  ce qui est de toute facon plus juste — un soignant de bord suit des
  //  personnes, pas un couloir.
  //
  //  R-0448 tombe sur le premier compte, Dr. Oyelaran : c'est la psychologue
  //  de bord, et c'est coherent avec sa fiche. Rien n'est pipe pour autant, il
  //  est juste le premier de la liste.
  //
  const soignants = [...medecinParNom.values()];
  const insTraitant = db.prepare(
    "UPDATE residents SET medecin_traitant_id = :mid WHERE id = :rid",
  );
  equipage.forEach((r, i) =>
    insTraitant.run({ mid: soignants[i % soignants.length], rid: r.id }),
  );
  etape("residents rattaches a un medecin traitant", equipage.length);

  // R-0448 porte la demonstration scriptee : ses quatorze jours de mesures et
  // ses nuits sont ceux des graphiques de l'ecran 03. On ne les regenere pas.
  const SCRIPTE = db.prepare("SELECT id FROM residents WHERE code = 'R-0448'").get().id;
  const autres = equipage.filter((r) => r.id !== SCRIPTE);

  // ------------------------------------------------------ profils de sante --
  // Chaque resident recoit un profil stable : c'est lui qui decide s'il
  // dormira mal toute la quinzaine ou s'il ira bien. Sans cela les series
  // seraient du bruit, et aucune tendance individuelle ne serait lisible.
  const profils = new Map();
  for (const r of equipage) {
    const fragilite = clamp(normale(0, 1), -2.5, 2.5); // > 0 : va moins bien
    profils.set(r.id, {
      fragilite,
      fcRepos: clamp(normale(62 + fragilite * 4, 6), 46, 88),
      rmssd: clamp(normale(45 - fragilite * 7, 11), 12, 85),
      spo2: clamp(normale(97.6 - fragilite * 0.4, 1.0), 89, 100),
      resp: clamp(normale(14 + fragilite * 0.7, 1.4), 9, 22),
      temp: clamp(normale(34.3, 0.28), 33.4, 35.2),
      eda: clamp(normale(2.2 + fragilite * 0.5, 0.6), 0.6, 6),
      pas: Math.round(clamp(normale(7800 - fragilite * 900, 1900), 900, 15000)),
      sommeil: Math.round(clamp(normale(410 - fragilite * 32, 55), 180, 560)),
      moral: clamp(normale(-fragilite * 9, 6), -50, 26), // ecart a la moyenne
    });
  }

  // ------------------------------------------ quatorze jours de constantes --
  const insJour = db.prepare(`
    INSERT INTO mesures_jour
      (resident_id, jour, jour_vol, fc_repos_bpm, fc_moy_bpm, rmssd_ms,
       spo2_pct, resp_min, temp_c, eda_us, pas, minutes_valides, source)
    VALUES (:rid, :jour, :jv, :fcr, :fcm, :rmssd, :spo2, :resp, :temp, :eda,
            :pas, :minutes, 'mixte')
    ON CONFLICT (resident_id, jour) DO NOTHING`);
  const insNuit = db.prepare(`
    INSERT INTO nuits
      (resident_id, nuit_du, jour_vol, coucher_at, lever_at, sommeil_min,
       latence_min, eveils_min, source)
    VALUES (:rid, :jour, :jv, :coucher, :lever, :sommeil, :latence, :eveils,
            'estime')
    ON CONFLICT (resident_id, nuit_du) DO NOTHING`);

  // Les valeurs d'hier restent en memoire : ce sont elles que comptent les six
  // barres d'alertes, et il faudra les ajuster pour tomber sur les cibles.
  const hier = new Map();
  let nJours = 0;
  let nNuits = 0;

  for (const r of autres) {
    const p = profils.get(r.id);
    for (let d = 13; d >= 0; d--) {
      // Une derive lente sur la quinzaine, propre a chaque personne.
      const derive = (13 - d) * p.fragilite * 0.12;
      const fcr = arrondi(clamp(p.fcRepos + derive + normale(0, 2), 42, 95));
      const rmssd = arrondi(clamp(p.rmssd - derive * 1.6 + normale(0, 4), 8, 95));
      const spo2 = arrondi(clamp(p.spo2 + normale(0, 0.7), 86, 100));
      const pas = Math.round(clamp(p.pas - derive * 120 + normale(0, 900), 300, 18000));
      const sommeil = Math.round(clamp(p.sommeil - derive * 6 + normale(0, 45), 120, 600));

      const ligne = {
        rid: r.id,
        jour: jour(d),
        jv: JOUR_VOL - d,
        fcr,
        fcm: arrondi(clamp(fcr + entre(10, 18), 50, 120)),
        rmssd,
        spo2,
        resp: arrondi(clamp(p.resp + normale(0, 0.8), 8, 26)),
        temp: arrondi(clamp(p.temp + normale(0, 0.15), 33, 36), 2),
        eda: arrondi(clamp(p.eda + derive * 0.05 + normale(0, 0.3), 0.3, 8), 2),
        pas,
        minutes: entier(1180, 1439),
      };
      insJour.run(ligne);
      nJours++;

      insNuit.run({
        rid: r.id,
        jour: jour(d),
        jv: JOUR_VOL - d,
        coucher: instant(d, 22, entier(0, 59)),
        lever: instant(d - 1, 6, entier(0, 59)),
        sommeil,
        latence: Math.round(clamp(normale(18 + p.fragilite * 9, 9), 2, 120)),
        eveils: Math.round(clamp(normale(22 + p.fragilite * 14, 14), 0, 180)),
      });
      nNuits++;

      if (d === 1) hier.set(r.id, { ...ligne, sommeil });
    }
  }
  etape("journees de constantes (14 j x equipage)", nJours);
  etape("nuits analysees", nNuits);

  // ----------------------------------- ajustement des six barres d'alertes --
  // On compte ce que la population a produit spontanement, puis on force le
  // nombre exact de residents au-dessus de chaque seuil. Le seuil vient de la
  // vue ; la cible vient de la maquette.
  const majJour = db.prepare(
    `UPDATE mesures_jour SET rmssd_ms = :rmssd, spo2_pct = :spo2,
            fc_repos_bpm = :fcr, pas = :pas
      WHERE resident_id = :rid AND jour = :jour`,
  );
  const majNuit = db.prepare(
    "UPDATE nuits SET sommeil_min = :sommeil WHERE resident_id = :rid AND nuit_du = :jour",
  );

  /**
   * Amene a `cible` le nombre de residents pour lesquels `test` est vrai
   * hier. Les candidats les plus fragiles basculent en premier : un resident
   * deja en difficulte est le plus plausible sous le seuil.
   */
  function calibrer(test, pousser, ramener, cible) {
    const lignes = [...hier.values()];
    const dedans = lignes.filter(test);
    const dehors = lignes.filter((l) => !test(l));
    const parFragilite = (a, b) => profils.get(b.rid).fragilite - profils.get(a.rid).fragilite;

    if (dedans.length < cible) {
      dehors.sort(parFragilite);
      for (const l of dehors.slice(0, cible - dedans.length)) pousser(l);
    } else if (dedans.length > cible) {
      dedans.sort((a, b) => parFragilite(b, a));
      for (const l of dedans.slice(0, dedans.length - cible)) ramener(l);
    }
  }

  // prettier-ignore
  {
    calibrer((l) => l.rmssd < 30,
      (l) => { l.rmssd = arrondi(entre(14, 29.4)); },
      (l) => { l.rmssd = arrondi(entre(30.6, 44)); }, PHYSIO.rmssdBas);
    calibrer((l) => l.spo2 < 95,
      (l) => { l.spo2 = arrondi(entre(89, 94.6)); },
      (l) => { l.spo2 = arrondi(entre(95.4, 99)); }, PHYSIO.spo2Bas);
    calibrer((l) => l.fcr > 75,
      (l) => { l.fcr = arrondi(entre(75.6, 92)); },
      (l) => { l.fcr = arrondi(entre(56, 74.4)); }, PHYSIO.fcHaute);
    calibrer((l) => l.pas < 4000,
      (l) => { l.pas = entier(900, 3900); },
      (l) => { l.pas = entier(4100, 9000); }, PHYSIO.peuActif);
    calibrer((l) => l.sommeil < 360,
      (l) => { l.sommeil = entier(180, 355); },
      (l) => { l.sommeil = entier(365, 500); }, PHYSIO.sommeilCourt);
  }

  for (const l of hier.values()) {
    majJour.run({ rid: l.rid, jour: l.jour, rmssd: l.rmssd, spo2: l.spo2, fcr: l.fcr, pas: l.pas });
    majNuit.run({ rid: l.rid, jour: l.jour, sommeil: l.sommeil });
  }
  etape("lignes d'hier calibrees sur les six seuils", hier.size);

  // Chutes d'hier : la barre la plus basse de l'ecran, 0,3 %.
  const chutesDeja = db
    .prepare(
      `SELECT COUNT(DISTINCT resident_id) AS n FROM evenements
        WHERE type = 'chute' AND survenu_at >= datetime('now','-1 day')`,
    )
    .get().n;
  const insEvt = db.prepare(
    `INSERT INTO evenements (resident_id, type, survenu_at, intensite_g, acquitte_at)
     VALUES (:rid, 'chute', :quand, :g, :acq)`,
  );
  const tombeurs = [...autres]
    .sort((a, b) => profils.get(b.id).fragilite - profils.get(a.id).fragilite)
    .slice(0, Math.max(0, PHYSIO.chutes - chutesDeja));
  for (const r of tombeurs) {
    insEvt.run({
      rid: r.id,
      quand: instant(0, entier(1, 20), entier(0, 59)),
      g: arrondi(entre(2.4, 5.8), 2),
      acq: rnd() < 0.7 ? instant(0, 21, entier(0, 59)) : null,
    });
  }
  etape("chutes detectees dans les 24 h", tombeurs.length + chutesDeja);

  // ------------------------------------------- indice de bien-etre et scores --
  // Les dates d'evaluation sont exactement les points des trois onglets de
  // l'ecran 02 (annee, mois, semaine). A chaque date on connait la moyenne
  // d'equipage visee ; on tire une population autour, puis on corrige l'ecart
  // restant pour que ROUND(AVG(score_moral),1) tombe juste.
  const cibles = new Map();
  const poser = (offsets, valeurs) =>
    offsets.forEach((o, i) => cibles.set(o, valeurs[i]));
  poser([360, 330, 300, 270, 240, 210, 180, 150, 120, 90, 60], COURBE_ANNEE);
  poser([30, 27, 24, 22, 21, 19, 16, 15, 14, 12, 9, 7],
        [75.1, 74.8, 74.2, 73.9, 74.0, 74.4, 73.6, 73.1, 73.0, 72.8, 73.3, 72.6]);
  poser([6, 5, 4, 3, 2, 1], COURBE_SEMAINE);
  cibles.set(0, INDICE_AUJOURDHUI);

  // Les 13 residents scriptes ont deja des evaluations : on ne les ecrase pas,
  // mais on les compte dans la moyenne du jour.
  const dejaEvalues = new Set(
    db
      .prepare("SELECT resident_id || '@' || evalue_le AS cle, score_moral FROM etat_mental")
      .all()
      .map((r) => r.cle),
  );
  const scoresExistants = new Map();
  for (const r of db
    .prepare("SELECT evalue_le, score_moral FROM etat_mental WHERE score_moral IS NOT NULL")
    .all()) {
    const acc = scoresExistants.get(r.evalue_le) ?? { somme: 0, n: 0 };
    acc.somme += r.score_moral;
    acc.n++;
    scoresExistants.set(r.evalue_le, acc);
  }

  const insEtat = db.prepare(`
    INSERT INTO etat_mental
      (resident_id, evalue_le, jour_vol, score_moral, phq9, gad7, isi, source)
    VALUES (:rid, :jour, :jv, :moral, :phq9, :gad7, :isi, 'questionnaire')
    ON CONFLICT (resident_id, evalue_le, source) DO NOTHING`);

  let nEtats = 0;
  const offsetsTries = [...cibles.keys()].sort((a, b) => b - a);

  for (const o of offsetsTries) {
    const date = jour(o);
    const cible = cibles.get(o);
    const jv = JOUR_VOL - o;

    // Qui reste a evaluer ce jour-la. R-0448 est inclus : ses quatre
    // evaluations scriptees sont conservees, mais il doit apparaitre aux
    // autres dates, sinon la courbe d'equipage compte 1 239 personnes
    // certains jours et 1 240 les autres.
    const aEvaluer = equipage.filter((r) => !dejaEvalues.has(`${r.id}@${date}`));
    if (aEvaluer.length === 0) continue;

    // Tirage autour de la cible, avec l'ecart personnel de chacun.
    const bruts = aEvaluer.map((r) => cible + profils.get(r.id).moral + normale(0, 3));

    // Correction : on translate toute la population pour que la moyenne du
    // jour — residents scriptes compris — tombe sur la cible.
    const dejaLa = scoresExistants.get(date) ?? { somme: 0, n: 0 };
    const total = cible * (dejaLa.n + bruts.length);
    const decalage = (total - dejaLa.somme - bruts.reduce((a, b) => a + b, 0)) / bruts.length;
    const scores = bruts.map((v) => Math.round(clamp(v + decalage, 5, 99)));

    // L'arrondi a l'entier laisse un reste : on le resorbe en deplacant
    // quelques scores d'un point, sur les residents les plus medians.
    let reste = Math.round(total - dejaLa.somme - scores.reduce((a, b) => a + b, 0));
    for (let i = 0; i < scores.length && reste !== 0; i++) {
      const pas = Math.sign(reste);
      const suivant = scores[i] + pas;
      if (suivant >= 5 && suivant <= 99) {
        scores[i] = suivant;
        reste -= pas;
      }
    }

    // Les scores de depistage suivent le moral : quelqu'un qui va mal coche
    // plus d'items. Le nombre exact de residents au-dessus du seuil est
    // impose sur la derniere evaluation seulement — c'est celle que lit
    // v_depistage_jour.
    const rangs = scores
      .map((s, i) => ({ i, s }))
      .sort((a, b) => a.s - b.s)
      .map((x, rang) => ({ ...x, rang }));
    // Certains residents scriptes sont deja au-dessus des seuils (Lyam en
    // PHQ-9 et ISI, Nour en GAD-7). On les compte plutot que de les supposer :
    // le jeu scripte peut changer sans casser les cibles.
    const deja = db
      .prepare(
        `SELECT COALESCE(SUM(phq9 >= 10), 0) AS phq9,
                COALESCE(SUM(gad7 >= 10), 0) AS gad7,
                COALESCE(SUM(isi  >= 15), 0) AS isi
           FROM etat_mental WHERE evalue_le = :date`,
      )
      .get({ date });
    const [pPhq9, pGad7, pIsi] = pctDepistage(o);
    const seuils = {
      phq9: Math.round((pPhq9 * EQUIPAGE) / 100) - deja.phq9,
      gad7: Math.round((pGad7 * EQUIPAGE) / 100) - deja.gad7,
      isi: Math.round((pIsi * EQUIPAGE) / 100) - deja.isi,
    };

    const parIndex = new Array(scores.length);
    for (const x of rangs) parIndex[x.i] = x.rang;

    for (let i = 0; i < aEvaluer.length; i++) {
      const rang = parIndex[i];
      const moral = scores[i];
      // Les residents au moral le plus bas sont ceux qui franchissent le
      // seuil : c'est ce que produirait un vrai questionnaire.
      const auDessus = (cle) => rang < seuils[cle];
      insEtat.run({
        rid: aEvaluer[i].id,
        jour: date,
        jv,
        moral,
        phq9: auDessus("phq9") ? entier(10, 22) : entier(0, 9),
        gad7: auDessus("gad7") ? entier(10, 18) : entier(0, 9),
        isi: auDessus("isi") ? entier(15, 26) : entier(0, 14),
      });
      nEtats++;
    }
  }
  etape(`evaluations de bien-etre (${offsetsTries.length} dates)`, nEtats);

  // ------------------------------------------------- signaux ouverts par module --
  const ouvertsParModule = Object.fromEntries(
    db
      .prepare(
        `SELECT SUBSTR(r.cabine,1,1) AS m, COUNT(*) AS n
           FROM signaux s JOIN residents r ON r.id = s.resident_id
          WHERE s.statut <> 'clos' GROUP BY 1`,
      )
      .all()
      .map((r) => [r.m, r.n]),
  );

  const MOTIFS_SIGNAL = [
    ["critique", "physio", "SpO₂ sous 92 % au repos pendant plus de 5 min"],
    ["critique", "conversation", "Verbalisation de désespoir détectée, dépistage C-SSRS positif"],
    ["critique", "physio", "HRV sous 18 ms depuis 4 jours consécutifs"],
    ["surveillance", "physio", "3 nuits consécutives sous 5 h 30"],
    ["surveillance", "physio", "HRV en baisse de plus de 30 % sur la base personnelle"],
    ["surveillance", "conversation", "Humeur basse rapportée sur 3 échanges consécutifs"],
    ["surveillance", "conversation", "Retrait social : invitations collectives déclinées"],
    ["surveillance", "physio", "Activité quotidienne en baisse de plus de 40 %"],
    ["info", "usage", "Usage du compagnon en forte hausse, interactions humaines en baisse"],
    ["info", "physio", "FC de repos au-dessus de la base personnelle depuis 6 jours"],
  ];

  // Les signaux qu'un moteur de regles ouvre au fil de l'eau, hors urgence.
  const SIGNAUX_COURANTS = MOTIFS_SIGNAL.filter(([sev]) => sev !== "critique");

  // Fenetre d'ouverture, en minutes depuis minuit. Le dernier signal scripte
  // de gravite « surveillance » tombe a 09:15 (+555) ; on ouvre juste apres,
  // et on s'arrete a l'heure courante. Le sixieme scripte, a 11:02, est de
  // gravite « info » : la file etant triee par gravite d'abord, il reste en
  // bas quoi qu'il arrive. Lance tot le matin, le generateur garde quand meme
  // une demi-heure de fenetre — mieux vaut des horaires serres que des
  // horaires a venir.
  const DEBUT_SIGNAUX = 556;
  const minuit = new Date();
  minuit.setHours(0, 0, 0, 0);
  const maintenant = Math.floor((Date.now() - minuit.getTime()) / 60000);
  const finSignaux = Math.min(1439, Math.max(maintenant - 2, DEBUT_SIGNAUX + 30));

  const insSignal = db.prepare(`
    INSERT INTO signaux
      (resident_id, severite, motif, origine, ouvert_at, assigne_id, assigne_a, statut)
    VALUES (:rid, :severite, :motif, :origine, :quand, :assigne_id, :assigne_a, :statut)`);
  const majStatut = db.prepare("UPDATE residents SET statut = :statut WHERE id = :rid");

  let nSignaux = 0;
  for (const mod of MODULES) {
    const manque = mod.signaux - (ouvertsParModule[mod.code] ?? 0);
    // Les plus fragiles du module declenchent les signaux : c'est ce que
    // ferait le moteur de regles a partir des constantes ci-dessus.
    const candidats = autres
      .filter((r) => r.module === mod.code)
      .sort((a, b) => profils.get(b.id).fragilite - profils.get(a.id).fragilite)
      .slice(0, Math.max(0, manque));

    for (const r of candidats) {
      // Pas de signal critique genere : les trois seuls de la journee sont
      // ceux du jeu scripte. Trois urgences vitales par jour pour 1 240
      // personnes est deja beaucoup ; une dizaine ne serait pas credible, et
      // noierait la file de triage sous des cas qui ne racontent rien.
      const [severite, origine, motif] = piocher(SIGNAUX_COURANTS);
      const assigne = rnd() < 0.62 ? tirerSoignant() : { assigne_id: null, assigne_a: null };
      insSignal.run({
        rid: r.id,
        severite,
        motif,
        origine,
        ...assigne,
        // Ouverts apres le dernier signal scripte (09:15) et jamais dans le
        // futur. Deux contraintes a la fois : la file de triage trie par
        // gravite puis par anciennete, donc les six scriptes du matin doivent
        // rester en tete ; et l'ecran des alertes recentes affiche des heures,
        // or une alerte ouverte dans huit heures ne veut rien dire.
        quand: aujourdhuiA(entier(DEBUT_SIGNAUX, finSignaux)),
        statut:
          (assigne.assigne_id || assigne.assigne_a) && rnd() < 0.5 ? "en_cours" : "ouvert",
      });
      majStatut.run({ rid: r.id, statut: severite === "critique" ? "critique" : "surveillance" });
      nSignaux++;
    }
  }
  etape("signaux ouverts crees", nSignaux);

  // Des signaux clos, pour que la file de triage ne soit pas la seule histoire
  // que la base raconte : on doit pouvoir mesurer ce qui a ete traite.
  let nClos = 0;
  for (const r of [...autres].sort(() => rnd() - 0.5).slice(0, 180)) {
    const [severite, origine, motif] = piocher(MOTIFS_SIGNAL);
    const ouvert = entier(11, 90);
    db.prepare(
      `INSERT INTO signaux
         (resident_id, severite, motif, origine, ouvert_at, assigne_id, assigne_a,
          statut, clos_at, clos_motif)
       VALUES (:rid, :severite, :motif, :origine, :ouvert, :assigne_id, :assigne_a,
               'clos', :clos, :raison)`,
    ).run({
      rid: r.id,
      severite,
      motif,
      origine,
      ouvert: instant(ouvert, entier(0, 23), entier(0, 59)),
      ...tirerSoignant(),
      clos: instant(ouvert - entier(1, 6), entier(8, 19), entier(0, 59)),
      raison: piocher([
        "Entretien réalisé, retour à la normale",
        "Faux positif : artefact de mesure confirmé",
        "Traitement ajusté, suivi programmé",
        "Pris en charge par la psychologue de bord",
      ]),
    });
    nClos++;
  }
  etape("signaux clos (historique de traitement)", nClos);

  // ------------------------------------------------------------ conversations --
  //
  //  Rappel : ces lignes ne contiennent AUCUN verbatim. Le modele tourne dans
  //  la borne, en cabine ; il n'envoie ici que le resume clinique qu'il a
  //  produit. Les resumes ci-dessous sont ecrits a la main, par motif, pour
  //  ressembler a ce que la borne remonterait — jamais a ce que le resident
  //  a dit.
  //
  const RESUMES = {
    "Troubles du sommeil": [
      "Endormissement difficile rapporté sur plusieurs nuits. Exercice de respiration proposé et suivi. Aucun marqueur d'humeur basse sur l'échange.",
      "Réveils nocturnes attribués au bruit de ventilation du module. Demande de contrôle acoustique transmise à la maintenance.",
      "Sommeil fractionné depuis le changement de quart. Recalage lumineux proposé, accepté pour une semaine d'essai.",
    ],
    "Humeur basse": [
      "Sentiment d'inutilité exprimé après un incident de service. Repli verbal marqué en fin d'échange. Dépistage d'idéation suicidaire négatif.",
      "Perte d'intérêt rapportée pour les activités collectives. Contact avec la psychologue de bord proposé, refusé.",
      "Lassitude générale, ton monocorde sur l'ensemble de l'échange. Entretien de suivi proposé et accepté.",
    ],
    "Anxiété, stress chronique": [
      "Anticipation anxieuse liée à la manœuvre de correction de trajectoire. Marqueurs prosodiques de tension sur toute la conversation.",
      "Tension continue rapportée depuis trois semaines. Exercice de relaxation proposé, suivi jusqu'au bout.",
      "Préoccupations répétées sur l'autonomie en eau du module. Information factuelle transmise, apaisement observé en fin d'échange.",
    ],
    "Isolement social": [
      "Troisième repas collectif décliné cette semaine. Appel à un proche proposé, refusé à deux reprises.",
      "Aucune interaction hors service rapportée depuis dix jours. Mise en relation avec le groupe de marche proposée.",
      "Retrait progressif des activités communes. Le résident évoque une fatigue sociale plutôt qu'un conflit.",
    ],
    "Désynchronisation circadienne": [
      "Coucher repoussé de plus de trois heures depuis la bascule du cycle lumineux. Avance progressive de la lumière de cabine proposée.",
      "Décalage installé après une semaine de quart de nuit. Protocole de recalage proposé sur dix jours.",
      "Horaires de sommeil erratiques sur la quinzaine. Suivi par le bracelet proposé et accepté.",
    ],
    "Dépendance au compagnon": [
      "Durée d'usage quotidienne en forte hausse, interactions humaines en baisse sur la même période. Point abordé directement avec le résident.",
      "Le résident sollicite le compagnon plusieurs fois par nuit. Cadre d'usage rediscuté et accepté.",
    ],
  };

  const insConv = db.prepare(`
    INSERT INTO conversations
      (resident_id, debut_at, jour_vol, duree_min, severite, resume,
       actions_proposees, actions_acceptees, remontee_auto, resident_notifie_at)
    VALUES (:rid, :debut, :jv, :duree, :severite, :resume, :prop, :acc,
            :auto, :notifie)`);
  const insTag = db.prepare(
    "INSERT INTO conversation_tags (conversation_id, tag) VALUES (:cid, :tag)",
  );

  // Un jeton par etiquette a placer : le total de chaque motif est impose par
  // la maquette, on tire juste l'ordre. Ce que le jeu scripte a deja pose
  // dans la fenetre de 30 jours est deduit de la cible.
  const tagsDeja = Object.fromEntries(
    db
      .prepare(
        `SELECT t.tag, COUNT(*) AS n
           FROM conversation_tags t
           JOIN conversations c ON c.id = t.conversation_id
          WHERE c.debut_at >= datetime('now', '-30 days')
          GROUP BY t.tag`,
      )
      .all()
      .map((r) => [r.tag, r.n]),
  );
  const jetons = [];
  for (const [motif, n] of MOTIFS) {
    for (let i = 0; i < Math.max(0, n - (tagsDeja[motif] ?? 0)); i++) jetons.push(motif);
  }
  for (let i = jetons.length - 1; i > 0; i--) {
    const j = entier(0, i);
    [jetons[i], jetons[j]] = [jetons[j], jetons[i]];
  }

  let nConv = 0;
  let nTags = 0;
  let curseur = 0;
  while (curseur < jetons.length) {
    // Une conversation porte une ou deux etiquettes, jamais deux fois la meme.
    const tags = [jetons[curseur++]];
    if (curseur < jetons.length && rnd() < 0.28 && jetons[curseur] !== tags[0]) {
      tags.push(jetons[curseur++]);
    }

    const r = piocher(autres);
    const o = entier(0, 29);
    const severite = rnd() < 0.08 ? "critique" : rnd() < 0.42 ? "surveillance" : "info";
    const prop = entier(0, 3);
    const { lastInsertRowid } = insConv.run({
      rid: r.id,
      debut: instant(o, entier(19, 23), entier(0, 59)),
      jv: JOUR_VOL - o,
      duree: entier(4, 44),
      severite,
      resume: piocher(RESUMES[tags[0]]),
      prop,
      acc: entier(0, prop),
      auto: severite === "info" ? 0 : 1,
      notifie: instant(o, 23, 59),
    });
    for (const tag of tags) {
      insTag.run({ cid: Number(lastInsertRowid), tag });
      nTags++;
    }
    nConv++;
  }
  etape("conversations sur 30 jours", nConv);
  etape("etiquettes de motif posees", nTags);

  // Le compteur "138 conversations" de la fiche de Lyam doit etre un COUNT,
  // pas un nombre ecrit dans l'interface. On complete son historique.
  const CIBLE_LYAM = 138;
  const dejaLyam = db
    .prepare("SELECT COUNT(*) AS n FROM conversations WHERE resident_id = :rid")
    .get({ rid: SCRIPTE }).n;
  for (let i = 0; i < CIBLE_LYAM - dejaLyam; i++) {
    const o = entier(31, 900);
    const tag = piocher(Object.keys(RESUMES));
    const prop = entier(0, 2);
    const { lastInsertRowid } = insConv.run({
      rid: SCRIPTE,
      debut: instant(o, entier(19, 23), entier(0, 59)),
      jv: JOUR_VOL - o,
      duree: entier(4, 38),
      severite: rnd() < 0.2 ? "surveillance" : "info",
      resume: piocher(RESUMES[tag]),
      prop,
      acc: entier(0, prop),
      auto: 0,
      notifie: instant(o, 23, 59),
    });
    insTag.run({ cid: Number(lastInsertRowid), tag });
  }
  etape("conversations dans l'historique de R-0448", CIBLE_LYAM);

  // ------------------------------------------------------ bilans sanguins --
  //
  //  Une consultation avec prise de sang toutes les deux semaines, decalee
  //  d'un resident a l'autre : les 1 240 personnes ne defilent pas le meme
  //  jour, elles s'etalent sur le cycle. Trois bilans chacune, soit six
  //  semaines d'historique — assez pour qu'une ferritine basse mise sous
  //  traitement remonte visiblement d'un bilan au suivant.
  //
  //  Les bornes sont celles d'un laboratoire d'adulte, arrondies. Elles sont
  //  ecrites AVEC chaque resultat (colonnes ref_bas / ref_haut) parce qu'un
  //  resultat se relit des annees plus tard avec les bornes de son epoque.
  //
  const MARQUEURS = [
    ["cellules_sanguines", "Hémoglobine", "g/dL", 13, 17],
    ["cellules_sanguines", "Leucocytes", "10⁹/L", 4, 10],
    ["cellules_sanguines", "Plaquettes", "10⁹/L", 150, 400],
    ["cellules_sanguines", "Hématocrite", "%", 40, 52],
    ["fer", "Ferritine", "µg/L", 30, 300],
    ["fer", "Fer sérique", "µmol/L", 11, 28],
    ["foie", "ALAT", "U/L", 10, 45],
    ["foie", "ASAT", "U/L", 10, 40],
    ["reins", "Créatinine", "µmol/L", 60, 110],
    ["reins", "Débit de filtration glomérulaire", "mL/min", 90, 140],
    ["sucre", "Glycémie à jeun", "g/L", 0.7, 1.05],
    ["sucre", "HbA1c", "%", 4, 5.6],
    ["thyroide", "TSH", "mUI/L", 0.4, 4],
    ["thyroide", "T4 libre", "pmol/L", 12, 22],
    ["electrolytes", "Sodium", "mmol/L", 135, 145],
    ["electrolytes", "Potassium", "mmol/L", 3.5, 5],
    ["electrolytes", "Calcium", "mmol/L", 2.2, 2.6],
    ["inflammation", "CRP", "mg/L", 0, 5],
    ["inflammation", "Vitesse de sédimentation", "mm/h", 0, 15],
    ["lipides", "Cholestérol total", "g/L", 1.4, 2],
    ["lipides", "LDL", "g/L", 0.7, 1.3],
    ["lipides", "HDL", "g/L", 0.4, 0.8],
    ["lipides", "Triglycérides", "g/L", 0.5, 1.5],
    ["vitamines", "Vitamine D", "nmol/L", 50, 125],
    ["vitamines", "Vitamine B12", "pmol/L", 150, 650],
    ["vitamines", "Folates", "nmol/L", 7, 45],
    ["hormones", "Cortisol matinal", "nmol/L", 170, 500],
    ["hormones", "DHEA-S", "µmol/L", 2, 9],
  ];

  /**
   * Le seul marqueur qualitatif du panel, et il est la pour une raison : il
   * n'a pas de valeur numerique, seulement un resultat en toutes lettres.
   * C'est le cas que les deux colonnes de `analyses_sang` doivent savoir
   * porter, et le laisser dans le jeu de demonstration evite qu'on « simplifie »
   * un jour le schema en une seule colonne REAL.
   */
  const QUALITATIF = ["inflammation", "Recherche d'agent infectieux"];

  /** Situe une valeur par rapport a ses bornes. */
  function interpreter(v, bas, haut) {
    if (v < bas) return v < bas * 0.7 ? "critique" : "bas";
    if (v > haut) return v > haut * 1.5 ? "critique" : "eleve";
    return "normal";
  }

  const insBilan = db.prepare(`
    INSERT INTO bilans_sanguins
      (resident_id, medecin_id, preleve_le, jour_vol, prochain_le, statut,
       commentaire, source)
    VALUES (:rid, :mid, :preleve, :jv, :prochain, 'rendu', :commentaire, 'simule')`);
  const insAnalyse = db.prepare(`
    INSERT INTO analyses_sang
      (bilan_id, panel, marqueur, valeur_num, valeur_texte, unite, ref_bas,
       ref_haut, interpretation)
    VALUES (:bid, :panel, :marqueur, :num, :texte, :unite, :bas, :haut, :interpretation)`);

  const idsMedecins = [...medecinParNom.values()];
  const tousResidents = db.prepare("SELECT id, statut FROM residents ORDER BY id").all();

  /**
   * Indice de fragilite, en ecarts-types : 0 est la moyenne de l'equipage,
   * au-dessus on va moins bien. Les residents generes en ont un, tire avec
   * leur profil physiologique. Les treize residents scriptes n'en ont pas —
   * ils viennent du seed SQL — alors on le deduit de leur statut, plutot que
   * de leur donner des analyses de manuel alors que l'ecran les montre sous
   * surveillance.
   */
  const fragiliteDe = (r) =>
    profils.get(r.id)?.fragilite ??
    (r.statut === "critique" ? 1.7 : r.statut === "surveillance" ? 1.0 : -0.1);

  let nBilans = 0;
  let nAnalyses = 0;
  for (const [rang, r] of tousResidents.entries()) {
    // Le profil physiologique du resident tire aussi ses analyses : quelqu'un
    // que le bracelet voit mal dormir depuis des semaines n'a pas, par
    // hasard, une ferritine de manuel.
    const fragilite = fragiliteDe(r);
    const decalage = rang % 14;

    for (const rappel of [0, 1, 2]) {
      const jours = decalage + rappel * 14;
      const { lastInsertRowid } = insBilan.run({
        rid: r.id,
        mid: piocher(idsMedecins),
        preleve: jour(jours),
        jv: JOUR_VOL - jours,
        // Quinze jours plus tard. Pour le bilan le plus recent, cette date
        // est dans le futur : c'est le prochain rendez-vous, et c'est elle
        // que la fiche affiche.
        prochain: jour(jours - 14),
        commentaire:
          rnd() < 0.12
            ? piocher([
                "Contrôle de suivi, pas de plainte nouvelle.",
                "Supplémentation en cours, à recontrôler au prochain cycle.",
                "Prélèvement à jeun respecté.",
                "Fatigue rapportée en consultation, bilan élargi.",
              ])
            : null,
      });
      const bid = Number(lastInsertRowid);
      nBilans++;

      for (const [panel, marqueur, unite, bas, haut] of MARQUEURS) {
        const milieu = (bas + haut) / 2;
        const etendue = haut - bas;
        // La derive suit la fragilite, et s'attenue avec les bilans anciens :
        // l'ecart se creuse vers aujourd'hui plutot que d'etre constant.
        const derive = fragilite * etendue * 0.2 * (1 - rappel * 0.25);
        const sens = ["Ferritine", "Vitamine D", "HDL", "Hémoglobine"].includes(marqueur)
          ? -1 // ces marqueurs BAISSENT quand ca va moins bien
          : ["CRP", "Vitesse de sédimentation", "Cortisol matinal", "HbA1c"].includes(marqueur)
            ? 1 // ceux-la montent
            : 0; // les autres ne suivent pas l'etat general
        const brut = milieu + sens * derive + normale(0, etendue * 0.27);
        const decimales = etendue < 3 ? 2 : etendue < 40 ? 1 : 0;
        // Un dosage ne rend pas zero : sous le seuil de detection, le
        // laboratoire ecrit la plus petite valeur qu'il sait lire.
        const plancher = bas > 0 ? 0 : decimales === 0 ? 1 : 0.1;
        const v = Math.max(arrondi(brut, decimales), plancher);

        insAnalyse.run({
          bid,
          panel,
          marqueur,
          num: v,
          texte: null,
          unite,
          bas,
          haut,
          interpretation: interpreter(v, bas, haut),
        });
        nAnalyses++;
      }

      insAnalyse.run({
        bid,
        panel: QUALITATIF[0],
        marqueur: QUALITATIF[1],
        num: null,
        texte: rnd() < 0.04 ? "Traces, à recontrôler" : "Négatif",
        unite: null,
        bas: null,
        haut: null,
        interpretation: "normal",
      });
      nAnalyses++;
    }
  }
  etape("bilans sanguins (3 par resident, un cycle de 14 jours)", nBilans);
  etape("analyses du sang", nAnalyses);

  // Trois des six notes de dossier sont signees, trois ne le sont pas.
  // C'est volontaire : les notes anterieures aux comptes n'ont pas d'auteur
  // et n'en auront jamais, et l'ecran doit montrer les deux cas plutot que de
  // laisser croire que la signature est acquise partout.
  const majAuteur = db.prepare("UPDATE particularites SET auteur_id = :mid WHERE id = :id");
  const aSigner = db.prepare("SELECT id FROM particularites ORDER BY id LIMIT 3").all();
  aSigner.forEach((n, i) => majAuteur.run({ id: n.id, mid: idsMedecins[i % idsMedecins.length] }));
  etape("notes de dossier signees (sur 6)", aSigner.length);

  // ------------------------------------------------- mesures a la minute --
  // `mesures` est la table que les bornes remplissent en continu. On en
  // remplit une journee pour quelques residents : c'est ce qui permet de
  // verifier `npm run db:rollup`, qui recalcule `mesures_jour` a partir
  // d'elle. Sans ces lignes, le rollup n'a rien a agreger et on ne saurait
  // pas s'il fonctionne.
  //
  // La journee choisie est J-2, PAS hier : les six barres d'alertes de
  // l'ecran 02 lisent la ligne d'hier, calibree plus haut. Un rollup lance
  // sur hier la remplacerait et ferait bouger les pourcentages.
  const insMesure = db.prepare(`
    INSERT INTO mesures
      (resident_id, bracelet_id, mesure_at, fc_bpm, rmssd_ms, spo2_pct,
       resp_min, temp_c, eda_us, activite_g, pas, dort, source, qualite)
    VALUES (:rid, :bid, :quand, :fc, :rmssd, :spo2, :resp, :temp, :eda,
            :act, :pas, :dort, :source, :qualite)
    ON CONFLICT (resident_id, mesure_at) DO NOTHING`);

  const JOUR_MESURES = 2;
  const temoins = autres.slice(0, 3);
  let nMesures = 0;
  for (const r of temoins) {
    const p = profils.get(r.id);
    const bid = db
      .prepare("SELECT id FROM bracelets WHERE resident_id = :rid")
      .get({ rid: r.id })?.id ?? null;
    let pas = 0;
    for (let minute = 0; minute < 1440; minute += 1) {
      const heure = Math.floor(minute / 60);
      const dort = heure < 6 || heure >= 23 ? 1 : 0;
      // La nuit : FC basse, RMSSD haut, pas de pas. C'est exactement le
      // signal que le bracelet cherche pour estimer le sommeil.
      const fc = clamp(p.fcRepos + (dort ? -6 : entre(4, 26)) + normale(0, 3), 40, 150);
      if (!dort && rnd() < 0.55) pas += entier(0, 14);
      const d = new Date(AUJOURDHUI.getTime() - JOUR_MESURES * MS_JOUR);
      d.setHours(0, minute, 0, 0);
      const pad = (x) => String(x).padStart(2, "0");
      insMesure.run({
        rid: r.id,
        bid,
        quand:
          `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
          `${pad(d.getHours())}:${pad(d.getMinutes())}:00`,
        fc: arrondi(fc),
        rmssd: arrondi(clamp(p.rmssd + (dort ? 9 : -4) + normale(0, 5), 6, 99)),
        spo2: arrondi(clamp(p.spo2 + normale(0, 0.6), 85, 100)),
        resp: arrondi(clamp(p.resp + (dort ? -1.5 : 0) + normale(0, 1), 7, 28)),
        temp: arrondi(clamp(p.temp + (dort ? -0.2 : 0) + normale(0, 0.12), 32, 36), 2),
        eda: arrondi(clamp(p.eda + (dort ? -0.4 : 0) + normale(0, 0.25), 0.2, 9), 2),
        act: arrondi(dort ? entre(0, 0.04) : entre(0.02, 0.9), 3),
        pas,
        dort,
        // FC et RMSSD viennent du capteur ; le reste est simule, et la
        // colonne le dit. C'est la meme honnetete que dans l'interface.
        source: "mesure",
        qualite: rnd() < 0.04 ? "fair" : "good",
      });
      nMesures++;
    }
  }
  etape(`mesures a la minute (${temoins.length} residents, J-${JOUR_MESURES})`, nMesures);

  db.exec("COMMIT");
} catch (e) {
  db.exec("ROLLBACK");
  console.error("\nEchec, rien n'a ete ecrit :\n  " + e.message);
  db.close();
  process.exit(1);
}

console.log(`\nJeu de test genere dans ${FICHIER} :\n`);
console.log(etapes.join("\n"));
console.log(`\n  en ${((Date.now() - debut) / 1000).toFixed(1)} s`);

// Les comptes ne servent a rien si personne ne sait s'y connecter. On les
// rappelle ici plutot que dans un fichier : ce sont des comptes de
// demonstration sur une base synthetique et locale, et ils se regenerent a
// chaque `npm run db:reset`.
const colonne = (r, c, email, mdp) =>
  `  ${r.padEnd(8)} ${c.padEnd(6)} ${email.padEnd(32)} ${mdp}`;

console.log(
  "\nComptes de demonstration\n\n" +
    MEDECINS.map((m) =>
      colonne(
        "medecin",
        m.code,
        `${m.prenom}.${m.nom}@meridien.vol`.toLowerCase(),
        MDP_DEMO,
      ),
    ).join("\n") +
    "\n" +
    ADMINS.map((a) => colonne("admin", "—", a.email, a.mdp ?? MDP_DEMO)).join("\n") +
    "\n\n  L'administrateur ouvre la console ET le backoffice ; le medecin\n" +
    "  ouvre la console, et c'est lui qui signe les notes de dossier.\n" +
    "  Pour un compte reel : npm run compte -- medecin\n",
);
db.close();
