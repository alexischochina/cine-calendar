// Client Allociné — source unique de vérité du format. Si la route interne change de nom ou de
// forme, c'est le seul fichier à re-diagnostiquer.
//
// Deux endpoints, deux usages :
//   - `/_/autocomplete/{titre}`  → recherche interne, résout un titre TMDB en identifiant Allociné.
//   - `/_/showtimes/movie-…`     → séances d'un film à une date, autour de Paris.
//
// ⚠️ `robots.txt` d'Allociné porte `Disallow: /_/` : les deux routes sont hors-crawl selon leur
// politique déclarée. Les voies conformes ont été explorées et ne tiennent pas (détail et mesures dans
// le README). Compromis assumé pour une app mono-utilisateur, en lecture, à volume dérisoire et adossée
// à un cache durable : User-Agent honnête, timeout dur, concurrence bornée, aucun contournement
// anti-bot.

// Identifiant de localisation « Paris » chez Allociné. ⚠️ Il ratisse Paris **+ toute la couronne**
// (mesuré : 73 salles dont 22 seulement en 75xxx sur un blockbuster) → le filtre sur le code
// postal plus bas n'est pas cosmétique.
export const PARIS_LOCALIZATION = 115755;

const ALLOCINE_ORIGIN = 'https://www.allocine.fr';
// ⚠️ User-Agent **honnête** : ni préfixe `Mozilla/5.0`, ni chaîne de navigateur. Le compromis décrit
// plus haut ne tient que si l'on est identifiable — se présenter comme un navigateur serait la
// première brique d'un contournement, et n'apporte rien : les quatre sources du projet (Allociné,
// UGC, Dulac, MK2) répondent exactement pareil avec ou sans (vérifié le 15/08/2026, même statut et
// même charge utile à l'octet près).
const USER_AGENT = 'cine-calendar/1.0';
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
// Renvoie `{ allocineId, unavailable }`. ⚠️ `unavailable` distingue « Allociné n'a pas répondu » de
// « ce film n'existe pas chez eux » : seul le second justifie que l'appelant arrête de réessayer.
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

const fetchJson = async (url, what) => {
    try {
        return await $fetch(url, {
            headers: { 'User-Agent': USER_AGENT },
            signal: AbortSignal.timeout(TIMEOUT),
            responseType: 'json',
        });
    } catch (e) {
        console.error(`[allocine] ${what} indisponible`, url, e?.message ?? e);
        return null;
    }
};

// ⚠️ `d-` prend une **date ISO** (`d-2026-08-14`). Les offsets numériques (`d-1`, `d-2`) sont
// acceptés mais renvoient tous *aujourd'hui* — piège silencieux, ne jamais les utiliser.
export const fetchShowtimesPage = (allocineId, date, page = 1) =>
    fetchJson(
        `${ALLOCINE_ORIGIN}/_/showtimes/movie-${allocineId}/near-${PARIS_LOCALIZATION}/d-${date}/p-${page}/`,
        'Séances',
    );

const fetchTheaterPage = (code, date, page = 1) =>
    fetchJson(`${ALLOCINE_ORIGIN}/_/showtimes/theater-${code}/d-${date}/p-${page}/`, 'Séances de salle');

