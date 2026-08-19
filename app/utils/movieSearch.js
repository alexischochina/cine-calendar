// Règles **pures** de ciblage d'un film dans la timeline. `now` est injectable : sans lui les verdicts
// « à venir / passé » dépendraient de l'horloge et le test serait vert ou rouge selon le jour.
import { releaseDateOf } from './movieDate.js';

// Un film daté est plus actionnable qu'un sans-date, et à venir plus que passé — mais un sans-date
// reste une cible légitime : il vit dans la section « Sans date », que `goToMovie` sait ouvrir.
export const RANK_UPCOMING = 0;
export const RANK_PAST = 1;
export const RANK_UNDATED = 2;

const startOfDay = (value) => {
    const d = new Date(value);
    d.setHours(0, 0, 0, 0);
    return d;
};

const rankOf = (entry, today) => {
    if (entry.date === null) return RANK_UNDATED;
    return entry.date >= today ? RANK_UPCOMING : RANK_PAST;
};

// Date construite **une fois** par film, jamais dans un comparateur.
const resolve = (list) => (list ?? []).map(movie => ({ movie, date: releaseDateOf(movie) }));

// Meilleur film correspondant à un terme de recherche : à venir (le plus proche d'abord), puis passé
// (le plus récent), puis sans date. `null` si aucun titre ne contient le terme.
export function bestSearchMatch(list, term, now = new Date()) {
    const q = term?.trim().toLowerCase();
    if (!q) return null;

    const today = startOfDay(now);
    const matches = resolve((list ?? []).filter(m => m?.title?.toLowerCase().includes(q)))
        .map(entry => ({ ...entry, rank: rankOf(entry, today) }));

    if (!matches.length) return null;

    // Tri stable (ES2019) : deux sans-date gardent l'ordre de la liste.
    matches.sort((a, b) => {
        if (a.rank !== b.rank) return a.rank - b.rank;
        if (a.rank === RANK_UPCOMING) return a.date - b.date; // le plus proche
        if (a.rank === RANK_PAST) return b.date - a.date;     // le plus récent
        return 0;
    });

    return matches[0].movie;
}

// Film daté le plus proche d'aujourd'hui : le passé le plus récent, sinon le futur le plus proche.
// Les sans-date sont hors sujet ici — « aujourd'hui » ne les situe pas.
export function closestToToday(list, now = new Date()) {
    const today = startOfDay(now);

    const dated = resolve(list)
        .filter(entry => entry.date !== null)
        .map(entry => ({ ...entry, day: startOfDay(entry.date) }));

    if (!dated.length) return null;

    // À égalité, le premier de la liste gagne dans les deux branches.
    const past = dated.filter(entry => entry.day <= today);
    return past.length
        ? past.reduce((a, b) => (a.day >= b.day ? a : b)).movie
        : dated.reduce((a, b) => (a.day <= b.day ? a : b)).movie;
}
