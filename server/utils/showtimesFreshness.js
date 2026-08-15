// Règle de fraîcheur du cache de séances, partagée par la lecture groupée
// (`/api/allocine/showtimes`) et le rafraîchissement unitaire (`/api/allocine/refresh`).
// Une seule définition : les deux routes doivent trancher exactement pareil, sans quoi la lecture
// déclarerait « à rafraîchir » ce que le rafraîchissement juge encore bon, et on tournerait en rond.

const HOUR = 60 * 60 * 1000;
const FRESH_NEAR = 2 * HOUR;   // aujourd'hui et demain : ça bouge encore (séances ajoutées, complets)

// ⚠️ Pas 12 h : les exploitants n'ouvrent pas leurs ventes d'un bloc, elles arrivent par vagues sur les
// jours à venir. Un cache d'une demi-journée fige donc un état incomplet et fait mentir la vue face au
// site de la salle (constaté le 13/08/2026, cf. README). 3 h, plus le bouton « Actualiser ».
const FRESH_FAR = 3 * HOUR;

// Combien de temps on continue de montrer une salle qu'Allociné ne rend plus : assez pour traverser une
// panne de la source, assez court pour qu'une vraie déprogrammation ne traîne pas la semaine.
const CARRY_OVER_MS = 48 * 60 * 60 * 1000;

// Une lecture fraîche ne doit **jamais** appauvrir ce qu'on avait sans le dire : une entrée plus pauvre
// aurait remplacé la précédente en silence, sans trace ni dans la vue ni dans les logs.
//
// Les salles disparues sont donc reportées, marquées `unconfirmedSince` : affichées comme non
// confirmées, ignorées par le contrôle « en salle ». Elles s'effacent au bout de `CARRY_OVER_MS`, ou
// dès que la source les rend à nouveau.
//
// ⚠️ `unconfirmedSince` n'est jamais rafraîchi : le renouveler à chaque passage ferait d'une salle
// disparue une fois pour toutes un fantôme éternel.
export const carryOverMissing = (previous, fresh, previousFetchedAt) => {
    const present = new Set((fresh ?? []).map(t => t.code));
    const cutoff = Date.now() - CARRY_OVER_MS;

    return (previous ?? [])
        .filter(theater => theater?.code && !present.has(theater.code))
        .map(theater => ({ ...theater, unconfirmedSince: theater.unconfirmedSince ?? previousFetchedAt }))
        .filter(theater => Date.parse(theater.unconfirmedSince) > cutoff);
};

export const isShowtimesFresh = (fetchedAt, date) => {
    const written = Date.parse(fetchedAt);
    if (!Number.isFinite(written)) return false;
    if (written < lastWednesday()) return false;

    const ttl = (date === isoDay(0) || date === isoDay(1)) ? FRESH_NEAR : FRESH_FAR;
    return Date.now() - written < ttl;
};