// Séances événement d'une **salle** pour une date, indexées par `internalId`. Seul endpoint à porter
// les champs d'événement (cf. l'encadré « Deux endpoints, deux jeux de champs »).
//
// ⚠️⚠️ CET ENDPOINT EST CREUX — mesuré : `theater-C0159` rendait 1 jour sur 7 là où l'endpoint film en
// rendait 6. Une réponse vide veut le plus souvent dire « rien à dire de cette journée », pas « aucun
// événement ». D'où `seen` : les `internalId` réellement observés, seule preuve permettant de se
// prononcer. On résout **par séance** et non par salle, une salle à moitié rendue étant le cas courant.
//
// `previews` voyage à part parce que c'est la seule qualification qui décide quelque chose en aval
// (`isCardEligible`).
//
// N'échoue jamais : `ok: false` = « on n'a pas joint Allociné », sans quoi la route de cache graverait
// une panne réseau comme une journée sans événement.
export const fetchTheaterEvents = async (code, date) => {
    const first = await fetchTheaterPage(code, date, 1);
    if (!first) return { ok: false, events: {}, seen: [], previews: [] };

    // `error: true` = « aucune séance à cette date » chez Allociné (cf. `fetchParisShowtimes`), pas
    // une panne. Ici, c'est aussi la forme que prend le creux : `seen` reste vide, donc l'appelant ne
    // se prononcera sur aucune séance — la journée est mise en cache sans rien affirmer.
    if (first.error) return { ok: true, events: {}, seen: [], previews: [] };

    const totalPages = Number(first.pagination?.totalPages) || 1;
    const rest = totalPages > 1
        ? await promisePool(
            Array.from({ length: totalPages - 1 }, (_, i) => () => fetchTheaterPage(code, date, i + 2)),
            SHOWTIME_CONCURRENCY,
        )
        : [];

    // Même prudence que sur les séances : une page perdue, ce sont des films entiers évanouis sans le
    // moindre signal. L'appelant a besoin de le savoir pour ne pas graver le trou dans le cache.
    const missedPages = rest.filter(page => !page).length;
    if (missedPages) console.error(`[allocine] ${missedPages}/${totalPages} page(s) perdues pour la salle ${code} au ${date}`);

    const events = {};
    const seen = new Set();
    const previews = new Set();

    for (const result of [first, ...rest].filter(Boolean)) {
        for (const entry of result.results ?? []) {
            for (const bucket of Object.values(entry.showtimes ?? {})) {
                for (const showtime of bucket ?? []) {
                    const id = showtime?.internalId;
                    if (id == null) continue;

                    seen.add(id);
                    const tags = Array.isArray(showtime.tags) ? showtime.tags : [];

                    if (isPreviewShowtime(showtime, tags)) previews.add(id);

                    const labels = showtimeEventLabels(showtime, tags);
                    if (labels.length) events[id] = labels;
                }
            }
        }
    }

    return { ok: true, partial: missedPages > 0, events, seen: [...seen], previews: [...previews] };
};

// Première URL de billetterie exploitable. Les `relay.mvtx.us` (provider `relay`) sont des
// redirections internes Allociné, pas la billetterie de l'exploitant : on veut le lien direct.
//
// ⚠️ Le schéma est validé **ici**, à l'entrée : cette URL vient d'un tiers et finit dans un `href`.
// Vue ne filtre pas les schémas — un `javascript:` dans le payload s'exécuterait au clic.
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

// --- Séances événement --------------------------------------------------------------------------
//
// ⚠️ Allociné ne livre **aucun texte libre** décrivant l'événement. Relevé le 14/08/2026 sur
// 2 293 séances de 49 salles parisiennes réparties sur 7 jours : pas de champ `comment`, pas de
// `title`, rien qui ressemble à « En présence de l'équipe du film ». Ce qu'on peut afficher est donc
// borné par un **vocabulaire fermé**, et c'est lui qu'on traduit ici — inutile de chercher mieux
// ailleurs dans le payload, il n'y a rien.
//
// ⚠️⚠️ DEUX ENDPOINTS, DEUX JEUX DE CHAMPS — le piège central de ce fichier. À `internalId` égal, le
// même `Showtime` ne porte les champs d'événement que sur la route **par salle** ; la route par film,
// celle qui sert les horaires, ne les porte pas. Conséquence : appelée depuis `normalizeShowtime`
// (chemin film), cette fonction rend `[]` ; ce sont `fetchTheaterEvents` et la seconde passe qui
// posent les libellés. Mesures et coût : `_ressources/README-seances.md`.
//
// La table reste **côté serveur** — l'app ne compare jamais ces chaînes, elle ne fait que les
// afficher. Ce qu'elle a besoin de *décider* (une avant-première n'est pas couverte par la carte UGC)
// passe par le booléen `isPreview` : un test métier adossé à un texte d'interface se casse au premier
// reformulage, et en silence.
const EVENT_LABELS = {
    'Showtime.Event.Preview': 'Avant-première',
    'Showtime.Event.OnlySession': 'Séance unique',
};

