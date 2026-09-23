-- =============================================================================
--  REFERENCE DE MODELISATION — NON EXECUTEE
--
--  Ce fichier est la version MySQL du schema, gardee parce que c'est le
--  format du modele que l'equipe fait evoluer sur dbdiagram.io. La base qui
--  tourne reellement est en SQLite : db/serveur/01-schema.sql.
--
--  Les deux decrivent les memes 17 tables. Si vous modifiez l'une, modifiez
--  l'autre — ou supprimez celle-ci le jour ou dbdiagram ne sert plus.
-- =============================================================================

-- =============================================================================
--  Sola — base du serveur de bord (MySQL 8)
--
--  C'est la base QUE LE MEDECIN LIT. Elle ne contient aucune transcription de
--  conversation : celles-ci restent dans la cabine, dans la base SQLite de la
--  borne (db/borne/01-schema.sql). La frontiere est ici, dans le schema.
--
--  Conventions
--    · identifiants en snake_case ASCII : pas de backticks, pas d'accents
--    · toute valeur mesuree est numerique et porte son unite dans son nom
--    · toute donnee affichee au medecin porte sa source (mesuree ou simulee)
-- =============================================================================

CREATE DATABASE IF NOT EXISTS sola
  CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE sola;

SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS analyses_sang, bilans_sanguins, conversation_tags,
  conversations, signaux, evenements, etat_mental, nuits, mesures_jour,
  mesures, suivis, particularites, bracelets, residents,
  sessions, medecins, admins;
SET FOREIGN_KEY_CHECKS = 1;

-- ---------------------------------------------------------------- comptes ---
-- Qui lit les dossiers, et qui a ecrit quoi dedans. Ces tables viennent avant
-- `residents` parce que `particularites` et `signaux` les referencent : une
-- note de dossier porte le nom de celui qui l'a ecrite.
--
-- `mdp_hash` contient une empreinte argon2id, jamais un mot de passe. Le
-- format stocke inclut le sel et les parametres, d'ou la longueur.
CREATE TABLE medecins (
  id                 INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  -- Matricule affiche a l'ecran : M-001.
  code               CHAR(5)      NOT NULL UNIQUE,
  prenom             VARCHAR(80)  NOT NULL,
  nom                VARCHAR(80)  NOT NULL,
  titre              ENUM('Dr.','Inf.') NOT NULL DEFAULT 'Dr.',
  poste              VARCHAR(80)  NOT NULL DEFAULT 'Medecine de bord',
  email              VARCHAR(160) NOT NULL UNIQUE,
  mdp_hash           VARCHAR(255) NOT NULL,
  -- On desactive, on ne supprime pas : une note signee par un soignant parti
  -- perdrait son auteur.
  actif              BOOLEAN      NOT NULL DEFAULT TRUE,
  cree_le            TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  derniere_connexion DATETIME     NULL
) ENGINE = InnoDB;

-- Administration du bord : le backoffice, les tables, les comptes. Pas de
-- matricule ni de titre — un administrateur ne signe pas de note clinique.
CREATE TABLE admins (
  id                 INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  prenom             VARCHAR(80)  NOT NULL,
  nom                VARCHAR(80)  NOT NULL,
  email              VARCHAR(160) NOT NULL UNIQUE,
  mdp_hash           VARCHAR(255) NOT NULL,
  actif              BOOLEAN      NOT NULL DEFAULT TRUE,
  cree_le            TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  derniere_connexion DATETIME     NULL
) ENGINE = InnoDB;

-- Sessions ouvertes. `id` est le SHA-256 du jeton pose dans le cookie, pas le
-- jeton : une copie de la base ne donne acces a aucune session ouverte.
CREATE TABLE sessions (
  id           CHAR(64)     PRIMARY KEY,
  medecin_id   INT UNSIGNED NULL,
  admin_id     INT UNSIGNED NULL,
  ouverte_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  vue_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expire_at    DATETIME     NOT NULL,

  CONSTRAINT fk_sessions_medecin
    FOREIGN KEY (medecin_id) REFERENCES medecins (id) ON DELETE CASCADE,
  CONSTRAINT fk_sessions_admin
    FOREIGN KEY (admin_id) REFERENCES admins (id) ON DELETE CASCADE,
  -- Une session appartient a un compte et a un seul.
  CONSTRAINT chk_sessions_proprietaire
    CHECK ((medecin_id IS NULL) <> (admin_id IS NULL)),
  INDEX idx_sessions_expire (expire_at)
) ENGINE = InnoDB;

