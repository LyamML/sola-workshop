import { useEffect, useState } from "react";
import { ligneBracelet } from "../adapt";
import type { DirectApi, LectureApi, MinuteApi } from "../api";
import { FENETRE_MIN, SILENCE_S, etatDirect, type Direct } from "../direct";
import { duree, entier, fr, frMax, jv, pluriel } from "../format";
import "../styles/direct.css";

type Champ = "fc_bpm" | "spo2_pct" | "rmssd_ms" | "temp_c" | "activite_g" | "pas";

/**
 * Ce que la carte lit dans chaque lecture. La FC et la SpO₂ ont toujours leur
 * case ; les autres seulement si le bracelet les envoie — le croquis Wi-Fi a
 * la température et les pas, le firmware BLE la variabilité et l'activité.
 * La précision des tuiles de constantes : une SpO₂ ou une température qui
 * suit la carte doit y écrire le même chiffre.
 */
const VALEURS: {
  champ: Champ;
  libelle: string;
  unite: string;
  decimales: number;
  /** Décimales fixes, comme la tuile : « 34,0 °C » plutôt que « 34 °C ». */
  fixe?: boolean;
  toujours: boolean;
}[] = [
  { champ: "fc_bpm", libelle: "Fréquence cardiaque", unite: "bpm", decimales: 1, toujours: true },
  { champ: "spo2_pct", libelle: "SpO₂", unite: "%", decimales: 1, toujours: true },
  { champ: "rmssd_ms", libelle: "Variabilité · RMSSD", unite: "ms", decimales: 1, toujours: false },
  { champ: "temp_c", libelle: "Température cutanée", unite: "°C", decimales: 1, fixe: true, toujours: false },
  { champ: "activite_g", libelle: "Activité", unite: "g", decimales: 2, toujours: false },
  { champ: "pas", libelle: "Pas", unite: "pas", decimales: 0, toujours: false },
];

/** Pourquoi une lecture n'a pas de valeur optique : le capteur l'a dit. */
const QUALITE: Partial<Record<MinuteApi["qualite"], string>> = {
  poor: "contact faible",
  warmup: "capteur en mise en route",
};

/**
 * L'écart au-delà duquel le trait se coupe entre deux points : trois envois
 * manqués entre deux lectures, plus d'une minute entre deux minutes.
 */
const TROU_LECTURES_MS = SILENCE_S * 1000;
const TROU_MINUTES_MS = 90_000;

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

/**
 * « 58 à 84 bpm », ou « 60 bpm » quand la journée n'a pas bougé — à la
 * précision affichée : 58,2 et 58,4 ne font pas « 58 à 58 ».
 */
function plage(min: number, max: number, unite: string, format = (v: number) => frMax(v, 0)): string {
  const [de, a] = [format(min), format(max)];
  return de === a ? `${de} ${unite}` : `${de} à ${a} ${unite}`;
}

/**
 * Les dix dernières minutes d'une constante, jusqu'à maintenant au bord
 * droit, une lecture par point. Les minutes de la base ne comblent que ce qui
 * précède la première lecture — un serveur qui vient de redémarrer n'en a
 * plus —, placées en leur milieu puisqu'elles en sont la moyenne. Le trait se
 * coupe sur une valeur absente ou un silence : un trou dit que le capteur
 * s'est tu, une droite tirée par-dessus le cacherait.
 */