// **Le seul namespace d'événements d'Allociné.** `Showtime.Event.*` est le nom qu'il donne lui-même à
// ce qui qualifie une séance : `Preview`, `OnlySession`. C'est le seul où un membre inconnu peut être
// affiché de confiance.
const EVENT_NAMESPACE = /^Showtime\.Event\./;

// ⚠️⚠️ `BoostPos.XpEtLabels.*` N'EST PAS un namespace d'événements — « expériences **et labels** »
// mélange dispositifs de programmation et identités de salles. Généralisé sur deux exemples, il a
// produit 161 badges de bruit sur 202 (« Artet essai » ×54, des noms de salles ×45…). Liste blanche
// stricte, **sans repli** : un membre inconnu y est ignoré, pas deviné.
//
// Les autres namespaces sont écartés depuis le début (format de copie, version, accessibilité,
// commercial) : tout accepter aurait marqué 1 656 séances sur 2 293.
const PROGRAMME_LABELS = {
    'BoostPos.XpEtLabels.JeunePublic': 'Jeune public',
    'BoostPos.XpEtLabels.LenfanceDeLart': 'L’enfance de l’art',
};

// Signalé une fois par instance, pas une fois par séance : sur un blockbuster le même tag reviendrait
// des dizaines de fois par requête.
const unknownEventTags = new Set();

// Repli quand Allociné élargit son vocabulaire : `Showtime.Event.CineClub` → « Cine club ». Imparfait
// (ni accent, ni trait d'union) mais préférable aux deux alternatives — taire l'événement, ou tout
// coller sous un « Séance événement » générique qui fusionnerait deux événements distincts.
const humanizeEventTag = (tag) => {
    const words = tag.slice(tag.lastIndexOf('.') + 1)
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .toLowerCase();
    return words.charAt(0).toUpperCase() + words.slice(1);
};

// Avant-première ? Deux signaux, pas toujours livrés ensemble : le booléen (5 cas sur le relevé du
// 14/08/2026) et le tag (1 cas, **sans** le booléen). Exporté parce que c'est la seule qualification
// d'événement qui porte une conséquence métier — la carte UGC ne couvre pas les avant-premières — et
// qu'elle voyage donc à part des libellés d'affichage.
export const isPreviewShowtime = (showtime, tags) =>
    showtime?.isPreview === true || (tags ?? []).includes('Showtime.Event.Preview');

// Libellés d'événement d'une séance, dédoublonnés. Un tableau vide signifie « séance ordinaire », et
// c'est l'immense majorité : 6 séances sur 2 293 dans le relevé du 14/08/2026. La rareté est le
// propos — un marqueur qui apparaît partout ne se remarque plus.
export const showtimeEventLabels = (showtime, tags) => {
    const labels = new Set();

    if (isPreviewShowtime(showtime, tags)) labels.add(EVENT_LABELS['Showtime.Event.Preview']);

    for (const tag of tags ?? []) {
        // Label de programmation : liste blanche stricte, **aucun repli**. Cf. l'encadré ci-dessus —
        // c'est le namespace qui a produit « Artet essai » sur 54 séances.
        const programme = PROGRAMME_LABELS[tag];
        if (programme) {
            labels.add(programme);
            continue;
        }

        // Namespace d'événements d'Allociné : là, un membre inconnu est affiché quand même. Taire un
        // événement est pire que l'annoncer imparfaitement — et ce namespace-là ne contient que des
        // événements.
        if (!EVENT_NAMESPACE.test(String(tag))) continue;

        const known = EVENT_LABELS[tag];
        if (known) {
            labels.add(known);
            continue;
        }

        if (!unknownEventTags.has(tag)) {
            unknownEventTags.add(tag);
            console.warn(`[allocine] Tag d'événement inconnu, à ajouter à EVENT_LABELS : ${tag}`);
        }
        labels.add(humanizeEventTag(tag));
    }

    return [...labels];
};