-- --------------------------------------------------------------- identite ---
CREATE TABLE residents (
  id                 INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  -- Identifiant affiche partout dans l'interface : R-0448.
  code               CHAR(6)      NOT NULL UNIQUE,
  prenom             VARCHAR(80)  NOT NULL,
  nom                VARCHAR(80)  NOT NULL,
  date_naissance     DATE         NOT NULL,
  poste              VARCHAR(80)  NOT NULL,
  -- Cabine : "C-12". Le premier caractere est le module, utilise par les
  -- agregats par module de l'ecran 02.
  cabine             CHAR(4)      NOT NULL,
  groupe_sanguin     ENUM('A+','A-','B+','B-','AB+','AB-','O+','O-') NOT NULL,
  embarque_jour_vol  INT UNSIGNED NOT NULL DEFAULT 0,
  statut             ENUM('ok','surveillance','critique') NOT NULL DEFAULT 'ok',
  -- Personne de confiance declaree par le resident (un autre resident).
  confiance_id       INT UNSIGNED NULL,
  confiance_lien     VARCHAR(40)  NULL,
  -- Le medecin qui suit ce resident au long cours : un rattachement, pas un
  -- acte. Voir le commentaire de db/serveur/01-schema.sql.
  medecin_traitant_id INT UNSIGNED NULL,
  created_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
                                  ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_residents_confiance
    FOREIGN KEY (confiance_id) REFERENCES residents (id) ON DELETE SET NULL,
  CONSTRAINT fk_residents_traitant
    FOREIGN KEY (medecin_traitant_id) REFERENCES medecins (id),
  INDEX idx_residents_cabine (cabine),
  INDEX idx_residents_statut (statut),
  INDEX idx_residents_traitant (medecin_traitant_id)
) ENGINE = InnoDB;

CREATE TABLE bracelets (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  serie          VARCHAR(16)  NOT NULL UNIQUE,      -- "BR-0448"
  resident_id    INT UNSIGNED NULL,                 -- NULL = en stock
  firmware       VARCHAR(32)  NOT NULL DEFAULT 'bracelet-i2c',
  batterie_pct   TINYINT UNSIGNED NULL,
  synchro_at     DATETIME     NULL,
  created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_bracelets_resident
    FOREIGN KEY (resident_id) REFERENCES residents (id) ON DELETE SET NULL,
  CONSTRAINT chk_bracelets_batterie CHECK (batterie_pct BETWEEN 0 AND 100)
) ENGINE = InnoDB;

-- Allergies, contre-indications, antecedents : une seule liste, parce que
-- c'est une seule liste a l'ecran. Le `type` porte la distinction, le
-- `niveau` porte l'urgence de lecture.
CREATE TABLE particularites (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  resident_id  INT UNSIGNED NOT NULL,
  type         ENUM('allergie','contre_indication','antecedent','info') NOT NULL,
  niveau       ENUM('critique','surveillance','info') NOT NULL DEFAULT 'info',
  titre        VARCHAR(120) NOT NULL,
  detail       TEXT         NOT NULL,
  constate_le  DATE         NULL,
  -- Qui a ecrit la note. Sans ON DELETE : on ne supprime pas un compte, on le
  -- desactive, justement pour que cette colonne reste vraie.
  auteur_id    INT UNSIGNED NULL,
  created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_particularites_resident
    FOREIGN KEY (resident_id) REFERENCES residents (id) ON DELETE CASCADE,
  CONSTRAINT fk_particularites_auteur
    FOREIGN KEY (auteur_id) REFERENCES medecins (id),
  INDEX idx_particularites_resident (resident_id, niveau)
) ENGINE = InnoDB;

-- Traitements en cours, rendez-vous, actions acceptees par le resident.
CREATE TABLE suivis (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  resident_id  INT UNSIGNED NOT NULL,
  type         ENUM('traitement','action','rendez_vous','contact') NOT NULL,
  titre        VARCHAR(120) NOT NULL,
  detail       TEXT         NOT NULL,
  debut_jour_vol   INT UNSIGNED NULL,
  echeance_jour_vol INT UNSIGNED NULL,
  actif        BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_suivis_resident
    FOREIGN KEY (resident_id) REFERENCES residents (id) ON DELETE CASCADE,
  INDEX idx_suivis_resident (resident_id, actif)
) ENGINE = InnoDB;

