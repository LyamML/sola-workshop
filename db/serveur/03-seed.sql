-- =============================================================================
--  Sola — jeu de demonstration
--
--  Les valeurs reprennent EXACTEMENT celles affichees par la console
--  (web/console/src/data/). Une fois la console branchee sur l'API, les trois
--  ecrans doivent montrer les memes chiffres qu'aujourd'hui : c'est le test
--  qui prouve que le schema porte bien ce que l'interface demande.
--
--  Les dates sont relatives a date('now') : la demonstration est toujours
--  "aujourd'hui", quel que soit le jour de la soutenance. Le jour de vol
--  courant est 4128. Les heures, elles, sont fixes (« start of day » plus
--  des minutes) : l'horloge de demonstration marque 16:05, comme celle de
--  scripts/db-demo.mjs, quelle que soit l'heure ou la base est generee.
-- =============================================================================

PRAGMA foreign_keys = ON;

DELETE FROM analyses_sang;
DELETE FROM bilans_sanguins;
DELETE FROM sessions;
DELETE FROM conversation_tags;
DELETE FROM conversations;
DELETE FROM signaux;
DELETE FROM evenements;
DELETE FROM etat_mental;
DELETE FROM nuits;
DELETE FROM mesures_jour;
DELETE FROM mesures;
DELETE FROM suivis;
DELETE FROM particularites;
DELETE FROM bracelets;
-- Les comptes ne sont pas semes ici : un mot de passe ne se pose pas en SQL,
-- il se hache. C'est `npm run db:demo` (comptes de demonstration) ou
-- `npm run compte` (creation a la main) qui remplissent ces deux tables.
DELETE FROM medecins;
DELETE FROM admins;
DELETE FROM residents;

-- ---------------------------------------------------------------- equipage --
-- Le statut suit les signaux ouverts, avec la regle que la console applique a
-- chaque cloture : critique s'il en reste un critique, surveillance s'il en
-- reste un autre, ok sinon. Un signal « info » compte donc : R-1003 est en
-- surveillance tant que son signal d'usage n'est pas clos.
INSERT INTO residents
  (code, prenom, nom, date_naissance, poste, cabine, groupe_sanguin,
   embarque_jour_vol, statut)
VALUES
  ('R-0448','Lyam','Mafray',     date('now','-28 years'),'Technicien hydroponie','C-12','O-',0,'surveillance'),
  ('R-0449','Amara','Mafray',    date('now','-31 years'),'Ingénieure systèmes',  'C-15','O+',0,'ok'),
  ('R-0001','Alice','Rousseau',  date('now','-47 years'),'Capitaine',            'A-01','A+',0,'ok'),
  ('R-0002','Bob','Nakamura',    date('now','-39 years'),'Médecin de bord',      'B-04','B-',0,'ok'),
  ('R-0003','Candice','Oyelaran',date('now','-44 years'),'Psychologue',          'B-06','AB+',0,'ok'),
  ('R-0004','David','Lindqvist', date('now','-35 years'),'Équipage',             'C-09','O-',0,'ok'),
  ('R-0005','George','Abadi',    date('now','-52 years'),'Administration',       'A-03','B+',0,'ok'),
  ('R-0006','Pierre','Vasseur',  date('now','-29 years'),'Équipage',             'E-11','A-',0,'ok'),
  ('R-0912','Nour','Belkacem',   date('now','-34 years'),'Maintenance',          'C-14','A+',0,'critique'),
  ('R-1147','Tomas','Ferreira',  date('now','-51 years'),'Logistique',           'E-03','O+',0,'critique'),
  ('R-0233','Helene','Park',     date('now','-62 years'),'Archives',             'A-07','AB-',0,'critique'),
  ('R-0781','Samuel','Diaz',     date('now','-41 years'),'Habitat 1',            'B-22','B+',0,'surveillance'),
  ('R-1003','Iris','Kowalski',   date('now','-24 years'),'Recherche',            'F-05','A+',0,'surveillance');

-- Personne de confiance : sa soeur, declaree au J+4 001.
UPDATE residents
   SET confiance_id   = (SELECT id FROM residents WHERE code = 'R-0449'),
       confiance_lien = 'sœur'
 WHERE code = 'R-0448';

