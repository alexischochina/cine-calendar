// Client Allociné — source unique de vérité du format, sur le modèle de `tmdbDates.js`.
// Tout ce que le reste du projet sait d'Allociné est confiné ici : si la route interne change de
// nom ou de forme, c'est le seul fichier à re-diagnostiquer.
//
// Deux endpoints, deux usages :
//   - `/_/autocomplete/{titre}`  → recherche interne, résout un titre TMDB en identifiant Allociné.
//   - `/_/showtimes/movie-…`     → séances d'un film à une date, autour de Paris.
//
// ⚠️ `robots.txt` d'Allociné porte `Disallow: /_/`. Les deux sont donc hors-crawl selon leur
// politique déclarée. Les voies conformes ont été explorées et ne tiennent pas (la page publique
// `/seance/film-{id}/` ne rend aucune séance côté serveur, la page par salle en rend une seule
// journée et exigerait 300–600 requêtes par jour affiché contre ~20 ici ; l'index HTML
// `/film/aucinema/`, lui, ignore purement et simplement l'art et essai — cf. `resolveAllocineId`).
// Compromis assumé pour une app mono-utilisateur, en lecture, à volume dérisoire et adossée à un
// cache durable : User-Agent honnête et identifiable, timeout dur, concurrence bornée, aucun
// contournement anti-bot. Précédent maison de même nature : `server/api/movies/[id]/letterboxd.js`.

// Identifiant de localisation « Paris » chez Allociné. ⚠️ Il ratisse Paris **+ toute la couronne**
// (mesuré : 73 salles dont 22 seulement en 75xxx sur un blockbuster) → le filtre sur le code
// postal plus bas n'est pas cosmétique.
export const PARIS_LOCALIZATION = 115755;

const ALLOCINE_ORIGIN = 'https://www.allocine.fr';
const USER_AGENT = 'Mozilla/5.0 (compatible; cine-calendar/1.0)';
const TIMEOUT = 8000;
const SHOWTIME_CONCURRENCY = 4;

// En dessous, on considère que le moteur nous a rendu autre chose que le film demandé. Seuil bas à
// dessein : le rapprochement se joue entre deux rédactions différentes (« Chronique » / « Chroniques »,
// casse, ponctuation), et un titre inexistant ne remonte de toute façon aucun film.
const MIN_TITLE_SIMILARITY = 0.6;

const DAY = 24 * 60 * 60 * 1000;

