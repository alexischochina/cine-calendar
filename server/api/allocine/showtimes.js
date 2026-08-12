// Lecture groupée du cache de séances :
// `GET /api/allocine/showtimes?ids={a,b,c}&date=YYYY-MM-DD`
//
// **Cette route ne sort jamais sur le réseau.** Elle lit `showtimes_cache` en **une** requête pour
// tous les films du jour, renvoie ce qui est frais, et laisse à l'appelant la liste de ce qui reste
// à rafraîchir (`/api/allocine/refresh`, un film à la fois).
//
// Pourquoi ce découpage plutôt qu'une route qui ferait tout :
//   - Le chemin **chaud** est le cas courant (cache plein). Il passe de 14 requêtes HTTP + 14 requêtes
//     Supabase à 1 + 1 — mesuré à 252 ms → 92 ms sur la seule lecture en base, sans compter les 14
//     invocations de fonction serverless épargnées.
//   - Le chemin **froid** garde l'éventail côté client : une journée entière à rafraîchir prendrait
//     plusieurs secondes en série côté serveur et flirterait avec la limite d'exécution d'une
//     fonction. En parallélisant depuis le navigateur, chaque appel reste court et indépendant.

import { serverSupabaseClient } from '#supabase/server';

// Garde-fou : la liste des films en salle tient largement dedans, et ça borne la longueur d'URL
// comme la taille de la clause `in`.
const MAX_IDS = 60;

export default defineEventHandler(async (event) => {
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

    const { data, error } = await client
        .from('showtimes_cache')
        .select('allocine_id, payload, fetched_at')
        .in('allocine_id', wanted)
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
