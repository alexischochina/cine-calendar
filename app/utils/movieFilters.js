// Filtres de la liste (état de visionnage / média) — règle **pure**, source unique partagée par le
// tri de la timeline (`useMovieCalendar.sortMovies`) et la recherche (`useCalendarNav.onSearch`), qui
// doit savoir si sa cible est masquée avant d'y naviguer.
export const MOVIE_FILTER_KEYS = ['state', 'media'];

// Un filtre nul n'exclut rien.
export const matchesFilters = (movie, filters) =>
    MOVIE_FILTER_KEYS.every(key => !filters?.[key] || movie?.[key] === filters[key]);

// Les filtres actifs qui masquent ce film — tableau vide s'il est déjà visible.
export const blockingFilters = (movie, filters) =>
    MOVIE_FILTER_KEYS.filter(key => filters?.[key] && movie?.[key] !== filters[key]);