function Trace({ donnees: d, champ, maintenant }: { donnees: DirectApi; champ: Champ; maintenant: number }) {
  const debut = maintenant - FENETRE_MIN * 60_000;
  const premiere = d.lectures.length ? Date.parse(d.lectures[0]!.at) : Infinity;
  const serie = [
    ...d.minutes
      .filter((m) => Date.parse(m.at) + 60_000 <= premiere)
      .map((m) => ({ t: Date.parse(m.at) + 30_000, v: m[champ], trou: TROU_MINUTES_MS })),
    ...d.lectures.map((l) => ({ t: Date.parse(l.at), v: l[champ], trou: TROU_LECTURES_MS })),
  ].filter((p) => p.t >= debut);

  const morceaux: { t: number; v: number }[][] = [];
  let precedent: { t: number; trou: number } | null = null;
  for (const p of serie) {
    if (p.v === null) {
      precedent = null;
      continue;
    }
    if (!precedent || p.t - precedent.t > Math.max(precedent.trou, p.trou)) morceaux.push([]);
    morceaux.at(-1)!.push({ t: p.t, v: p.v });
    precedent = p;
  }
  // Un point seul ne trace rien : il attend la lecture suivante.
  const traits = morceaux.filter((m) => m.length > 1);
  if (!traits.length) return <span />;

  const ys = traits.flat().map((p) => p.v);
  const lo = Math.min(...ys);
  const hi = Math.max(...ys);
  const marge = (hi - lo) * 0.2 || 1;
  const X = (t: number) => ((t - debut) / 60_000).toFixed(3);
  const Y = (v: number) => (22 - ((v - lo + marge) / (hi - lo + 2 * marge)) * 20).toFixed(2);
  const trace = traits.map((m) => m.map((p, i) => `${i ? "L" : "M"}${X(p.t)} ${Y(p.v)}`).join(" ")).join(" ");

  return (
    <svg className="dl-sp" viewBox={`0 0 ${FENETRE_MIN} 24`} preserveAspectRatio="none" aria-hidden="true">
      <path d={trace} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/**
 * Ce que le croquis dit des chutes sur les dix minutes : « signalée » dès
 * qu'une lecture en signale une, avec l'heure où il a commencé à la dire. Le
 * signal critique s'est ouvert au serveur à cette lecture-là
 * (routes/ingest.ts) : la carte ne fait que la montrer. Une chute signalée
 * depuis la première lecture de la fenêtre a commencé avant elle, et son
 * heure est celle du signal.
 */
function Chute({ lectures, maintenant }: { lectures: LectureApi[]; maintenant: number }) {
  const debut = maintenant - FENETRE_MIN * 60_000;
  const dites = lectures.filter((l) => l.chute !== null && Date.parse(l.at) >= debut);
  let depuis: string | null = null;
  for (let i = 1; i < dites.length; i++) {
    if (dites[i]!.chute && !dites[i - 1]!.chute) depuis = dites[i]!.at;
  }
  const signalee = dites.some((l) => l.chute);
  return (
    <div className={`dl-v mot${signalee ? " chute" : ""}`}>
      <span className="l">Chute</span>
      <span className="v">
        {signalee ? "signalée" : "aucune"}
        {depuis && <small>à {heureLocale(depuis, maintenant, true)}</small>}
      </span>
    </div>
  );
}

/**
 * La carte « en direct » de la fiche : la dernière valeur reçue du bracelet,
 * les dix minutes qui la précèdent, et ce que la journée en a retenu. Absente
 * tant que le bracelet n'a rien envoyé depuis vingt-quatre heures : les tuiles
 * disent alors, chacune, de quand date sa valeur.
 */
export function EnDirect({ direct }: { direct: Direct }) {
  useSeconde();
  const etat = etatDirect(direct);
  if (!etat) return null;
  const { donnees: d, panne } = direct;
  const { mesure, moyenne, silence, vivant } = etat;

  const maintenant = Date.now() + direct.decalage;
  const pastille =
    panne === "session"
      ? "session expirée"
      : panne === "serveur"
        ? "serveur injoignable"
        : vivant
          ? `reçue il y a ${age(silence)}`
          : `aucune trame depuis ${age(silence)}`;

  const valeurs = VALEURS.filter(
    (v) => v.toujours || [...d.minutes, ...d.lectures].some((m) => m[v.champ] !== null),
  );
  const chutes = d.lectures.some((l) => l.chute !== null);
  const j = d.jour;
  const jour =
    j.minutes > 0
      ? [
          j.jour_vol !== null ? jv(j.jour_vol) : "Aujourd'hui",
          pluriel(j.minutes, "minute exploitable", "minutes exploitables"),
          j.fc_min !== null && j.fc_max !== null ? `FC ${plage(j.fc_min, j.fc_max, "bpm")}` : null,
          j.spo2_min !== null ? `SpO₂ au plus bas ${frMax(j.spo2_min, 0)} %` : null,
          j.temp_min !== null && j.temp_max !== null
            ? `température ${plage(j.temp_min, j.temp_max, "°C", (v) => fr(v, 1))}`
            : null,
          j.pas !== null ? `${entier(j.pas)} pas` : null,
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
              moyenne
                ? `moyenne de la minute de ${heureLocale(mesure.at, maintenant, false)}`
                : `lecture de ${heureLocale(mesure.at, maintenant, true)}`,
              QUALITE[mesure.qualite],
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
          <span className="r">
            <span className={`chip ${vivant ? "ok" : "watch"}`}>
              <i className={`dl-pouls${vivant ? " on" : ""}`} aria-hidden="true" />
              {pastille}
            </span>
          </span>
        </div>
        <div className="dl-g">
          {valeurs.map((v) => {
            const valeur = mesure[v.champ];
            return (
              <div className="dl-v" key={v.champ}>
                <span className="l">{v.libelle}</span>
                {/* Clé sur la valeur : chaque nouvelle lecture rejoue l'apparition. */}
                <span className="v" key={`${mesure.at}·${valeur}`}>
                  {valeur === null ? "—" : (v.fixe ? fr : frMax)(valeur, v.decimales)}
                  {valeur !== null && <small>{v.unite}</small>}
                </span>
                <Trace donnees={d} champ={v.champ} maintenant={maintenant} />
              </div>
            );
          })}
          {chutes && <Chute lectures={d.lectures} maintenant={maintenant} />}
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
