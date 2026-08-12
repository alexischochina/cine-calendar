// Vue « Séances » : tout l'état et toute la logique métier de la page.
//
// Point de départ : les films `state === 'inTheaters'` (ceux du rail « Au ciné en ce moment »).
// Pour chacun on résout un identifiant Allociné (une fois, persisté en base), puis on charge ses
// séances parisiennes du jour sélectionné. Les composants ne font que rendre ce qui sort d'ici —
// aucune logique métier dans les `.vue`.
//
// Deux niveaux de cache :
//   L1 — `useState` clé `allocineId:date`, évite l'aller-retour vers notre propre API pendant la
//        visite (changer de jour puis revenir ne refetch rien).
//   L2 — table `showtimes_cache`, durable, côté serveur (cf. server/api/allocine/showtimes.js).
// Les filtres (version, arrondissement, carte, regroupement) sont purement dérivés : en changer
// ne déclenche jamais de requête.

const DAYS_AHEAD = 7;
const DAY_NAMES = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
const MSHORT = ['JAN', 'FÉV', 'MAR', 'AVR', 'MAI', 'JUN', 'JUL', 'AOÛ', 'SEP', 'OCT', 'NOV', 'DÉC'];

const RESOLVE_CONCURRENCY = 8;
const SHOWTIMES_CONCURRENCY = 4;

// Un film cherché en vain reste introuvable un moment (il n'est pas à l'affiche) : on ne réessaie
// qu'au bout d'une semaine plutôt qu'à chaque ouverture de la page.
const RESOLVE_RETRY_MS = 7 * 24 * 60 * 60 * 1000;

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
const isCardEligible = (showtime) => {
    if (showtime.isPreview) return false;
    return !(showtime.projection ?? []).some(format => CARD_EXCLUDED_FORMATS.includes(String(format).toUpperCase()));
};

const pad = (n) => String(n).padStart(2, '0');

// « 1er », « 6e ». Exporté : les composants l'utilisent pour les libellés de salle et le <select>.
export const arrondissementLabel = (n) => n === 1 ? '1er' : `${n}e`;

// Arrondissement de repli tant que `scripts/geocode-cinemas.mjs` n'est pas passé : le référentiel
// le tient de `properties.district` (fiable), mais le code postal suffit à faire tourner le filtre
// dès la première visite.
// ⚠️ Deux familles de codes postaux parisiens cohabitent : `750xx` (le cas courant) et `751xx`
// (75116 pour Passy, notamment). Ne reconnaître que la première faisait disparaître la salle du
// filtre par arrondissement.
const arrondissementFromZip = (zip) => {
    const match = /^75[01](\d{2})$/.exec(String(zip ?? ''));
    if (!match) return null;
    const n = Number(match[1]);
    return n >= 1 && n <= 20 ? n : null;
};

