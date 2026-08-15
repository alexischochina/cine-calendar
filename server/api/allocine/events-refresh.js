// Rafraîchissement des événements d'une salle pour une date :
// `GET /api/allocine/events-refresh?code={C0146}&date=YYYY-MM-DD`
//
// Jumelle de `refresh.js` pour la seconde passe. Appelée uniquement pour les salles que la lecture
// groupée (`/api/allocine/events`) a déclarées absentes ou périmées, une par appel — le client les
// parallélise, ce qui garde chaque invocation courte.
//
// Différence notable avec `refresh.js` : ici, un échec réseau ne ressert **pas** l'entrée périmée. Des
// horaires un peu vieux valent mieux qu'une page vide, mais un marqueur « avant-première » un peu
// vieux ne vaut rien — il envoie vers une séance qui n'existe peut-être plus, et le clic se paie en
// déplacement. On préfère ne rien dire.

import { serverSupabaseClient } from '#supabase/server';

const CODE = /^[A-Z]\d{3,6}$/;

export default defineEventHandler(async (event) => {
    const { code, date } = getQuery(event);

    if (!CODE.test(String(code ?? ''))) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid theater code' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date ?? ''))) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid date' });
    }

    const client = await serverSupabaseClient(event);

    // Relecture volontaire, même raison que dans `refresh.js` : entre la lecture groupée et cet
    // appel, un autre onglet a pu rafraîchir la même salle. Une requête en base coûte infiniment
    // moins qu'une sortie inutile chez Allociné.
    const { data: cached } = await client
        .from('theater_events_cache')
        .select('payload, fetched_at')
        .eq('theater_code', code)
        .eq('date', date)
        .maybeSingle();

    if (cached && isShowtimesFresh(cached.fetched_at, date)) {
        return {
            events: cached.payload?.events ?? {},
            seen: cached.payload?.seen ?? [],
            previews: cached.payload?.previews ?? [],
        };
    }

    const fresh = await fetchTheaterEvents(String(code), String(date));

    // Allociné injoignable : vide honnête et **non mis en cache**, pour que la prochaine ouverture
    // réessaie. La vue est déjà juste sans nous — il ne lui manque qu'un marqueur.
    if (!fresh.ok) return { events: {}, seen: [], previews: [], error: true };

    // Résultat amputé d'une page : on le sert (mieux que rien) mais on ne le fige pas. Graver le trou
    // reviendrait à taire les événements d'une partie des films de la salle jusqu'à expiration.
    //
    // ⚠️ Ne pas confondre avec le creux de cet endpoint : `partial` dit « une page a été perdue en
    // route », le creux dit « Allociné n'a rien à dire de cette journée ». Le premier ne se met pas en
    // cache, le second si — et `seen` porte la nuance côté appelant.
    const payload = { events: fresh.events, seen: fresh.seen, previews: fresh.previews };

    if (fresh.partial) {
        console.warn(`[allocine] Événements partiels pour la salle ${code} au ${date} — non mis en cache`);
        return payload;
    }

    const { error } = await client
        .from('theater_events_cache')
        .upsert(
            { theater_code: code, date, payload, fetched_at: new Date().toISOString() },
            { onConflict: 'theater_code,date' },
        );

    if (error) {
        if (isMissingSchema(error)) {
            console.warn('[allocine] Table `theater_events_cache` absente — joue _ressources/sql/2608141200-add-seance-events.sql.');
        } else {
            console.error('[allocine] Cache d\'événements non écrit:', error.message);
        }
    }

    return payload;
});