-- ------------------------------------------------------------- constantes ---
-- Serie brute : une ligne par minute et par resident, telle que le bracelet
-- l'envoie. A 1 240 residents cela fait ~1,8 M lignes par jour : cette table
-- est ecrite en continu et lue rarement. La console lit `mesures_jour`.
CREATE TABLE mesures (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  resident_id   INT UNSIGNED NOT NULL,
  bracelet_id   INT UNSIGNED NULL,
  mesure_at     DATETIME     NOT NULL,

  fc_bpm        DECIMAL(4,1) NULL,   -- frequence cardiaque
  rmssd_ms      DECIMAL(5,1) NULL,   -- variabilite cardiaque
  spo2_pct      DECIMAL(4,1) NULL,   -- NON CALIBREE, voir `source`
  resp_min      DECIMAL(4,1) NULL,   -- frequence respiratoire
  temp_c        DECIMAL(4,2) NULL,   -- temperature cutanee
  eda_us        DECIMAL(5,2) NULL,   -- activite electrodermale (transpiration)
  activite_g    DECIMAL(6,4) NULL,   -- variation moyenne de l'acceleration
  pas           SMALLINT UNSIGNED NULL,
  dort          BOOLEAN      NULL,   -- estimation du bracelet sur cette minute

  -- L'honnetete du prototype vit ici. Le bracelet KY-039 ne mesure que la FC
  -- et le RMSSD : tout le reste arrive en 'simule' tant qu'il est branche.
  source        ENUM('mesure','simule') NOT NULL DEFAULT 'mesure',
  qualite       ENUM('good','fair','poor','warmup') NOT NULL DEFAULT 'good',
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_mesures_resident
    FOREIGN KEY (resident_id) REFERENCES residents (id) ON DELETE CASCADE,
  CONSTRAINT fk_mesures_bracelet
    FOREIGN KEY (bracelet_id) REFERENCES bracelets (id) ON DELETE SET NULL,
  -- Le bracelet peut reemettre apres une coupure BLE : la meme minute ne doit
  -- pas entrer deux fois.
  UNIQUE KEY uq_mesures_minute (resident_id, mesure_at),
  INDEX idx_mesures_serie (resident_id, mesure_at DESC),
  CONSTRAINT chk_mesures_fc   CHECK (fc_bpm   IS NULL OR fc_bpm   BETWEEN 25 AND 220),
  CONSTRAINT chk_mesures_spo2 CHECK (spo2_pct IS NULL OR spo2_pct BETWEEN 50 AND 100)
) ENGINE = InnoDB;

-- Agregat quotidien : c'est CE QUE LA CONSOLE LIT. Les huit tuiles de
-- constantes et leurs graphiques 14 jours sortent tous d'ici, en une requete.
CREATE TABLE mesures_jour (
  resident_id   INT UNSIGNED NOT NULL,
  jour          DATE         NOT NULL,
  jour_vol      INT UNSIGNED NOT NULL,

  fc_repos_bpm  DECIMAL(4,1) NULL,   -- percentile 10 de la nuit, pas la moyenne
  fc_moy_bpm    DECIMAL(4,1) NULL,
  rmssd_ms      DECIMAL(5,1) NULL,
  spo2_pct      DECIMAL(4,1) NULL,
  resp_min      DECIMAL(4,1) NULL,
  temp_c        DECIMAL(4,2) NULL,
  eda_us        DECIMAL(5,2) NULL,
  pas           MEDIUMINT UNSIGNED NULL,
  minutes_valides SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  source        ENUM('mesure','simule','mixte') NOT NULL DEFAULT 'mesure',
  calcule_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
                             ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (resident_id, jour),
  CONSTRAINT fk_mesures_jour_resident
    FOREIGN KEY (resident_id) REFERENCES residents (id) ON DELETE CASCADE,
  INDEX idx_mesures_jour_date (jour)
) ENGINE = InnoDB;

-- Une ligne par nuit et par resident. `sommeil_min` est une ESTIMATION du
-- bracelet (immobilite + baisse de FC), jamais une mesure — d'ou `source`.
CREATE TABLE nuits (
  resident_id   INT UNSIGNED NOT NULL,
  nuit_du       DATE         NOT NULL,      -- date du coucher
  jour_vol      INT UNSIGNED NOT NULL,
  coucher_at    DATETIME     NULL,
  lever_at      DATETIME     NULL,
  sommeil_min   SMALLINT UNSIGNED NULL,     -- temps de sommeil total
  latence_min   SMALLINT UNSIGNED NULL,     -- delai d'endormissement
  eveils_min    SMALLINT UNSIGNED NULL,     -- eveils intra-sommeil
  source        ENUM('estime','simule','declare') NOT NULL DEFAULT 'estime',
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (resident_id, nuit_du),
  CONSTRAINT fk_nuits_resident
    FOREIGN KEY (resident_id) REFERENCES residents (id) ON DELETE CASCADE,
  CONSTRAINT chk_nuits_sommeil CHECK (sommeil_min IS NULL OR sommeil_min <= 1440)
) ENGINE = InnoDB;

