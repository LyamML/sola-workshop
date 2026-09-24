import { type ReactNode, useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { MODULES, gravite, statut as pastilleStatut } from "../adapt";
import { ErreurApi, api, type AncreApi, type Origine, type SignalApi, type StatsSignauxApi } from "../api";
import { useAvis } from "../components/Avis";
import { Icone } from "../components/Icone";
import { Segments } from "../components/Segments";
import { dateCourte, duree, entier, fr, frMax, heure, jv, pluriel } from "../format";
import { type LigneEquipage, type LigneSignal, type Sens, useListe, useRetard } from "../registre";
import { useCompte } from "../session";

/**
 * Écran 04 — le registre.
 *
 * Les deux écrans précédents répondent à « comment va l'équipage ? » et
 * « comment va cette personne ? ». Celui-ci répond à la question qui les relie
 * et qu'aucun des deux ne couvre : « qui, parmi les 1 240, dois-je regarder
 * d'abord ? ». D'où le tri sur chaque colonne — la réponse dépend de ce qu'on
 * cherche ce matin-là, et personne ne peut la figer à l'avance.
 *
 * Il lit la base directement et n'a pas de jeu de démonstration : c'est le
 * seul écran de la console qui se tait quand le serveur se tait, et il le dit.
 */

const TAILLE = 50;

interface Colonne<T> {
  /** Clé de tri envoyée au serveur. `null` = colonne non triable. */
  cle: string | null;
  titre: string;
  /** Le seuil, sous l'en-tête : « ≥ 10 », « < 30 ms ». */
  sous?: string;
  /** Aligné à gauche, dans un tableau de chiffres alignés à droite. */
  gauche?: boolean;
  /** La classe de la cellule : `res`, `mo`, `m2`, `act`. */
  classe?: string;
  /**
   * Sens du PREMIER clic. Une SpO₂ se regarde en commençant par la plus
   * basse, un nombre de signaux par le plus élevé : le sens par défaut est
   * celui qui met en haut ce qui inquiète.
   */
  sens?: Sens;
  rendu: (l: T) => ReactNode;
  /** La cellule franchit le seuil de la colonne. */
  chaud?: (l: T) => boolean;
  /** Le sens du franchissement, quand il n'est pas celui de la colonne. */
  fleche?: (l: T) => string;
  /** Une mesure plus ancienne que le jour courant : sa date, pour l'infobulle. */
  date?: (l: T) => string | null;
}

/** Arrondi à l'affichage : une règle se juge sur ce que la cellule écrit. */
const a1 = (v: number) => Math.round(v * 10) / 10;

function Tableau<T>({
  classe,
  colonnes,
  lignes,
  cleLigne,
  onLigne,
  tri,
  sens,
  onTri,
  chargement,
  vide,
  jour,
}: {
  classe: string;
  colonnes: Colonne<T>[];
  lignes: T[];
  cleLigne: (l: T) => string | number;
  onLigne: (l: T) => void;
  tri: string;
  sens: Sens;
  onTri: (cle: string, sens: Sens) => void;
  chargement: boolean;
  vide: string;
  /** Le jour courant de la base, pour repérer une mesure qui date. */
  jour: string | null;
}) {
  return (
    <div className="rg-w">
      <table className={`${classe}${chargement ? " chargement" : ""}`}>
        <thead>
          <tr>
            {colonnes.map((c) => {
              const actif = c.cle !== null && c.cle === tri;
              const cls = [c.gauche ? "l" : "", c.classe === "act" ? "act" : ""].filter(Boolean).join(" ");
              return (
                <th
                  key={c.titre}
                  className={cls || undefined}
                  aria-sort={actif ? (sens === "asc" ? "ascending" : "descending") : undefined}
                >
                  {c.cle === null ? (
                    <span className="th-fixe">
                      {c.titre}
                      {c.sous && <small>{c.sous}</small>}
                    </span>
                  ) : (
                    <button
                      type="button"
                      className={actif ? "actif" : undefined}
                      onClick={() =>
                        onTri(c.cle!, actif ? (sens === "asc" ? "desc" : "asc") : (c.sens ?? "asc"))
                      }
                      title={`Trier par ${c.titre}`}
                    >
                      {c.titre}
                      <span className="fleche" aria-hidden="true">
                        {actif ? (sens === "asc" ? "▲" : "▼") : "⇅"}
                      </span>
                      {c.sous && <small>{c.sous}</small>}
                    </button>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {lignes.map((l) => (
            <tr key={cleLigne(l)} className="go" onClick={() => onLigne(l)}>
              {colonnes.map((c) => {
                const chaud = c.chaud?.(l) ?? false;
                const date = jour && c.date ? c.date(l) : null;
                const vieux = date !== null && date !== jour;
                const cls = [c.gauche ? "l" : "", c.classe ?? "", chaud ? "hot" : "", vieux ? "vieux" : ""]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <td
                    key={c.titre}
                    className={cls || undefined}
                    title={vieux ? `dernière mesure le ${dateCourte(date)}` : undefined}
                  >
                    {c.rendu(l)}
                    {chaud && (
                      <>
                        <i aria-hidden="true">{c.fleche?.(l) ?? (c.sens === "desc" ? "▲" : "▼")}</i>
                        <span className="cache"> (au-delà du seuil)</span>
                      </>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
          {lignes.length === 0 && !chargement && (
            <tr>
              <td colSpan={colonnes.length} className="vide">
                {vide}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/** Ce que l'écran dit quand la base ne répond pas : un refus n'est pas une panne. */
function Indisponible({ erreur }: { erreur: string }) {
  const { deconnecter } = useCompte();
  const refus = erreur === "HTTP 401";
  return (
    <div className="vide" role="status">
      {refus ? (
        <>
          Registre indisponible : votre session a expiré.
          <br />
          <button type="button" className="btn mini" onClick={deconnecter}>
            Se reconnecter
          </button>
        </>
      ) : (
        <>Registre indisponible : le serveur de bord ne répond pas.</>
      )}
      <br />
      Cet écran lit la base directement, il n'a pas de jeu de démonstration.
    </div>
  );
}

function Pager({
  page,
  total,
  ordre,
  onPage,
}: {
  page: number;
  total: number;
  ordre: string;
  onPage: (p: number) => void;
}) {
  const premier = total === 0 ? 0 : (page - 1) * TAILLE + 1;
  const dernier = Math.min(page * TAILLE, total);
  const pages = Math.max(1, Math.ceil(total / TAILLE));
  return (
    <div className="pager">
      <span>
        {entier(premier)}–{entier(dernier)} sur {entier(total)} · {ordre}
      </span>
      <span className="p">
        <button type="button" className="btn mini" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Précédent
        </button>
        <button type="button" className="btn mini" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Suivant
        </button>
      </span>
    </div>
  );
}

/** « tri : PHQ-9, décroissant », sauf pour le tri par défaut, qui se dit en clair. */
function ordreLu<T>(colonnes: Colonne<T>[], tri: string, sens: Sens, defaut: { tri: string; sens: Sens; texte: string }) {
  if (tri === defaut.tri && sens === defaut.sens) return defaut.texte;
  const c = colonnes.find((x) => x.cle === tri);
  return `tri : ${c?.titre ?? tri}, ${sens === "asc" ? "croissant" : "décroissant"}`;
}

const RETOUR_REGISTRE = { chemin: "/registre", libelle: "Registre" };
const RETOUR_SIGNAUX = { chemin: "/signaux", libelle: "Registre" };

// ------------------------------------------------------------- résidents --
type VueRegistre = "dep" | "cst" | "all";

const VUES: { cle: VueRegistre; libelle: string }[] = [
  { cle: "dep", libelle: "Dépistage" },
  { cle: "cst", libelle: "Constantes" },
  { cle: "all", libelle: "Tout" },
];

/**
 * Les colonnes du registre, et les trois vues qui les choisissent. Chaque
 * en-tête porte son seuil, et une cellule qui le franchit est teintée : on
 * repère un dépassement sans connaître les échelles par cœur.
 */
const COLONNES: Record<string, Colonne<LigneEquipage>> = {
  res: {
    cle: "nom",
    titre: "Résident",
    gauche: true,
    classe: "res",
    rendu: (l) => (
      <>
        <Link
          to={`/residents/${encodeURIComponent(l.code)}`}
          state={{ retour: RETOUR_REGISTRE }}
          onClick={(e) => e.stopPropagation()}
        >
          <b>
            {l.prenom} {l.nom}
          </b>
        </Link>
        <span>
          {l.code} · {l.poste}
        </span>
      </>
    ),
  },
  cab: { cle: "cabine", titre: "Cabine", gauche: true, rendu: (l) => l.cabine },
  age: { cle: "age", titre: "Âge", rendu: (l) => entier(l.age) },
  st: {
    cle: "statut",
    titre: "Statut",
    gauche: true,
    classe: "st",
    rendu: (l) => {
      const p = pastilleStatut(l.statut);
      return <span className={`chip ${p.ton}`}>{p.libelle}</span>;
    },
  },
  sig: { cle: "signaux", titre: "Signaux", sous: "ouverts", sens: "desc", rendu: (l) => entier(l.signaux) },
  moral: { cle: "moral", titre: "Moral", sous: "sur 100", rendu: (l) => entier(l.score_moral) },
  phq: {
    cle: "phq9",
    titre: "PHQ-9",
    sous: "≥ 10",
    sens: "desc",
    rendu: (l) => entier(l.phq9),
    chaud: (l) => l.phq9 !== null && l.phq9 >= 10,
  },
  gad: {
    cle: "gad7",
    titre: "GAD-7",
    sous: "≥ 10",
    sens: "desc",
    rendu: (l) => entier(l.gad7),
    chaud: (l) => l.gad7 !== null && l.gad7 >= 10,
  },
  isi: {
    cle: "isi",
    titre: "ISI",
    sous: "≥ 15",
    sens: "desc",
    rendu: (l) => entier(l.isi),
    chaud: (l) => l.isi !== null && l.isi >= 15,
  },
  fc: {
    cle: "fc_repos",
    titre: "FC repos",
    sous: "> 75 bpm",
    sens: "desc",
    rendu: (l) => frMax(l.fc_repos_bpm),
    chaud: (l) => l.fc_repos_bpm !== null && a1(l.fc_repos_bpm) > 75,
    date: (l) => l.constantes_du,
  },
  rmssd: {
    cle: "rmssd",
    titre: "RMSSD",
    sous: "< 30 ms",
    sens: "asc",
    rendu: (l) => frMax(l.rmssd_ms),
    chaud: (l) => l.rmssd_ms !== null && a1(l.rmssd_ms) < 30,
    date: (l) => l.constantes_du,
  },
  spo2: {
    cle: "spo2",
    titre: "SpO₂",
    sous: "< 95 %",
    sens: "asc",
    rendu: (l) => frMax(l.spo2_pct),
    chaud: (l) => l.spo2_pct !== null && a1(l.spo2_pct) < 95,
    date: (l) => l.constantes_du,
  },
  resp: {
    cle: "resp",
    titre: "Resp.",
    sous: "12–18 /min",
    sens: "desc",
    rendu: (l) => frMax(l.resp_min),
    chaud: (l) => l.resp_min !== null && (a1(l.resp_min) < 12 || a1(l.resp_min) > 18),
    fleche: (l) => (l.resp_min !== null && a1(l.resp_min) > 18 ? "▲" : "▼"),
    date: (l) => l.constantes_du,
  },
  // « Temp » seul se lirait comme une température centrale, et 34,2 °C
  // alarmerait à tort : le bracelet mesure la peau du poignet.
  temp: {
    cle: "temp",
    titre: "T° cutanée",
    sous: "sans seuil",
    sens: "desc",
    rendu: (l) => fr(l.temp_c, 1),
    date: (l) => l.constantes_du,
  },
  som: {
    cle: "sommeil",
    titre: "Sommeil",
    sous: "< 6 h",
    sens: "asc",
    rendu: (l) => duree(l.sommeil_min),
    chaud: (l) => l.sommeil_min !== null && l.sommeil_min < 360,
    date: (l) => l.nuit_du,
  },
  pas: {
    cle: "pas",
    titre: "Pas",
    sous: "< 4 000",
    sens: "asc",
    rendu: (l) => entier(l.pas),
    chaud: (l) => l.pas !== null && l.pas < 4000,
    date: (l) => l.constantes_du,
  },
};

const PAR_VUE: Record<VueRegistre, string[]> = {
  dep: ["res", "cab", "st", "sig", "moral", "phq", "gad", "isi"],
  cst: ["res", "cab", "st", "fc", "rmssd", "spo2", "resp", "temp", "som", "pas"],
  all: ["res", "cab", "age", "st", "sig", "moral", "phq", "gad", "isi", "fc", "rmssd", "spo2", "resp", "temp", "som", "pas"],
};

function Residents({ jour }: { jour: string | null }) {
  const naviguer = useNavigate();
  const [recherche, setRecherche] = useState("");
  const [module, setModule] = useState("");
  const [statut, setStatut] = useState("");
  const [vue, setVue] = useState<VueRegistre>("dep");
  const [tri, setTri] = useState("statut");
  const [sens, setSens] = useState<Sens>("asc");
  const [page, setPage] = useState(1);
  const q = useRetard(recherche);

  // Changer un filtre ou un tri ramène en page 1 : rester page 7 d'une liste
  // qui vient d'être refiltrée donne un écran vide sans explication.
  useEffect(() => setPage(1), [q, module, statut, tri, sens]);

  const { lignes, total, chargement, erreur } = useListe<LigneEquipage>("/api/equipage", {
    q,
    module,
    statut,
    tri,
    sens,
    page,
    taille: TAILLE,
  });

  const colonnes = PAR_VUE[vue].map((k) => COLONNES[k]!);

  return (
    <section className="mk-card">
      <div className="flt">
        <label className="inp">
          <Icone nom="search" />
          <span className="cache">Rechercher un résident</span>
          <input
            type="search"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            placeholder="Nom, identifiant, poste ou cabine…"
            autoComplete="off"
          />
        </label>
        <label className="cache" htmlFor="filtre-module">
          Module
        </label>
        <select id="filtre-module" className="select" value={module} onChange={(e) => setModule(e.target.value)}>
          <option value="">Tous les modules</option>
          {Object.entries(MODULES).map(([code, nom]) => (
            <option key={code} value={code}>
              {code} · {nom}
            </option>
          ))}
        </select>
        <label className="cache" htmlFor="filtre-statut">
          Statut
        </label>
        <select id="filtre-statut" className="select" value={statut} onChange={(e) => setStatut(e.target.value)}>
          <option value="">Tous les statuts</option>
          <option value="critique">Critique</option>
          <option value="surveillance">Surveillance</option>
          <option value="ok">Suivi normal</option>
        </select>
        <div className="r">
          <Segments options={VUES} valeur={vue} onChange={setVue} libelle="Vue du tableau" />
        </div>
      </div>

      {erreur ? (
        <Indisponible erreur={erreur} />
      ) : (
        <>
          <Tableau
            classe={vue === "all" ? "rg all" : "rg"}
            colonnes={colonnes}
            lignes={lignes}
            cleLigne={(l) => l.code}
            onLigne={(l) =>
              naviguer(`/residents/${encodeURIComponent(l.code)}`, { state: { retour: RETOUR_REGISTRE } })
            }
            tri={tri}
            sens={sens}
            onTri={(c, s) => {
              setTri(c);
              setSens(s);
            }}
            chargement={chargement}
            vide="Aucun résident ne correspond à cette recherche."
            jour={jour}
          />
          <Pager
            page={page}
            total={total}
            ordre={ordreLu(Object.values(COLONNES), tri, sens, { tri: "statut", sens: "asc", texte: "critiques d'abord" })}
            onPage={setPage}
          />
        </>
      )}
    </section>
  );
}

// --------------------------------------------------------------- signaux --
const ORIGINES: Record<Origine, string> = {
  physio: "Physio",
  conversation: "Conversation",
  usage: "Usage",
  chute: "Chute",
  manuel: "Manuel",
};

function Statistiques({ stats }: { stats: StatsSignauxApi }) {
  const t = stats.a_traiter;
  const c = stats.clos;
  // Une origine qui n'a rien clos n'a pas de taux. Les autres arrivent du
  // serveur rangées par nombre de clôtures : un taux sur deux signaux dit
  // moins qu'un taux sur cent, il vient après.
  const origines = c.par_origine.filter((o) => o.clos > 0);
  return (
    <div className="st3">
      <div className="stc">
        <span className="k">À traiter</span>
        <span className="n">
          {entier(t.ouverts)}
          <small>signaux</small>
        </span>
        <span className="s">
          {pluriel(t.critiques, "critique")} · <b>{entier(t.non_assignes)}</b> sans personne
        </span>
      </div>
      <div className="stc">
        <span className="k">Faux positifs à la clôture</span>
        {origines.map((o) => {
          const pct = o.clos ? (100 * o.faux_positifs) / o.clos : 0;
          return (
            <div className="mini-b" key={o.origine}>
              <span>{ORIGINES[o.origine] ?? o.origine}</span>
              <span className="t" aria-hidden="true">
                <i style={{ width: `${pct}%` }} />
              </span>
              <span className="v">
                {entier(o.faux_positifs)} / {entier(o.clos)} · {entier(pct)} %
              </span>
            </div>
          );
        })}
        <span className="s">
          {entier(c.faux_positifs)} des {entier(c.total)} signaux clos
        </span>
      </div>
      <div className="stc">
        <span className="k">Motif de clôture à revoir</span>
        <span className="n">
          {entier(c.a_revoir)}
          <small>signaux</small>
        </span>
        <span className="s">
          Clos avec un motif que leur origine ne propose pas : ils faussent le taux de faux positifs.
        </span>
      </div>
    </div>
  );
}

type Liste = "atraiter" | "clos";

function Signaux({ stats, onGeste }: { stats: StatsSignauxApi | null; onGeste: () => void }) {
  const naviguer = useNavigate();
  const { compte } = useCompte();
  const { montrer, rendu: avis } = useAvis();
  const [liste, setListe] = useState<Liste>("atraiter");
  const [recherche, setRecherche] = useState("");
  const [severite, setSeverite] = useState("");
  const [sansPersonne, setSansPersonne] = useState(false);
  const [tri, setTri] = useState("ouvert");
  const [sens, setSens] = useState<Sens>("desc");
  const [page, setPage] = useState(1);
  const [pris, setPris] = useState<Record<number, SignalApi>>({});
  const [enCours, setEnCours] = useState<number | null>(null);
  const q = useRetard(recherche);

  useEffect(() => setPage(1), [q, severite, sansPersonne, tri, sens, liste]);

  const { lignes, total, chargement, erreur, rafraichir } = useListe<LigneSignal>("/api/signaux", {
    q,
    severite,
    statut: liste === "clos" ? "clos" : "",
    sans_personne: liste === "atraiter" && sansPersonne ? 1 : 0,
    tri,
    sens,
    page,
    taille: TAILLE,
  });

  const moi = compte?.role === "medecin" ? compte.id : null;
  const peutAgir = moi !== null;

  function changer(l: Liste) {
    setListe(l);
    setTri(l === "clos" ? "clos" : "ouvert");
    setSens("desc");
  }

  async function prendre(l: LigneSignal) {
    setEnCours(l.id);
    try {
      const { signal } = await api.prendre(l.id);
      setPris((d) => ({ ...d, [l.id]: signal }));
      montrer(`Signal de ${l.prenom} ${l.nom} pris en charge : il est à votre nom.`);
    } catch (e) {
      montrer(
        e instanceof ErreurApi
          ? e.statut === 401
            ? "Session expirée : reconnectez-vous pour prendre ce signal."
            : e.message
          : "Le serveur de bord ne répond pas : signal non pris.",
      );
    } finally {
      setEnCours(null);
      rafraichir();
      onGeste();
    }
  }

  const resident: Colonne<LigneSignal> = {
    cle: "nom",
    titre: "Résident",
    classe: "res",
    rendu: (l) => (
      <>
        <Link
          to={`/residents/${encodeURIComponent(l.resident)}`}
          state={{ retour: RETOUR_SIGNAUX }}
          onClick={(e) => e.stopPropagation()}
        >
          <b>
            {l.prenom} {l.nom}
          </b>
        </Link>
        <span>
          {l.resident} · {l.cabine}
        </span>
      </>
    ),
  };
  const communes: Colonne<LigneSignal>[] = [
    {
      cle: "severite",
      titre: "Gravité",
      rendu: (l) => {
        const g = gravite(l.severite);
        return <span className={`chip ${g.ton}`}>{g.libelle}</span>;
      },
    },
    resident,
    { cle: "motif", titre: "Motif", classe: "mo", rendu: (l) => l.motif },
    { cle: "origine", titre: "Origine", classe: "m2", rendu: (l) => l.origine },
  ];

  const colonnes: Colonne<LigneSignal>[] =
    liste === "atraiter"
      ? [
          ...communes,
          {
            cle: "ouvert",
            titre: "Ouvert",
            classe: "m2",
            sens: "desc",
            rendu: (l) => `${jv(l.ouvert_jour_vol)} · ${heure(l.ouvert_at)}`,
          },
          {
            cle: "assigne",
            titre: "Pris par",
            classe: "act",
            rendu: (l) => {
              const p = pris[l.id];
              const nom = l.assigne_a ?? p?.assigne_a ?? null;
              const id = l.assigne_a ? l.assigne_id : (p?.assigne_id ?? null);
              if (nom) return moi !== null && id === moi ? <span className="me">{nom} · vous</span> : nom;
              if (!peutAgir) return <span className="personne">sans personne</span>;
              return (
                <button
                  type="button"
                  className="btn mini pri"
                  disabled={enCours === l.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    void prendre(l);
                  }}
                >
                  {enCours === l.id ? "Envoi…" : "Je prends"}
                </button>
              );
            },
          },
        ]
      : [
          ...communes,
          {
            cle: "clos",
            titre: "Clos",
            classe: "m2",
            sens: "desc",
            rendu: (l) => (l.clos_jour_vol !== null ? `${jv(l.clos_jour_vol)} · ${heure(l.clos_at)}` : "—"),
          },
          {
            cle: "cloture",
            titre: "Motif de clôture",
            rendu: (l) => (
              <span
                className={`cm${l.motif_a_revoir ? " bad" : ""}`}
                title={l.motif_a_revoir ? "Un motif que l'origine de ce signal ne propose pas" : undefined}
              >
                {l.clos_motif ?? "sans motif"}
              </span>
            ),
          },
          { cle: "assigne", titre: "Par", classe: "m2", rendu: (l) => l.assigne_a ?? "—" },
        ];

  const aRevoir = liste === "clos" && lignes.some((l) => l.motif_a_revoir);

  return (
    <>
      {stats && <Statistiques stats={stats} />}
      <section className="mk-card">
        <div className="mk-ch">
          <Segments
            options={[
              {
                cle: "atraiter" as Liste,
                libelle: "À traiter",
                compte: stats ? entier(stats.a_traiter.ouverts) : undefined,
              },
              { cle: "clos" as Liste, libelle: "Clos", compte: stats ? entier(stats.clos.total) : undefined },
            ]}
            valeur={liste}
            onChange={changer}
            libelle="Signaux"
            onglets
            controle="liste-signaux"
          />
        </div>

        <div role="tabpanel" id="liste-signaux" aria-labelledby={`liste-signaux-${liste}`} className="panneau">
          <div className="flt">
            <label className="inp">
              <Icone nom="search" />
              <span className="cache">Rechercher un signal</span>
              <input
                type="search"
                value={recherche}
                onChange={(e) => setRecherche(e.target.value)}
                placeholder="Résident, identifiant ou motif…"
                autoComplete="off"
              />
            </label>
            <label className="cache" htmlFor="filtre-gravite">
              Gravité
            </label>
            <select
              id="filtre-gravite"
              className="select"
              value={severite}
              onChange={(e) => setSeverite(e.target.value)}
            >
              <option value="">Toutes gravités</option>
              <option value="critique">Critique</option>
              <option value="surveillance">Surveillance</option>
              <option value="info">Info</option>
            </select>
            {liste === "atraiter" && (
              <button
                type="button"
                className="btn mini"
                aria-pressed={sansPersonne}
                onClick={() => setSansPersonne((v) => !v)}
              >
                Sans personne{stats ? <> · <b>{entier(stats.a_traiter.non_assignes)}</b></> : null}
              </button>
            )}
          </div>

          {erreur ? (
            <Indisponible erreur={erreur} />
          ) : (
            <>
              <Tableau
                classe="sg"
                colonnes={colonnes}
                lignes={lignes}
                cleLigne={(l) => l.id}
                onLigne={(l) =>
                  naviguer(`/residents/${encodeURIComponent(l.resident)}`, { state: { retour: RETOUR_SIGNAUX } })
                }
                tri={tri}
                sens={sens}
                onTri={(c, s) => {
                  setTri(c);
                  setSens(s);
                }}
                chargement={chargement}
                vide={
                  liste === "clos"
                    ? "Aucun signal clos ne correspond à ce filtre."
                    : "Aucun signal à traiter ne correspond à ce filtre."
                }
                jour={null}
              />
              <Pager
                page={page}
                total={total}
                ordre={
                  liste === "clos"
                    ? ordreLu(colonnes, tri, sens, { tri: "clos", sens: "desc", texte: "les plus récents d'abord" })
                    : ordreLu(colonnes, tri, sens, { tri: "ouvert", sens: "desc", texte: "les plus récents d'abord" })
                }
                onPage={setPage}
              />
              {aRevoir && (
                <p className="mk-sub">Le motif en rouge ne correspond pas à l'origine du signal.</p>
              )}
            </>
          )}
        </div>
      </section>
      {avis}
    </>
  );
}

// ------------------------------------------------------------------ page --
export function RegistrePage({ onglet }: { onglet: "residents" | "signaux" }) {
  const naviguer = useNavigate();
  const [stats, setStats] = useState<StatsSignauxApi | null>(null);
  const [tour, setTour] = useState(0);

  // L'en-tête et les comptes des onglets : une réponse légère, relue après
  // chaque geste. Son absence n'empêche rien, les tableaux disent eux-mêmes
  // quand la base ne répond pas.
  useEffect(() => {
    let vivant = true;
    api
      .statsSignaux()
      .then((s) => vivant && setStats(s))
      .catch(() => {});
    return () => {
      vivant = false;
    };
  }, [tour]);
  const relire = useCallback(() => setTour((t) => t + 1), []);

  const ancre: AncreApi | null = stats?.ancre ?? null;

  return (
    <main className="app page">
      <div className="mk-head">
        <div>
          <h1>Registre</h1>
          <div className="sub">
            {stats && ancre
              ? `${entier(stats.residents)} résidents · ${jv(ancre.jour_vol)}`
              : "lecture directe de la base"}
          </div>
        </div>
        <div className="r">
          <Segments
            options={[
              { cle: "residents" as const, libelle: "Résidents", compte: stats ? entier(stats.residents) : undefined },
              { cle: "signaux" as const, libelle: "Signaux", compte: stats ? entier(stats.a_traiter.ouverts) : undefined },
            ]}
            valeur={onglet}
            onChange={(o) => naviguer(o === "residents" ? "/registre" : "/signaux")}
            libelle="Onglet du registre"
            onglets
            controle="registre"
          />
        </div>
      </div>

      <div role="tabpanel" id="registre" aria-labelledby={`registre-${onglet}`}>
        {onglet === "residents" ? (
          <Residents jour={ancre?.jour ?? null} />
        ) : (
          <Signaux stats={stats} onGeste={relire} />
        )}
      </div>
    </main>
  );
}
