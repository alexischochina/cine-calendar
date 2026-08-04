// Helpers partagés films/dates — auto-importés par Nuxt (dossier app/utils/).
// Mutualisés entre stats/TopRated, stats/Catchup, MovieActionsBtn et useMovieCalendar.

// Date du jour au format YYYY-MM-DD, recalculée à chaque appel (pas de gel au setup :
// une session ouverte au passage de minuit reste juste).
export const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Année (number) d'une date ISO, ou null si absente/invalide.
export const yearOf = (ds) => { const x = new Date(ds); return isNaN(x) ? null : x.getFullYear(); };

// URL d'affiche TMDB (w185) validée contre injection, ou null si chemin absent/suspect.
export const posterUrl = (path) => /^\/[\w./-]+$/.test(path || '') ? `https://image.tmdb.org/t/p/w185${path}` : null;

// Date courte FR, ex. « août 2026 » ; '' si date invalide.
export const dateShort = (ds) => {
    const d = new Date(ds);
    return isNaN(d) ? '' : new Intl.DateTimeFormat('fr-FR', { month: 'short', year: 'numeric' }).format(d);
};