-- ----------------------------------------------------------- etat mental ---
-- Scores de depistage. Ce sont des SCORES, pas des paroles : c'est pour cela
-- qu'ils peuvent vivre dans la base du serveur sans trahir le resident.
CREATE TABLE etat_mental (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  resident_id     INT UNSIGNED NOT NULL,
  evalue_le       DATE         NOT NULL,
  jour_vol        INT UNSIGNED NOT NULL,
  score_moral     TINYINT UNSIGNED NULL,   -- 0-100, indice de bien-etre
  phq9            TINYINT UNSIGNED NULL,   -- depression, 0-27
  gad7            TINYINT UNSIGNED NULL,   -- anxiete, 0-21
  isi             TINYINT UNSIGNED NULL,   -- insomnie, 0-28
  -- Un score renseigne par le questionnaire n'a pas la meme valeur qu'un
  -- score deduit de la conversation par le modele. On ne les melange pas.
  source          ENUM('questionnaire','conversation','simule') NOT NULL,
  created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_etat_mental_resident
    FOREIGN KEY (resident_id) REFERENCES residents (id) ON DELETE CASCADE,
  UNIQUE KEY uq_etat_mental_jour (resident_id, evalue_le, source),
  INDEX idx_etat_mental_date (evalue_le),
  CONSTRAINT chk_etat_moral CHECK (score_moral IS NULL OR score_moral <= 100),
  CONSTRAINT chk_etat_phq9  CHECK (phq9 IS NULL OR phq9 <= 27),
  CONSTRAINT chk_etat_gad7  CHECK (gad7 IS NULL OR gad7 <= 21),
  CONSTRAINT chk_etat_isi   CHECK (isi  IS NULL OR isi  <= 28)
) ENGINE = InnoDB;

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
--  un champ de transcription : voir server/src/routes/ingest.ts.
--
CREATE TABLE conversations (
  id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  resident_id         INT UNSIGNED NOT NULL,
  debut_at            DATETIME     NOT NULL,
  jour_vol            INT UNSIGNED NOT NULL,
  duree_min           SMALLINT UNSIGNED NOT NULL,
  severite            ENUM('critique','surveillance','info') NOT NULL,
  -- Resume clinique produit en cabine. Quelques phrases, jamais le verbatim.
  resume              TEXT         NOT NULL,
  actions_proposees   TINYINT UNSIGNED NOT NULL DEFAULT 0,
  actions_acceptees   TINYINT UNSIGNED NOT NULL DEFAULT 0,
  -- TRUE  : un seuil clinique a ete franchi, la remontee est automatique
  -- FALSE : remonte pour contexte seul
  remontee_auto       BOOLEAN      NOT NULL DEFAULT FALSE,
  -- Le resident est prevenu de chaque remontee. On horodate la notification :
  -- une promesse non tracee n'est pas une promesse.
  resident_notifie_at DATETIME     NULL,
  created_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_conversations_resident
    FOREIGN KEY (resident_id) REFERENCES residents (id) ON DELETE CASCADE,
  INDEX idx_conversations_resident (resident_id, debut_at DESC),
  INDEX idx_conversations_severite (severite, debut_at DESC),
  CONSTRAINT chk_conversations_actions
    CHECK (actions_acceptees <= actions_proposees)
) ENGINE = InnoDB;

CREATE TABLE conversation_tags (
  conversation_id  INT UNSIGNED NOT NULL,
  tag              VARCHAR(40)  NOT NULL,
  PRIMARY KEY (conversation_id, tag),
  CONSTRAINT fk_conversation_tags_conversation
    FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE,
  INDEX idx_conversation_tags_tag (tag)
) ENGINE = InnoDB;

-- --------------------------------------------------- triage et evenements ---
-- La file de l'ecran 02 : ce que le medecin doit traiter aujourd'hui.
CREATE TABLE signaux (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  resident_id   INT UNSIGNED NOT NULL,
  severite      ENUM('critique','surveillance','info') NOT NULL,
  -- Ce qui a declenche le signal, en une phrase lisible par le medecin.
  motif         VARCHAR(255) NOT NULL,
  -- D'ou vient le declenchement : utile pour mesurer les faux positifs.
  origine       ENUM('physio','conversation','chute','usage','manuel') NOT NULL,
  ouvert_at     DATETIME     NOT NULL,
  -- Assigne a une personne : le compte du soignant.
  assigne_id    INT UNSIGNED NULL,
  -- Assigne a ce qui n'est pas une personne : « Equipe d'intervention ». Les
  -- deux colonnes ne sont jamais remplies ensemble.
  assigne_a     VARCHAR(80)  NULL,          -- NULL = non assigne
  statut        ENUM('ouvert','en_cours','clos') NOT NULL DEFAULT 'ouvert',
  clos_at       DATETIME     NULL,
  clos_motif    VARCHAR(255) NULL,
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_signaux_resident
    FOREIGN KEY (resident_id) REFERENCES residents (id) ON DELETE CASCADE,
  CONSTRAINT fk_signaux_assigne
    FOREIGN KEY (assigne_id) REFERENCES medecins (id),
  INDEX idx_signaux_file (statut, severite, ouvert_at),
  INDEX idx_signaux_resident (resident_id, ouvert_at DESC)
) ENGINE = InnoDB;

