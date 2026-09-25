import { useEffect, useState } from "react";
import { ErreurApi, api, type DirectApi, type LectureApi, type MinuteApi } from "./api";

/** Le bracelet envoie toutes les dix secondes : relire plus souvent ne montrerait rien de neuf. */
const PERIODE_MS = 10_000;

/**
 * Trois envois manqués : au-delà, le bracelet ne se dit plus « en direct ». Il
 * envoie toutes les dix secondes, et une trame en retard n'est pas encore une
 * trame perdue.
 */
export const SILENCE_S = 30;

/** La largeur de la carte, en minutes : les lectures que le serveur garde (FENETRE_MIN, server/src/routes/ingest.ts). */
export const FENETRE_MIN = 10;

export interface Direct {
  donnees: DirectApi;
  /** Ce qu'il faut ajouter à l'horloge du poste pour lire celle du serveur. */
  decalage: number;
  /** La dernière relecture a échoué : ce qui s'affiche date de la précédente. */
  panne: "serveur" | "session" | null;
}

/** Ce que la carte et les tuiles lisent d'une relecture. */
export interface EtatDirect {
  /** La dernière valeur reçue du bracelet ; null quand rien n'est arrivé depuis vingt-quatre heures. */
  mesure: MinuteApi | null;
  /** La même, quand c'est une lecture : elle seule dit quels champs la trame portait. */
  lecture: LectureApi | null;
  /** C'est la moyenne d'une minute : le serveur a redémarré depuis la dernière lecture et l'a oubliée. */
  moyenne: boolean;
  /** Secondes depuis le dernier envoi reçu, à l'horloge du serveur ; null quand le bracelet n'a jamais rien envoyé. */
  silence: number | null;
  /** Le bracelet envoie encore, et la relecture qui le dit vient de réussir. */
  vivant: boolean;
}

/**
 * La dernière lecture, telle que le bracelet l'a envoyée. La dernière minute
 * seulement quand elle est plus récente : `mesures` n'en garde que la moyenne,
 * et une valeur qui change en cours de minute ne s'y lit qu'à moitié.
 */
export function etatDirect(direct: Direct): EtatDirect {
  const d = direct.donnees;
  const derniere = d.lectures.at(-1);
  const lecture =
    derniere !== undefined && (!d.derniere || Date.parse(derniere.at) >= Date.parse(d.derniere.at)) ? derniere : null;
  const mesure = lecture ?? d.derniere;
  // `synchro_at` bouge à chaque envoi reçu, même quand rien n'en est retenu :
  // un contact faible reste un bracelet qui parle.
  const depuis = d.bracelet?.synchro_at ?? mesure?.at;
  const silence = depuis ? (Date.now() + direct.decalage - Date.parse(depuis)) / 1000 : null;
  return {
    mesure,
    lecture,
    moyenne: mesure !== null && lecture === null,
    silence,
    vivant: direct.panne === null && silence !== null && silence <= SILENCE_S,
  };
}

/**
 * Ce que le bracelet d'un résident vient d'envoyer, relu tant que la fiche
 * est ouverte.
 *
 * Seulement quand la fiche vient du serveur : en démonstration, il n'y a pas
 * de bracelet à écouter, et la carte ne s'affiche pas plutôt que d'annoncer
 * une panne qui n'en est pas une. Une relecture manquée garde la réponse
 * précédente : l'âge de la dernière trame continue de courir, et la carte dit
 * pourquoi rien de neuf n'arrive.
 */
export function useDirect(code: string, actif: boolean): Direct | null {
  const [direct, setDirect] = useState<Direct | null>(null);

  useEffect(() => {
    setDirect(null);
    if (!actif) return;
    let vivant = true;
    let minuteur: ReturnType<typeof setTimeout> | undefined;

    const relire = () => {
      api
        .direct(code)
        .then((donnees) => {
          if (!vivant) return;
          setDirect({ donnees, decalage: Date.parse(donnees.maintenant) - Date.now(), panne: null });
        })
        .catch((e: unknown) => {
          if (!vivant) return;
          const panne = e instanceof ErreurApi && e.statut === 401 ? "session" : "serveur";
          setDirect((d) => (d ? { ...d, panne } : d));
        })
        .finally(() => {
          if (vivant) minuteur = setTimeout(relire, PERIODE_MS);
        });
    };
    relire();

    return () => {
      vivant = false;
      clearTimeout(minuteur);
    };
  }, [code, actif]);

  return direct;
}
