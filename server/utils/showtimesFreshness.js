// Règle de fraîcheur du cache de séances, partagée par la lecture groupée
// (`/api/allocine/showtimes`) et le rafraîchissement unitaire (`/api/allocine/refresh`).
// Une seule définition : les deux routes doivent trancher exactement pareil, sans quoi la lecture
// déclarerait « à rafraîchir » ce que le rafraîchissement juge encore bon, et on tournerait en rond.

const HOUR = 60 * 60 * 1000;
const FRESH_NEAR = 2 * HOUR;   // aujourd'hui et demain : ça bouge encore (séances ajoutées, complets)

// ⚠️ « Au-delà, la programmation est posée » : c'était faux, et 12 h de TTL l'ont fait payer. Cas
// constaté le 13/08/2026 sur *La fin d'Oak Street* au dimanche 16 — l'entrée écrite à 09 h 20
// portait 23 salles parisiennes, sans UGC Ciné Cité Les Halles, qu'Allociné servait pourtant
// l'après-midi même (7 séances). Les exploitants n'ouvrent pas leurs ventes d'un bloc : elles
// arrivent par vagues sur les jours à venir, UGC en tête. Un cache d'une demi-journée fige donc un
// état incomplet et fait mentir la vue face au site de la salle.
//
// 3 h est le compromis : la fenêtre de décalage devient une vraie fenêtre de consultation, pour un
// surcoût borné (un jour re-demandé au plus 4 à 5 fois par journée d'usage réel, contre 1 avant).
// Le bouton « Actualiser » de la vue reste là pour ne jamais rester coincé entre deux.
const FRESH_FAR = 3 * HOUR;

// `isoDay` et `lastWednesday` viennent de `shared/utils/cineWeek.js` : la règle du mercredi vaut
// des deux côtés de la barrière app/serveur, et deux copies jumelles finiraient par diverger sans
// que rien ne le signale — le cache déclarerait « frais » ce que le contrôle « en salle » juge
// périmé, et les deux tourneraient en rond.

// Combien de temps on continue de montrer une salle qu'Allociné ne rend plus. Assez pour traverser
// une panne de la source — celle du 13/08/2026 a fait disparaître UGC Ciné Cité Les Halles de
// toutes les réponses **en 29 secondes**, entre deux de nos écritures —, assez court pour qu'une
// vraie déprogrammation ne traîne pas la semaine entière.
const CARRY_OVER_MS = 48 * 60 * 60 * 1000;

// Une lecture fraîche ne doit **jamais** appauvrir ce qu'on avait sans le dire. Ce jour-là, nos
// entrées des 13-16 contenaient Les Halles et celles des 17-18 non : à la première expiration, les
// premières auraient perdu la salle en silence, remplacées par une vérité plus pauvre. Rien, ni
// dans la vue ni dans les logs, ne l'aurait signalé.
//
// Les salles disparues sont donc **reportées**, marquées `unconfirmedSince` : la vue les affiche
// comme non confirmées, et le contrôle « en salle » les ignore — elles témoignent du passé, elles
// ne décident de rien. Elles s'effacent seules au bout de `CARRY_OVER_MS`, ou dès que la source les
// rend à nouveau (la version fraîche gagne toujours).
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