INSERT INTO bracelets (serie, resident_id, firmware, batterie_pct, synchro_at)
SELECT 'BR-' || substr(code, 3), id, 'bracelet-i2c', 61,
       datetime('now', 'start of day', '+963 minutes')
  FROM residents;

-- -------------------------------------------------- fiche de R-0448 : Lyam --
INSERT INTO particularites (resident_id, type, niveau, titre, detail) VALUES
  ((SELECT id FROM residents WHERE code='R-0448'),'allergie','critique',
   'Arachide — allergie sévère',
   'Choc anaphylactique en 2076. Auto-injecteur d''adrénaline en cabine C-12 et à l''infirmerie B. Régime tracé à la cuisine centrale.'),
  ((SELECT id FROM residents WHERE code='R-0448'),'contre_indication','critique',
   'AINS — proscrits',
   'Antécédent d''ulcère gastrique (2078). Paracétamol en première intention.'),
  ((SELECT id FROM residents WHERE code='R-0448'),'allergie','surveillance',
   'Pénicilline — allergie',
   'Éruption cutanée généralisée. Alternative : macrolides.'),
  ((SELECT id FROM residents WHERE code='R-0448'),'antecedent','surveillance',
   'Asthme d''effort',
   'Salbutamol à la demande. Dernière crise : J+3 840, sans hospitalisation.'),
  ((SELECT id FROM residents WHERE code='R-0448'),'antecedent','info',
   'Épisode dépressif caractérisé (2077)',
   'Rémission complète sous suivi. Facteur de vulnérabilité à considérer dans l''interprétation des signaux actuels — pas un diagnostic en cours.'),
  ((SELECT id FROM residents WHERE code='R-0448'),'info','info',
   'Intolérance au lactose · lentilles -3,5 / -3,75',
   'Groupe sanguin O-. Vaccination de bord à jour, rappel au J+4 300.');

INSERT INTO suivis (resident_id, type, titre, detail, debut_jour_vol, echeance_jour_vol) VALUES
  ((SELECT id FROM residents WHERE code='R-0448'),'traitement',
   'Mélatonine 2 mg · 21:00',
   'Recalage circadien depuis le J+4 120. Observance 9 prises sur 9, confirmée par le bracelet.', 4120, NULL),
  ((SELECT id FROM residents WHERE code='R-0448'),'action',
   'Lumière de cabine avancée à 19:00',
   'Proposé par Sola au J+4 128, accepté par le résident. À réévaluer au J+4 135.', 4128, 4135),
  ((SELECT id FROM residents WHERE code='R-0448'),'rendez_vous',
   'Entretien psychologique bimensuel',
   'Prochain créneau : J+4 134 à 15:00, infirmerie B. Dr. Ferreira.', NULL, 4134);

-- Quatorze jours de constantes — les memes series que les graphiques actuels.
-- `mixte` : FC et RMSSD viennent du capteur, le reste est simule et l'interface
-- l'affiche comme tel.
INSERT INTO mesures_jour
  (resident_id, jour, jour_vol, fc_repos_bpm, fc_moy_bpm, rmssd_ms,
   spo2_pct, resp_min, temp_c, eda_us, pas, minutes_valides, source)
