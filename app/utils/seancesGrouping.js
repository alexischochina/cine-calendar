// Règles de filtrage, de tri et de regroupement de la vue « Séances ».
//
// Extraites de `useSeances` pour deux raisons :
//   - ce sont des **fonctions pures** — mêmes entrées, mêmes sorties, aucune réactivité, aucun
//     accès réseau. Elles n'avaient rien à faire au milieu d'un composable qui gère de l'état, du
//     chargement et des effets ;
//   - elles portent les décisions métier les plus faciles à casser sans s'en rendre compte (le
//     filtre carte, l'ordre des salles). Ici, elles sont exécutables par un script de test
//     (`scripts/test-seances-rules.mjs`) sans monter Nuxt.

// Séances qu'une carte UGC Illimité ne couvre pas, **dans la salle même où elle est acceptée**.
// Une seule constante, volontairement : ces exclusions sont amenées à s'enrichir à l'usage et
// éparpillées en conditions elles deviendraient introuvables.
//
// ⚠️ Limite assumée : la donnée Allociné ne décrit pas exhaustivement ce que la carte couvre. Le
// filtre est juste sur le gros (salle + avant-première + formats majorés), approximatif sur les
// cas exotiques (séances événement, festivals). Le lien billetterie reste l'arbitre final.
const CARD_EXCLUDED_FORMATS = [
    'IMAX',      // supplément systématique
    '4DX',       // idem
    'SCREENX',
    'ICE',       // Immersive Cinema Experience (CGR / Pathé)
    'DOLBY_CINEMA',
    'F_3D',      // majoration lunettes
];

// `isPreview` : les avant-premières sortent du cadre de la carte. ⚠️ Allociné n'expose pas ce champ
// aujourd'hui (vérifié le 12/08/2026) — le test est en place et inerte, il se réveillera tout seul
// si le champ réapparaît, plutôt que d'exclure à tort par un autre biais.
export const isCardEligible = (showtime) => {
    if (showtime.isPreview) return false;
    return !(showtime.projection ?? []).some(format => CARD_EXCLUDED_FORMATS.includes(String(format).toUpperCase()));
};

// « 1er », « 6e ». Utilisé par les libellés de salle et le <select> d'arrondissement.
export const arrondissementLabel = (n) => n === 1 ? '1er' : `${n}e`;

// Arrondissement de repli tant que `scripts/geocode-cinemas.mjs` n'est pas passé : le référentiel
// le tient de `properties.district` (fiable), mais le code postal suffit à faire tourner le filtre
// dès la première visite.
// ⚠️ Deux familles de codes postaux parisiens cohabitent : `750xx` (le cas courant) et `751xx`
// (75116 pour Passy, notamment). Ne reconnaître que la première faisait disparaître la salle du
// filtre par arrondissement.
export const arrondissementFromZip = (zip) => {
    const match = /^75[01](\d{2})$/.exec(String(zip ?? ''));
    if (!match) return null;
    const n = Number(match[1]);
    return n >= 1 && n <= 20 ? n : null;
};

export const countShowtimes = (list) => list.reduce((n, e) => n + e.showtimes.length, 0);

// Filtres — purement dérivés, aucun fetch. Le filtre carte agit à deux niveaux : la salle
// (référentiel curé) et la séance (cf. `isCardEligible`).
// `card` est paramétrable pour pouvoir répondre à « et si j'ouvrais à tout Paris ? » sans dupliquer
// la chaîne de filtres.
export const applyFilters = (list, { card, arrondissement = 'all', version = 'all' }) =>
    list
        .filter(entry => !card || entry.cinema.acceptsUgc)
        .filter(entry => arrondissement === 'all' || entry.cinema.arrondissement === Number(arrondissement))
        .map(entry => ({
            ...entry,
            showtimes: entry.showtimes
                .filter(s => version === 'all' || s.version === version)
                .filter(s => !card || isCardEligible(s)),
        }))
        .filter(entry => entry.showtimes.length);

// Ordre entre deux salles : les favorites d'abord, puis l'arrondissement, puis le nom.
// Un seul comparateur pour les deux regroupements — c'est la même intention (« mes salles
// d'abord »), vue par un bout ou par l'autre, et la dupliquer les ferait diverger.
export const byFavoriteThenPlace = (a, b) =>
    (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0)
    || (a.arrondissement ?? 99) - (b.arrondissement ?? 99)
    || String(a.name).localeCompare(String(b.name));

// Regroupement « Par film » : l'ordre des films suit le rail, les salles remontent selon le même
// ordre — une salle favorite se trouve donc en haut de chaque film.
export const groupByFilm = (entries) => {
    const buckets = new Map();
    for (const entry of entries) {
        if (!buckets.has(entry.movie.id)) buckets.set(entry.movie.id, { key: `f${entry.movie.id}`, movie: entry.movie, entries: [] });
        buckets.get(entry.movie.id).entries.push(entry);
    }
    return [...buckets.values()].map(bucket => ({
        ...bucket,
        entries: bucket.entries.sort((a, b) => byFavoriteThenPlace(a.cinema, b.cinema)),
        nbSeances: countShowtimes(bucket.entries),
    }));
};

// Regroupement « Par cinéma » : favoris en tête, puis arrondissement croissant.
export const groupByCinema = (entries) => {
    const buckets = new Map();
    for (const entry of entries) {
        if (!buckets.has(entry.cinema.code)) buckets.set(entry.cinema.code, { key: `c${entry.cinema.code}`, cinema: entry.cinema, entries: [] });
        buckets.get(entry.cinema.code).entries.push(entry);
    }
    return [...buckets.values()]
        .map(bucket => ({ ...bucket, nbSeances: countShowtimes(bucket.entries) }))
        .sort((a, b) => byFavoriteThenPlace(a.cinema, b.cinema));
};
