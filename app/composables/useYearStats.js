// Agrégats statistiques pour l'année sélectionnée (vue Stats).
// Consomme la liste `movies` (déjà résolue par useMovieCalendar : `release_date` = date effective)
// et l'année courante. Tout est `computed` → se recalcule au changement d'année ou de données.
//
// Conventions (cf. plan 2607271048) :
//   - vu       = state === 'seen'
//   - à voir   = tout le reste (unseen | inTheaters | downloadAvailable)
//   - cinéma   = media === 'cinema'
//   - streaming= tout le reste (netflix | primeVideo | disney+ | streaming | vod | unknown)
//   - graphe mensuel : regroupement par mois de release_date, films vus (+ surcouche ciné)

const MONTHS_FR = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'];

const TOP_LIMIT = 10; // top 10 genres / pays

// Parse une date TMDB « YYYY-MM-DD » en composants locaux, SANS passer par `new Date()`
// (qui interprète la chaîne en UTC → décale mois/année sur les fuseaux à offset négatif).
// Retourne { year, month } (month 0-based) ou null si la chaîne est absente/malformée.
const parseYMD = (s) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || '');
    return match ? { year: +match[1], month: +match[2] - 1 } : null;
};

// ISO 3166-1 → nom FR (natif, pas de dictionnaire à maintenir).
let regionNames = null;
const countryName = (iso) => {
    if (!iso) return iso;
    try {
        if (!regionNames) regionNames = new Intl.DisplayNames(['fr'], { type: 'region' });
        return regionNames.of(iso) || iso;
    } catch {
        return iso;
    }
};

// Top N par clé multi-valuée (un film peut compter dans plusieurs buckets : genres, pays).
// `keyOf(m)` renvoie le tableau de clés du film. Retourne [{ key, count, movies }] trié
// décroissant, limité à n ; chaque `movies` est trié par date de sortie croissante.
// Dates ISO « YYYY-MM-DD » à largeur fixe → comparaison lexicographique = ordre chronologique.
const byReleaseDate = (a, b) => (a.release_date || '') < (b.release_date || '') ? -1 : 1;
const topNBy = (movies, keyOf, n) => {
    const buckets = new Map(); // clé -> films[]
    for (const m of movies) {
        for (const k of keyOf(m) || []) {
            if (!buckets.has(k)) buckets.set(k, []);
            buckets.get(k).push(m);
        }
    }
    return [...buckets.entries()]
        .sort((a, b) => b[1].length - a[1].length)
        .slice(0, n)
        .map(([key, ms]) => ({ key, count: ms.length, movies: ms.sort(byReleaseDate) }));
};

const ratio = (a, b) => {
    const total = a + b;
    return total ? Math.round((a / total) * 100) : 0;
};

export function useYearStats(movies, year) {
    const moviesRef = toRef(movies);
    const yearRef = toRef(year);

    // Films de l'année sélectionnée (par mois de release_date). Année null (« Sans date ») → vide.
    const yearMovies = computed(() => {
        const y = unref(yearRef);
        if (y === null || y === undefined) return [];
        return (moviesRef.value || []).filter(m => {
            const parsed = parseYMD(m.release_date);
            return parsed !== null && parsed.year === y;
        });
    });

    const total = computed(() => yearMovies.value.length);

    const seen = computed(() => yearMovies.value.filter(m => m.state === 'seen').length);
    const toWatch = computed(() => total.value - seen.value);
    const seenRatio = computed(() => ratio(seen.value, toWatch.value));

    const cinema = computed(() => yearMovies.value.filter(m => m.media === 'cinema').length);
    const streaming = computed(() => total.value - cinema.value);
    const cinemaRatio = computed(() => ratio(cinema.value, streaming.value));

    // Top genres / pays : uniquement parmi les films VUS de l'année.
    const seenMovies = computed(() => yearMovies.value.filter(m => m.state === 'seen'));

    const topGenres = computed(() =>
        topNBy(seenMovies.value, m => m.genres, TOP_LIMIT)
            .map(({ key, count, movies }) => ({ label: key, count, movies }))
    );

    const topCountries = computed(() =>
        topNBy(seenMovies.value, m => m.countries, TOP_LIMIT)
            .map(({ key, count, movies }) => ({ label: countryName(key), count, movies }))
    );

    // 12 mois : films du mois répartis en vus-au-ciné / vus-en-streaming / pas-vus.
    // `total` = tous les films du mois ; `seen` = cinemaSeen + streamingSeen.
    const monthly = computed(() => {
        const buckets = MONTHS_FR.map((label, i) => ({
            label, month: i, cinemaSeen: 0, streamingSeen: 0, notSeen: 0, seen: 0, total: 0,
        }));
        for (const m of yearMovies.value) {
            const b = buckets[parseYMD(m.release_date).month];
            b.total++;
            if (m.state === 'seen') {
                b.seen++;
                if (m.media === 'cinema') b.cinemaSeen++;
                else b.streamingSeen++;
            } else {
                b.notSeen++;
            }
        }
        return buckets;
    });

    return {
        yearMovies,
        total,
        seen,
        toWatch,
        seenRatio,
        cinema,
        streaming,
        cinemaRatio,
        topGenres,
        topCountries,
        monthly,
    };
}
