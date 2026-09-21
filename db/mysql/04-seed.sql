-- =============================================================================
--  Sola — jeu de demonstration
--
--  Les valeurs reprennent EXACTEMENT celles affichees par la console
--  (web/console/src/data/). Une fois la console branchee sur l'API, les trois
--  ecrans doivent montrer les memes chiffres qu'aujourd'hui : c'est le test
--  qui prouve que le schema porte bien ce que l'interface demande.
--
--  Les dates sont relatives a CURDATE() : la demonstration est toujours
--  "aujourd'hui", quel que soit le jour de la soutenance.
-- =============================================================================

USE sola;

SET @J = 4128;   -- jour de vol du jour courant

SET FOREIGN_KEY_CHECKS = 0;
TRUNCATE conversation_tags; TRUNCATE conversations; TRUNCATE signaux;
TRUNCATE evenements; TRUNCATE etat_mental; TRUNCATE nuits;
TRUNCATE mesures_jour; TRUNCATE mesures; TRUNCATE suivis;
TRUNCATE particularites; TRUNCATE bracelets; TRUNCATE residents;
SET FOREIGN_KEY_CHECKS = 1;

-- ---------------------------------------------------------------- equipage --
INSERT INTO residents
  (code, prenom, nom, date_naissance, poste, cabine, groupe_sanguin,
   embarque_jour_vol, statut)
VALUES
  ('R-0448','Lyam','Mafray',   CURDATE() - INTERVAL 28 YEAR,'Technicien hydroponie','C-12','O-',0,'surveillance'),
  ('R-0449','Amara','Mafray',  CURDATE() - INTERVAL 31 YEAR,'Ingenieure systemes',  'C-15','O+',0,'ok'),
  ('R-0001','Alice','Rousseau',CURDATE() - INTERVAL 47 YEAR,'Capitaine',            'A-01','A+',0,'ok'),
  ('R-0002','Bob','Nakamura',  CURDATE() - INTERVAL 39 YEAR,'Medecin de bord',      'B-04','B-',0,'ok'),
  ('R-0003','Candice','Oyelaran',CURDATE() - INTERVAL 44 YEAR,'Psychologue',        'B-06','AB+',0,'ok'),
  ('R-0004','David','Lindqvist',CURDATE() - INTERVAL 35 YEAR,'Equipage',            'C-09','O-',0,'ok'),
  ('R-0005','George','Abadi',  CURDATE() - INTERVAL 52 YEAR,'Administration',       'A-03','B+',0,'ok'),
  ('R-0006','Pierre','Vasseur',CURDATE() - INTERVAL 29 YEAR,'Equipage',             'E-11','A-',0,'ok'),
  ('R-0912','Nour','Belkacem', CURDATE() - INTERVAL 34 YEAR,'Maintenance',          'C-14','A+',0,'critique'),
  ('R-1147','Tomas','Ferreira',CURDATE() - INTERVAL 51 YEAR,'Logistique',           'E-03','O+',0,'critique'),
  ('R-0233','Helene','Park',   CURDATE() - INTERVAL 62 YEAR,'Archives',             'A-07','AB-',0,'critique'),
  ('R-0781','Samuel','Diaz',   CURDATE() - INTERVAL 41 YEAR,'Habitat 1',            'B-22','B+',0,'surveillance'),
  ('R-1003','Iris','Kowalski', CURDATE() - INTERVAL 24 YEAR,'Recherche',            'F-05','A+',0,'ok');

-- Personne de confiance : sa soeur, declaree au J+4 001.
UPDATE residents
SET confiance_id = (SELECT id FROM (SELECT id FROM residents WHERE code = 'R-0449') x),
    confiance_lien = 'soeur'
WHERE code = 'R-0448';

INSERT INTO bracelets (serie, resident_id, firmware, batterie_pct, synchro_at)
SELECT CONCAT('BR-', SUBSTRING(code, 3)), id, 'bracelet-i2c', 61, NOW() - INTERVAL 2 MINUTE
FROM residents;

-- -------------------------------------------------- fiche de R-0448 : Lyam --
SET @lyam = (SELECT id FROM residents WHERE code = 'R-0448');