const normalizeShowtime = (showtime) => {
    const startsAt = showtime?.startsAt;
    if (typeof startsAt !== 'string' || startsAt.length < 16) return null;

    const tags = Array.isArray(showtime.tags) ? showtime.tags : [];

    return {
        startsAt,
        // **Clé de jointure** avec la passe par salle : identique sur les deux endpoints (vérifié le
        // 14/08/2026), alors que rien d'autre ne les rapprocherait de façon sûre (une salle peut
        // programmer deux séances à la même heure dans deux salles).
        internalId: showtime.internalId ?? null,
        // ⚠️ `startsAt` est en heure locale **sans offset** (`2026-08-14T10:00:00`). Un `new Date()`
        // le réinterpréterait selon le fuseau du serveur : on découpe la chaîne, point.
        time: startsAt.slice(11, 16),
        // La version se lit sur la séance, pas sur le nom du bucket : un même bucket mélange
        // les deux. `LOCAL` = film français projeté en français → VF.
        version: showtime.diffusionVersion === 'ORIGINAL' ? 'VO' : 'VF',
        subtitled: tags.includes('Localization.Subtitle.French'),
        accessible: tags.includes('Showtime.Accessibility.Accessible'),
        // ⚠️ `isPreview` est **absent de la réponse** sur ce chemin (cf. l'encadré plus haut). On le
        // lit s'il est là, avec un repli sur les tags, et on considère « pas une avant-première » par
        // défaut plutôt que d'exclure à tort.
        isPreview: showtime.isPreview === true || tags.some(t => /preview|avantpremiere/i.test(String(t).replace(/[^a-z]/gi, ''))),
        // Résolus ici : le front ne connaît jamais le vocabulaire de tags d'Allociné.
        events: showtimeEventLabels(showtime, tags),
        projection: Array.isArray(showtime.projection) ? showtime.projection : [],
        booking: pickBooking(showtime.data?.ticketing),
    };
};

// Séances d'un film à une date, restreintes à Paris intra-muros, dans la forme que consomme le front.
// 15 salles/page, `totalPages` connu après la page 1, le reste en parallèle borné.
//
// N'échoue jamais. ⚠️ `ok` distingue les deux vides qui se ressemblent : « aucune séance ce jour-là »
// (`true`) et « on n'a pas joint Allociné » (`false`) — sans lui, la route de cache graverait un échec
// réseau comme une journée sans séance.
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

    // Une page manquante, c'est jusqu'à 15 salles évanouies **sans signal** : le résultat reste bien
    // formé, simplement amputé. L'appelant doit le savoir pour ne pas graver le trou dans le cache.
    const missedPages = rest.filter(page => !page).length;
    if (missedPages) console.error(`[allocine] ${missedPages}/${totalPages} page(s) perdues pour le film ${allocineId} au ${date}`);

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
            // ⚠️ Valeur par défaut **à la création** d'une salle, jamais une mise à jour : la liste
            // reste curée à la main (Allociné a déjà été pris en défaut dessus). Sans ce défaut, une
            // salle découverte après le seed entrait à `false` et disparaissait de la vue filtrée.
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
        // Résultat incomplet : bon à afficher, pas à mettre en cache (cf. `missedPages`).
        partial: missedPages > 0,
        // Prochaine date avec des séances quand il n'y en a aucune ce jour-là — sert au message
        // « prochaine séance le … » plutôt qu'un vide sec.
        nextDate: first.nextDate ?? null,
        theaters,
    };
};
