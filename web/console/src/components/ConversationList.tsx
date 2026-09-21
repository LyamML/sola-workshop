import { useMemo, useState } from "react";
import type { ConversationSummary } from "../types";
import { Seg } from "./Seg";

type Filter = "all" | "watch" | "info";
type Sort = "date" | "grav" | "duree";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "Tout" },
  { value: "watch", label: "Surveillance" },
  { value: "info", label: "Contexte" },
];

const SEVERITY_RANK: Record<string, number> = { crit: 3, watch: 2, info: 1 };

interface Props {
  conversations: ConversationSummary[];
  totalConversations: number;
}

/**
 * Résumés de conversation : cartes compactes, repliées par défaut.
 * L'en-tête porte tout ce qui sert à décider s'il faut ouvrir — date, gravité,
 * motifs, durée — de sorte qu'on puisse parcourir la liste sans rien déplier.
 */
export function ConversationList({ conversations, totalConversations }: Props) {
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("date");
  const [open, setOpen] = useState<Set<string>>(new Set());

  const visible = useMemo(() => {
    const filtered = conversations.filter((c) =>
      filter === "all" ? true : filter === "watch" ? c.severity === "watch" : c.severity === "info",
    );
    return [...filtered].sort((a, b) => {
      if (sort === "grav") {
        return SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || b.sortKey - a.sortKey;
      }
      if (sort === "duree") return b.durationMinutes - a.durationMinutes;
      return b.sortKey - a.sortKey;
    });
  }, [conversations, filter, sort]);

  const allOpen = visible.length > 0 && visible.every((c) => open.has(c.id));

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = () => setOpen(allOpen ? new Set() : new Set(visible.map((c) => c.id)));

  const ratio = ((visible.length / totalConversations) * 100).toFixed(1).replace(".", ",");

  return (
    <>
      <div className="card-h">
        <h3>Conversations remontées</h3>
        <span className="sub">
          {visible.length} résumé{visible.length > 1 ? "s" : ""} sur {totalConversations}{" "}
          conversations · {ratio} %
        </span>
        <div className="right conv-tools">
          <Seg options={FILTERS} value={filter} onChange={setFilter} ariaLabel="Filtrer" />
          <div className="selectwrap">
            <label htmlFor="convSort" style={{ position: "absolute", left: -9999 }}>
              Trier les conversations
            </label>
            <select id="convSort" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              <option value="date">Plus récentes</option>
              <option value="grav">Gravité</option>
              <option value="duree">Durée</option>
            </select>
          </div>
          <button
            type="button"
            className="btn"
            style={{ padding: "7px 15px", fontSize: "12.5px" }}
            onClick={toggleAll}
          >
            {allOpen ? "Tout replier" : "Tout déplier"}
          </button>
        </div>
      </div>

      <div className="convs">
        {visible.map((conversation) => {
          const isOpen = open.has(conversation.id);
          return (
            <article className={`conv${isOpen ? " open" : ""}`} key={conversation.id}>
              <button
                type="button"
                className="conv-hd"
                aria-expanded={isOpen}
                aria-controls={`conv-body-${conversation.id}`}
                onClick={() => toggle(conversation.id)}
              >
                <span className="dt">{conversation.date}</span>
                <span className={`chip ${conversation.severity === "info" ? "" : conversation.severity}`}>
                  {conversation.severityLabel}
                </span>
                <span className="tags">
                  {conversation.tags.map((tag) => (
                    <span className="tag" key={tag}>
                      {tag}
                    </span>
                  ))}
                </span>
                <span className="dur">{conversation.durationMinutes} min</span>
                <span className="cv" aria-hidden="true" />
              </button>

              {isOpen && (
                <div className="conv-bd" id={`conv-body-${conversation.id}`}>
                  {/* Le résumé est produit par le modèle embarqué de la borne ;
                      il contient un balisage léger (exposants, citation). */}
                  <p dangerouslySetInnerHTML={{ __html: conversation.summary }} />
                  <div className="facts">
                    {conversation.facts.map((fact) => (
                      <span key={fact}>{fact}</span>
                    ))}
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </>
  );
}
