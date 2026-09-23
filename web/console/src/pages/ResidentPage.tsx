import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { adapterResident, statut } from "../adapt";
import { ErreurApi, api, type SignalApi } from "../api";
import { AjoutNote } from "../components/AjoutNote";
import { useAvis } from "../components/Avis";
import { BilanSanguin } from "../components/BilanSanguin";
import { Conversations } from "../components/Conversations";
import { Courbe } from "../components/Courbe";
import { EnDirect, LigneBracelet } from "../components/EnDirect";
import { RETOUR_EQUIPAGE } from "../components/FileTriage";
import { Icone } from "../components/Icone";
import { MentionDemo } from "../components/MentionDemo";
import { SignalFerme, SignalOuvert, type SignalClos } from "../components/SignalOuvert";
import { TuileConstante } from "../components/TuileConstante";
import { useDirect } from "../direct";
import { REPLI_RESIDENT } from "../repli";
import { useCompte } from "../session";
import type { CleConstante, SignalFiche, VueResident } from "../types";
import { useSource, type Source } from "../useSource";

interface Retour {
  chemin: string;
  libelle: string;
}

/** Le texte d'un geste refusé : un refus du serveur se dit tel quel, une panne se nomme. */
function refus(e: unknown, quoi: string): string {
  if (!(e instanceof ErreurApi)) return `Le serveur de bord ne répond pas : ${quoi}.`;
  if (e.statut === 401) return `Session expirée : reconnectez-vous. ${quoi[0]!.toUpperCase()}${quoi.slice(1)}.`;
  return e.message;
}

/**
 * Écran 03 — la fiche d'un résident.
 *
 * L'ordre suit la visite : qui c'est et qui prévenir, le signal pour lequel on
 * ouvre la fiche, les constantes, puis ce qu'il faut savoir avant tout soin.
 * Conversations, suivi et bilan viennent ensuite, pour qui a le temps.
 */
export function ResidentPage() {
  const { id = "" } = useParams();
  const location = useLocation();
  const retour = (location.state as { retour?: Retour } | null)?.retour ?? RETOUR_EQUIPAGE;
  const { vue, source, erreur, rafraichir } = useSource(
    () => api.resident(id),
    adapterResident,
    REPLI_RESIDENT,
    [id],
  );

  // Le repli ne contient qu'une fiche. Pour tout autre résident, on attend la
  // base plutôt que d'afficher le dossier de quelqu'un d'autre.
  if (vue.code !== id) return <FicheAbsente id={id} erreur={erreur} retour={retour} />;

  return <Fiche key={vue.code} vue={vue} source={source} rafraichir={rafraichir} retour={retour} />;
}

function Fil({ retour, source }: { retour: Retour; source: Source | null }) {
  return (
    <div className="fil">
      <Link className="crumb" to={retour.chemin}>
        <Icone nom="left" />
        {retour.libelle}
      </Link>
      {source && <MentionDemo source={source} />}
    </div>
  );
}

function FicheAbsente({ id, erreur, retour }: { id: string; erreur: string | null; retour: Retour }) {
  const { deconnecter } = useCompte();

  let texte: ReactNode;
  if (erreur === null) texte = "Chargement de la fiche…";
  else if (erreur === "HTTP 404") texte = `Aucun résident ${id} dans la base.`;
  else if (erreur === "HTTP 401") {
    texte = (
      <>
        La session a expiré : reconnectez-vous pour ouvrir cette fiche.
        <br />
        <button type="button" className="btn mini" onClick={deconnecter}>
          Se reconnecter
        </button>
      </>
    );
  } else {
    texte = (
      <>
        Le serveur de bord ne répond pas, et le jeu de démonstration ne contient qu'une fiche :{" "}
        <Link className="link" to={`/residents/${REPLI_RESIDENT.code}`} state={{ retour }}>
          celle de {REPLI_RESIDENT.identite.nom}, {REPLI_RESIDENT.code}
        </Link>
        .
      </>
    );
  }

  return (
    <main className="app page">
      <Fil retour={retour} source={null} />
      <section className="mk-card">
        <p className="vide" role="status">
          {texte}
        </p>
      </section>
    </main>
  );
}