-- Chutes et secousses : rares, horodatees a la seconde, jamais agregees.
CREATE TABLE evenements (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  resident_id  INT UNSIGNED NOT NULL,
  type         ENUM('chute','secousse','perte_contact','bouton_urgence') NOT NULL,
  survenu_at   DATETIME     NOT NULL,
  intensite_g  DECIMAL(4,2) NULL,
  acquitte_at  DATETIME     NULL,           -- NULL = personne n'a repondu
  created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_evenements_resident
    FOREIGN KEY (resident_id) REFERENCES residents (id) ON DELETE CASCADE,
  INDEX idx_evenements_resident (resident_id, survenu_at DESC),
  INDEX idx_evenements_type (type, survenu_at DESC)
) ENGINE = InnoDB;

-- -------------------------------------------------------- bilans sanguins ---
-- Un rendez-vous toutes les deux semaines : prise de sang et consultation.
-- L'en-tete est ici, les dosages dans `analyses_sang`.
CREATE TABLE bilans_sanguins (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  resident_id  INT UNSIGNED NOT NULL,
  -- Qui a preleve. NULL pour un bilan importe ou simule.
  medecin_id   INT UNSIGNED NULL,
  preleve_le   DATE         NOT NULL,
  jour_vol     INT UNSIGNED NOT NULL,
  -- Le rendez-vous suivant, affiche au resident comme au medecin.
  prochain_le  DATE         NULL,
  statut       ENUM('planifie','preleve','rendu') NOT NULL DEFAULT 'rendu',
  commentaire  TEXT         NULL,
  source       ENUM('analyse','simule') NOT NULL DEFAULT 'analyse',
  created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_bilans_resident
    FOREIGN KEY (resident_id) REFERENCES residents (id) ON DELETE CASCADE,
  CONSTRAINT fk_bilans_medecin
    FOREIGN KEY (medecin_id) REFERENCES medecins (id),
  UNIQUE KEY uq_bilans_prelevement (resident_id, preleve_le),
  INDEX idx_bilans_resident (resident_id, preleve_le DESC)
) ENGINE = InnoDB;

-- Un dosage. DEUX colonnes de valeur, et c'est delibere : l'automate rend un
-- nombre pour la plupart des marqueurs, mais du texte pour les qualitatifs
-- (« negatif », « traces »). Une seule colonne VARCHAR ferait perdre le tri,
-- la moyenne et la comparaison aux bornes sur les 28 marqueurs numeriques
-- du bilan de bord, qui en compte 29.
CREATE TABLE analyses_sang (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  bilan_id       INT UNSIGNED NOT NULL,
  panel          ENUM('cellules_sanguines','fer','foie','reins','sucre',
                      'thyroide','electrolytes','inflammation','lipides',
                      'vitamines','hormones') NOT NULL,
  marqueur       VARCHAR(80)   NOT NULL,
  valeur_num     DECIMAL(10,3) NULL,
  valeur_texte   VARCHAR(120)  NULL,
  unite          VARCHAR(20)   NULL,
  -- Bornes de reference du laboratoire de bord, gardees avec le dosage : une
  -- norme qui change plus tard ne doit pas reecrire un resultat d'hier.
  ref_bas        DECIMAL(10,3) NULL,
  ref_haut       DECIMAL(10,3) NULL,
  interpretation ENUM('normal','bas','eleve','critique') NOT NULL DEFAULT 'normal',

  CONSTRAINT fk_analyses_bilan
    FOREIGN KEY (bilan_id) REFERENCES bilans_sanguins (id) ON DELETE CASCADE,
  CONSTRAINT chk_analyses_valeur
    CHECK (valeur_num IS NOT NULL OR valeur_texte IS NOT NULL),
  UNIQUE KEY uq_analyses_marqueur (bilan_id, marqueur),
  INDEX idx_analyses_bilan (bilan_id, panel),
  INDEX idx_analyses_interpretation (interpretation)
) ENGINE = InnoDB;