export function useSeances() {
    const client = useSupabaseClient();
    const { movies, cinemaNow } = useMovieCalendar();

    // --- état de la vue (useState : la page est démontée au passage sur Timeline/Stats) ---
    const dayIndex = useState('seancesDay', () => 0);
    const group = useState('seancesGroup', () => 'film');       // 'film' | 'cinema'
    const version = useState('seancesVersion', () => 'all');    // 'all' | 'VO' | 'VF'
    const arrondissement = useState('seancesArr', () => 'all'); // 'all' | number
    const ugcOnly = useState('seancesUgcOnly', () => true);      // pré-filtre carte, actif par défaut
    const openCard = useState('seancesOpenCard', () => null);

    // --- données ---
    const payloads = useState('seancesPayloads', () => ({}));   // L1 : `${allocineId}:${date}` → payload
    const cinemas = useState('seancesCinemas', () => null);      // référentiel, chargé une fois
    const loading = useState('seancesLoading', () => false);
    const error = useState('seancesError', () => null);

    const days = computed(() => {
        // Midi et non minuit : ajouter des jours à partir de midi traverse les changements d'heure
        // sans jamais retomber sur la veille.
        const base = new Date();
        base.setHours(12, 0, 0, 0);

        return Array.from({ length: DAYS_AHEAD }, (_, i) => {
            const d = new Date(base);
            d.setDate(base.getDate() + i);
            return {
                index: i,
                date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
                dow: i === 0 ? 'Auj.' : DAY_NAMES[d.getDay()],
                dd: pad(d.getDate()),
                month: MSHORT[d.getMonth()],
                today: i === 0,
            };
        });
    });

    const selectedDay = computed(() => days.value[dayIndex.value] ?? days.value[0]);

    // Films de la liste actuellement en salle, dans l'ordre du rail.
    const films = computed(() => cinemaNow.value);

    // Films qu'on n'a pas su rapprocher d'une fiche Allociné : affichés grisés plutôt que
    // silencieusement absents (on ne veut pas laisser croire qu'ils n'ont aucune séance).
    const unresolved = computed(() =>
        films.value.filter(m => !m.allocine_id && m.allocine_checked_at)
    );

    // --- chargement ---

    // Résout les identifiants Allociné manquants et les persiste. Même discipline que
    // `recheckUpcomingCinema` : pool borné, un seul réassign de `movies.value` à la fin.
    const resolveMissingIds = async () => {
        const staleBefore = Date.now() - RESOLVE_RETRY_MS;
        const toResolve = films.value.filter(m =>
            !m.allocine_id &&
            m.title &&
            (!m.allocine_checked_at || Date.parse(m.allocine_checked_at) < staleBefore)
        );
        if (!toResolve.length) return;

        const checkedAt = new Date().toISOString();
        const patches = new Map();

        await promisePool(toResolve.map(movie => async () => {
            try {
                const { allocine_id, unavailable } = await $fetch('/api/allocine/resolve', {
                    query: {
                        title: movie.title,
                        release_date: movie.release_date || '',
                        // Départage les homonymes (remakes, re-sorties) plus sûrement que la date.
                        director: movie.director || '',
                    },
                });

                // ⚠️ Allociné injoignable ≠ film introuvable. Horodater dans ce cas épinglerait le
                // film comme « pas chez Allociné » pendant une semaine pour un simple hoquet réseau.
                // On ne touche à rien : la prochaine ouverture de la vue réessaiera.
                if (unavailable) return;

                // Un « pas trouvé » avéré, lui, est horodaté : sans ça on relancerait une recherche
                // à chaque ouverture pour un film qui n'est tout simplement pas au catalogue.
                const patch = { allocine_id: allocine_id ?? null, allocine_checked_at: checkedAt };
                await client.from('calendar').update(patch).eq('id', movie.id);
                patches.set(movie.id, patch);
            } catch (e) {
                console.error('Résolution Allociné échouée pour', movie.title, e);
            }
        }), RESOLVE_CONCURRENCY);

        if (!patches.size) return;
        movies.value = movies.value.map(m => {
            const patch = patches.get(m.id);
            return patch ? { ...m, ...patch } : m;
        });
    };

    // Référentiel des salles : une lecture par session, il ne bouge qu'au rythme du seed carte
    // et du script de géocodage.
    const loadCinemas = async () => {
        if (cinemas.value) return;
        const COLUMNS = 'code, name, arrondissement, accepts_ugc, transit_minutes';

        let { data, error: dbError } = await client.from('cinemas').select(`${COLUMNS}, favorite`);

        // Repli si `favorite` n'existe pas encore en base : le code peut être déployé avant que la
        // migration soit jouée, et sans ce filet **tout** le référentiel devient illisible — donc
        // plus d'`accepts_ugc`, donc une page vide alors que le pré-filtre carte est actif par
        // défaut. Une salle sans favori vaut mieux qu'un écran blanc. À retirer une fois la
        // migration passée partout.
        if (dbError?.code === '42703') {
            console.warn('[seances] Colonne `favorite` absente — joue _ressources/sql/2608121820-add-cinema-favorite.sql pour activer les cinémas favoris.');
            ({ data, error: dbError } = await client.from('cinemas').select(COLUMNS));
        }

        if (dbError) {
            console.error('Référentiel cinemas illisible:', dbError.message);
            cinemas.value = {};
            return;
        }
        cinemas.value = Object.fromEntries((data ?? []).map(c => [c.code, c]));
    };

    // Séances du jour, pour les seuls films résolus et pas déjà en cache L1.
    //
    // Deux temps volontairement séparés : une lecture **groupée** du cache (1 requête pour tout le
    // jour), puis un rafraîchissement film par film pour ce qui manque seulement. Le cas courant
    // — cache plein — se règle donc en un seul aller-retour au lieu d'un par film ; le cas froid
    // garde l'éventail ici, où chaque appel reste court et indépendant plutôt que de sérialiser une
    // journée entière dans une seule fonction serveur.
    const loadDay = async (date) => {
        const pending = films.value.filter(m => m.allocine_id && !payloads.value[`${m.allocine_id}:${date}`]);
        if (!pending.length) return;

        const ids = [...new Set(pending.map(m => m.allocine_id))];
        const fetched = {};
        let toRefresh = ids;

        try {
            const { movies, missing } = await $fetch('/api/allocine/showtimes', {
                query: { ids: ids.join(','), date },
            });
            for (const [id, payload] of Object.entries(movies ?? {})) fetched[`${id}:${date}`] = payload;
            toRefresh = missing ?? [];
        } catch (e) {
            // Cache illisible : on ne renonce pas, tout part au rafraîchissement.
            console.error('Lecture groupée des séances échouée', e);
        }

        let failures = 0;
        if (toRefresh.length) {
            await promisePool(toRefresh.map(id => async () => {
                try {
                    const payload = await $fetch('/api/allocine/refresh', { query: { id, date } });

                    // ⚠️ `refresh` ne throw pas quand Allociné est injoignable : il répond 200 avec
                    // `{ theaters: [], error: true }`. Sans ce test, le `catch` ne se déclenchait
                    // jamais et une panne réseau s'affichait comme « aucune séance pour ces
                    // critères » — le pire des messages, puisqu'il désigne les filtres. Le payload
                    // en échec n'entre pas non plus en cache L1, sans quoi aucun nouvel essai
                    // n'aurait lieu avant la fin de la session.
                    if (payload?.error) {
                        failures++;
                        return;
                    }
                    fetched[`${id}:${date}`] = payload;
                } catch (e) {
                    failures++;
                    console.error('Séances indisponibles pour le film', id, e);
                }
            }), SHOWTIMES_CONCURRENCY);
        }

        // Un seul réassign : le L1 est lu par tous les `computed` en aval.
        if (Object.keys(fetched).length) payloads.value = { ...payloads.value, ...fetched };
        // Un seul film en échec sur douze ne justifie pas d'effacer la page : on n'annonce l'erreur
        // que si le jour est intégralement perdu.
        if (failures && failures === ids.length) error.value = 'Impossible de récupérer les séances.';
    };

    const load = async () => {
        loading.value = true;
        error.value = null;
        try {
            await Promise.all([loadCinemas(), resolveMissingIds()]);
            await loadDay(selectedDay.value.date);
        } finally {
            loading.value = false;
        }
    };

    // Réessai après échec réseau : on purge le L1 du jour pour forcer un nouvel appel (le L2
    // décidera de son côté s'il retape Allociné ou s'il ressert du périmé).
    const retry = async () => {
        const date = selectedDay.value.date;
        const kept = Object.fromEntries(
            Object.entries(payloads.value).filter(([key]) => !key.endsWith(`:${date}`))
        );
        payloads.value = kept;
        await load();
    };

    const selectDay = async (index) => {
        dayIndex.value = index;
        openCard.value = null;
        await load();
    };

    // Épingle / désépingle une salle. Bascule optimiste : le tri se réordonne immédiatement, et on
    // revient en arrière si l'écriture échoue — sur un simple clic d'étoile, attendre l'aller-retour
    // réseau pour voir la carte bouger serait pénible.
    const toggleFavorite = async (code) => {
        const current = cinemas.value?.[code];
        if (!current) return;

        const next = !current.favorite;
        cinemas.value = { ...cinemas.value, [code]: { ...current, favorite: next } };

        const { error: dbError } = await client
            .from('cinemas')
            .update({ favorite: next, updated_at: new Date().toISOString() })
            .eq('code', code);

        if (dbError) {
            console.error('Bascule favori échouée pour', code, dbError.message);
            cinemas.value = { ...cinemas.value, [code]: { ...current } };
        }
    };

    // --- dérivés ---

    // Une entrée = un couple (film, salle) pour le jour sélectionné, avec ses horaires bruts.
    // C'est la granularité commune aux deux regroupements.
    const entries = computed(() => {
        const date = selectedDay.value.date;
        const referential = cinemas.value ?? {};
        const out = [];

        for (const movie of films.value) {
            const payload = movie.allocine_id ? payloads.value[`${movie.allocine_id}:${date}`] : null;
            if (!payload) continue;

            for (const theater of payload.theaters ?? []) {
                const known = referential[theater.code] ?? {};
                const arr = known.arrondissement ?? arrondissementFromZip(theater.zip);

                out.push({
                    movie,
                    cinema: {
                        code: theater.code,
                        name: theater.name,
                        zip: theater.zip,
                        circuit: theater.circuit,
                        arrondissement: arr,
                        acceptsUgc: known.accepts_ugc === true,
                        // Trajet porte-à-porte, pré-calculé côté serveur : le domicile ne bougeant
                        // pas, c'est une constante par salle. Rien à calculer ici, et surtout
                        // aucune coordonnée personnelle à exposer au navigateur.
                        transitMinutes: known.transit_minutes ?? null,
                        favorite: known.favorite === true,
                    },
                    showtimes: theater.showtimes ?? [],
                });
            }
        }

        return out;
    });

    // Filtres — purement dérivés, aucun fetch. Le filtre carte agit à deux niveaux : la salle
    // (référentiel curé) et la séance (cf. `isCardEligible`).
    // `card` est paramétrable pour pouvoir répondre à « et si j'ouvrais à tout Paris ? » sans
    // dupliquer la chaîne de filtres.
    const applyFilters = (list, card) => {
        const arr = arrondissement.value;
        const ver = version.value;

        return list
            .filter(entry => !card || entry.cinema.acceptsUgc)
            .filter(entry => arr === 'all' || entry.cinema.arrondissement === Number(arr))
            .map(entry => ({
                ...entry,
                showtimes: entry.showtimes
                    .filter(s => ver === 'all' || s.version === ver)
                    .filter(s => !card || isCardEligible(s)),
            }))
            .filter(entry => entry.showtimes.length);
    };

    const filtered = computed(() => applyFilters(entries.value, ugcOnly.value));

    const countShowtimes = (list) => list.reduce((n, e) => n + e.showtimes.length, 0);

    // Ordre entre deux salles : les favorites d'abord, puis l'arrondissement, puis le nom.
    // Un seul comparateur pour les deux regroupements — c'est la même intention (« mes salles
    // d'abord »), vue par un bout ou par l'autre, et la dupliquer les ferait diverger.
    const byFavoriteThenPlace = (a, b) =>
        (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0)
        || (a.arrondissement ?? 99) - (b.arrondissement ?? 99)
        || String(a.name).localeCompare(String(b.name));

    // Regroupement « Par film » : l'ordre des films suit le rail, les salles remontent selon le
    // même ordre — une salle favorite se trouve donc en haut de chaque film.
    const byFilm = computed(() => {
        const buckets = new Map();
        for (const entry of filtered.value) {
            if (!buckets.has(entry.movie.id)) buckets.set(entry.movie.id, { key: `f${entry.movie.id}`, movie: entry.movie, entries: [] });
            buckets.get(entry.movie.id).entries.push(entry);
        }
        return [...buckets.values()].map(bucket => ({
            ...bucket,
            entries: bucket.entries.sort((a, b) => byFavoriteThenPlace(a.cinema, b.cinema)),
            nbSeances: countShowtimes(bucket.entries),
        }));
    });

    // Regroupement « Par cinéma » : favoris en tête, puis arrondissement croissant.
    const byCinema = computed(() => {
        const buckets = new Map();
        for (const entry of filtered.value) {
            if (!buckets.has(entry.cinema.code)) buckets.set(entry.cinema.code, { key: `c${entry.cinema.code}`, cinema: entry.cinema, entries: [] });
            buckets.get(entry.cinema.code).entries.push(entry);
        }
        return [...buckets.values()]
            .map(bucket => ({ ...bucket, nbSeances: countShowtimes(bucket.entries) }))
            .sort((a, b) => byFavoriteThenPlace(a.cinema, b.cinema));
    });

    const nbFilms = computed(() => byFilm.value.length);
    const nbSeances = computed(() => countShowtimes(filtered.value));

    // Ce que le pré-filtre carte masque, à filtres égaux par ailleurs. Sert à distinguer
    // « il n'y a rien ce jour-là » de « c'est le filtre carte qui a tout mangé » — sans quoi
    // l'écran vide se lit comme un bug plutôt que comme un filtre.
    const hiddenByCard = computed(() =>
        ugcOnly.value ? countShowtimes(applyFilters(entries.value, false)) - nbSeances.value : 0
    );

    // Arrondissements réellement présents ce jour-là, hors filtre d'arrondissement lui-même
    // (sinon sélectionner le 6e viderait la liste et on ne pourrait plus en sortir).
    const arrondissements = computed(() => {
        const present = new Set();
        for (const entry of entries.value) {
            if (ugcOnly.value && !entry.cinema.acceptsUgc) continue;
            if (entry.cinema.arrondissement) present.add(entry.cinema.arrondissement);
        }
        return [...present].sort((a, b) => a - b);
    });

    // Payloads servis depuis une entrée périmée (Allociné injoignable au dernier rafraîchissement).
    const stale = computed(() => {
        const date = selectedDay.value.date;
        return films.value.some(m => m.allocine_id && payloads.value[`${m.allocine_id}:${date}`]?.stale);
    });

    // Prochaine date avec des séances, quand le jour sélectionné est vide. On prend la plus proche
    // annoncée par Allociné parmi les films de la liste.
    const nextDate = computed(() => {
        const date = selectedDay.value.date;
        const dates = films.value
            .map(m => m.allocine_id && payloads.value[`${m.allocine_id}:${date}`]?.nextDate)
            .filter(Boolean)
            .sort();
        return dates[0] ?? null;
    });

    // Heure du dernier rafraîchissement effectif, pour la ligne de provenance.
    const updatedAt = computed(() => {
        const date = selectedDay.value.date;
        const stamps = films.value
            .map(m => m.allocine_id && payloads.value[`${m.allocine_id}:${date}`]?.fetchedAt)
            .filter(Boolean)
            .sort();
        if (!stamps.length) return null;
        const d = new Date(stamps[stamps.length - 1]);
        return isNaN(d) ? null : `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    });

    return {
        // état
        days, dayIndex, selectedDay, group, version, arrondissement, ugcOnly, openCard,
        loading, error, stale,
        // données
        films, unresolved, byFilm, byCinema, nbFilms, nbSeances, hiddenByCard,
        arrondissements, nextDate, updatedAt,
        // actions
        load, retry, selectDay, toggleFavorite,
    };
}
