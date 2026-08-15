// Rafraîchissement d'un film pour une date :
// `GET /api/allocine/refresh?id={allocineId}&date=YYYY-MM-DD`
//
// Appelée uniquement pour les films que la lecture groupée a déclarés absents ou périmés, un par appel
// — le client les parallélise, ce qui garde chaque invocation courte.
//
// Cycle : relire le cache → décider → rafraîchir → réécrire. ⚠️ Un fetch en échec ne remplace jamais
// une entrée existante : on renvoie le périmé avec `stale: true`, des horaires un peu vieux valant
// mieux qu'une page vide.
//
// Le cache vit en base et non en mémoire Nitro, qui meurt au cold start : chaque réveil retaperait
// Allociné pour rien.

import { serverSupabaseClient } from '#supabase/server';

// Toute salle croisée dans une réponse et absente du référentiel y entre : les scripts de géocodage et
// de curation travaillent ensuite sur des lignes existantes.
//
// ⚠️ `ignoreDuplicates` (→ `on conflict do nothing`) est essentiel : réécrire une salle connue
// effacerait la curation d'`accepts_ugc` et le géocodage. Cette valeur n'est qu'un point de départ à la
// création — la mettre à `false` d'office faisait disparaître de la vue filtrée toute salle découverte
// après le seed, sans le moindre signal.
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
    // Seule route de la vue Séances qui sort sur le réseau : elle ne s'ouvre pas aux anonymes
    // (cf. `server/utils/requireUser.js`).
    await requireUser(event);

    const { id, date, force } = getQuery(event);

    if (!/^\d+$/.test(String(id ?? ''))) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid allocine id' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date ?? ''))) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid date' });
    }

    // `force` : sortir chez Allociné même si l'entrée est encore réputée fraîche. Réservé au geste
    // explicite de l'utilisateur (bouton « Actualiser »), jamais à un chargement automatique — les
    // exploitants ajoutent des séances en cours de journée, et aucun TTL ne peut deviner quand.
    const bypassCache = String(force ?? '') === '1';

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
    if (!bypassCache && cached && isShowtimesFresh(cached.fetched_at, date)) {
        return { ...cached.payload, stale: false, fetchedAt: cached.fetched_at };
    }

    const fresh = await fetchParisShowtimes(allocineId, date);

    // Allociné injoignable : on ne détruit pas ce qu'on a. Entrée périmée → on la sert telle
    // quelle en l'annonçant ; rien en cache → vide honnête, l'appelant affichera « réessayer ».
    if (!fresh.ok) {
        if (cached) return { ...cached.payload, stale: true, fetchedAt: cached.fetched_at };
        return { nextDate: null, theaters: [], stale: false, fetchedAt: null, error: true };
    }

    // Report des salles que cette lecture a perdues (cf. `carryOverMissing`), puis re-tri sur le
    // même critère que le client : code postal, puis nom.
    const carried = cached
        ? carryOverMissing(cached.payload?.theaters, fresh.theaters, cached.fetched_at)
        : [];
    if (carried.length) console.warn(`[allocine] ${carried.length} salle(s) disparue(s) pour ${allocineId} au ${date}, reportées : ${carried.map(t => t.name).join(', ')}`);

    const theaters = [...fresh.theaters, ...carried]
        .sort((a, b) => String(a.zip).localeCompare(String(b.zip)) || String(a.name).localeCompare(String(b.name)));

    const payload = { nextDate: fresh.nextDate, theaters };
    const fetchedAt = new Date().toISOString();

    // Une journée sans séance est un résultat, pas un échec : elle est mise en cache comme les autres.
    // Un résultat **amputé d'une page**, lui, ne rentre pas — on l'affiche, on ne le fige pas : un cache
    // vide se rattrape au prochain affichage, un cache faux ne se rattrape pas.
    if (fresh.partial) {
        console.warn(`[allocine] Résultat partiel pour ${allocineId} au ${date} — non mis en cache`);
        return { ...payload, stale: false, fetchedAt };
    }

    const { error } = await client
        .from('showtimes_cache')
        .upsert({ allocine_id: allocineId, date, payload, fetched_at: fetchedAt }, { onConflict: 'allocine_id,date' });
    if (error) console.error('[allocine] Cache séances non écrit:', error.message);

    await rememberTheaters(client, fresh.theaters);

    return { ...payload, stale: false, fetchedAt };
});
