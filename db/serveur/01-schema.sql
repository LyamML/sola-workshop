-- =============================================================================
--  Sola — base du serveur de bord (SQLite)
--
--  C'est la base QUE LE MEDECIN LIT. Elle ne contient aucune transcription de
--  conversation : celles-ci restent dans la cabine, dans la base de la borne
--  (db/borne/01-schema.sql). La frontiere est ici, dans le schema.
--
--  Toutes les tables sont STRICT : SQLite refuse alors d'ecrire une chaine
--  dans une colonne INTEGER ou REAL. C'est exactement ce qu'on veut apres
--  avoir banni les `varchar(255)` : une frequence cardiaque est un nombre, et
--  la base le fait respecter au lieu de faire confiance au code.
--
--  Conventions
--    · identifiants en snake_case ASCII
--    · toute valeur mesuree est numerique et porte son unite dans son nom
--    · toute donnee affichee au medecin porte sa source (mesuree ou simulee)
--    · horodatages en TEXT ISO 8601 UTC : 'YYYY-MM-DD HH:MM:SS'
-- =============================================================================

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- Les enfants d'abord : avec `PRAGMA foreign_keys = ON`, supprimer une table
-- encore referencee echoue.
DROP TABLE IF EXISTS analyses_sang;
DROP TABLE IF EXISTS bilans_sanguins;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS conversation_tags;
DROP TABLE IF EXISTS conversations;
DROP TABLE IF EXISTS signaux;
DROP TABLE IF EXISTS evenements;
DROP TABLE IF EXISTS etat_mental;
DROP TABLE IF EXISTS nuits;
DROP TABLE IF EXISTS mesures_jour;
DROP TABLE IF EXISTS mesures;
DROP TABLE IF EXISTS suivis;
DROP TABLE IF EXISTS particularites;
DROP TABLE IF EXISTS bracelets;
DROP TABLE IF EXISTS medecins;
DROP TABLE IF EXISTS admins;
DROP TABLE IF EXISTS residents;

-- ----------------------------------------------------------------- comptes ---
--
--  Ces trois tables viennent en premier parce que `particularites` et
--  `signaux` les referencent : une note de dossier dit qui l'a ecrite, une
--  affectation dit a qui elle revient.
--
--  Le mot de passe n'est JAMAIS stocke, seulement son empreinte argon2id —
--  voir server/src/mdp.ts. La colonne s'appelle `mdp_hash` et non `mdp` :
--  le nom rappelle ce qu'on a le droit d'y mettre.
--
CREATE TABLE medecins (
  id                 INTEGER PRIMARY KEY,
  -- Matricule affiche au bas d'une note : M-007. Ce n'est pas un secret.
  code               TEXT NOT NULL UNIQUE,
  prenom             TEXT NOT NULL,
  nom                TEXT NOT NULL,
  -- Etiquette d'affichage, pour que la fiche ecrive « Dr. Nakamura ». Ce
  -- n'est pas un droit : un infirmier et un medecin ouvrent les memes ecrans.
  titre              TEXT NOT NULL DEFAULT 'Dr.' CHECK (titre IN ('Dr.','Inf.')),
  poste              TEXT NOT NULL DEFAULT 'Medecine de bord',
  email              TEXT NOT NULL UNIQUE,        -- range en minuscules
  mdp_hash           TEXT NOT NULL,               -- argon2id, jamais le mot de passe
  actif              INTEGER NOT NULL DEFAULT 1 CHECK (actif IN (0,1)),
  cree_le            TEXT NOT NULL DEFAULT (datetime('now')),
  derniere_connexion TEXT
) STRICT;

-- Ceux qui exploitent : corriger une donnee, reassigner un signal, regarder
-- les tables brutes. Meme forme, table separee — la separation est dans le
-- schema et non dans une clause WHERE qu'on peut oublier d'ecrire.
CREATE TABLE admins (
  id                 INTEGER PRIMARY KEY,
  prenom             TEXT NOT NULL,
  nom                TEXT NOT NULL,
  email              TEXT NOT NULL UNIQUE,
  mdp_hash           TEXT NOT NULL,
  actif              INTEGER NOT NULL DEFAULT 1 CHECK (actif IN (0,1)),
  cree_le            TEXT NOT NULL DEFAULT (datetime('now')),
  derniere_connexion TEXT
) STRICT;