INSERT INTO particularites (resident_id, type, niveau, titre, detail) VALUES
  (@lyam,'allergie','critique','Arachide — allergie severe',
   'Choc anaphylactique en 2076. Auto-injecteur d''adrenaline en cabine C-12 et a l''infirmerie B. Regime trace a la cuisine centrale.'),
  (@lyam,'contre_indication','critique','AINS — proscrits',
   'Antecedent d''ulcere gastrique (2078). Paracetamol en premiere intention.'),
  (@lyam,'allergie','surveillance','Penicilline — allergie',
   'Eruption cutanee generalisee. Alternative : macrolides.'),
  (@lyam,'antecedent','surveillance','Asthme d''effort',
   'Salbutamol a la demande. Derniere crise : J+3 840, sans hospitalisation.'),
  (@lyam,'antecedent','info','Episode depressif caracterise (2077)',
   'Remission complete sous suivi. Facteur de vulnerabilite a considerer dans l''interpretation des signaux actuels — pas un diagnostic en cours.'),
  (@lyam,'info','info','Intolerance au lactose · lentilles -3,5 / -3,75',
   'Groupe sanguin O-. Vaccination de bord a jour, rappel au J+4 300.');

INSERT INTO suivis (resident_id, type, titre, detail, debut_jour_vol, echeance_jour_vol) VALUES
  (@lyam,'traitement','Melatonine 2 mg · 21:00',
   'Recalage circadien depuis le J+4 120. Observance 9 prises sur 9, confirmee par le bracelet.', 4120, NULL),
  (@lyam,'action','Lumiere de cabine avancee a 19:00',
   'Propose par Sola au J+4 128, accepte par le resident. A reevaluer au J+4 135.', 4128, 4135),
  (@lyam,'rendez_vous','Entretien psychologique bimensuel',
   'Prochain creneau : J+4 134 a 15:00, infirmerie B. Dr. A. Ferreira.', NULL, 4134),
  (@lyam,'contact','Amara Mafray · soeur · C-15',
   'Personne de confiance declaree, joignable en urgence. Autorisation donnee par le resident au J+4 001.', 4001, NULL);

-- Quatorze jours de constantes — les memes series que les graphiques actuels.
-- `mixte` : FC et RMSSD viennent du capteur, le reste est simule et l'interface
-- l'affiche comme tel.
INSERT INTO mesures_jour
  (resident_id, jour, jour_vol, fc_repos_bpm, fc_moy_bpm, rmssd_ms,
   spo2_pct, resp_min, temp_c, eda_us, pas, minutes_valides, source)
VALUES
  (@lyam, CURDATE() - INTERVAL 13 DAY, @J-13, 61, 74, 49, 98, 13, 34.50, 2.00, 8600, 1412, 'mixte'),
  (@lyam, CURDATE() - INTERVAL 12 DAY, @J-12, 62, 75, 47, 97, 14, 34.40, 2.10, 8200, 1430, 'mixte'),
  (@lyam, CURDATE() - INTERVAL 11 DAY, @J-11, 60, 73, 51, 98, 13, 34.40, 1.90, 8800, 1418, 'mixte'),
  (@lyam, CURDATE() - INTERVAL 10 DAY, @J-10, 63, 76, 46, 98, 13, 34.30, 2.20, 8100, 1402, 'mixte'),
  (@lyam, CURDATE() - INTERVAL  9 DAY, @J-9,  62, 75, 48, 97, 14, 34.30, 2.10, 7900, 1425, 'mixte'),
  (@lyam, CURDATE() - INTERVAL  8 DAY, @J-8,  64, 78, 44, 97, 14, 34.20, 2.40, 8100, 1433, 'mixte'),
  (@lyam, CURDATE() - INTERVAL  7 DAY, @J-7,  61, 74, 41, 98, 15, 34.20, 2.30, 7600, 1408, 'mixte'),
  (@lyam, CURDATE() - INTERVAL  6 DAY, @J-6,  63, 77, 43, 96, 14, 34.30, 2.60, 7900, 1396, 'mixte'),
  (@lyam, CURDATE() - INTERVAL  5 DAY, @J-5,  65, 79, 37, 97, 15, 34.10, 3.00, 7200, 1421, 'mixte'),
  (@lyam, CURDATE() - INTERVAL  4 DAY, @J-4,  64, 78, 34, 97, 16, 34.00, 3.10, 7000, 1417, 'mixte'),
  (@lyam, CURDATE() - INTERVAL  3 DAY, @J-3,  63, 77, 33, 96, 15, 34.10, 3.30, 6800, 1404, 'mixte'),
  (@lyam, CURDATE() - INTERVAL  2 DAY, @J-2,  62, 76, 31, 97, 14, 34.00, 3.50, 6500, 1399, 'mixte'),
  (@lyam, CURDATE() - INTERVAL  1 DAY, @J-1,  64, 78, 33, 97, 15, 34.20, 3.60, 6600, 1426, 'mixte'),
  (@lyam, CURDATE(),                   @J,    62, 76, 31, 97, 14, 34.10, 3.80, 6240,  892, 'mixte');