VALUES
  ((SELECT id FROM residents WHERE code='R-0448'), date('now','-13 days'), 4115, 61, 74, 49, 98, 13, 34.5, 2.0, 8600, 1412, 'mixte'),
  ((SELECT id FROM residents WHERE code='R-0448'), date('now','-12 days'), 4116, 62, 75, 47, 97, 14, 34.4, 2.1, 8200, 1430, 'mixte'),
  ((SELECT id FROM residents WHERE code='R-0448'), date('now','-11 days'), 4117, 60, 73, 51, 98, 13, 34.4, 1.9, 8800, 1418, 'mixte'),
  ((SELECT id FROM residents WHERE code='R-0448'), date('now','-10 days'), 4118, 63, 76, 46, 98, 13, 34.3, 2.2, 8100, 1402, 'mixte'),
  ((SELECT id FROM residents WHERE code='R-0448'), date('now','-9 days'),  4119, 62, 75, 48, 97, 14, 34.3, 2.1, 7900, 1425, 'mixte'),
  ((SELECT id FROM residents WHERE code='R-0448'), date('now','-8 days'),  4120, 64, 78, 44, 97, 14, 34.2, 2.4, 8100, 1433, 'mixte'),
  ((SELECT id FROM residents WHERE code='R-0448'), date('now','-7 days'),  4121, 61, 74, 41, 98, 15, 34.2, 2.3, 7600, 1408, 'mixte'),
  ((SELECT id FROM residents WHERE code='R-0448'), date('now','-6 days'),  4122, 63, 77, 43, 96, 14, 34.3, 2.6, 7900, 1396, 'mixte'),
  ((SELECT id FROM residents WHERE code='R-0448'), date('now','-5 days'),  4123, 65, 79, 37, 97, 15, 34.1, 3.0, 7200, 1421, 'mixte'),
  ((SELECT id FROM residents WHERE code='R-0448'), date('now','-4 days'),  4124, 64, 78, 34, 97, 16, 34.0, 3.1, 7000, 1417, 'mixte'),
  ((SELECT id FROM residents WHERE code='R-0448'), date('now','-3 days'),  4125, 63, 77, 33, 96, 15, 34.1, 3.3, 6800, 1404, 'mixte'),
  ((SELECT id FROM residents WHERE code='R-0448'), date('now','-2 days'),  4126, 62, 76, 31, 97, 14, 34.0, 3.5, 6500, 1399, 'mixte'),
  ((SELECT id FROM residents WHERE code='R-0448'), date('now','-1 days'),  4127, 64, 78, 33, 97, 15, 34.2, 3.6, 6600, 1426, 'mixte'),
  ((SELECT id FROM residents WHERE code='R-0448'), date('now'),            4128, 62, 76, 31, 97, 14, 34.1, 3.8, 6240,  892, 'mixte');

-- Quatorze nuits. `estime` : c'est la methode immobilite + baisse de FC.
INSERT INTO nuits (resident_id, nuit_du, jour_vol, sommeil_min, latence_min, eveils_min, source)
VALUES
  ((SELECT id FROM residents WHERE code='R-0448'), date('now','-13 days'), 4115, 426, 14,  9, 'estime'),
  ((SELECT id FROM residents WHERE code='R-0448'), date('now','-12 days'), 4116, 408, 17, 12, 'estime'),
  ((SELECT id FROM residents WHERE code='R-0448'), date('now','-11 days'), 4117, 444, 11,  6, 'estime'),
  ((SELECT id FROM residents WHERE code='R-0448'), date('now','-10 days'), 4118, 372, 22, 18, 'estime'),
  ((SELECT id FROM residents WHERE code='R-0448'), date('now','-9 days'),  4119, 420, 15, 10, 'estime'),
  ((SELECT id FROM residents WHERE code='R-0448'), date('now','-8 days'),  4120, 396, 19, 14, 'estime'),
  ((SELECT id FROM residents WHERE code='R-0448'), date('now','-7 days'),  4121, 354, 28, 23, 'estime'),
  ((SELECT id FROM residents WHERE code='R-0448'), date('now','-6 days'),  4122, 384, 21, 16, 'estime'),
  ((SELECT id FROM residents WHERE code='R-0448'), date('now','-5 days'),  4123, 312, 41, 34, 'estime'),
  ((SELECT id FROM residents WHERE code='R-0448'), date('now','-4 days'),  4124, 294, 47, 38, 'estime'),
  ((SELECT id FROM residents WHERE code='R-0448'), date('now','-3 days'),  4125, 324, 38, 29, 'estime'),
  ((SELECT id FROM residents WHERE code='R-0448'), date('now','-2 days'),  4126, 306, 44, 33, 'estime'),
  ((SELECT id FROM residents WHERE code='R-0448'), date('now','-1 days'),  4127, 360, 26, 21, 'estime'),
  ((SELECT id FROM residents WHERE code='R-0448'), date('now'),            4128, 318, 39, 31, 'estime');

