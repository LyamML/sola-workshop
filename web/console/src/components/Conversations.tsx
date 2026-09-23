import { useState } from "react";
import { entier, pluriel } from "../format";
import type { VueResident } from "../types";
import { Icone } from "./Icone";

/** Au-delà, les résumés remontés attendent un clic : la carte reste lisible. */
const VISIBLES = 3;

/**
 * Les résumés de la borne : ceux qui ont franchi le seuil, dépliés, puis
 * l'en-tête de ceux gardés pour contexte.
 *
 * Aucune transcription : la borne résume en local et seuls des résumés
 * quittent la cabine. Un résumé de contexte n'a même pas de texte ici — sa
 * date et ses thèmes suffisent à situer un échange remonté.
 */
export function Conversations({ conversations: c }: { conversations: VueResident["conversations"] }) {
  const [tout, setTout] = useState(false);
  const [contexte, setContexte] = useState(false);

  const visibles = tout ? c.liste : c.liste.slice(0, VISIBLES);
  const caches = c.liste.length - visibles.length;

  return (
    <section className="mk-card">
      <div className="mk-ch">
        <h3>Conversations</h3>
        <span className="sub">
          <b>{entier(c.total)}</b> résumés en base · <b>{entier(c.remontees)}</b> remontés au seuil ·{" "}
          {entier(c.contexte)} pour contexte
        </span>
      </div>

      <div className="lockl">
        <Icone nom="lock" />
        Aucune transcription n'est accessible : la borne résume en local, et seuls des résumés
        quittent la cabine.
      </div>

      {c.liste.length ? (
        visibles.map((v) => (
          <article className="cv" key={v.id}>
            <div className="cv-h">
              {v.entete}
              <span className={`chip ${v.gravite.ton}`}>{v.gravite.libelle}</span>
              {v.tags.map((t) => (
                <span className="tag" key={t}>
                  {t}
                </span>
              ))}
              {v.duree}
            </div>
            <p>{v.resume}</p>
            <div className="f">
              {v.actions} ·{" "}
              {v.notifie ? "résident notifié" : <span className="nn">résident non notifié</span>}
            </div>
          </article>
        ))
      ) : (
        <p className="vide">Aucun échange n'a franchi le seuil.</p>
      )}

      {caches > 0 && (
        <button type="button" className="link" onClick={() => setTout(true)}>
          Voir {caches > 1 ? `les ${entier(caches)} autres` : "l'autre"}
        </button>
      )}

      {c.contexteListe.length > 0 && (
        <>
          <button
            type="button"
            className="link"
            aria-expanded={contexte}
            aria-controls="ctx-fiche"
            onClick={() => setContexte((o) => !o)}
          >
            {contexte ? "Replier" : "Voir"} les résumés pour contexte
          </button>
          {contexte && (
            <div className="ctx-l" id="ctx-fiche">
              {c.contexteListe.map((x) => (
                <div className="cv ctx" key={x.id}>
                  <div className="cv-h">
                    {x.entete}
                    <span className="chip">Contexte</span>
                    {x.tags.map((t) => (
                      <span className="tag" key={t}>
                        {t}
                      </span>
                    ))}
                    {x.duree} ·{" "}
                    {x.notifie ? "notifié au résident" : <span className="nn">jamais notifié au résident</span>}
                  </div>
                </div>
              ))}
              {c.contexteAutres > 0 && (
                <p className="mk-sub plus">… et {pluriel(c.contexteAutres, "autre")}, sous le seuil</p>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
