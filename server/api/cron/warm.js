// Préchauffage du cache de séances :
// `GET /api/cron/warm?scope=near|far|all[&days=2,3]`
//
// Le TTL de `showtimes_cache` est de 2 h (aujourd'hui, demain) et 3 h au-delà : un visiteur qui passe
// deux ou trois fois dans la journée tombe presque toujours sur un cache expiré et paie l'aller-retour
// Allociné avant de voir quoi que ce soit. Cette route fait payer ce coût à une tâche planifiée.
//
// ⚠️ **Ce n'est pas une invitation à relâcher le TTL.** Préchauffer moins souvent n'aurait de sens
// qu'en allongeant `FRESH_NEAR` / `FRESH_FAR` d'autant — le bug documenté en tête de
// `showtimesFreshness.js`. La cadence du cron **suit** le TTL, elle ne le remplace pas.
//
// Cadences et périmètres : `.github/workflows/warm-showtimes.yml`.

import { createHash, timingSafeEqual } from 'node:crypto';
import { serverSupabaseServiceRole } from '#supabase/server';

const HOUR = 60 * 60 * 1000;

// ⚠️ `everyMs` doit rester la cadence réelle du workflow : c'est l'horizon passé à `isShowtimesFresh`.
// Le sous-estimer laisse une fenêtre froide, le surestimer refait des sorties pour rien.
const SCOPES = {
    near: { days: [0, 1], everyMs: 2 * HOUR },
    far: { days: [2, 3, 4, 5, 6], everyMs: 12 * HOUR },
    all: { days: [0, 1, 2, 3, 4, 5, 6], everyMs: 2 * HOUR },
};

const CONCURRENCY = 4;      // borne le volume sortant vers Allociné, comme côté client

// Garde-fou contre un périmètre qui enflerait par bug : on veut un passage tronqué et **bruyant**.
// ⚠️ Par journée traitée et non par passage — un plafond fixe se serait desserré d'autant que le
// workflow découpe `far` en tranches d'une journée.
const MAX_FETCHES_PER_DAY = 60;

// ⚠️ Comparaison des **empreintes** et non des valeurs : `timingSafeEqual` exige des longueurs égales
// et lève sinon, ce qui imposait une sortie anticipée sur la longueur — donc une fuite par le canal
// que cette fonction est censée fermer. Deux SHA-256 font 32 octets, la branche disparaît.
const digest = (value) => createHash('sha256').update(String(value ?? ''), 'utf8').digest();

const secretMatches = (given, expected) => timingSafeEqual(digest(given), digest(expected));

// Date de sortie **effective** : l'override manuel gagne sur la date TMDB. Sans ça, un film redaté à la
// main serait balayé par la vue Événements et jamais préchauffé. La ligne est remaniée comme le fait
// l'app (`effectiveDate` dans `useMovieCalendar`), même paire de champs — deux conventions pour la même
// notion divergeraient au premier partage d'une règle datée.
//
// ⚠️ `manual_release_date` est une colonne `date` : PostgREST rend `"2026-08-12"`, donc `slice` est
// exact. Le jour où elle passerait en `timestamptz`, c'est ici qu'il faudrait convertir en heure
// locale, sinon les sorties du soir se lisent la veille.
const withEffectiveDate = (row) => (row.manual_release_date
    ? { ...row, release_date: String(row.manual_release_date).slice(0, 10), _tmdbReleaseDate: row.release_date ?? null }
    : row);

// Périmètre : les films de la vue Séances, plus les sorties de la semaine encore `unseen` — celles que
// le relevé de la vue Événements balaie sur sept journées (cf. `useEvents`). Règles partagées avec
// elles (`shared/utils/seanceScope.js`), où le sur-ensemble volontaire est expliqué et testé.
//
// ⚠️ `allocine_id` filtré d'abord : la résolution de date tournerait sinon sur les ~440 lignes du
// calendrier pour n'en garder qu'une vingtaine, dix fois par jour.
const scopeFilms = (rows, today, weekStart) => rows
    .filter(m => m.allocine_id)
    .map(withEffectiveDate)
    .filter(m => isSeanceFilm(m, today) || isFreshRelease(m, weekStart, today));

