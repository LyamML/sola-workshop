import { type ReactNode, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  type LigneEquipage,
  type LigneSignal,
  type Sens,
  depuis,
  duree,
  horodatage,
  nombre,
  useListe,
  useRetard,
} from "../registre";

/**
 * Écran 04 — le registre.
 *
 * Les deux écrans précédents répondent à « comment va l'équipage ? » et
 * « comment va cette personne ? ». Celui-ci répond à la question qui les relie
 * et qu'aucun des deux ne couvre : « qui, parmi les 1 240, dois-je regarder
 * d'abord ? ». D'où le tri sur chaque colonne — la réponse dépend de ce qu'on
 * cherche ce matin-là, et personne ne peut la figer à l'avance.
 */

interface Colonne<T> {
  /** Clé de tri envoyée au serveur. `null` = colonne non triable. */
  cle: string | null;
  titre: string;
  /** Aligné à droite, chiffres alignés : toute valeur qu'on compare. */
  num?: boolean;
  /** Reste visible pendant le défilement horizontal. */
  fige?: boolean;
  /**
   * Sens du PREMIER clic. Une SpO₂ se regarde en commençant par la plus
   * basse, un nombre de signaux par le plus élevé : le sens par défaut est
   * celui qui met en haut ce qui inquiète.
   */
  sens?: Sens;
  rendu: (l: T) => ReactNode;
}

