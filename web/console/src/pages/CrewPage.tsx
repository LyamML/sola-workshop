import { useState } from "react";
import { AreaChart } from "../components/AreaChart";
import { Bars, formatCount, formatPercent } from "../components/Bars";
import { Seg } from "../components/Seg";
import { Sparkline } from "../components/Sparkline";
import { TriageQueue } from "../components/TriageQueue";
import {
  KPIS,
  MODULE_BARS,
  MOTIF_BARS,
  PHYSIO_BARS,
  SHIP,
  TRIAGE,
  WELLBEING,
  type PeriodKey,
} from "../data/crew";

const PERIODS: { value: PeriodKey; label: string }[] = [
  { value: "7", label: "7 jours" },
  { value: "30", label: "30 jours" },
  { value: "365", label: "12 mois" },
];

/** Écran 02 — vue équipage : agrégat, tendance, puis file de triage. */
export function CrewPage() {
  const [period, setPeriod] = useState<PeriodKey>("30");
  const series = WELLBEING[period];

  const criticals = TRIAGE.filter((s) => s.severity === "crit").length;
  const unassigned = TRIAGE.filter((s) => s.unassigned).length;

  return (
    <div className="app">
      <div className="pagehead">
        <div>
          <h1>Santé de l'équipage</h1>
          <div className="sub">
            Vaisseau {SHIP.name} · {SHIP.residents.toLocaleString("fr-FR")} résidents ·{" "}
            {SHIP.flightDay} · synchro {SHIP.lastSync}
          </div>
        </div>
        <div className="right">
          <Seg options={PERIODS} value={period} onChange={setPeriod} ariaLabel="Période" />
        </div>
      </div>

      <div className="row g4">
        {KPIS.map((kpi) => (
          <div className="card kpi" key={kpi.label}>
            <div className="lbl">{kpi.label}</div>
            <div className="btm">
              <div>
                <span className="val">{kpi.value}</span>
                {kpi.unit && <span className="unit">{kpi.unit}</span>}
              </div>
              <div className="sp">
                <Sparkline values={kpi.spark} tone={kpi.tone} />
              </div>
            </div>
            <div className="foot">
              <span className={`chip ${kpi.deltaDirection}`}>{kpi.deltaLabel}</span> {kpi.footNote}
            </div>
          </div>
        ))}
      </div>

      <div className="row g21">
        <div className="card pad-lg">
          <div className="card-h">
            <h3>Indice de bien-être</h3>
            <span className="sub">{series.subtitle}</span>
          </div>
          <AreaChart
            key={period}
            values={series.values}
            min={series.min}
            max={series.max}
            ticks={series.ticks}
            refLine={series.refLine}
            labels={series.labels}
            tips={series.tips}
            note={series.note}
            height={240}
            format={(v) => `${v.toFixed(1).replace(".", ",")} /100`}
            ariaLabel={`Indice de bien-être de l'équipage, ${series.subtitle}, de ${series.values[0]} à ${
              series.values[series.values.length - 1]
            } sur 100.`}
          />
          <div className="legend">
            <span>
              <i style={{ background: "var(--accent)" }} />
              Indice de bien-être
            </span>
            <span>
              <i style={{ background: "var(--line-2)" }} />
              Seuil d'attention (70)
            </span>
          </div>
        </div>

        <div className="card pad-lg">
          <div className="card-h">
            <h3>Signalements actifs</h3>
            <span className="sub">par module</span>
          </div>
          <Bars rows={MODULE_BARS} max={16} format={formatPercent} />
        </div>
      </div>

      <div className="row g2">
        <div className="card pad-lg">
          <div className="card-h">
            <h3>Motifs de signalement</h3>
            <span className="sub">90 jours · 837 signalements</span>
          </div>
          <Bars rows={MOTIF_BARS} max={330} format={formatCount} />
        </div>

        <div className="card pad-lg">
          <div className="card-h">
            <h3>Marqueurs physiologiques hors norme</h3>
            <span className="sub">% de l'équipage · 7 jours</span>
          </div>
          <Bars rows={PHYSIO_BARS} max={14} format={formatPercent} />
        </div>
      </div>

      <div className="row">
        <div className="card pad-lg">
          <div className="card-h">
            <h3>File de triage</h3>
            <span className="sub">
              {TRIAGE.length} signaux ouverts · {criticals} critiques · {unassigned} non assignés
            </span>
          </div>
          <TriageQueue signals={TRIAGE} />
          <p style={{ fontSize: 12, color: "var(--ink-3)" }}>
            Sélectionnez une ligne pour ouvrir la fiche individuelle.
          </p>
        </div>
      </div>
    </div>
  );
}
