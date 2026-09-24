import { Router } from "express";
import { requete, residentId } from "../db.js";

/**
 * Routes de lecture réservées à la borne de cabine.
 *
 * Montées sous /borne, protégées par authBorne (jeton porteur).
 * Lecture seule : la borne n'écrit que via /ingest.
 *
 * Seule donnée renvoyée : un bloc texte destiné à enrichir le prompt système
 * de Sola. Le texte est écrit pour être compris par un LLM, pas pour
 * être affiché à l'écran.
 */
export const borneApi = Router();

/** Arrondit à n décimales, ou renvoie "–" si null. */
function fmt(v: number | null | undefined, dec = 1): string {
  if (v == null) return "–";
  return v.toFixed(dec);
}

/** Convertit des minutes en "Xh Ymin", ou "–". */
function fmtMin(min: number | null | undefined): string {
  if (min == null) return "–";
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h ${m > 0 ? `${m}min` : ""}`.trim() : `${m}min`;
}

/**
 * GET /ia-contexte/:code
 *
 * Retourne un résumé de santé du résident identifié par son code (ex. R-0448).
 * Utilisé par la borne pour enrichir le prompt système de Sola au démarrage
 * de la scène « Échange ».
 *
 * Sola ne doit PAS citer ces chiffres bruts — elle s'en sert pour orienter
 * et poser les bonnes questions, jamais pour diagnostiquer.
 */
borneApi.get("/ia-contexte/:code", (req, res, next) => {
  try {
    const { code } = req.params;
    const id = residentId(code);
    if (id === null) {
      res.status(404).json({ erreur: `Résident inconnu : ${code}` });
      return;
    }

    // ---- identité -----------------------------------------------------------
    const resident = requete<{
      prenom: string;
      cabine: string;
      embarque_jour_vol: number;
      statut: string;
    }>(
      `SELECT prenom, cabine, embarque_jour_vol, statut
         FROM residents
        WHERE id = :id`,
      { id },
    )[0];

    if (!resident) {
      res.status(404).json({ erreur: `Résident introuvable : ${code}` });
      return;
    }

    const lignes: string[] = [
      `[DONNÉES SANTÉ — usage interne, ne pas citer les chiffres bruts, guider seulement]`,
      `Résident : ${resident.prenom} (${code}), cabine ${resident.cabine}`,
      `Statut médical : ${resident.statut}`,
    ];

    // ---- particularités actives (allergies, contre-indications, antécédents) -
    const particularites = requete<{
      type: string;
      niveau: string;
      titre: string;
      detail: string;
    }>(
      `SELECT type, niveau, titre, detail
         FROM particularites
        WHERE resident_id = :id
          AND type IN ('allergie','contre_indication','antecedent')
        ORDER BY niveau DESC, created_at DESC
        LIMIT 10`,
      { id },
    );

    if (particularites.length > 0) {
      lignes.push("");
      lignes.push("Particularités connues :");
      for (const p of particularites) {
        const niveauLabel = p.niveau === "critique" ? " [CRITIQUE]" : "";
        lignes.push(`  · ${p.type.replace("_", " ")} — ${p.titre}${niveauLabel} : ${p.detail}`);
      }
    }

    // ---- constantes — 14 derniers jours -------------------------------------
    const mesures = requete<{
      jour: string;
      jour_vol: number;
      fc_repos_bpm: number | null;
      rmssd_ms: number | null;
      spo2_pct: number | null;
      temp_c: number | null;
      pas: number | null;
      minutes_valides: number;
    }>(
      `SELECT jour, jour_vol, fc_repos_bpm, rmssd_ms, spo2_pct, temp_c, pas, minutes_valides
         FROM mesures_jour
        WHERE resident_id = :id
        ORDER BY jour DESC
        LIMIT 14`,
      { id },
    );

    if (mesures.length > 0) {
      const fcs = mesures.map((m) => m.fc_repos_bpm).filter((v): v is number => v != null);
      const rsds = mesures.map((m) => m.rmssd_ms).filter((v): v is number => v != null);
      const spo2s = mesures.map((m) => m.spo2_pct).filter((v): v is number => v != null);
      const temps = mesures.map((m) => m.temp_c).filter((v): v is number => v != null);
      const pass_ = mesures.map((m) => m.pas).filter((v): v is number => v != null);

      const moy = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
      const min = (arr: number[]) => (arr.length ? Math.min(...arr) : null);
      const max = (arr: number[]) => (arr.length ? Math.max(...arr) : null);

      lignes.push("");
      lignes.push(`Constantes (${mesures.length} jours, du J+${mesures[mesures.length - 1]?.jour_vol} au J+${mesures[0]?.jour_vol}) :`);

      if (fcs.length) {
        const derniere = fcs[0];
        lignes.push(
          `  FC repos : dernière ${fmt(derniere)} bpm · moy ${fmt(moy(fcs))} · min ${fmt(min(fcs))} · max ${fmt(max(fcs))} bpm`,
        );
        // Tendance sur les 7 derniers jours vs les 7 précédents
        if (fcs.length >= 7) {
          const recentes = fcs.slice(0, Math.min(7, fcs.length));
          const anciennes = fcs.slice(Math.min(7, fcs.length));
          if (anciennes.length >= 3) {
            const delta = (moy(recentes) ?? 0) - (moy(anciennes) ?? 0);
            if (Math.abs(delta) >= 3) {
              lignes.push(`    → tendance : ${delta > 0 ? "hausse" : "baisse"} de ${fmt(Math.abs(delta))} bpm sur les 7 derniers jours`);
            }
          }
        }
      }

      if (rsds.length) {
        lignes.push(`  VFC (RMSSD) : moy ${fmt(moy(rsds))} ms (variabilité cardiaque)`);
      }

      if (spo2s.length) {
        const minSpo2 = min(spo2s);
        lignes.push(`  SpO2 : moy ${fmt(moy(spo2s), 1)} % · min ${fmt(minSpo2, 1)} %${(minSpo2 ?? 100) < 94 ? " [valeur basse]" : ""}`);
      }

      if (temps.length) {
        lignes.push(`  Température cutanée : moy ${fmt(moy(temps), 1)} °C`);
      }

      if (pass_.length) {
        lignes.push(`  Pas/jour : moy ${fmt(moy(pass_), 0)}`);
      }
    } else {
      lignes.push("");
      lignes.push("Constantes : aucune donnée de bracelet disponible.");
    }

    // ---- nuits — 7 dernières ------------------------------------------------
    const nuits = requete<{
      nuit_du: string;
      jour_vol: number;
      sommeil_min: number | null;
      latence_min: number | null;
      source: string;
    }>(
      `SELECT nuit_du, jour_vol, sommeil_min, latence_min, source
         FROM nuits
        WHERE resident_id = :id
        ORDER BY nuit_du DESC
        LIMIT 7`,
      { id },
    );

    if (nuits.length > 0) {
      const sommeils = nuits.map((n) => n.sommeil_min).filter((v): v is number => v != null);
      const latences = nuits.map((n) => n.latence_min).filter((v): v is number => v != null);
      const moy = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);

      lignes.push("");
      lignes.push(`Sommeil (${nuits.length} nuits, estimation bracelet) :`);
      if (sommeils.length) {
        const moyMin = moy(sommeils);
        lignes.push(`  Durée moyenne : ${fmtMin(Math.round(moyMin ?? 0))}`);
        lignes.push(`  Min : ${fmtMin(Math.min(...sommeils))} · Max : ${fmtMin(Math.max(...sommeils))}`);
        if ((moyMin ?? 0) < 360) {
          lignes.push(`  → durée moyenne inférieure à 6 h sur la période`);
        }
      }
      if (latences.length) {
        const moyLat = moy(latences);
        lignes.push(`  Latence d'endormissement : moy ${fmt(moyLat, 0)} min`);
        if ((moyLat ?? 0) > 30) {
          lignes.push(`  → endormissement long sur la période`);
        }
      }
    } else {
      lignes.push("");
      lignes.push("Sommeil : aucune donnée de nuit disponible.");
    }

    // ---- état mental — 3 derniers mois --------------------------------------
    const mental = requete<{
      evalue_le: string;
      jour_vol: number;
      score_moral: number | null;
      phq9: number | null;
      gad7: number | null;
      isi: number | null;
      source: string;
    }>(
      `SELECT evalue_le, jour_vol, score_moral, phq9, gad7, isi, source
         FROM etat_mental
        WHERE resident_id = :id
        ORDER BY evalue_le DESC
        LIMIT 6`,
      { id },
    );

    if (mental.length > 0) {
      lignes.push("");
      lignes.push("Bilans de santé mentale (scores, pas de paroles) :");
      for (const m of mental) {
        const parties: string[] = [`J+${m.jour_vol}`];
        if (m.phq9 != null) {
          parties.push(`PHQ-9 ${m.phq9}/27${m.phq9 >= 10 ? " [≥ seuil 10]" : ""}`);
        }
        if (m.gad7 != null) {
          parties.push(`GAD-7 ${m.gad7}/21${m.gad7 >= 10 ? " [≥ seuil 10]" : ""}`);
        }
        if (m.isi != null) {
          parties.push(`ISI ${m.isi}/28${m.isi >= 15 ? " [≥ seuil 15]" : ""}`);
        }
        if (m.score_moral != null) {
          parties.push(`moral ${m.score_moral}/100`);
        }
        parties.push(`(${m.source})`);
        lignes.push(`  · ${parties.join(" · ")}`);
      }
    }

    // ---- signaux ouverts ----------------------------------------------------
    const signaux = requete<{
      severite: string;
      motif: string;
      origine: string;
      ouvert_at: string;
    }>(
      `SELECT severite, motif, origine, ouvert_at
         FROM signaux
        WHERE resident_id = :id
          AND statut IN ('ouvert','en_cours')
        ORDER BY
          CASE severite WHEN 'critique' THEN 1 WHEN 'surveillance' THEN 2 ELSE 3 END,
          ouvert_at DESC
        LIMIT 5`,
      { id },
    );

    lignes.push("");
    if (signaux.length > 0) {
      lignes.push("Alertes médicales ouvertes :");
      for (const s of signaux) {
        const dateLabel = s.ouvert_at.slice(0, 10);
        lignes.push(`  · [${s.severite.toUpperCase()}] ${s.motif} (${s.origine}, ${dateLabel})`);
      }
    } else {
      lignes.push("Alertes médicales ouvertes : aucune.");
    }

    lignes.push("[FIN DONNÉES SANTÉ]");

    res.type("text/plain; charset=utf-8").send(lignes.join("\n"));
  } catch (e) {
    next(e);
  }
});
