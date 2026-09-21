import { useState } from "react";
import { AreaChart } from "../components/AreaChart";
import { ConversationList } from "../components/ConversationList";
import { FlagList } from "../components/FlagList";
import { PrivacyNote } from "../components/PrivacyNote";
import { Seg } from "../components/Seg";
import { SleepChart } from "../components/SleepChart";
import { VitalTile } from "../components/VitalTile";
import {
  CONVERSATIONS,
  DAY_LABELS,
  DAY_TIPS,
  FOLLOW_UP,
  PARTICULARITIES,
  RESIDENT,
  SLEEP_NIGHTS,
  TOTAL_CONVERSATIONS,
  VITALS,
} from "../data/resident";

type Window = "24h" | "7j" | "30j" | "90j";

const WINDOWS: { value: Window; label: string }[] = [
  { value: "24h", label: "24 h" },
  { value: "7j", label: "7 j" },
  { value: "30j", label: "30 j" },
  { value: "90j", label: "90 j" },
];

/** Écran 03 — fiche individuelle. */
export function ResidentPage() {
  const [window, setWindow] = useState<Window>("7j");
  const [vitalKey, setVitalKey] = useState("hrv");

  const vital = VITALS.find((v) => v.key === vitalKey) ?? VITALS[0];

  return (
    <div className="app">
      <div className="row" style={{ marginTop: 26 }}>
        <div className="card pad-lg">
          <div className="f-head">
            <div className="f-av">{RESIDENT.initials}</div>
            <div className="f-id">
              <h2>
                {RESIDENT.name} <span className="chip watch">{RESIDENT.status}</span>
              </h2>
              <div className="meta">{RESIDENT.meta}</div>
              <div className="ids">
                {RESIDENT.id} · {RESIDENT.device}
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
          <h1 style={{ fontSize: 20 }}>Constantes</h1>
          <div className="sub">
            Bracelet · moyenne des dernières 24 h · comparées à la base personnelle
          </div>
        </div>
        <div className="right">
          <Seg options={WINDOWS} value={window} onChange={setWindow} ariaLabel="Historique" />
        </div>
      </div>

      <div className="row g4">
        {VITALS.map((v) => (
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
            <span className="sub">14 dernières nuits · heures</span>
          </div>
          <SleepChart nights={SLEEP_NIGHTS} />
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
            labels={DAY_LABELS}
            tips={DAY_TIPS}
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
            <span>
              <i style={{ background: "var(--line-2)" }} />
              Base personnelle
            </span>
          </div>
        </div>
      </div>

      <div className="row">
        <div className="card pad-lg">
          <PrivacyNote>
            <b>Aucune transcription intégrale n'est accessible.</b> Le modèle embarqué dans la borne
            résume en local ; seuls les échanges franchissant un seuil clinique remontent, et le
            résident est notifié de chaque remontée.
          </PrivacyNote>
          <ConversationList
            conversations={CONVERSATIONS}
            totalConversations={TOTAL_CONVERSATIONS}
          />
        </div>
      </div>

      <div className="row g2">
        <div className="card pad-lg">
          <div className="card-h">
            <h3>Notes de particularité</h3>
            <span className="sub">saisies à l'initialisation · toujours visibles</span>
          </div>
          <FlagList notes={PARTICULARITIES} />
        </div>

        <div className="card pad-lg">
          <div className="card-h">
            <h3>Suivi en cours</h3>
            <span className="sub">protocoles actifs</span>
          </div>
          <FlagList notes={FOLLOW_UP} />
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