-- L'identifiant stocke est l'EMPREINTE du cookie, pas le cookie : une copie
-- de la base ne donne aucune session ouverte. Le CHECK garantit qu'une
-- session appartient a un medecin OU a un admin, jamais aux deux.
CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,                    -- sha256 du jeton du cookie
  medecin_id INTEGER REFERENCES medecins (id) ON DELETE CASCADE,
  admin_id   INTEGER REFERENCES admins (id) ON DELETE CASCADE,
  ouverte_at TEXT NOT NULL DEFAULT (datetime('now')),
  vue_at     TEXT NOT NULL DEFAULT (datetime('now')),
  expire_at  TEXT NOT NULL,
  CHECK ((medecin_id IS NULL) <> (admin_id IS NULL))
) STRICT;

CREATE INDEX idx_sessions_expire ON sessions (expire_at);

-- --------------------------------------------------------------- identite ---
CREATE TABLE residents (
  id                INTEGER PRIMARY KEY,
  -- Identifiant affiche partout dans l'interface : R-0448.
  code              TEXT NOT NULL UNIQUE,
  prenom            TEXT NOT NULL,
  nom               TEXT NOT NULL,
  date_naissance    TEXT NOT NULL,
  poste             TEXT NOT NULL,
  -- Cabine : "C-12". Le premier caractere est le module, utilise par les
  -- agregats par module de l'ecran 02.
  cabine            TEXT NOT NULL,
  groupe_sanguin    TEXT NOT NULL
                    CHECK (groupe_sanguin IN ('A+','A-','B+','B-','AB+','AB-','O+','O-')),
  embarque_jour_vol INTEGER NOT NULL DEFAULT 0,
  statut            TEXT NOT NULL DEFAULT 'ok'
                    CHECK (statut IN ('ok','surveillance','critique')),
  -- Personne de confiance declaree par le resident (un autre resident).
  confiance_id      INTEGER REFERENCES residents (id) ON DELETE SET NULL,
  confiance_lien    TEXT,
  -- Le medecin qui suit ce resident au long cours. A ne pas confondre avec
  -- `bilans_sanguins.medecin_id`, qui dit qui a preleve ce jour-la, ni avec
  -- `particularites.auteur_id`, qui dit qui a signe une note : ces deux-la
  -- sont des actes, celui-ci est un rattachement. Pas d'ON DELETE, comme
  -- partout ou on pointe un compte : on desactive un medecin, on ne l'efface
  -- pas sous ses residents.
  medecin_traitant_id INTEGER REFERENCES medecins (id),
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

CREATE INDEX idx_residents_cabine ON residents (cabine);
CREATE INDEX idx_residents_statut ON residents (statut);
CREATE INDEX idx_residents_traitant ON residents (medecin_traitant_id);

CREATE TABLE bracelets (
  id           INTEGER PRIMARY KEY,
  serie        TEXT NOT NULL UNIQUE,              -- "BR-0448"
  resident_id  INTEGER REFERENCES residents (id) ON DELETE SET NULL,
  firmware     TEXT NOT NULL DEFAULT 'bracelet-i2c',
  batterie_pct INTEGER CHECK (batterie_pct IS NULL OR batterie_pct BETWEEN 0 AND 100),
  synchro_at   TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

-- Allergies, contre-indications, antecedents : une seule liste, parce que
-- c'est une seule liste a l'ecran. Le `type` porte la distinction, le
-- `niveau` porte l'urgence de lecture.
CREATE TABLE particularites (
  id          INTEGER PRIMARY KEY,
  resident_id INTEGER NOT NULL REFERENCES residents (id) ON DELETE CASCADE,
  type        TEXT NOT NULL
              CHECK (type IN ('allergie','contre_indication','antecedent','info')),
  niveau      TEXT NOT NULL DEFAULT 'info'
              CHECK (niveau IN ('critique','surveillance','info')),
  titre       TEXT NOT NULL,
  detail      TEXT NOT NULL,
  constate_le TEXT,
  -- Qui a ecrit la note. Pas d'ON DELETE : la base doit refuser d'effacer un
  -- medecin qui a signe des dossiers. Nullable, parce que les notes du jeu de
  -- demonstration anterieures aux comptes n'ont pas d'auteur et n'en auront
  -- jamais — on ne reinvente pas une signature.
  auteur_id   INTEGER REFERENCES medecins (id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

CREATE INDEX idx_particularites_resident ON particularites (resident_id, niveau);

-- Traitements en cours, rendez-vous, actions acceptees par le resident.
CREATE TABLE suivis (
  id                INTEGER PRIMARY KEY,
  resident_id       INTEGER NOT NULL REFERENCES residents (id) ON DELETE CASCADE,
  type              TEXT NOT NULL
                    CHECK (type IN ('traitement','action','rendez_vous','contact')),
  titre             TEXT NOT NULL,
  detail            TEXT NOT NULL,
  debut_jour_vol    INTEGER,
  echeance_jour_vol INTEGER,
  actif             INTEGER NOT NULL DEFAULT 1 CHECK (actif IN (0,1)),
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

CREATE INDEX idx_suivis_resident ON suivis (resident_id, actif);

-- ------------------------------------------------------------- constantes ---
-- Serie brute : une ligne par minute et par resident, telle que le bracelet
-- l'envoie. A 1 240 residents cela fait ~1,8 M lignes par jour : cette table
-- est ecrite en continu et lue rarement. La console lit `mesures_jour`.
CREATE TABLE mesures (
  id          INTEGER PRIMARY KEY,
  resident_id INTEGER NOT NULL REFERENCES residents (id) ON DELETE CASCADE,
  bracelet_id INTEGER REFERENCES bracelets (id) ON DELETE SET NULL,
  mesure_at   TEXT NOT NULL,

  fc_bpm     REAL,       -- frequence cardiaque
  rmssd_ms   REAL,       -- variabilite cardiaque
  spo2_pct   REAL,       -- NON CALIBREE, voir `source`
  resp_min   REAL,       -- frequence respiratoire
  temp_c     REAL,       -- temperature cutanee
  eda_us     REAL,       -- activite electrodermale (transpiration)
  activite_g REAL,       -- variation moyenne de l'acceleration
  pas        INTEGER,
  dort       INTEGER CHECK (dort IS NULL OR dort IN (0,1)),

  -- L'honnetete du prototype vit ici. Le bracelet KY-039 ne mesure que la FC
  -- et le RMSSD : tout le reste arrive en 'simule' tant qu'il est branche.
  source     TEXT NOT NULL DEFAULT 'mesure' CHECK (source IN ('mesure','simule')),
  qualite    TEXT NOT NULL DEFAULT 'good'
             CHECK (qualite IN ('good','fair','poor','warmup')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),

  CHECK (fc_bpm   IS NULL OR fc_bpm   BETWEEN 25 AND 220),
  CHECK (spo2_pct IS NULL OR spo2_pct BETWEEN 50 AND 100),
  -- Le bracelet peut reemettre apres une coupure BLE : la meme minute ne doit
  -- pas entrer deux fois.
  UNIQUE (resident_id, mesure_at)
) STRICT;

CREATE INDEX idx_mesures_serie ON mesures (resident_id, mesure_at DESC);

-- Agregat quotidien : c'est CE QUE LA CONSOLE LIT. Les huit tuiles de
-- constantes et leurs graphiques 14 jours sortent tous d'ici, en une requete.
CREATE TABLE mesures_jour (
  resident_id     INTEGER NOT NULL REFERENCES residents (id) ON DELETE CASCADE,
  jour            TEXT NOT NULL,
  jour_vol        INTEGER NOT NULL,

  fc_repos_bpm    REAL,   -- moyenne du decile le plus bas, pas la moyenne
  fc_moy_bpm      REAL,
  rmssd_ms        REAL,
  spo2_pct        REAL,
  resp_min        REAL,
  temp_c          REAL,
  eda_us          REAL,
  pas             INTEGER,
  minutes_valides INTEGER NOT NULL DEFAULT 0,
  source          TEXT NOT NULL DEFAULT 'mesure'
                  CHECK (source IN ('mesure','simule','mixte')),
  calcule_at      TEXT NOT NULL DEFAULT (datetime('now')),

  PRIMARY KEY (resident_id, jour)
) STRICT;

CREATE INDEX idx_mesures_jour_date ON mesures_jour (jour);

-- Une ligne par nuit et par resident. `sommeil_min` est une ESTIMATION du
-- bracelet (immobilite + baisse de FC), jamais une mesure — d'ou `source`.
-- Une nuit est rangee a la date du lever, comme le font les bracelets du
-- commerce : au jour J, la « derniere nuit » est celle qui a fini ce matin,
-- et elle se lit a cote des constantes du meme jour.
CREATE TABLE nuits (
  resident_id INTEGER NOT NULL REFERENCES residents (id) ON DELETE CASCADE,
  nuit_du     TEXT NOT NULL,              -- date du lever
  jour_vol    INTEGER NOT NULL,
  coucher_at  TEXT,
  lever_at    TEXT,
  sommeil_min INTEGER CHECK (sommeil_min IS NULL OR sommeil_min BETWEEN 0 AND 1440),
  latence_min INTEGER,                    -- delai d'endormissement
  eveils_min  INTEGER,                    -- eveils intra-sommeil
  source      TEXT NOT NULL DEFAULT 'estime'
              CHECK (source IN ('estime','simule','declare')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),

  PRIMARY KEY (resident_id, nuit_du)
) STRICT;

-- ----------------------------------------------------------- etat mental ---
-- Scores de depistage. Ce sont des SCORES, pas des paroles : c'est pour cela
-- qu'ils peuvent vivre dans la base du serveur sans trahir le resident.
CREATE TABLE etat_mental (
  id          INTEGER PRIMARY KEY,
  resident_id INTEGER NOT NULL REFERENCES residents (id) ON DELETE CASCADE,
  evalue_le   TEXT NOT NULL,
  jour_vol    INTEGER NOT NULL,
  score_moral INTEGER CHECK (score_moral IS NULL OR score_moral BETWEEN 0 AND 100),
  phq9        INTEGER CHECK (phq9 IS NULL OR phq9 BETWEEN 0 AND 27),  -- depression
  gad7        INTEGER CHECK (gad7 IS NULL OR gad7 BETWEEN 0 AND 21),  -- anxiete
  isi         INTEGER CHECK (isi  IS NULL OR isi  BETWEEN 0 AND 28),  -- insomnie
  -- Un score renseigne par le questionnaire n'a pas la meme valeur qu'un
  -- score deduit de la conversation par le modele. On ne les melange pas.
  source      TEXT NOT NULL
              CHECK (source IN ('questionnaire','conversation','simule')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),

  UNIQUE (resident_id, evalue_le, source)
) STRICT;

CREATE INDEX idx_etat_mental_date ON etat_mental (evalue_le);

-- --------------------------------------------------------- conversations ---
--
--  !! LIRE AVANT DE MODIFIER CETTE TABLE !!
--
--  Il n'y a PAS de colonne de transcription, et il ne doit jamais y en avoir.
--  Le modele de langage tourne dans la borne, en cabine, et n'envoie ici que
--  le resume clinique qu'il a produit. Ajouter une colonne `texte` ici
--  detruirait la garantie sur laquelle repose tout le projet.
--
--  Le service d'ingestion refuse explicitement toute charge utile contenant
--  un champ de transcription : voir server/src/validation.ts.
--
CREATE TABLE conversations (
  id                  INTEGER PRIMARY KEY,
  resident_id         INTEGER NOT NULL REFERENCES residents (id) ON DELETE CASCADE,
  debut_at            TEXT NOT NULL,
  jour_vol            INTEGER NOT NULL,
  duree_min           INTEGER NOT NULL,
  severite            TEXT NOT NULL
                      CHECK (severite IN ('critique','surveillance','info')),
  -- Resume clinique produit en cabine. Quelques phrases, jamais le verbatim.
  resume              TEXT NOT NULL,
  actions_proposees   INTEGER NOT NULL DEFAULT 0,
  actions_acceptees   INTEGER NOT NULL DEFAULT 0,
  -- 1 : un seuil clinique a ete franchi, la remontee est automatique
  -- 0 : remonte pour contexte seul
  remontee_auto       INTEGER NOT NULL DEFAULT 0 CHECK (remontee_auto IN (0,1)),
  -- Le resident est prevenu de chaque remontee. On horodate la notification :
  -- une promesse non tracee n'est pas une promesse.
  resident_notifie_at TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),

  CHECK (actions_acceptees <= actions_proposees)
) STRICT;

CREATE INDEX idx_conversations_resident ON conversations (resident_id, debut_at DESC);
CREATE INDEX idx_conversations_severite ON conversations (severite, debut_at DESC);

CREATE TABLE conversation_tags (
  conversation_id INTEGER NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  tag             TEXT NOT NULL,
  PRIMARY KEY (conversation_id, tag)
) STRICT;

CREATE INDEX idx_conversation_tags_tag ON conversation_tags (tag);

-- --------------------------------------------------- triage et evenements ---
-- La file de l'ecran 02 : ce que le medecin doit traiter aujourd'hui.
CREATE TABLE signaux (
  id          INTEGER PRIMARY KEY,
  resident_id INTEGER NOT NULL REFERENCES residents (id) ON DELETE CASCADE,
  severite    TEXT NOT NULL CHECK (severite IN ('critique','surveillance','info')),
  -- Ce qui a declenche le signal, en une phrase lisible par le medecin.
  motif       TEXT NOT NULL,
  -- D'ou vient le declenchement : utile pour mesurer les faux positifs.
  origine     TEXT NOT NULL
              CHECK (origine IN ('physio','conversation','chute','usage','manuel')),
  ouvert_at   TEXT NOT NULL,
  -- `assigne_id` designe une personne, `assigne_a` reste pour le seul cas qui
  -- n'en est pas une : « Equipe d'intervention ». Le texte libre ne disparait
  -- donc pas, il se limite a ce qu'une cle etrangere ne sait pas dire.
  assigne_id  INTEGER REFERENCES medecins (id),
  assigne_a   TEXT,                       -- NULL = non assigne
  statut      TEXT NOT NULL DEFAULT 'ouvert'
              CHECK (statut IN ('ouvert','en_cours','clos')),
  clos_at     TEXT,
  clos_motif  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

CREATE INDEX idx_signaux_file     ON signaux (statut, severite, ouvert_at);
CREATE INDEX idx_signaux_resident ON signaux (resident_id, ouvert_at DESC);

-- Chutes et secousses : rares, horodatees a la seconde, jamais agregees.
CREATE TABLE evenements (
  id          INTEGER PRIMARY KEY,
  resident_id INTEGER NOT NULL REFERENCES residents (id) ON DELETE CASCADE,
  type        TEXT NOT NULL
              CHECK (type IN ('chute','secousse','perte_contact','bouton_urgence')),
  survenu_at  TEXT NOT NULL,
  intensite_g REAL,
  acquitte_at TEXT,                       -- NULL = personne n'a repondu
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

CREATE INDEX idx_evenements_resident ON evenements (resident_id, survenu_at DESC);
CREATE INDEX idx_evenements_type     ON evenements (type, survenu_at DESC);

-- ------------------------------------------------------- bilans sanguins ---
--
--  Le seul examen de Sola qui ne vienne pas d'un capteur : toutes les deux
--  semaines, un medecin recoit le resident, preleve, et commente. Le bracelet
--  mesure en continu et ne sait rien du fer ni de la thyroide ; la prise de
--  sang sait, mais une fois tous les quinze jours. Les deux ne se remplacent
--  pas, d'ou deux tables separees de `mesures`.
--
CREATE TABLE bilans_sanguins (
  id          INTEGER PRIMARY KEY,
  resident_id INTEGER NOT NULL REFERENCES residents (id) ON DELETE CASCADE,
  -- Le medecin qui a recu le resident. Pas d'ON DELETE, comme pour une note :
  -- un compte ferme ne doit pas effacer les consultations qu'il a menees.
  medecin_id  INTEGER REFERENCES medecins (id),
  preleve_le  TEXT NOT NULL,
  jour_vol    INTEGER NOT NULL,
  -- Le rendez-vous suivant, pose au moment du prelevement. C'est cette date
  -- que la fiche affiche, et elle vaut `preleve_le` + 14 jours.
  prochain_le TEXT,
  statut      TEXT NOT NULL DEFAULT 'rendu'
              CHECK (statut IN ('planifie','preleve','rendu')),
  commentaire TEXT,
  source      TEXT NOT NULL DEFAULT 'analyse'
              CHECK (source IN ('analyse','simule')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),

  -- Un seul bilan par resident et par jour : une reemission du laboratoire ne
  -- doit pas doubler la ligne, comme pour les minutes du bracelet.
  UNIQUE (resident_id, preleve_le)
) STRICT;

CREATE INDEX idx_bilans_resident ON bilans_sanguins (resident_id, preleve_le DESC);
CREATE INDEX idx_bilans_prochain ON bilans_sanguins (prochain_le);

-- Une ligne par marqueur dose, et non onze colonnes fourre-tout.
--
-- DEUX COLONNES DE VALEUR, ET C'EST VOULU. On ne sait pas encore ce que
-- l'analyseur de bord rendra : un nombre pour l'hemoglobine, sans doute, mais
-- peut-etre « traces » ou « non detecte » pour un marqueur qualitatif. Plutot
-- que de tout mettre en texte — ce qui interdirait AVG(), une courbe et un
-- seuil — on garde le nombre en REAL quand il y en a un, le texte a cote
-- quand il n'y en a pas, et le CHECK impose qu'au moins l'un des deux soit la.
--
-- Les bornes de reference voyagent avec le resultat plutot que de vivre dans
-- une table de reference : elles dependent de l'appareil et de la date du
-- dosage, et un resultat de l'an dernier doit rester lisible avec les bornes
-- de l'an dernier.
CREATE TABLE analyses_sang (
  id             INTEGER PRIMARY KEY,
  bilan_id       INTEGER NOT NULL REFERENCES bilans_sanguins (id) ON DELETE CASCADE,
  -- Les onze groupes du modele d'origine, en snake_case ASCII.
  panel          TEXT NOT NULL CHECK (panel IN (
                   'cellules_sanguines','fer','foie','reins','sucre','thyroide',
                   'electrolytes','inflammation','lipides','vitamines','hormones')),
  marqueur       TEXT NOT NULL,            -- "Hémoglobine", "Ferritine"…
  valeur_num     REAL,
  valeur_texte   TEXT,
  unite          TEXT,                     -- "g/dL", "µg/L"…
  ref_bas        REAL,
  ref_haut       REAL,
  -- Calculee a l'ecriture : l'interface n'a pas a redecider si 11,2 g/dL est
  -- bas, et un marqueur purement textuel n'a pas de bornes a comparer.
  interpretation TEXT NOT NULL DEFAULT 'normal'
                 CHECK (interpretation IN ('normal','bas','eleve','critique')),

  CHECK (valeur_num IS NOT NULL OR valeur_texte IS NOT NULL),
  UNIQUE (bilan_id, marqueur)
) STRICT;

CREATE INDEX idx_analyses_bilan ON analyses_sang (bilan_id, panel);
CREATE INDEX idx_analyses_anormales ON analyses_sang (interpretation)
  WHERE interpretation <> 'normal';