function Tableau<T>({
  colonnes,
  lignes,
  cleLigne,
  onLigne,
  tri,
  sens,
  onTri,
  chargement,
  erreur,
  vide,
}: {
  colonnes: Colonne<T>[];
  lignes: T[];
  cleLigne: (l: T) => string | number;
  onLigne?: (l: T) => void;
  tri: string;
  sens: Sens;
  onTri: (cle: string, sens: Sens) => void;
  chargement: boolean;
  erreur: string | null;
  vide: string;
}) {
  if (erreur) {
    return (
      <div className="vide">
        Registre indisponible&nbsp;: le serveur de bord ne répond pas ({erreur}).
        <br />
        Cet écran lit la base directement, il n’a pas de jeu de démonstration.
      </div>
    );
  }

  return (
    <div className="tableau-cadre">
      <table className={`registre${chargement ? " chargement" : ""}`}>
        <thead>
          <tr>
            {colonnes.map((c) => {
              const actif = c.cle !== null && c.cle === tri;
              return (
                <th
                  key={c.titre}
                  className={`${c.num ? "num" : ""}${c.fige ? " fige" : ""}`}
                  aria-sort={actif ? (sens === "asc" ? "ascending" : "descending") : "none"}
                >
                  {c.cle === null ? (
                    <span className="th-fixe">{c.titre}</span>
                  ) : (
                    <button
                      type="button"
                      className={actif ? "actif" : undefined}
                      onClick={() =>
                        onTri(
                          c.cle as string,
                          actif ? (sens === "asc" ? "desc" : "asc") : (c.sens ?? "asc"),
                        )
                      }
                      title={`Trier par ${c.titre}`}
                    >
                      {c.titre}
                      <span className="fleche">{actif ? (sens === "asc" ? "▲" : "▼") : "⇅"}</span>
                    </button>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {lignes.map((l) => (
            <tr
              key={cleLigne(l)}
              onClick={onLigne ? () => onLigne(l) : undefined}
              className={onLigne ? "cliquable" : undefined}
            >
              {colonnes.map((c) => (
                <td
                  key={c.titre}
                  className={`${c.num ? "num" : ""}${c.fige ? " fige" : ""}`}
                >
                  {c.rendu(l)}
                </td>
              ))}
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

function Pagination({
  page,
  taille,
  total,
  onPage,
}: {
  page: number;
  taille: number;
  total: number;
  onPage: (p: number) => void;
}) {
  const premier = total === 0 ? 0 : (page - 1) * taille + 1;
  const dernier = Math.min(page * taille, total);
  const pages = Math.max(1, Math.ceil(total / taille));
  return (
    <div className="pagin">
      <span>
        {nombre(premier)}–{nombre(dernier)} sur {nombre(total)}
      </span>
      <button className="btn mini" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Précédent
      </button>
      <button className="btn mini" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        Suivant
      </button>
    </div>
  );
}

const MODULES = [
  ["A", "Commandement"],
  ["B", "Habitat 1"],
  ["C", "Hydroponie"],
  ["D", "Habitat 2"],
  ["E", "Maintenance"],
  ["F", "Recherche"],
];

const STATUT_LIBELLE: Record<string, string> = {
  ok: "Suivi normal",
  surveillance: "Surveillance",
  critique: "Critique",
};

const SEVERITE_LIBELLE: Record<string, string> = {
  critique: "Critique",
  surveillance: "Surveillance",
  info: "Info",
};

const SEVERITE_CLASSE: Record<string, string> = {
  critique: "crit",
  surveillance: "watch",
  info: "",
};

// ------------------------------------------------------------- résidents --
function Residents() {
  const naviguer = useNavigate();
  const [recherche, setRecherche] = useState("");
  const [module, setModule] = useState("");
  const [statut, setStatut] = useState("");
  const [tri, setTri] = useState("statut");
  const [sens, setSens] = useState<Sens>("asc");
  const [page, setPage] = useState(1);
  const q = useRetard(recherche);

  // Changer un filtre ou un tri ramène en page 1 : rester page 7 d'une liste
  // qui vient d'être refiltrée donne un écran vide sans explication.
  useEffect(() => setPage(1), [q, module, statut, tri, sens]);

  const taille = 50;
  const { lignes, total, chargement, erreur } = useListe<LigneEquipage>("/api/equipage", {
    q,
    module,
    statut,
    tri,
    sens,
    page,
    taille,
  });

  const colonnes: Colonne<LigneEquipage>[] = [
    {
      cle: "nom",
      titre: "Résident",
      fige: true,
      rendu: (l) => (
        <div className="cellule-id">
          <span className={`pastille ${l.statut}`} title={STATUT_LIBELLE[l.statut]} />
          <div>
            <strong>
              {l.prenom} {l.nom}
            </strong>
            <span className="mono">{l.code}</span>
          </div>
        </div>
      ),
    },
    { cle: "poste", titre: "Poste", rendu: (l) => l.poste },
    { cle: "cabine", titre: "Cabine", rendu: (l) => <span className="mono">{l.cabine}</span> },
    { cle: "age", titre: "Âge", num: true, rendu: (l) => l.age },
    {
      cle: "statut",
      titre: "Statut",
      rendu: (l) => (
        <span className={`chip ${l.statut === "ok" ? "ok" : l.statut === "critique" ? "crit" : "watch"}`}>
          {STATUT_LIBELLE[l.statut]}
        </span>
      ),
    },
    {
      cle: "signaux",
      titre: "Signaux",
      num: true,
      sens: "desc",
      rendu: (l) => (l.signaux === 0 ? <span className="creux">0</span> : l.signaux),
    },
    { cle: "spo2", titre: "SpO₂ %", num: true, sens: "asc", rendu: (l) => nombre(l.spo2_pct, 1) },
    { cle: "fc_repos", titre: "FC repos", num: true, sens: "desc", rendu: (l) => nombre(l.fc_repos_bpm, 1) },
    { cle: "rmssd", titre: "RMSSD ms", num: true, sens: "asc", rendu: (l) => nombre(l.rmssd_ms, 1) },
    { cle: "resp", titre: "Resp /min", num: true, sens: "desc", rendu: (l) => nombre(l.resp_min, 1) },
    // « Temp » seul se lirait comme une temperature centrale, et 34,2 °C
    // alarmerait a tort : le bracelet mesure la peau du poignet.
    { cle: "temp", titre: "T° cutanée", num: true, sens: "desc", rendu: (l) => nombre(l.temp_c, 1) },
    { cle: "sommeil", titre: "Sommeil", num: true, sens: "asc", rendu: (l) => duree(l.sommeil_min) },
    { cle: "pas", titre: "Pas", num: true, sens: "asc", rendu: (l) => nombre(l.pas) },
    { cle: "moral", titre: "Moral", num: true, sens: "asc", rendu: (l) => nombre(l.score_moral) },
    { cle: "phq9", titre: "PHQ-9", num: true, sens: "desc", rendu: (l) => nombre(l.phq9) },
    { cle: "gad7", titre: "GAD-7", num: true, sens: "desc", rendu: (l) => nombre(l.gad7) },
    { cle: "isi", titre: "ISI", num: true, sens: "desc", rendu: (l) => nombre(l.isi) },
    {
      cle: "synchro",
      titre: "Synchro",
      num: true,
      sens: "asc",
      rendu: (l) => <span className="creux">{depuis(l.synchro_at)}</span>,
    },
  ];

  return (
    <>
      <div className="filtres">
        <label className="champ recherche">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-4-4" />
          </svg>
          <input
            id="recherche-resident"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            placeholder="Nom, prénom, identifiant, poste ou cabine…"
            autoComplete="off"
          />
        </label>

        <select className="select" value={module} onChange={(e) => setModule(e.target.value)}>
          <option value="">Tous les modules</option>
          {MODULES.map(([code, nom]) => (
            <option key={code} value={code}>
              {code} · {nom}
            </option>
          ))}
        </select>

        <select className="select" value={statut} onChange={(e) => setStatut(e.target.value)}>
          <option value="">Tous les statuts</option>
          <option value="critique">Critique</option>
          <option value="surveillance">Surveillance</option>
          <option value="ok">Suivi normal</option>
        </select>

        <Pagination page={page} taille={taille} total={total} onPage={setPage} />
      </div>

      <Tableau
        colonnes={colonnes}
        lignes={lignes}
        cleLigne={(l) => l.code}
        onLigne={(l) => naviguer(`/residents/${l.code}`)}
        tri={tri}
        sens={sens}
        onTri={(c, s) => {
          setTri(c);
          setSens(s);
        }}
        chargement={chargement}
        erreur={erreur}
        vide="Aucun résident ne correspond à cette recherche."
      />
    </>
  );
}

// --------------------------------------------------------------- signaux --
function Signaux() {
  const naviguer = useNavigate();
  const [recherche, setRecherche] = useState("");
  const [severite, setSeverite] = useState("");
  const [statut, setStatut] = useState("");
  const [tri, setTri] = useState("severite");
  const [sens, setSens] = useState<Sens>("asc");
  const [page, setPage] = useState(1);
  const q = useRetard(recherche);

  useEffect(() => setPage(1), [q, severite, statut, tri, sens]);

  const taille = 50;
  const { lignes, total, chargement, erreur } = useListe<LigneSignal>("/api/signaux", {
    q,
    severite,
    statut,
    tri,
    sens,
    page,
    taille,
  });

  const colonnes: Colonne<LigneSignal>[] = [
    {
      cle: "severite",
      titre: "Gravité",
      fige: true,
      rendu: (l) => (
        <span className={`chip ${SEVERITE_CLASSE[l.severite]}`}>{SEVERITE_LIBELLE[l.severite]}</span>
      ),
    },
    {
      cle: "resident",
      titre: "Résident",
      rendu: (l) => (
        <div className="cellule-id">
          <div>
            <strong>
              {l.prenom} {l.nom}
            </strong>
            <span className="mono">
              {l.resident} · {l.cabine} · {l.age} ans
            </span>
          </div>
        </div>
      ),
    },
    { cle: "motif", titre: "Motif", rendu: (l) => <span className="motif">{l.motif}</span> },
    { cle: "origine", titre: "Origine", rendu: (l) => <span className="creux">{l.origine}</span> },
    {
      cle: "ouvert",
      titre: "Ouvert",
      num: true,
      sens: "desc",
      rendu: (l) => (
        <span title={l.ouvert_at}>
          {horodatage(l.ouvert_at)}
          <span className="creux"> · {depuis(l.ouvert_at)}</span>
        </span>
      ),
    },
    {
      cle: "assigne",
      titre: "Assigné à",
      rendu: (l) =>
        l.assigne_a ?? <span className="chip watch">Non assigné</span>,
    },
    {
      cle: "statut",
      titre: "Statut",
      rendu: (l) =>
        l.statut === "clos" ? (
          <span className="creux" title={l.clos_motif ?? undefined}>
            Clos · {horodatage(l.clos_at)}
          </span>
        ) : (
          <span className="chip">{l.statut === "ouvert" ? "Ouvert" : "En cours"}</span>
        ),
    },
  ];

  return (
    <>
      <div className="filtres">
        <label className="champ recherche">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-4-4" />
          </svg>
          <input
            id="recherche-signal"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            placeholder="Résident, identifiant ou motif…"
            autoComplete="off"
          />
        </label>

        <select className="select" value={severite} onChange={(e) => setSeverite(e.target.value)}>
          <option value="">Toutes gravités</option>
          <option value="critique">Critique</option>
          <option value="surveillance">Surveillance</option>
          <option value="info">Info</option>
        </select>

        <select className="select" value={statut} onChange={(e) => setStatut(e.target.value)}>
          <option value="">À traiter</option>
          <option value="ouvert">Ouvert</option>
          <option value="en_cours">En cours</option>
          <option value="clos">Clos</option>
          <option value="tout">Tout l’historique</option>
        </select>

        <Pagination page={page} taille={taille} total={total} onPage={setPage} />
      </div>

      <Tableau
        colonnes={colonnes}
        lignes={lignes}
        cleLigne={(l) => l.id}
        onLigne={(l) => naviguer(`/residents/${l.resident}`)}
        tri={tri}
        sens={sens}
        onTri={(c, s) => {
          setTri(c);
          setSens(s);
        }}
        chargement={chargement}
        erreur={erreur}
        vide="Aucun signal ne correspond à ce filtre."
      />
    </>
  );
}

// ------------------------------------------------------------------ page --
export function RegistrePage({ onglet }: { onglet: "residents" | "signaux" }) {
  const naviguer = useNavigate();

  return (
    <div className="app">
      <div className="pagehead">
        <div>
          <h1>{onglet === "residents" ? "Registre de l’équipage" : "Signaux"}</h1>
          <div className="sub">
            {onglet === "residents"
              ? "Les 1 240 résidents du Méridien. Chaque colonne se trie, dans les deux sens, sur la base entière."
              : "Ce que le moteur de règles a ouvert, ce qui a été pris en charge, et ce qui a été clos."}
          </div>
        </div>
        <div className="seg" style={{ marginLeft: "auto" }}>
          <button
            aria-pressed={onglet === "residents"}
            onClick={() => naviguer("/registre")}
          >
            Résidents
          </button>
          <button aria-pressed={onglet === "signaux"} onClick={() => naviguer("/signaux")}>
            Signaux
          </button>
        </div>
      </div>

      <div className="card pad-lg">{onglet === "residents" ? <Residents /> : <Signaux />}</div>
    </div>
  );
}
