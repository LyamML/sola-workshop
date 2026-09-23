import { useEffect, useState } from "react";
import { ligneBracelet } from "../adapt";
import type { MinuteApi } from "../api";
import type { Direct } from "../direct";
import { duree, frMax, jv, pluriel } from "../format";
import "../styles/direct.css";

/**
 * Trois envois manqués : au-delà, le bracelet ne se dit plus « en direct ». Il
 * envoie toutes les dix secondes, et une trame en retard n'est pas encore une
 * trame perdue.
 */
const SILENCE_S = 30;

type Champ = "fc_bpm" | "spo2_pct" | "rmssd_ms" | "activite_g";

/**
 * Ce que la carte lit dans chaque minute. La FC et la SpO₂ ont toujours leur
 * case ; la variabilité et l'activité seulement si le bracelet les envoie —
 * le croquis Arduino n'a ni l'une ni l'autre, le firmware BLE a les deux.
 */
const VALEURS: { champ: Champ; libelle: string; unite: string; decimales: number; toujours: boolean }[] = [
  { champ: "fc_bpm", libelle: "Fréquence cardiaque", unite: "bpm", decimales: 0, toujours: true },
  { champ: "spo2_pct", libelle: "SpO₂", unite: "%", decimales: 0, toujours: true },
  { champ: "rmssd_ms", libelle: "Variabilité · RMSSD", unite: "ms", decimales: 0, toujours: false },
  { champ: "activite_g", libelle: "Activité", unite: "g", decimales: 2, toujours: false },
];

/** Pourquoi une minute n'a pas de valeur optique : le capteur l'a dit. */
const QUALITE: Partial<Record<MinuteApi["qualite"], string>> = {
  poor: "contact faible",
  warmup: "capteur en mise en route",
};

/** Un rendu par seconde : « il y a 8 s » doit avancer seul entre deux relectures. */
function useSeconde(): void {
  const [, setTic] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTic((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
}

/** « 8 s », « 3 min », « 2 h 05 ». */
function age(secondes: number): string {
  const s = Math.max(0, Math.round(secondes));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  return duree(s / 60);
}

/**
 * L'heure du poste, et le jour s'il a changé. `mesures` et `synchro_at` sont
 * écrits en UTC : une trame qui vient d'arriver doit se lire à l'heure de la
 * pendule, pas deux heures plus tôt. Le reste de la fiche garde l'heure de
 * bord de la base, celle d'`horodatage`.
 */
function heureLocale(iso: string, maintenant: number, secondes: boolean): string {
  const t = new Date(iso);
  const heure = t.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    second: secondes ? "2-digit" : undefined,
  });
  return t.toDateString() === new Date(maintenant).toDateString()
    ? heure
    : `${t.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })} ${heure}`;
}

/** « 58 à 84 bpm », ou « 60 bpm » quand la journée n'a pas bougé. */
function plage(min: number, max: number, unite: string): string {
  return min === max ? `${frMax(min, 0)} ${unite}` : `${frMax(min, 0)} à ${frMax(max, 0)} ${unite}`;
}

/**
 * L'heure écoulée d'une constante, jusqu'à maintenant au bord droit. Le trait
 * se coupe sur une minute sans valeur : un trou dit un silence du capteur, une
 * droite tirée par-dessus le cacherait.
 */
