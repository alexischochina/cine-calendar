// Rafraîchissement d'un film pour une date :
// `GET /api/allocine/refresh?id={allocineId}&date=YYYY-MM-DD`
//
// C'est la seule route qui sort sur le réseau. Appelée uniquement pour les films que la lecture
// groupée (`/api/allocine/showtimes`) a déclarés absents ou périmés, un par appel — le client les
// parallélise, ce qui garde chaque invocation courte.
//
// Cycle : relire le cache → décider → rafraîchir → réécrire. Un fetch en échec ne remplace jamais
// une entrée existante : on renvoie le périmé avec `stale: true` (des horaires un peu vieux valent
// mieux qu'une page vide, et le lien billetterie reste l'arbitre).
//
// Le cache vit en base et non dans le cache mémoire Nitro : sur Vercel ce dernier vit dans
// l'instance et meurt au cold start, donc chaque réveil retaperait Allociné pour rien. Une table le
// rend durable, partagé entre instances et inspectable — l'architecture décrite par le développeur
// de paris-cine.info.

import { serverSupabaseClient } from '#supabase/server';

// Toute salle croisée dans une réponse et absente du référentiel y entre — ça évite d'avoir à
// deviner la liste des salles parisiennes à l'avance, `scripts/geocode-cinemas.mjs` et le seed
// carte UGC travaillant ensuite sur des lignes existantes.
//
// `ignoreDuplicates` (→ `on conflict do nothing`) est essentiel : une salle déjà connue ne doit
// **jamais** être réécrite, sinon chaque rafraîchissement effacerait le travail de curation
// d'`accepts_ugc` et le géocodage.
//
// `accepts_ugc` prend à la création ce qu'Allociné annonce, et seulement là. Le mettre à `false`
// d'office faisait disparaître toute salle découverte après le seed de la vue filtrée — sans le
// moindre signal, puisque le filtre est actif par défaut. La liste reste curée : cette valeur n'est
// qu'un point de départ, corrigeable par `scripts/set-cinema-ugc.mjs`.
const rememberTheaters = async (client, theaters) => {
    if (!theaters.length) return;

    const { error } = await client.from('cinemas').upsert(
        theaters.map(t => ({
            code: t.code, name: t.name, address: t.address, zip: t.zip,
            circuit: t.circuit, accepts_ugc: t.ugcCard === true,
        })),
        { onConflict: 'code', ignoreDuplicates: true },
    );
    if (error) console.error('[allocine] Référentiel cinemas non mis à jour:', error.message);
};

export default defineEventHandler(async (event) => {
    const { id, date } = getQuery(event);

    if (!/^\d+$/.test(String(id ?? ''))) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid allocine id' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date ?? ''))) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid date' });
    }

    const allocineId = Number(id);
    const client = await serverSupabaseClient(event);

    const { data: cached } = await client
        .from('showtimes_cache')
        .select('payload, fetched_at')
        .eq('allocine_id', allocineId)
        .eq('date', date)
        .maybeSingle();

    // Relecture volontaire : entre la lecture groupée et cet appel, un autre onglet a pu rafraîchir
    // la même entrée. Une requête en base coûte infiniment moins qu'une sortie inutile chez Allociné.
    if (cached && isShowtimesFresh(cached.fetched_at, date)) {
        return { ...cached.payload, stale: false, fetchedAt: cached.fetched_at };
    }

    const fresh = await fetchParisShowtimes(allocineId, date);

    // Allociné injoignable : on ne détruit pas ce qu'on a. Entrée périmée → on la sert telle
    // quelle en l'annonçant ; rien en cache → vide honnête, l'appelant affichera « réessayer ».
    if (!fresh.ok) {
        if (cached) return { ...cached.payload, stale: true, fetchedAt: cached.fetched_at };
        return { nextDate: null, theaters: [], stale: false, fetchedAt: null, error: true };
    }

    const payload = { nextDate: fresh.nextDate, theaters: fresh.theaters };
    const fetchedAt = new Date().toISOString();

    // Une journée sans séance est un résultat, pas un échec : elle est mise en cache comme les
    // autres, sinon on retaperait Allociné à chaque affichage de ce jour-là.
    const { error } = await client
        .from('showtimes_cache')
        .upsert({ allocine_id: allocineId, date, payload, fetched_at: fetchedAt }, { onConflict: 'allocine_id,date' });
    if (error) console.error('[allocine] Cache séances non écrit:', error.message);

    await rememberTheaters(client, fresh.theaters);

    return { ...payload, stale: false, fetchedAt };
});
