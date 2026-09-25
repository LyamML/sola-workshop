import { useEffect, useState } from "react";
import { ligneBracelet } from "../adapt";
import type { ChampMesure, DirectApi, LectureApi } from "../api";
import { FENETRE_MIN, SILENCE_S, etatDirect, type Direct, type EtatDirect } from "../direct";
import { duree, entier, fr, frMax, jv, pluriel } from "../format";
import "../styles/direct.css";

/**
 * Ce que la carte lit dans chaque lecture, toutes les cases à leur place, que
 * le bracelet les remplisse ou non : une case qui n'apparaît qu'avec sa
 * première valeur déplace les autres, et un champ que le bracelet n'envoie
 * pas doit se lire absent plutôt que passer inaperçu — le croquis Wi-Fi n'a
 * pas l'activité, le firmware BLE ni la température ni les pas. La précision
 * des tuiles de constantes : une SpO₂ ou une température qui suit la carte
 * doit y écrire le même chiffre.
 */
const VALEURS: {
  champ: ChampMesure;
  libelle: string;
  unite: string;
  decimales: number;
  /** Décimales fixes, comme la tuile : « 34,0 °C » plutôt que « 34 °C ». */
  fixe?: boolean;
}[] = [
  { champ: "fc_bpm", libelle: "Fréquence cardiaque", unite: "bpm", decimales: 1 },
  { champ: "spo2_pct", libelle: "SpO₂", unite: "%", decimales: 1 },
  { champ: "rmssd_ms", libelle: "Variabilité · RMSSD", unite: "ms", decimales: 1 },
  { champ: "temp_c", libelle: "Température cutanée", unite: "°C", decimales: 1, fixe: true },
  { champ: "activite_g", libelle: "Activité", unite: "g", decimales: 2 },
  { champ: "pas", libelle: "Pas", unite: "pas", decimales: 0 },
];

/**
 * Ce qu'une case écrit faute de valeur. Indisponible : rien n'en arrive — le
 * bracelet s'est tu, ou sa trame n'a pas ce champ. Calibrage : la trame le
 * porte, mais sans valeur qui tienne encore — zéro, ce que le capteur publie
 * tant qu'il cherche, une valeur hors des bornes physiologiques, un capteur en
 * mise en route. Contact faible : le capteur le dit lui-même, et l'optique
 * comme la température ne valent rien sans la peau.
 */
const ETATS = {
  indisponible: "donnée indisponible",
  calibrage: "calibrage…",
  contact: "contact faible",
} as const;
type Etat = keyof typeof ETATS;

/** Ce que le serveur ne retient que sur un contact bon ou correct (retenir, server/src/routes/ingest.ts). */
const OPTIQUES: ChampMesure[] = ["fc_bpm", "spo2_pct", "rmssd_ms", "temp_c"];

/** La valeur d'une case, ou pourquoi elle n'en a pas. */
function lire(etat: EtatDirect, champ: ChampMesure): number | Etat {
  const { mesure, lecture, vivant } = etat;
  // Un bracelet muet n'a plus de valeur du moment : ce qu'il a dit reste sur
  // la courbe, grisée.
  if (!vivant || !mesure) return "indisponible";
  const valeur = mesure[champ];
  if (valeur !== null) return valeur;
  // Une minute ne garde pas ce que ses trames portaient : faute de le savoir,
  // la case n'annonce pas une valeur qui ne viendra peut-être jamais.
  if (!lecture?.envoyes.includes(champ)) return "indisponible";
  return lecture.qualite === "poor" && OPTIQUES.includes(champ) ? "contact" : "calibrage";
}

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
function Trace({ donnees: d, champ, maintenant }: { donnees: DirectApi; champ: ChampMesure; maintenant: number }) {
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
 * qu'une lecture en signale une, avec l'heure où il a commencé à la dire, que
 * le bracelet envoie encore ou non. Le signal critique s'est ouvert au serveur
 * à cette lecture-là (routes/ingest.ts) : la carte ne fait que la montrer. Une
 * chute signalée depuis la première lecture de la fenêtre a commencé avant
 * elle, et son heure est celle du signal. « Aucune », seulement si la
 * dernière lecture le dit : la trame BLE compte les chutes sans les dire, et
 * une minute n'en garde rien.
 */
function Chute({ etat, lectures, maintenant }: { etat: EtatDirect; lectures: LectureApi[]; maintenant: number }) {
  const debut = maintenant - FENETRE_MIN * 60_000;
  const dites = lectures.filter((l) => l.chute !== null && Date.parse(l.at) >= debut);
  let depuis: string | null = null;
  for (let i = 1; i < dites.length; i++) {
    if (dites[i]!.chute && !dites[i - 1]!.chute) depuis = dites[i]!.at;
  }
  const signalee = dites.some((l) => l.chute);
  const aucune = etat.vivant && etat.lecture?.chute === false;
  return (
    <div className={`dl-v mot${signalee ? " chute" : ""}`}>
      <span className="l">Chute</span>
      {signalee || aucune ? (
        <span className="v">
          {signalee ? "signalée" : "aucune"}
          {depuis && <small>à {heureLocale(depuis, maintenant, true)}</small>}
        </span>
      ) : (
        <span className="v etat indisponible">{ETATS.indisponible}</span>
      )}
    </div>
  );
}

/**
 * La carte « en direct » de la fiche : la dernière valeur reçue du bracelet,
 * les dix minutes qui la précèdent, et ce que la journée en a retenu. Toujours
 * là, toutes ses cases comprises, même quand le bracelet ne dit rien : chaque
 * case dit alors pourquoi elle est vide. Une carte qui disparaît laisse croire
 * à une panne de la console.
 */
export function EnDirect({ direct }: { direct: Direct }) {
  useSeconde();
  const etat = etatDirect(direct);
  const { donnees: d, panne } = direct;
  const { mesure, moyenne, silence, vivant } = etat;

  const maintenant = Date.now() + direct.decalage;
  const pastille =
    panne === "session"
      ? "session expirée"
      : panne === "serveur"
        ? "serveur injoignable"
        : silence === null
          ? "aucune trame reçue"
          : vivant
            ? `reçue il y a ${age(silence)}`
            : `aucune trame depuis ${age(silence)}`;
  // L'heure de ce que les cases montrent ; muet, celle où le bracelet s'est tu.
  const quand = !mesure
    ? null
    : !vivant
      ? `dernière lecture à ${heureLocale(mesure.at, maintenant, !moyenne)}`
      : moyenne
        ? `moyenne de la minute de ${heureLocale(mesure.at, maintenant, false)}`
        : `lecture de ${heureLocale(mesure.at, maintenant, true)}`;

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
            {[d.bracelet ? `bracelet ${d.bracelet.serie}` : "aucun bracelet appairé", quand]
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
          {VALEURS.map((v) => {
            const valeur = lire(etat, v.champ);
            return (
              <div className="dl-v" key={v.champ}>
                <span className="l">{v.libelle}</span>
                {typeof valeur === "number" ? (
                  // Clé sur la valeur : chaque nouvelle lecture rejoue l'apparition.
                  <span className="v" key={`${mesure?.at}·${valeur}`}>
                    {(v.fixe ? fr : frMax)(valeur, v.decimales)}
                    <small>{v.unite}</small>
                  </span>
                ) : (
                  <span className={`v etat ${valeur}`} key={valeur}>
                    {ETATS[valeur]}
                  </span>
                )}
                <Trace donnees={d} champ={v.champ} maintenant={maintenant} />
              </div>
            );
          })}
          <Chute etat={etat} lectures={d.lectures} maintenant={maintenant} />
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