-- Scores de depistage : ils se degradent avec le sommeil, comme a l'ecran.
INSERT INTO etat_mental (resident_id, evalue_le, jour_vol, score_moral, phq9, gad7, isi, source)
VALUES
  ((SELECT id FROM residents WHERE code='R-0448'), date('now','-21 days'), 4107, 74,  6, 5, 11, 'questionnaire'),
  ((SELECT id FROM residents WHERE code='R-0448'), date('now','-14 days'), 4114, 71,  8, 6, 13, 'questionnaire'),
  ((SELECT id FROM residents WHERE code='R-0448'), date('now','-7 days'),  4121, 66, 11, 8, 16, 'conversation'),
  ((SELECT id FROM residents WHERE code='R-0448'), date('now'),            4128, 61, 13, 9, 18, 'conversation');

-- Le reste de l'equipage, sur les memes quatre dates que Lyam.
--
-- Les valeurs ne sont pas tirees au hasard : elles sont choisies pour que les
-- agregats de l'ecran 02 tombent sur les chiffres des maquettes.
--   · indice de bien-etre du jour : 72,4 / 100
--   · PHQ-9 >= 10 : 1 resident sur 13 (Lyam)          -> 7,7 %
--   · GAD-7 >= 10 : 1 resident sur 13 (Nour)          -> 7,7 %
--   · ISI   >= 15 : 2 residents sur 13 (Lyam, Samuel) -> 15,4 %
-- `delta` fait remonter les scores dans le passe : le bien-etre d'equipage
-- descend de 76,2 a 72,4 sur trois semaines, comme la courbe de l'ecran 02.
WITH scores(code, moral, phq9, gad7, isi) AS (
  VALUES ('R-0449', 78, 3,  2,  6),
         ('R-0001', 80, 2,  1,  4),
         ('R-0002', 76, 4,  3,  7),
         ('R-0003', 77, 3,  2,  5),
         ('R-0004', 74, 5,  4,  9),
         ('R-0005', 75, 4,  4,  8),
         ('R-0006', 73, 6,  5, 10),
         ('R-0912', 67, 9, 11, 14),
         ('R-1147', 68, 8,  7, 12),
         ('R-0233', 69, 7,  6, 11),
         ('R-0781', 71, 8,  9, 16),
         ('R-1003', 72, 6,  3,  3)
),
jours(evalue_le, jour_vol, delta) AS (
  VALUES (date('now','-21 days'), 4107, 3),
         (date('now','-14 days'), 4114, 2),
         (date('now','-7 days'),  4121, 1),
         (date('now'),            4128, 0)
)
INSERT INTO etat_mental
  (resident_id, evalue_le, jour_vol, score_moral, phq9, gad7, isi, source)
SELECT r.id, j.evalue_le, j.jour_vol,
       s.moral + j.delta,
       max(0, s.phq9 - j.delta),
       max(0, s.gad7 - j.delta),
       max(0, s.isi  - j.delta),
       'questionnaire'
  FROM scores s
  JOIN residents r ON r.code = s.code
  CROSS JOIN jours j;

-- Resumes de conversation. Aucune transcription : ce champ n'existe pas.
INSERT INTO conversations
  (resident_id, debut_at, jour_vol, duree_min, severite, resume,
   actions_proposees, actions_acceptees, remontee_auto, resident_notifie_at)
VALUES
  ((SELECT id FROM residents WHERE code='R-0448'),
   datetime('now','start of day','+761 minutes'), 4128, 11, 'surveillance',
   'Dernière nuit à 5 h 18, la cinquième sous 5 h 30 en quatorze jours. Attribue les réveils à un bruit de ventilation dans le module C — demande de contrôle acoustique transmise à la maintenance. Ton irritable, phrases courtes, plusieurs ruptures de conversation. Dépistage d''idéation suicidaire négatif (C-SSRS, items 1-2). Lumière de cabine avancée et contact social proposés, acceptés.',
   2, 2, 1, datetime('now','start of day','+762 minutes')),
  ((SELECT id FROM residents WHERE code='R-0448'),
   datetime('now','start of day','-3 days','+1382 minutes'), 4125, 6, 'info',
   'Demande spontanée de conseils d''endormissement. Exercice de respiration 4-7-8 proposé et suivi jusqu''au bout. Aucun marqueur d''humeur basse sur l''échange.',
   1, 1, 0, NULL),
  ((SELECT id FROM residents WHERE code='R-0448'),
   datetime('now','start of day','-9 days','+1215 minutes'), 4119, 19, 'surveillance',
   'Évoque un sentiment d''inutilité après l''incident du bac 7 (J+4 117). Décline le repas collectif pour la 3e fois de la semaine. Sola a proposé un appel à l''équipe hydroponie — refusé à deux reprises. Repli verbal marqué en fin d''échange.',
   3, 0, 1, datetime('now','start of day','-9 days','+1216 minutes')),
  ((SELECT id FROM residents WHERE code='R-0448'),
   datetime('now','start of day','-32 days','+1290 minutes'), 4096, 41, 'info',
   'Anniversaire du départ de la Terre. Évoque longuement les proches restés au sol ; a passé la soirée avec sa sœur. Échange apaisé, marqueurs prosodiques en nette amélioration en fin de conversation. Aucune action nécessaire — note pour anticiper la même date l''an prochain.',
   0, 0, 0, NULL),
  ((SELECT id FROM residents WHERE code='R-0912'),
   datetime('now','start of day','-1 days','+1428 minutes'), 4127, 17, 'critique',
   'Verbalisation de désespoir, sentiment d''être un poids pour l''équipe de maintenance. Dépistage C-SSRS positif (items 1 à 3) : alerte immédiate au médecin de garde. Échange maintenu jusqu''au relais humain.',
   1, 1, 1, datetime('now','start of day','-1 days','+1429 minutes'));

