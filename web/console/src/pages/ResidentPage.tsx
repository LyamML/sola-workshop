import { useState } from "react";
import { AjoutNote } from "../components/AjoutNote";
import { AreaChart } from "../components/AreaChart";
import { BilanSanguin } from "../components/BilanSanguin";
import { ConversationList } from "../components/ConversationList";
import { FlagList } from "../components/FlagList";
import { PrivacyNote } from "../components/PrivacyNote";
import { Seg } from "../components/Seg";
import { SleepChart } from "../components/SleepChart";
import { VitalTile } from "../components/VitalTile";
import { useParams } from "react-router-dom";
import { adapterResident } from "../adapt";
import { api } from "../api";
import { REPLI_RESIDENT } from "../repli";
import { useSource } from "../useSource";
import type { SensEcart } from "../types";

type Window = "24h" | "7j" | "30j" | "90j";

const WINDOWS: { value: Window; label: string }[] = [
  { value: "24h", label: "24 h" },
  { value: "7j", label: "7 j" },
  { value: "30j", label: "30 j" },
  { value: "90j", label: "90 j" },
];

/** Écran 03 — fiche individuelle. */
/**
 * Le sens est porte par une forme autant que par une couleur : lu en noir et
 * blanc, ou par un oeil qui confond l'ambre et le turquoise, la fleche reste.
 */
const FLECHE: Record<SensEcart, string> = {
  haut: "▲",
  bas: "▼",
  dans: "—",
  sans: "○",
};

export function ResidentPage() {
  const { id = "R-0448" } = useParams();
  const [window, setWindow] = useState<Window>("7j");
  const [vitalKey, setVitalKey] = useState("hrv");

  // Même principe que l'écran 02 : la fiche s'affiche remplie avec le jeu de
  // démonstration, puis se met à jour dès que le serveur répond.
  const { vue, source, rafraichir } = useSource(
    () => api.resident(id),
    adapterResident,
    REPLI_RESIDENT,
    [id],
  );

  const [ajoutOuvert, setAjoutOuvert] = useState(false);

  const vital = vue.vitals.find((v) => v.key === vitalKey) ?? vue.vitals[0];

  return (
    <div className="app">
      <div className="row" style={{ marginTop: 26 }}>
        <div className="card pad-lg">
          <div className="f-head">
            <div className="f-av">{vue.resident.initials}</div>
            <div className="f-id">
              <h2>
                {vue.resident.name}{" "}
                <span className="chip watch">{vue.resident.status}</span>
                {source === "demo" && <span className="chip">jeu de démonstration</span>}
              </h2>
              <div className="meta">{vue.resident.meta}</div>
              <div className="ids">
                {vue.resident.id} · {vue.resident.device}
              </div>
            </div>
            <div className="right">
              <button type="button" className="btn">
                Protocole lumière
              </button>
              <button type="button" className="btn">
                Contacter
              </button>
              <button type="button" className="btn primary">
                Planifier une consultation
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="pagehead" style={{ paddingTop: 8 }}>
        <div>
          <h1 style={{ fontSize: 20 }}>Statistiques de santé</h1>
          <div className="sub">
            
          </div>
        </div>
        <div className="right">
          <Seg options={WINDOWS} value={window} onChange={setWindow} ariaLabel="Historique" />
        </div>
      </div>

      <div className="row g4">
        {vue.vitals.map((v) => (
          <VitalTile
            key={v.key}
            vital={v}
            selected={v.key === vitalKey}
            onSelect={() => setVitalKey(v.key)}
          />
        ))}
      </div>

      <div className="row g2">
        <div className="card pad-lg">
          <div className="card-h">
            <h3>Durée de sommeil</h3>
            <span className="sub">heures</span>
          </div>
          <SleepChart nights={vue.sleepNights} />
        </div>

        <div className="card pad-lg">
          <div className="card-h">
            <h3>{vital.chart.title}</h3>
            <span className="sub">{vital.chart.subtitle}</span>
          </div>
          <AreaChart
            key={vital.key}
            values={vital.chart.values}
            min={vital.chart.min}
            max={vital.chart.max}
            ticks={vital.chart.ticks}
            refLine={vital.chart.refLine}
            labels={vue.dayLabels}
            tips={vue.dayTips}
            color={vital.watch ? "var(--watch)" : "var(--accent)"}
            height={200}
            format={(v) => `${String(v).replace(".", ",")}${vital.chart.unitSuffix}`}
            ariaLabel={`${vital.chart.title} sur quatorze jours.`}
          />
          <div className="legend">
            <span>
              <i style={{ background: vital.watch ? "var(--watch)" : "var(--accent)" }} />
              Mesure nocturne
            </span>
            {vital.chart.etat && (
              <span className={`etat ${vital.chart.etat.sens}`}>
                <i aria-hidden="true">{FLECHE[vital.chart.etat.sens]}</i>
                <b>{vital.chart.etat.verdict}</b>
                <em>{vital.chart.etat.repere}</em>
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Entre les constantes et les conversations : le bilan est une mesure,
          pas une confidence, et il se lit dans la continuité des tuiles. */}
      <div className="row">
        <BilanSanguin reports={vue.bloodReports} />
      </div>

      <div className="row">
        <div className="card pad-lg">
          <PrivacyNote>
            <b>Aucune transcription intégrale n'est accessible.</b> Le modèle embarqué dans la borne
            résume en local ; seuls les échanges franchissant un seuil clinique remontent, et le
            résident est notifié de chaque remontée.
          </PrivacyNote>
          <ConversationList
            conversations={vue.conversations}
            totalConversations={vue.totalConversations}
          />
        </div>
      </div>

      <div className="row g2">
        <div className="card pad-lg">
          <div className="card-h">
            <h3>Notes de particularité</h3>
            <span className="sub">toujours visibles, en tête du dossier</span>
            <div className="right">
              <button
                className="btn mini"
                onClick={() => setAjoutOuvert((o) => !o)}
                aria-expanded={ajoutOuvert}
              >
                {ajoutOuvert ? "Fermer" : "Ajouter une note"}
              </button>
            </div>
          </div>
          {ajoutOuvert && (
            <AjoutNote
              code={id}
              onAnnule={() => setAjoutOuvert(false)}
              onAjout={() => {
                setAjoutOuvert(false);
                rafraichir();
              }}
            />
          )}
          <FlagList notes={vue.particularities} />
        </div>

        <div className="card pad-lg">
          <div className="card-h">
            <h3>Suivi en cours</h3>
            <span className="sub">protocoles actifs</span>
          </div>
          <FlagList notes={vue.followUp} />
          <PrivacyNote>
            Le résident consulte la même page depuis sa borne : constantes, historique et
            protocoles. <b>Sans</b> les scores de dépistage, les notes cliniques ni la file de
            triage.
          </PrivacyNote>
        </div>
      </div>
    </div>
  );
}
