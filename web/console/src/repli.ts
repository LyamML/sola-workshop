import { adapterCrew, adapterResident } from "./adapt";
import type { CrewApi, ResidentApi } from "./api";
import crew from "./data/crew.json";
import resident from "./data/resident.json";

/**
 * Ce qu'affichent les écrans 02 et 03 quand le serveur de bord ne répond pas.
 *
 * Deux réponses du serveur, figées par `npm run db:repli`, passent ici par le
 * même adaptateur que les réponses vivantes : une chaîne ne peut pas s'écrire
 * d'une façon serveur allumé et d'une autre serveur éteint, puisqu'il n'y a
 * qu'un adaptateur. Seuls les chiffres peuvent vieillir, et
 * `npm run db:repli -- --verifier` dit quand.
 *
 * Le repli ne contient qu'une fiche, celle des maquettes : la fiche d'un
 * autre résident ne s'invente pas, et la console le dit plutôt que de la
 * remplacer.
 */
export const REPLI_CREW = adapterCrew(crew as CrewApi);
export const REPLI_RESIDENT = adapterResident(resident as ResidentApi);
