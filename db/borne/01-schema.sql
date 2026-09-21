-- =============================================================================
--  Sola — base locale de la borne de cabine (SQLite)
--
--  Cette base vit DANS la cabine, sur la borne, et n'est jamais repliquee.
--  C'est le seul endroit de tout le vaisseau ou les paroles du resident
--  existent sous forme de texte.
--
--  Ce que la borne envoie au serveur de bord (db/mysql) :
--    · les constantes du bracelet, minute par minute
--    · le RESUME d'une conversation, quand un seuil clinique est franchi
--  Ce qu'elle n'envoie jamais :
--    · la table `tours` ci-dessous, sous aucune forme
--
--  sqlite3 borne.db < db/borne/01-schema.sql
-- =============================================================================

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- Une borne = un resident. L'identite tient en une ligne.
CREATE TABLE IF NOT EXISTS cabine (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  resident_code TEXT    NOT NULL,          -- "R-0448"
  cabine        TEXT    NOT NULL,          -- "C-12"
  bracelet      TEXT,                      -- "BR-0448"
  serveur_url   TEXT    NOT NULL,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS conversations (
  id            INTEGER PRIMARY KEY,
  debut_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  fin_at        TEXT,
  -- Resume produit en local par le modele, puis envoye au serveur.
  resume        TEXT,
  severite      TEXT    CHECK (severite IN ('critique','surveillance','info')),
  -- Horodatage de l'envoi du resume. NULL = rien n'est sorti de la cabine.
  remonte_at    TEXT,
  -- Le resident a vu la notification de remontee.
  notifie_at    TEXT
);

-- Le verbatim. Il ne quitte pas ce fichier.
CREATE TABLE IF NOT EXISTS tours (
  id               INTEGER PRIMARY KEY,
  conversation_id  INTEGER NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  role             TEXT    NOT NULL CHECK (role IN ('resident','sola')),
  texte            TEXT    NOT NULL,
  dit_at           TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tours_conversation ON tours (conversation_id, id);

-- Purge automatique du verbatim : ce qui n'existe plus ne peut pas fuir.
-- 30 jours suffisent au modele pour garder le fil d'une semaine difficile.
CREATE TRIGGER IF NOT EXISTS purge_tours_anciens
AFTER INSERT ON tours
BEGIN
  DELETE FROM tours
  WHERE dit_at < datetime('now', '-30 days');
END;

-- File d'envoi : la liaison avec le serveur de bord peut tomber, les mesures
-- s'accumulent ici et repartent a la reconnexion.
CREATE TABLE IF NOT EXISTS file_envoi (
  id          INTEGER PRIMARY KEY,
  endpoint    TEXT    NOT NULL,            -- '/ingest/mesure', '/ingest/conversation'
  charge      TEXT    NOT NULL,            -- JSON
  cree_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  tentatives  INTEGER NOT NULL DEFAULT 0,
  envoye_at   TEXT
);

CREATE INDEX IF NOT EXISTS idx_file_envoi_attente
  ON file_envoi (envoye_at, cree_at);