-- Quatorze nuits. `estime` : c'est la methode immobilite + baisse de FC.
INSERT INTO nuits (resident_id, nuit_du, jour_vol, sommeil_min, latence_min, eveils_min, source)
VALUES
  (@lyam, CURDATE() - INTERVAL 13 DAY, @J-13, 426, 14,  9, 'estime'),
  (@lyam, CURDATE() - INTERVAL 12 DAY, @J-12, 408, 17, 12, 'estime'),
  (@lyam, CURDATE() - INTERVAL 11 DAY, @J-11, 444, 11,  6, 'estime'),
  (@lyam, CURDATE() - INTERVAL 10 DAY, @J-10, 372, 22, 18, 'estime'),
  (@lyam, CURDATE() - INTERVAL  9 DAY, @J-9,  420, 15, 10, 'estime'),
  (@lyam, CURDATE() - INTERVAL  8 DAY, @J-8,  396, 19, 14, 'estime'),
  (@lyam, CURDATE() - INTERVAL  7 DAY, @J-7,  354, 28, 23, 'estime'),
  (@lyam, CURDATE() - INTERVAL  6 DAY, @J-6,  384, 21, 16, 'estime'),
  (@lyam, CURDATE() - INTERVAL  5 DAY, @J-5,  312, 41, 34, 'estime'),
  (@lyam, CURDATE() - INTERVAL  4 DAY, @J-4,  294, 47, 38, 'estime'),
  (@lyam, CURDATE() - INTERVAL  3 DAY, @J-3,  324, 38, 29, 'estime'),
  (@lyam, CURDATE() - INTERVAL  2 DAY, @J-2,  306, 44, 33, 'estime'),
  (@lyam, CURDATE() - INTERVAL  1 DAY, @J-1,  360, 26, 21, 'estime'),
  (@lyam, CURDATE(),                   @J,    318, 39, 31, 'estime');

-- Scores de depistage : ils se degradent avec le sommeil, comme a l'ecran.
INSERT INTO etat_mental (resident_id, evalue_le, jour_vol, score_moral, phq9, gad7, isi, source)
VALUES
  (@lyam, CURDATE() - INTERVAL 21 DAY, @J-21, 74,  6,  5, 11, 'questionnaire'),
  (@lyam, CURDATE() - INTERVAL 14 DAY, @J-14, 71,  8,  6, 13, 'questionnaire'),
  (@lyam, CURDATE() - INTERVAL  7 DAY, @J-7,  66, 11,  8, 16, 'conversation'),
  (@lyam, CURDATE(),                   @J,    61, 13,  9, 18, 'conversation');

-- Le reste de l'equipage, pour que les agregats de l'ecran 02 aient de quoi
-- travailler. Un score par resident, aujourd'hui.
INSERT INTO etat_mental (resident_id, evalue_le, jour_vol, score_moral, phq9, gad7, isi, source)
SELECT id, CURDATE(), @J,
       70 + (id * 7) % 22,
       (id * 5) % 18,
       (id * 3) % 14,
       (id * 11) % 24,
       'questionnaire'
FROM residents
WHERE code <> 'R-0448';

-- Resumes de conversation. Aucune transcription : ce champ n'existe pas.
INSERT INTO conversations
  (resident_id, debut_at, jour_vol, duree_min, severite, resume,
   actions_proposees, actions_acceptees, remontee_auto, resident_notifie_at)
