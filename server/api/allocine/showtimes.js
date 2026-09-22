// Lecture groupée du cache de séances :
// `GET /api/allocine/showtimes?ids={a,b,c}&date=YYYY-MM-DD`
//
// **Cette route ne sort jamais sur le réseau.** Elle lit `showtimes_cache` en **une** requête pour
// tous les films du jour, renvoie ce qui est frais, et laisse à l'appelant la liste de ce qui reste
// à rafraîchir (`/api/allocine/refresh`, un film à la fois).
//
// Pourquoi ce découpage plutôt qu'une route qui ferait tout : le chemin **chaud** (cache plein) passe
// de 14 requêtes HTTP + 14 requêtes Supabase à 1 + 1 (mesuré 252 ms → 92 ms), et le chemin **froid**
// garde l'éventail côté client, où chaque appel reste court plutôt que de flirter avec la limite
// d'exécution d'une fonction.

import { serverSupabaseClient } from '#supabase/server';

// Garde-fou : la liste des films en salle tient largement dedans, et ça borne la longueur d'URL
// comme la taille de la clause `in`.
const MAX_IDS = 60;

export default defineEventHandler(async (event) => {
    // Ouverte aux anonymes — c'est un choix, et le seul qui tienne sur le chemin le plus chaud du
    // projet (cf. `server/utils/requireUser.js`). Ce qui restait ouvert n'était pas la donnée, que
    // RLS protège, mais la dépense : invocations serverless et requêtes Supabase à volonté. Le
    // compteur est en mémoire et ne coûte donc rien à la lecture (cf. `server/utils/rateLimit.js`,
    // qui dit aussi ce que cette protection ne vaut pas).
    rateLimit(event);

    const { ids, date } = getQuery(event);

    if (!/^\d+(,\d+)*$/.test(String(ids ?? ''))) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid allocine ids' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date ?? ''))) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid date' });
    }

    const wanted = [...new Set(String(ids).split(',').map(Number))];
    if (wanted.length > MAX_IDS) {
        throw createError({ statusCode: 400, statusMessage: 'Too many ids' });
    }

    const client = await serverSupabaseClient(event);

    // ⚠️ La ville vient du profil, **jamais** de la query string — et elle doit être la même que
    // celle dont `refresh.js` se servira pour écrire, sinon `missing` revient identique à chaque tour
    // et le client boucle sur Allociné sans jamais rien satisfaire. Le raisonnement complet et le
    // coût de cette lecture sont dans `server/utils/userCity.js`.
    const city = await cityForRequest(event);

    const { data, error } = await client
        .from('showtimes_cache')
        .select('allocine_id, payload, fetched_at')
        .in('allocine_id', wanted)
        .eq('city', city)
        .eq('date', date);

    if (error) {
        // Cache illisible : on ne bloque pas, tout part en « à rafraîchir ».
        console.error('[allocine] Lecture groupée du cache échouée:', error.message);
        return { movies: {}, missing: wanted };
    }

    const movies = {};
    const fresh = new Set();

    for (const row of data ?? []) {
        if (!isShowtimesFresh(row.fetched_at, date)) continue;
        fresh.add(row.allocine_id);
        movies[row.allocine_id] = { ...row.payload, stale: false, fetchedAt: row.fetched_at };
    }

    // Absents **et** périmés : dans les deux cas il faut repasser par le réseau. Une entrée périmée
    // n'est pas renvoyée ici — `refresh` la ressortira avec `stale: true` si Allociné est injoignable,
    // ce qui évite d'afficher du périmé puis de le remplacer dans la foulée.
    return { movies, missing: wanted.filter(id => !fresh.has(id)) };
});
