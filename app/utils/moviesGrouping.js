// Le regroupement d'une liste de films en `année → mois → jour`, plus ce qui n'a pas de date.
//
// Extrait de `useMovieCalendar.sortMovies` à comportement constant, parce que deux listes s'affichent
// maintenant avec la même grammaire : la mienne et celle d'un compte partagé. Une seconde écriture,
// ce sont deux timelines qui divergent sur un mois vide ou un film du 31 décembre.
//
// Règle **pure** : les filtres du store restent aux appelants, qui passent ici la liste déjà filtrée.

import { releaseDateOf } from './movieDate.js';

// Instancié une fois : `Intl.DateTimeFormat` est coûteux à construire, et il l'était pour chacune des
// ~450 lignes à chaque changement de filtre.
const MONTH_FR = new Intl.DateTimeFormat('fr-FR', { month: 'long' });

// Rend `{ grouped, undated }`, où `grouped` vaut `{ année: { mois: { jour: [films] } } }`.
//
// ⚠️ **L'ordre des clés est l'ordre d'affichage** — le gabarit itère l'objet tel quel. D'où le tri
// chronologique **avant** remplissage : trier après est impossible, JavaScript ré-ordonnant de
// lui-même les clés numériques (années, jours) mais pas les mois, qui sont du texte.
export function groupByYearMonthDay(list) {
    const grouped = {};

    const dated = (list ?? [])
        .map(movie => ({ movie, date: releaseDateOf(movie) }))
        .filter(entry => entry.date !== null)
        .sort((a, b) => a.date - b.date);

    for (const { movie, date } of dated) {
        const year = date.getFullYear();
        const month = MONTH_FR.format(date);
        const day = date.getDate();

        grouped[year] ??= {};
        grouped[year][month] ??= {};
        grouped[year][month][day] ??= [];

        grouped[year][month][day].push(movie);
    }

    return {
        grouped,
        undated: (list ?? []).filter(movie => releaseDateOf(movie) === null),
    };
}

// Les années d'un regroupement avec leur compteur — le rail gauche et le menu année du mobile.
// Ici et non dans le layout : les deux listes en ont besoin, et le rail doit suivre celle qui est
// affichée.
//
// « Sans date » ferme la marche et porte `year: null`, que `yearToSlug` traduit en `undated`.
export function yearsOf(grouped, undated = []) {
    const out = [];

    for (const [year, months] of Object.entries(grouped ?? {})) {
        let count = 0;
        for (const days of Object.values(months))
            for (const films of Object.values(days)) count += films.length;
        out.push({ year: Number(year), label: year, count });
    }

    out.sort((a, b) => a.year - b.year);

    if (undated?.length) out.push({ year: null, label: 'Sans date', count: undated.length });

    return out;
}