function Trace({ minutes, champ, maintenant }: { minutes: MinuteApi[]; champ: Champ; maintenant: number }) {
  const debut = maintenant - 3_600_000;
  const points = minutes.flatMap((m) => {
    const v = m[champ];
    return v === null ? [] : [{ x: (Date.parse(m.at) - debut) / 60_000, y: v }];
  });
  if (points.length < 2) return <span />;

  const ys = points.map((p) => p.y);
  const lo = Math.min(...ys);
  const hi = Math.max(...ys);
  const marge = (hi - lo) * 0.2 || 1;
  const Y = (v: number) => 22 - ((v - lo + marge) / (hi - lo + 2 * marge)) * 20;
  const trace = points
    .map((p, i) => `${i && p.x - points[i - 1]!.x <= 1.5 ? "L" : "M"}${p.x.toFixed(2)} ${Y(p.y).toFixed(2)}`)
    .join(" ");

  return (
    <svg className="dl-sp" viewBox="0 0 60 24" preserveAspectRatio="none" aria-hidden="true">
      <path d={trace} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/**
 * La carte « en direct » de la fiche : la dernière minute du bracelet, l'heure
 * qui la précède, et ce que la journée en a retenu. Absente tant que le
 * bracelet n'a rien envoyé depuis vingt-quatre heures : les tuiles disent
 * alors, chacune, de quand date sa valeur.
 */
export function EnDirect({ direct }: { direct: Direct }) {
  useSeconde();
  const { donnees: d, decalage, panne } = direct;
  const derniere = d.derniere;
  if (!derniere) return null;

  const maintenant = Date.now() + decalage;
  const silence = (maintenant - Date.parse(d.bracelet?.synchro_at ?? derniere.at)) / 1000;
  const vivant = panne === null && silence <= SILENCE_S;
  const etat =
    panne === "session"
      ? "session expirée"
      : panne === "serveur"
        ? "serveur injoignable"
        : vivant
          ? `reçue il y a ${age(silence)}`
          : `aucune trame depuis ${age(silence)}`;

  const valeurs = VALEURS.filter((v) => v.toujours || d.minutes.some((m) => m[v.champ] !== null));
  const j = d.jour;
  const jour =
    j.minutes > 0
      ? [
          j.jour_vol !== null ? jv(j.jour_vol) : "Aujourd'hui",
          pluriel(j.minutes, "minute exploitable", "minutes exploitables"),
          j.fc_min !== null && j.fc_max !== null ? `FC ${plage(j.fc_min, j.fc_max, "bpm")}` : null,
          j.spo2_min !== null ? `SpO₂ au plus bas ${frMax(j.spo2_min, 0)} %` : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : null;

  return (
    <div className="mk-row">
      <section className={`mk-card direct${vivant ? "" : " fige"}`} aria-labelledby="en-direct">
        <div className="mk-ch">
          <h3 id="en-direct">En direct</h3>
          <span className="sub">
            {[
              d.bracelet ? `bracelet ${d.bracelet.serie}` : null,
              `minute de ${heureLocale(derniere.at, maintenant, false)}`,
              QUALITE[derniere.qualite],
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
          <span className="r">
            <span className={`chip ${vivant ? "ok" : "watch"}`}>
              <i className={`dl-pouls${vivant ? " on" : ""}`} aria-hidden="true" />
              {etat}
            </span>
          </span>
        </div>
        <div className="dl-g">
          {valeurs.map((v) => {
            const valeur = derniere[v.champ];
            return (
              <div className="dl-v" key={v.champ}>
                <span className="l">{v.libelle}</span>
                {/* Clé sur la valeur : chaque nouvelle lecture rejoue l'apparition. */}
                <span className="v" key={`${derniere.at}·${valeur}`}>
                  {valeur === null ? "—" : frMax(valeur, v.decimales)}
                  {valeur !== null && <small>{v.unite}</small>}
                </span>
                <Trace minutes={d.minutes} champ={v.champ} maintenant={maintenant} />
              </div>
            );
          })}
        </div>
        {jour && <p className="dl-jour">{jour}</p>}
      </section>
    </div>
  );
}

/**
 * La ligne bracelet de l'identité : à l'heure de la dernière trame reçue, à la
 * seconde, tant que le bracelet envoie ; celle de la fiche sinon.
 */
export function LigneBracelet({ direct, repli }: { direct: Direct | null; repli: string | null }) {
  const b = direct?.donnees.bracelet;
  if (!direct?.donnees.derniere || !b?.synchro_at) return <>{repli ?? "Aucun bracelet appairé"}</>;
  return <>{ligneBracelet(b.serie, b.batterie_pct, heureLocale(b.synchro_at, Date.now() + direct.decalage, true))}</>;
}