-- Un seul vocabulaire : les six motifs de l'ecran 02, plus deux etiquettes de
-- contexte hors de la fenetre de 30 jours. Les durees servent de cle, faute
-- d'identifiant connu a l'avance.
INSERT INTO conversation_tags (conversation_id, tag)
SELECT id, 'Troubles du sommeil'       FROM conversations WHERE duree_min IN (11, 6)
UNION ALL
SELECT id, 'Anxiété, stress chronique' FROM conversations WHERE duree_min = 11
UNION ALL
SELECT id, 'Humeur basse'              FROM conversations WHERE duree_min IN (19, 17)
UNION ALL
SELECT id, 'Isolement social'          FROM conversations WHERE duree_min = 19
UNION ALL
SELECT id, 'Deuil'                     FROM conversations WHERE duree_min = 41
UNION ALL
SELECT id, 'Date anniversaire'         FROM conversations WHERE duree_min = 41;

-- --------------------------------------------------- file de triage du jour --
INSERT INTO signaux (resident_id, severite, motif, origine, ouvert_at, assigne_a, statut)
VALUES
  ((SELECT id FROM residents WHERE code='R-0912'),'critique',
   'Verbalisation de désespoir détectée en conversation · dépistage C-SSRS positif',
   'conversation', datetime('now','start of day','+12 minutes'), NULL, 'ouvert'),
  ((SELECT id FROM residents WHERE code='R-1147'),'critique',
   'SpO₂ à 88 % au repos pendant 6 min · antécédent BPCO',
   'physio', datetime('now','start of day','+41 minutes'), 'Dr. Oyelaran', 'en_cours'),
  ((SELECT id FROM residents WHERE code='R-0233'),'critique',
   'Chute détectée par l''accéléromètre · aucune réponse à la borne après 90 s',
   'chute', datetime('now','start of day','+125 minutes'), 'Équipe d''intervention', 'en_cours'),
  ((SELECT id FROM residents WHERE code='R-0448'),'surveillance',
   'RMSSD sous le seuil personnel depuis 6 jours · 5 nuits sur 14 sous 5 h 30',
   'physio', datetime('now','start of day','+380 minutes'), 'Dr. Ferreira', 'en_cours'),
  ((SELECT id FROM residents WHERE code='R-0781'),'surveillance',
   'Retrait social depuis 12 jours · 4 invitations déclinées · activité -48 %',
   'conversation', datetime('now','start of day','+555 minutes'), NULL, 'ouvert'),
  ((SELECT id FROM residents WHERE code='R-1003'),'info',
   'Usage du compagnon 9 h 40 / jour (+180 % en 3 semaines) · 2 interactions humaines / semaine',
   'usage', datetime('now','start of day','+662 minutes'), 'Dr. Ferreira', 'en_cours');

INSERT INTO evenements (resident_id, type, survenu_at, intensite_g, acquitte_at)
VALUES
  ((SELECT id FROM residents WHERE code='R-0233'),'chute',
   datetime('now','start of day','+124 minutes'), 3.4, NULL);