// Forme de comparaison d'un titre : accents dépliés, apostrophes unifiées, tout ce qui n'est pas
// alphanumérique réduit à un espace. Agressif à dessein.
export const normalizeTitle = (str) => String(str ?? '')
    .replace(/[‘’ʼ`]/g, "'")
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

// Part des mots communs entre deux titres, rapportée au plus long des deux. Tolère l'écart de
// rédaction sans laisser passer un titre voisin mais différent.
const titleSimilarity = (a, b) => {
    const left = new Set(normalizeTitle(a).split(' ').filter(Boolean));
    const right = new Set(normalizeTitle(b).split(' ').filter(Boolean));
    if (!left.size || !right.size) return 0;

    let shared = 0;
    for (const word of left) if (right.has(word)) shared++;
    return shared / Math.max(left.size, right.size);
};

// Moteur de recherche interne d'Allociné. C'est lui qui fait le travail flou (pluriels, casse,
// diacritiques) ; on ne fait que trancher entre ses candidats.
//
// ⚠️ Renvoie `null` quand la recherche est **injoignable**, et `[]` quand elle répond sans résultat.
// Confondre les deux avait une conséquence coûteuse : l'appelant horodate `allocine_checked_at` sur
// un « pas trouvé » pour ne pas s'acharner, ce qui épinglait un film comme introuvable **pendant
// 7 jours** alors qu'Allociné avait simplement eu un hoquet pendant l'unique requête.
const fetchAutocomplete = async (query) => {
    const url = `${ALLOCINE_ORIGIN}/_/autocomplete/${encodeURIComponent(query)}`;

    try {
        const payload = await $fetch(url, {
            headers: { 'User-Agent': USER_AGENT },
            signal: AbortSignal.timeout(TIMEOUT),
            responseType: 'json',
        });
        return Array.isArray(payload?.results) ? payload.results : [];
    } catch (e) {
        console.error('[allocine] Recherche échouée', url, e?.message ?? e);
        return null;
    }
};

// Titre TMDB → identifiant Allociné. Aucun identifiant croisé n'existe entre les deux catalogues :
// on passe par le titre, avec la date de sortie FR et le réalisateur (tous deux déjà en base) comme
// départage.
//
// ⚠️ Historique : la première version parcourait `/film/aucinema/` (14 pages de HTML) et exigeait un
// titre normalisé **identique**. Elle laissait deux trous constatés — les films d'art et essai n'y
// figurent pas du tout (`Silent Friend`, à l'affiche aux 3 Luxembourg, était absent des 210 titres),
// et le moindre écart de rédaction faisait échouer le match (« Chronique » vs « Chroniques du
// Caire »). La recherche interne couvre le catalogue entier pour **une** requête au lieu de 14, sans
// parsing HTML — donc sans la pièce la plus fragile du client.
// Renvoie `{ allocineId, unavailable }`. `unavailable` distingue « Allociné n'a pas répondu » de
// « Allociné a répondu, ce film n'existe pas chez eux » — seul le second justifie que l'appelant
// arrête de réessayer.
export const resolveAllocineId = async ({ title, releaseDate, director }) => {
    if (!title) return { allocineId: null, unavailable: false };

    const results = await fetchAutocomplete(title);
    if (results === null) return { allocineId: null, unavailable: true };

    const movies = results.filter(r => r?.entity_type === 'movie' && r.entity_id);
    if (!movies.length) return { allocineId: null, unavailable: false };

    const reference = /^\d{4}-\d{2}-\d{2}$/.test(String(releaseDate ?? '')) ? Date.parse(releaseDate) : null;

    const candidates = movies
        .map((movie) => {
            // `label` = titre FR, `original_label` = titre d'origine. Selon le film, c'est l'un ou
            // l'autre que TMDB nous a donné.
            const similarity = Math.max(
                titleSimilarity(title, movie.label),
                titleSimilarity(title, movie.original_label),
            );
            const released = movie.data?.first_release ?? movie.last_release ?? null;

            return {
                id: Number(movie.entity_id),
                similarity,
                // Départage le plus fiable quand deux films portent le même titre (remakes,
                // re-sorties) : le réalisateur, puis l'écart de date de sortie.
                sameDirector: Boolean(director) && (movie.data?.director_name ?? [])
                    .some(name => normalizeTitle(name) === normalizeTitle(director)),
                gap: (reference !== null && released) ? Math.abs(Date.parse(released) - reference) / DAY : Infinity,
            };
        })
        .filter(candidate => candidate.similarity >= MIN_TITLE_SIMILARITY && Number.isFinite(candidate.id))
        .sort((a, b) =>
            (b.sameDirector ? 1 : 0) - (a.sameDirector ? 1 : 0)
            || b.similarity - a.similarity
            || a.gap - b.gap);

    return { allocineId: candidates[0]?.id ?? null, unavailable: false };
};

// ⚠️ `d-` prend une **date ISO** (`d-2026-08-14`). Les offsets numériques (`d-1`, `d-2`) sont
// acceptés mais renvoient tous *aujourd'hui* — piège silencieux, ne jamais les utiliser.
export const fetchShowtimesPage = async (allocineId, date, page = 1) => {
    const url = `${ALLOCINE_ORIGIN}/_/showtimes/movie-${allocineId}/near-${PARIS_LOCALIZATION}/d-${date}/p-${page}/`;

    try {
        return await $fetch(url, {
            headers: { 'User-Agent': USER_AGENT },
            signal: AbortSignal.timeout(TIMEOUT),
            responseType: 'json',
        });
    } catch (e) {
        console.error('[allocine] Séances indisponibles', url, e?.message ?? e);
        return null;
    }
};

// Première URL de billetterie exploitable. Les `relay.mvtx.us` (provider `relay`) sont des
// redirections internes Allociné, pas la billetterie de l'exploitant : on veut le lien direct.
//
// ⚠️ Le schéma est validé **ici**, à l'entrée, et pas au moment de rendre le lien : cette URL vient
// d'un tiers et finit dans un `href`. Vue ne filtre pas les schémas — un `javascript:` dans le
// payload s'exécuterait au clic. Le projet a déjà ce réflexe sur les chemins d'affiche TMDB
// (`posterUrl` dans `app/utils/movieHelpers.js`) ; on le tient au même endroit que le reste de
// l'interprétation du format.
const SAFE_SCHEMES = ['http:', 'https:'];

const safeUrl = (value) => {
    if (typeof value !== 'string' || !value) return null;
    try {
        return SAFE_SCHEMES.includes(new URL(value).protocol) ? value : null;
    } catch {
        return null;
    }
};

const pickBooking = (ticketing) => {
    if (!Array.isArray(ticketing)) return null;

    for (const entry of ticketing) {
        if (entry?.provider === 'relay' || !Array.isArray(entry?.urls)) continue;
        const url = entry.urls.map(safeUrl).find(Boolean);
        if (url) return url;
    }
    return null;
};

const normalizeShowtime = (showtime) => {
    const startsAt = showtime?.startsAt;
    if (typeof startsAt !== 'string' || startsAt.length < 16) return null;

    const tags = Array.isArray(showtime.tags) ? showtime.tags : [];

    return {
        startsAt,
        // ⚠️ `startsAt` est en heure locale **sans offset** (`2026-08-14T10:00:00`). Un `new Date()`
        // le réinterpréterait selon le fuseau du serveur : on découpe la chaîne, point.
        time: startsAt.slice(11, 16),
        // La version se lit sur la séance, pas sur le nom du bucket : un même bucket mélange
        // les deux. `LOCAL` = film français projeté en français → VF.
        version: showtime.diffusionVersion === 'ORIGINAL' ? 'VO' : 'VF',
        subtitled: tags.includes('Localization.Subtitle.French'),
        accessible: tags.includes('Showtime.Accessibility.Accessible'),
        // ⚠️ `isPreview` n'est pas systématiquement présent dans le payload (absent sur les films
        // sondés le 12/08/2026). On le lit s'il est là, avec un repli sur les tags, et on considère
        // « pas une avant-première » par défaut plutôt que d'exclure à tort.
        isPreview: showtime.isPreview === true || tags.some(t => /preview|avantpremiere/i.test(String(t).replace(/[^a-z]/gi, ''))),
        projection: Array.isArray(showtime.projection) ? showtime.projection : [],
        booking: pickBooking(showtime.data?.ticketing),
    };
};

// Séances d'un film à une date, restreintes à Paris intra-muros, dans la forme que consomme le
// front (et que met en cache `showtimes_cache`).
//
// Coût : 15 salles/page → 1 page pour un film d'art et essai, jusqu'à 6 pour un blockbuster.
// `totalPages` est connu après la page 1, le reste part en parallèle (borné à 4).
// N'échoue jamais : réseau coupé ou format changé → `{ theaters: [] }`, jamais de throw.
//
// `ok` distingue les deux vides qui se ressemblent : « Allociné a répondu, il n'y a aucune séance
// ce jour-là » (`ok: true`) et « on n'a pas pu joindre Allociné » (`ok: false`). Sans ce drapeau, la
// route de cache mettrait un échec réseau en cache comme une journée sans séance.
export const fetchParisShowtimes = async (allocineId, date) => {
    const first = await fetchShowtimesPage(allocineId, date, 1);

    // Aucune réponse du tout : c'est là, et seulement là, qu'on n'a pas joint Allociné.
    if (!first) return { ok: false, nextDate: null, theaters: [] };

    // ⚠️ `error: true` n'est PAS une panne : c'est ainsi qu'Allociné annonce « aucune séance à cette
    // date » (`message: "next.showtime.on"`), et il livre alors un `nextDate` exploitable. Le
    // confondre avec un échec réseau aurait deux conséquences, toutes deux constatées :
    // la journée vide n'est jamais mise en cache (on retape Allociné à chaque affichage), et le
    // `nextDate` est jeté — donc le message « prochaine séance le … » ne se déclenche jamais.
    if (first.error) return { ok: true, nextDate: first.nextDate ?? null, theaters: [] };

    const totalPages = Number(first.pagination?.totalPages) || 1;
    const rest = totalPages > 1
        ? await promisePool(
            Array.from({ length: totalPages - 1 }, (_, i) => () => fetchShowtimesPage(allocineId, date, i + 2)),
            SHOWTIME_CONCURRENCY,
        )
        : [];

    const results = [first, ...rest].filter(Boolean).flatMap(payload => payload.results ?? []);

    // Une salle ne devrait apparaître que sur une page, mais on fusionne par code pour rester
    // correct si Allociné répète une entrée entre deux pages.
    const byCode = new Map();

    for (const result of results) {
        const theater = result?.theater;
        const zip = theater?.location?.zip;
        // Paris intra-muros uniquement : la localisation Allociné ratisse toute la couronne.
        if (!theater?.internalId || !/^75/.test(String(zip ?? ''))) continue;

        // Les 6 buckets (`original`, `original_st`, `multiple`… ) ne sont pas des doublons : ils
        // portent des horaires distincts. On les aplatit et on relit la version sur la séance.
        const showtimes = Object.values(result.showtimes ?? {})
            .flat()
            .map(normalizeShowtime)
            .filter(Boolean);

        const existing = byCode.get(theater.internalId);
        if (existing) {
            existing.showtimes.push(...showtimes);
            continue;
        }

        byCode.set(theater.internalId, {
            code: theater.internalId,
            name: theater.name ?? null,
            address: theater.location?.address ?? null,
            zip: zip ?? null,
            circuit: theater.theaterCircuits?.name ?? null,
            // Ce qu'Allociné annonce sur la carte UGC Illimité. ⚠️ Sert **uniquement** de valeur par
            // défaut à la création d'une salle dans le référentiel, jamais à mettre à jour une ligne
            // existante : la liste reste curée à la main (Allociné a déjà été pris en défaut dessus).
            // Sans ce défaut, toute salle découverte après le seed entrait à `false` et disparaissait
            // silencieusement de la vue filtrée — constaté sur Les 3 Luxembourg.
            ugcCard: (theater.loyaltyCards ?? []).includes('UGC_ILLIMITE'),
            showtimes,
        });
    }

    const theaters = [...byCode.values()]
        .filter(t => t.showtimes.length)
        .map(t => ({ ...t, showtimes: t.showtimes.sort((a, b) => a.startsAt.localeCompare(b.startsAt)) }))
        .sort((a, b) => String(a.zip).localeCompare(String(b.zip)) || String(a.name).localeCompare(String(b.name)));

    return {
        ok: true,
        // Prochaine date avec des séances quand il n'y en a aucune ce jour-là — sert au message
        // « prochaine séance le … » plutôt qu'un vide sec.
        nextDate: first.nextDate ?? null,
        theaters,
    };
};
