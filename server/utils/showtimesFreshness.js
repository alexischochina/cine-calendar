// Règle de fraîcheur du cache de séances, partagée par la lecture groupée
// (`/api/allocine/showtimes`) et le rafraîchissement unitaire (`/api/allocine/refresh`).
// Une seule définition : les deux routes doivent trancher exactement pareil, sans quoi la lecture
// déclarerait « à rafraîchir » ce que le rafraîchissement juge encore bon, et on tournerait en rond.

const HOUR = 60 * 60 * 1000;
const FRESH_NEAR = 2 * HOUR;   // aujourd'hui et demain : ça bouge encore (séances ajoutées, complets)
const FRESH_FAR = 12 * HOUR;   // au-delà : la programmation est posée

const isoDay = (offset = 0) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// « Chaque mercredi les salles mettent à jour leur programmation » : toute entrée écrite avant le
// dernier mercredi 00 h est périmée quel que soit son âge — sinon une entrée du mardi pour le
// samedi resterait « fraîche » 12 h après le renouvellement complet des grilles.
const lastWednesday = () => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() - 3 + 7) % 7));
    return d.getTime();
};

export const isShowtimesFresh = (fetchedAt, date) => {
    const written = Date.parse(fetchedAt);
    if (!Number.isFinite(written)) return false;
    if (written < lastWednesday()) return false;

    const ttl = (date === isoDay(0) || date === isoDay(1)) ? FRESH_NEAR : FRESH_FAR;
    return Date.now() - written < ttl;
};
