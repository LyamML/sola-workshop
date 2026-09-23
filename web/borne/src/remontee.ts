/**
 * Envoi du résumé clinique au serveur de bord.
 *
 * Le navigateur appelle `/bord/…` : le proxy Vite ajoute le jeton borne. Aucun
 * secret et aucun verbatim ne transitent par cette route.
 */

import type { ResumeClinique } from "./ia";

/** Identité de démonstration de la cabine C-12 — alignée sur le jeu de données. */
export const RESIDENT_CODE = "R-0448";
export const JOUR_VOL = 4128;

export interface ChargeConversation {
  resident: string;
  debut_at: string;
  jour_vol: number;
  duree_min: number;
  severite: ResumeClinique["severite"];
  resume: string;
  tags: string[];
  actions_proposees: number;
  actions_acceptees: number;
  remontee_auto: boolean;
  resident_notifie_at: string | null;
}

export type ResultatRemontee =
  | { ok: true; remontee_auto: boolean }
  | { ok: false; raison: "resume" | "serveur" };

export async function envoyerResume(opts: {
  debut_at: string;
  duree_min: number;
  clinique: ResumeClinique;
}): Promise<ResultatRemontee> {
  const { debut_at, duree_min, clinique } = opts;
  const charge: ChargeConversation = {
    resident: RESIDENT_CODE,
    debut_at,
    jour_vol: JOUR_VOL,
    duree_min: Math.max(0, Math.min(600, duree_min)),
    severite: clinique.severite,
    resume: clinique.resume,
    tags: clinique.tags,
    actions_proposees: 0,
    actions_acceptees: 0,
    remontee_auto: clinique.remontee_auto,
    // Le résident est prévenu par la barre d'état (et par Sola pendant
    // l'échange si elle a annoncé une remontée). On horodate la promesse.
    resident_notifie_at: clinique.remontee_auto ? new Date().toISOString() : null,
  };

  try {
    const reponse = await fetch("/bord/ingest/conversation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(charge),
    });
    if (!reponse.ok) return { ok: false, raison: "serveur" };
    return { ok: true, remontee_auto: clinique.remontee_auto };
  } catch {
    return { ok: false, raison: "serveur" };
  }
}
