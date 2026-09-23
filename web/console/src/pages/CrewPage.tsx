import { useState } from "react";
import { Link } from "react-router-dom";
import { adapterCrew } from "../adapt";
import { ErreurApi, api, type SignalApi } from "../api";
import { useAvis } from "../components/Avis";
import { Barres } from "../components/Barres";
import { Courbe } from "../components/Courbe";
import { FileTriage } from "../components/FileTriage";
import { MentionDemo } from "../components/MentionDemo";
import { Segments } from "../components/Segments";
import { entier } from "../format";
import { REPLI_CREW } from "../repli";
import { useCompte } from "../session";
import type { CleIndicateur, LigneFile, Periode } from "../types";
import { useSource } from "../useSource";

type Vue = "motifs" | "modules" | "physio";

const PERIODES: { cle: Periode["cle"]; libelle: string }[] = [
  { cle: "7", libelle: "7 jours" },
  { cle: "30", libelle: "30 jours" },
  { cle: "365", libelle: "12 mois" },
];

const VUES: { cle: Vue; libelle: string }[] = [
  { cle: "motifs", libelle: "Motifs" },
  { cle: "modules", libelle: "Modules" },
  { cle: "physio", libelle: "Physio" },
];

/**
 * Écran 02 — santé de l'équipage.
 *
 * De haut en bas : comment va l'équipage, ce qui remonte, puis qui voir. Les
 * deux cartes d'agrégats ouvrent l'écran parce qu'elles disent où regarder ;
 * la file vient juste dessous, et c'est d'elle qu'on part vers une fiche.
 */
export function CrewPage() {
  const { compte } = useCompte();
  const { vue, source, rafraichir } = useSource(api.crew, adapterCrew, REPLI_CREW);
  const { montrer, rendu: avis } = useAvis();

  const [periode, setPeriode] = useState<Periode["cle"]>("30");
  const [indicateur, setIndicateur] = useState<CleIndicateur>("indice");
  const [onglet, setOnglet] = useState<Vue>("motifs");

  // Un signal pris reste à votre nom le temps que la file rechargée le dise.
  const [pris, setPris] = useState<Record<number, SignalApi>>({});
  const [enCours, setEnCours] = useState<number | null>(null);

  // Les gestes ne s'offrent que sur la base : sur le jeu de démonstration, un
  // « Je prends » partirait vers un signal qui n'existe que dans la page.
  const moi = compte?.role === "medecin" ? compte.id : null;
  const peutAgir = moi !== null && source === "api";

  const p = vue.periodes.find((x) => x.cle === periode) ?? vue.periodes[0]!;
  const { ouverts, critiques, sansPersonne } = vue.compteurs;

  const file: LigneFile[] = vue.file.map((l) => {
    const s = pris[l.id];
    return s && !l.assigne
      ? { ...l, assigne: s.assigne_a, assigneId: s.assigne_id, statut: s.statut }
      : l;
  });

  async function prendre(l: LigneFile) {
    setEnCours(l.id);
    try {
      const { signal } = await api.prendre(l.id);
      setPris((d) => ({ ...d, [l.id]: signal }));
      montrer(`Signal de ${l.nom} pris en charge : il est à votre nom.`);
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
    }
  }

  return (
    <main className="app page">
      <div className="mk-head">
        <div>
          <h1>Santé de l'équipage</h1>
          <div className="sub">
            {vue.entete} <MentionDemo source={source} />
          </div>
        </div>
      </div>

      <div className="mk-row g2">
        <section className="mk-card">
          <div className="mk-ch">
            <h3>Tendance de l'équipage</h3>
            <div className="r">
              <Segments options={PERIODES} valeur={periode} onChange={setPeriode} libelle="Période" />
            </div>
          </div>

          <div className="ktiles" role="group" aria-label="Indicateur affiché">
            {vue.indicateurs.map((i) => {
              const ecart = p.ecarts[i.cle];
              return (
                <button
                  key={i.cle}
                  type="button"
                  className="kt"
                  aria-pressed={i.cle === indicateur}
                  onClick={() => setIndicateur(i.cle)}
                >
                  <span className="l">{i.libelle}</span>
                  <span className="v">
                    {i.valeur}
                    <small>{i.unite}</small>
                  </span>
                  <span className="d">
                    <span className={`chip ${ecart.ton}`}>{ecart.libelle}</span>
                    {i.residents}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="kt-note">
            Écarts sur <b>{p.libelle}</b>, du {p.debut} au {p.fin}
          </p>
          <Courbe courbe={p.courbes[indicateur]} />
        </section>

        <section className="mk-card">
          <div className="mk-ch">
            <h3>Ce qui remonte</h3>
            <div className="r">
              <Segments
                options={VUES}
                valeur={onglet}
                onChange={setOnglet}
                libelle="Vue"
                onglets
                controle="remonte"
              />
            </div>
          </div>

          <div role="tabpanel" id="remonte" aria-labelledby={`remonte-${onglet}`} className="panneau">
            {onglet === "motifs" && (
              <>
                <p className="mk-sub">
                  30 jours · <b>{vue.remonte.motifs.conversations}</b> conversations · un échange peut
                  porter plusieurs motifs
                </p>
                <Barres barres={vue.remonte.motifs.barres} vide="Aucune conversation sur 30 jours." />
              </>
            )}
            {onglet === "modules" && (
              <>
                <p className="mk-sub">signaux ouverts · part des résidents du module</p>
                <Barres barres={vue.remonte.modules} vide="Aucun signal ouvert." />
              </>
            )}
            {onglet === "physio" && (
              <>
                <p className="mk-sub">nuit du {vue.remonte.physio.nuit} · part de l'équipage hors seuil</p>
                <Barres barres={vue.remonte.physio.barres} vide="Aucune mesure pour cette nuit." />
              </>
            )}
          </div>
        </section>
      </div>

      <div className="mk-row">
        <section className="mk-card">
          <div className="mk-ch">
            <h3>À traiter maintenant</h3>
            <span className="sub">
              <b>{entier(ouverts)}</b> {ouverts > 1 ? "ouverts" : "ouvert"} · <b>{entier(critiques)}</b>{" "}
              {critiques > 1 ? "critiques" : "critique"} · <b>{entier(sansPersonne)}</b> sans personne
            </span>
          </div>
          <FileTriage lignes={file} moi={moi} peutAgir={peutAgir} enCours={enCours} onPrendre={prendre} />
          {vue.piedFile && (
            <div className="tq-foot">
              <span>{vue.piedFile}</span>
              <Link className="link" to="/signaux">
                Voir {ouverts > 1 ? `les ${entier(ouverts)} signaux` : "le signal"} →
              </Link>
            </div>
          )}
        </section>
      </div>

      {avis}
    </main>
  );
}