export default defineEventHandler(async (event) => {
    // Avant la garde du secret : un martèlement anonyme finit en 401, mais après avoir réveillé la
    // fonction. 20/min couvre la salve légitime de cinq appels (`far` découpé par journée).
    rateLimit(event, { max: 20 });

    const secret = useRuntimeConfig(event).cronSecret;

    // Fermé par défaut : une route qui sort sur le réseau ne s'ouvre pas faute de configuration.
    if (!secret) {
        console.error('[cron] NUXT_CRON_SECRET absent — préchauffage désactivé.');
        throw createError({ statusCode: 503, statusMessage: 'Cron not configured' });
    }

    const given = String(getRequestHeader(event, 'authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (!secretMatches(given, secret)) {
        throw createError({ statusCode: 401, statusMessage: 'Unauthorized' });
    }

    const { scope = 'near', days } = getQuery(event);
    const plan = SCOPES[String(scope)];
    if (!plan) throw createError({ statusCode: 400, statusMessage: 'Invalid scope' });

    // `days` découpe le périmètre sans toucher à sa cadence : `?scope=far&days=2` garde l'horizon de
    // 12 h. Le workflow s'en sert pour tenir dans la durée maximale d'une fonction.
    // ⚠️ Sous-ensemble strict du périmètre : sinon on préchaufferait des journées hors horizon.
    let offsets = plan.days;
    if (days !== undefined) {
        const wanted = String(days).split(',').map(Number);
        offsets = plan.days.filter(offset => wanted.includes(offset));
        if (!offsets.length) throw createError({ statusCode: 400, statusMessage: 'Invalid days for scope' });
    }

    const startedAt = Date.now();
    const today = isoDay(0);
    const dates = offsets.map(offset => isoDay(offset));

    // Service-role : la tâche n'a pas de session et les RLS de `showtimes_cache` / `cinemas` sont
    // réservées à `authenticated`. Clé lue au runtime, jamais exposée au navigateur.
    const client = serverSupabaseServiceRole(event);

    const { data: rows, error } = await client
        .from('calendar')
        // Strictement ce que lisent `isSeanceFilm` et `isFreshRelease` (dates comprises, cf.
        // `withEffectiveDate`). ⚠️ Lecture de tout le calendrier, rejouée à chaque tranche : une
        // colonne de plus ici se paie dix fois par jour.
        .select('allocine_id, state, events, media, release_date, manual_release_date');

    if (error) {
        console.error('[cron] Lecture du calendrier échouée:', error.message);
        throw createError({ statusCode: 502, statusMessage: 'Calendar unreadable' });
    }

    const films = scopeFilms(rows ?? [], today, lastWednesdayDay());
    const ids = [...new Set(films.map(m => m.allocine_id))];

    if (!ids.length) {
        return { scope, dates, films: 0, refreshed: 0, skipped: 0, failures: 0, truncated: 0, ms: Date.now() - startedAt };
    }

    // La question n'est pas « cette entrée est-elle fraîche ? » mais « tiendra-t-elle jusqu'à mon
    // prochain passage ? ». C'est ce qui attrape les entrées écrites par une visite entre deux crons.
    //
    // ⚠️ Conséquence : la cadence étant calée sur le TTL, **rien n'est jamais sauté**. `skipped` ne
    // bouge que sur un déclenchement manuel rapproché. Prix assumé, pas un réglage à corriger.
    const freshAt = Date.now() + plan.everyMs;

    const work = [];
    for (const date of dates) for (const id of ids) work.push({ id, date });

    // ⚠️ Trié avant d'être tronqué : `work` sort de boucles déterministes, donc trancher dedans tel
    // quel condamnait sa queue à n'être jamais préchauffée, à aucun passage. Classement par ancienneté
    // (jamais relevé d'abord) : ce qui tombe est ce qui vient d'être écrit.
    const { data: known } = await client
        .from('showtimes_cache')
        .select('allocine_id, date, fetched_at')
        .in('allocine_id', ids)
        .in('date', dates);

    const writtenAt = new Map((known ?? []).map(r => [`${r.allocine_id}:${r.date}`, Date.parse(r.fetched_at) || 0]));
    const staleness = ({ id, date }) => writtenAt.get(`${id}:${date}`) ?? -1;   // absent = jamais relevé
    work.sort((a, b) => staleness(a) - staleness(b));

    const budget = MAX_FETCHES_PER_DAY * dates.length;
    const truncated = Math.max(0, work.length - budget);
    if (truncated) console.warn(`[cron] Périmètre ${scope} : ${work.length} couples (film, date) à traiter, plafonné à ${budget} (${MAX_FETCHES_PER_DAY} × ${dates.length} journée(s)) — ${truncated} laissés de côté, les plus récemment relevés (ils remonteront au passage suivant).`);

    let refreshed = 0;
    let skipped = 0;
    let failures = 0;

    await promisePool(work.slice(0, budget).map(({ id, date }) => async () => {
        try {
            // `freshAt` et non `force` : `refreshShowtimes` relit l'entrée avec ce même horizon. Le tri
            // ci-dessus n'**ordonne** que le travail, il ne tranche pas.
            const { payload, refreshed: didFetch } = await refreshShowtimes(client, id, date, { freshAt });
            if (payload.error) failures++;
            else if (didFetch) refreshed++;
            else skipped++;
        } catch (e) {
            failures++;
            console.error(`[cron] Préchauffage échoué pour ${id} au ${date}:`, e?.message ?? e);
        }
    }), CONCURRENCY);

    const summary = {
        scope, dates, films: ids.length,
        refreshed, skipped, failures, truncated,
        ms: Date.now() - startedAt,
    };
    console.log('[cron] Préchauffage terminé', JSON.stringify(summary));
    return summary;
});
