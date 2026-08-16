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

// Lettres que NFD ne décompose pas — la barre ou la ligature fait partie du glyphe — mais que
// Letterboxd translittère : sans elles, `andre-vredal` et `levan-ak-n`.
const UNDECOMPOSED = { 'ø': 'o', 'ı': 'i', 'đ': 'd', 'ð': 'd', 'þ': 'th', 'ł': 'l', 'æ': 'ae', 'œ': 'oe', 'ß': 'ss' };

// Slug Letterboxd **deviné**. Apostrophes et points sont supprimés, pas coupés : « J.J. Abrams » →
// `jj-abrams`.
// ⚠️ Repli seulement, jamais une preuve — cf. `shared/utils/letterboxdFilm.js`. Le lien exact vient
// de la base, via `directorLinks`.
export const letterboxdPersonSlug = (name) => String(name ?? '')
    .toLowerCase()
    .replace(/[øıđðþłæœß]/g, c => UNDECOMPOSED[c])
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/['’.]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

// Slug d'une URL /director/<slug>/, sans le suffixe d'homonyme : `kane-parsons-4` → `kane-parsons`.
// null sur la forme `contributor:61567`, qui ne porte aucun nom — et un '' s'y serait apparié par
// accident avec les noms non latins, dont le slug deviné est vide lui aussi.
const slugOfDirectorUrl = (url) => String(url ?? '').match(/\/director\/([a-z0-9-]+)\//)?.[1].replace(/-\d+$/, '') ?? null;

// Réalisateur(s) → liens Letterboxd. `director` tient **une seule chaîne**, les co-réalisateurs
// joints par « , » (cf. `extractDirector`, server/utils/tmdbDates.js). Chaque entrée porte son
// séparateur (`sep`, vide pour la première) pour que le template reste une simple boucle.
//
// `stored` = colonne `letterboxd_directors`. Elle fait autorité sur l'URL ; le libellé reste celui
// de TMDB tant qu'on peut prouver qu'il désigne la même personne (même slug, au suffixe près), parce
// que l'interface affiche « Andreï Zviaguintsev » partout ailleurs. Sinon on montre celui de
// Letterboxd, seul cohérent avec la page qui s'ouvre.
export const directorLinks = (director, stored = null) => {
    const names = String(director ?? '').split(',').map(n => n.trim()).filter(Boolean);

    // Revalidé ici aussi : la valeur sort de la base pour aller dans un `href`, et rien ne garantit
    // qu'elle y soit entrée par `parseLetterboxdFilm`.
    const exact = (Array.isArray(stored) ? stored : [])
        .filter(d => d?.name && isLetterboxdDirectorUrl(d?.url))
        .map(d => {
            const slug = slugOfDirectorUrl(d.url);
            const tmdbName = slug && names.find(n => letterboxdPersonSlug(n) === slug);
            return { name: tmdbName || d.name, url: d.url };
        });

    const links = exact.length ? exact : names
        .map(name => ({ name, slug: letterboxdPersonSlug(name) }))
        .filter(d => d.slug)
        .map(d => ({ name: d.name, url: `https://letterboxd.com/director/${d.slug}/` }));

    return links.map((d, i) => ({ ...d, sep: i ? ', ' : '' }));
};

// Date courte FR, ex. « août 2026 » ; '' si date invalide.
export const dateShort = (ds) => {
    const d = new Date(ds);
    return isNaN(d) ? '' : new Intl.DateTimeFormat('fr-FR', { month: 'short', year: 'numeric' }).format(d);
};