function Fiche({
  vue,
  source,
  rafraichir,
  retour,
}: {
  vue: VueResident;
  source: Source;
  rafraichir: () => void;
  retour: Retour;
}) {
  const { compte } = useCompte();
  const { montrer, rendu: avis } = useAvis();

  const direct = useDirect(vue.code, source === "api");
  const minute = direct?.donnees.derniere?.at ?? null;
  // La minute de la relecture précédente ; undefined avant la première.
  const minuteVue = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (!direct) return;
    // Une minute neuve a changé la ligne du jour : les tuiles et la courbe la
    // suivent. La première réponse ne recharge rien, la fiche vient d'arriver.
    if (minuteVue.current !== undefined && minute !== null && minute !== minuteVue.current) {
      rafraichir();
    }
    minuteVue.current = minute;
  }, [direct, minute, rafraichir]);

  const moi = compte?.role === "medecin" ? compte.id : null;
  const peutAgir = moi !== null && source === "api";
  // Le bouton de note reste affiché même quand il ne peut rien : un bouton qui
  // disparaît laisse croire que la fonction n'existe pas. Il dit pourquoi.
  const empeche =
    source !== "api"
      ? "Cette fiche vient du jeu de démonstration : le serveur de bord ne l'a pas servie, et rien ne s'y enregistre."
      : moi === null
        ? "Une note porte le nom d'un soignant : connectez-vous avec un compte médecin pour l'écrire."
        : null;
  const boutonNote = useRef<HTMLButtonElement>(null);

  // La courbe ouverte d'emblée est celle de la première tuile en vigilance :
  // c'est elle qu'on vient voir.
  const [cle, setCle] = useState<CleConstante>(
    () => vue.constantes.find((c) => c.alerte)?.cle ?? "hrv",
  );
  const [pris, setPris] = useState<Record<number, SignalApi>>({});
  const [clos, setClos] = useState<SignalClos[]>([]);
  const [note, setNote] = useState(false);

  const choisie = vue.constantes.find((c) => c.cle === cle) ?? vue.constantes[0]!;
  const i = vue.identite;

  const ouverts: SignalFiche[] = vue.signaux
    .filter((s) => !clos.some((c) => c.signal.id === s.id))
    .map((s) => {
      const p = pris[s.id];
      return p && !s.assigne ? { ...s, assigne: p.assigne_a, assigneId: p.assigne_id, statut: p.statut } : s;
    });

  function fermerNote() {
    setNote(false);
    // Le formulaire s'en va avec le bouton qui avait le focus : on le rend au
    // bouton de l'en-tête plutôt qu'au haut de la page.
    boutonNote.current?.focus();
  }

  async function prendre(s: SignalFiche) {
    try {
      const { signal } = await api.prendre(s.id);
      setPris((d) => ({ ...d, [s.id]: signal }));
      montrer("Signal pris en charge : il est à votre nom.");
    } catch (e) {
      montrer(refus(e, "signal non pris"));
    }
    rafraichir();
  }

  async function clore(s: SignalFiche, motif: string) {
    try {
      const r = await api.clore(s.id, motif);
      setClos((c) => [...c, { signal: s, motif }]);
      montrer(`Signal clos. Statut de ${i.nom} : ${statut(r.statut_resident).libelle.toLowerCase()}.`);
    } catch (e) {
      montrer(refus(e, "signal non clos"));
    }
    rafraichir();
  }

  const graves = vue.notes.filter((n) => n.niveau !== "info");
  const infos = vue.notes.filter((n) => n.niveau === "info");
  const teinte = vue.notes.some((n) => n.niveau === "critique")
    ? ""
    : graves.length
      ? " w"
      : " i";

  return (
    <main className="app page">
      <Fil retour={retour} source={source} />

      <section className="mk-card">
        <div className="idc">
          <span className="av" aria-hidden="true">
            {i.initiales}
          </span>
          <div>
            <h2>
              {i.nom} <span className={`chip ${i.statut.ton}`}>{i.statut.libelle}</span>
            </h2>
            <div className="meta">{i.meta}</div>
          </div>
          <div className="facts">
            <span className="f">
              <Icone nom="user" />
              {i.confiance ? (
                <span>
                  Personne de confiance : <b>{i.confiance.nom}</b>
                  {i.confiance.suite}
                </span>
              ) : (
                "Aucune personne de confiance renseignée"
              )}
            </span>
            <span className="f">
              <Icone nom="pulse" />
              <LigneBracelet direct={direct} repli={i.bracelet} />
            </span>
          </div>
        </div>
      </section>

      {ouverts.map((s) => (
        <SignalOuvert
          key={s.id}
          signal={s}
          moi={moi}
          peutAgir={peutAgir}
          onPrendre={prendre}
          onClore={clore}
        />
      ))}
      {clos.map((c) => (
        <SignalFerme key={c.signal.id} clos={c} />
      ))}

      {direct && <EnDirect direct={direct} />}

      <div className="mk-row">
        <section className="mk-card">
          <div className="mk-ch">
            <h3>Constantes · 14 derniers jours</h3>
            <span className="sub">{vue.fenetre}</span>
          </div>
          <div className="vt-g" role="group" aria-label="Constante affichée">
            {vue.constantes.map((c) => (
              <TuileConstante
                key={c.cle}
                constante={c}
                choisie={c.cle === choisie.cle}
                onChoisir={() => setCle(c.cle)}
              />
            ))}
          </div>
          <div className="vrow">
            <span className={vue.evenements.alerte ? "w" : "ok"}>
              <Icone nom={vue.evenements.alerte ? "alert" : "check"} />
              {vue.evenements.texte}
            </span>
          </div>
          <Courbe courbe={choisie.courbe} />
        </section>
      </div>

      <section className={`band${teinte}`} aria-labelledby="a-savoir">
        <div className="band-h">
          <Icone nom="alert" taille={15} />
          <h3 id="a-savoir">À savoir avant tout soin</h3>
          <span className="r">
            <button
              ref={boutonNote}
              type="button"
              className="btn mini"
              aria-expanded={empeche ? undefined : note}
              aria-disabled={empeche ? true : undefined}
              title={empeche ?? undefined}
              onClick={() => (empeche ? montrer(empeche) : setNote((o) => !o))}
            >
              {note ? "Fermer" : "Ajouter une note"}
            </button>
          </span>
        </div>

        {note && !empeche && (
          <AjoutNote
            code={vue.code}
            onAjout={() => {
              fermerNote();
              montrer("Note ajoutée au dossier, à votre nom.");
              rafraichir();
            }}
            onAnnule={fermerNote}
          />
        )}

        {graves.length > 0 && (
          <div className="band-g">
            {graves.map((n) => (
              <div key={n.id} className={`bi${n.niveau === "surveillance" ? " w" : ""}`}>
                <b>{n.titre}</b>
                <span>{n.detail}</span>
                <em>{n.signature}</em>
              </div>
            ))}
          </div>
        )}
        {infos.length > 0 && (
          <div className="band-g two">
            {infos.map((n) => (
              <div key={n.id} className="bi i">
                <b>{n.titre}</b>
                <span>{n.detail}</span>
                <em>{n.signature}</em>
              </div>
            ))}
          </div>
        )}
        {!vue.notes.length && <p className="band-vide">Aucune particularité notée.</p>}
      </section>

      <div className="mk-row g2e top">
        <div className="mk-col">
          <Conversations conversations={vue.conversations} />
          <section className="mk-card">
            <div className="mk-ch">
              <h3>Suivi en cours</h3>
              <span className="sub">protocoles actifs</span>
            </div>
            {vue.suivis.length ? (
              <div className="fl">
                {vue.suivis.map((s) => (
                  <div className="fl-i" key={s.titre}>
                    <span className="i">
                      <Icone nom={s.icone} taille={15} />
                    </span>
                    <div>
                      <b>{s.titre}</b>
                      <span>{s.detail}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="vide">Aucun protocole actif.</p>
            )}
          </section>
        </div>
        <BilanSanguin bilans={vue.bilans} />
      </div>

      {avis}
    </main>
  );
}