VALUES
  (@lyam, CURDATE() - INTERVAL 0 DAY + INTERVAL 1361 MINUTE, @J, 11, 'surveillance',
   '3e nuit consecutive sous 5 h 30. Attribue les reveils a un bruit de ventilation dans le module C — demande de controle acoustique transmise a la maintenance. Ton irritable, phrases courtes, plusieurs ruptures de conversation. Depistage d''ideation suicidaire negatif (C-SSRS, items 1-2). Contact social propose et accepte.',
   2, 2, TRUE,  CURDATE() + INTERVAL 1362 MINUTE),
  (@lyam, CURDATE() - INTERVAL 3 DAY + INTERVAL 1382 MINUTE, @J-3, 6, 'info',
   'Demande spontanee de conseils d''endormissement. Exercice de respiration 4-7-8 propose et suivi jusqu''au bout. Aucun marqueur d''humeur basse sur l''echange.',
   1, 1, FALSE, NULL),
  (@lyam, CURDATE() - INTERVAL 9 DAY + INTERVAL 1215 MINUTE, @J-9, 19, 'surveillance',
   'Evoque un sentiment d''inutilite apres l''incident du bac 7 (J+4 117). Decline le repas collectif pour la 3e fois de la semaine. Sola a propose un appel a l''equipe hydroponie — refuse a deux reprises. Repli verbal marque en fin d''echange.',
   3, 0, TRUE,  CURDATE() - INTERVAL 9 DAY + INTERVAL 1216 MINUTE),
  (@lyam, CURDATE() - INTERVAL 32 DAY + INTERVAL 1290 MINUTE, @J-32, 41, 'info',
   'Anniversaire du depart de la Terre. Evoque longuement sa soeur restee au sol. Echange apaise, marqueurs prosodiques en nette amelioration en fin de conversation. Aucune action necessaire — note pour anticiper la meme date l''an prochain.',
   0, 0, FALSE, NULL);

INSERT INTO conversation_tags (conversation_id, tag)
SELECT id, 'Sommeil'       FROM conversations WHERE duree_min IN (11, 6)
UNION ALL
SELECT id, 'Irritabilite'  FROM conversations WHERE duree_min = 11
UNION ALL
SELECT id, 'Humeur basse'  FROM conversations WHERE duree_min = 19
UNION ALL
SELECT id, 'Isolement'     FROM conversations WHERE duree_min = 19
UNION ALL
SELECT id, 'Deuil'         FROM conversations WHERE duree_min = 41
UNION ALL
SELECT id, 'Date anniversaire' FROM conversations WHERE duree_min = 41;

-- --------------------------------------------------- file de triage du jour --
INSERT INTO signaux (resident_id, severite, motif, origine, ouvert_at, assigne_a, statut)
VALUES
  ((SELECT id FROM residents WHERE code='R-0912'),'critique',
   'HRV sous 18 ms depuis 4 jours + verbalisation de desespoir detectee en conversation',
   'conversation', CURDATE() + INTERVAL 12 MINUTE, NULL, 'ouvert'),
  ((SELECT id FROM residents WHERE code='R-1147'),'critique',
   'SpO2 a 88 % au repos pendant 6 min · antecedent BPCO',
   'physio', CURDATE() + INTERVAL 41 MINUTE, 'Dr. Oyelaran', 'en_cours'),
  ((SELECT id FROM residents WHERE code='R-0233'),'critique',
   'Chute detectee par l''accelerometre · aucune reponse a la borne apres 90 s',
   'chute', CURDATE() + INTERVAL 125 MINUTE, 'Equipe d''intervention', 'en_cours'),
  (@lyam,'surveillance',
   '3 nuits sous 5 h 30 · HRV -35 % vs base personnelle · ton irritable',
   'physio', CURDATE() + INTERVAL 380 MINUTE, 'Dr. Ferreira', 'en_cours'),
  ((SELECT id FROM residents WHERE code='R-0781'),'surveillance',
   'Retrait social depuis 12 jours · 4 invitations declinees · activite -48 %',
   'conversation', CURDATE() + INTERVAL 555 MINUTE, NULL, 'ouvert'),
  ((SELECT id FROM residents WHERE code='R-1003'),'info',
   'Usage du compagnon 9 h 40 / jour (+180 % en 3 semaines) · 2 interactions humaines / semaine',
   'usage', CURDATE() + INTERVAL 662 MINUTE, 'Dr. Ferreira', 'en_cours');

INSERT INTO evenements (resident_id, type, survenu_at, intensite_g, acquitte_at)
VALUES
  ((SELECT id FROM residents WHERE code='R-0233'),'chute',
   CURDATE() + INTERVAL 124 MINUTE, 3.40, NULL);
