// Texte libre d'un événement, chez l'exploitant :
// `GET /api/events/detail?title=…&date=YYYY-MM-DD&cinema=…`
//
// Allociné ne décrit pas ses événements — son vocabulaire est fermé et rend « Avant-première », jamais
// « en présence du réalisateur ». Cette route va chercher la phrase là où elle existe : sur le site de
// la salle. Deux sources branchées (cf. `server/utils/exhibitors.js`) : **Dulac** (5 salles, JSON-LD
// `schema.org/Event`) et **MK2** (~10 salles, description SEO).
//
// Le cache est durable et **mémorise aussi les absences**. C'est essentiel : la plupart des séances
// événement n'ont aucune source branchée, et sans cache négatif on ressortirait sur le réseau à chaque relevé
// pour se faire répondre non. Une absence n'est pourtant pas définitive (la fiche peut être publiée
// après coup), d'où la même règle de fraîcheur que le reste du projet — la semaine ciné.

import { serverSupabaseClient } from '#supabase/server';

// Clé de cache : la salle et la date suffisent presque, le titre départage deux événements le même soir
// dans la même salle. Normalisé pour que « L'Arlequin » et « l arlequin » ne fassent pas deux lignes.
const cacheKey = (value) => String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export default defineEventHandler(async (event) => {
    // Sort chez l'exploitant (Dulac, MK2, UGC) : garde d'authentification comme les routes Allociné
    // qui sortent (cf. `server/utils/requireUser.js`). Ces sites-là sont encore moins nos hôtes
    // qu'Allociné — on n'y envoie que notre propre trafic.
    await requireUser(event);

    const { title, date, cinema, bookings } = getQuery(event);

    // Bornées comme partout ailleurs (`MAX_IDS`, `MAX_CODES`) : ces deux valeurs composent la clé
    // primaire du cache, une chaîne démesurée la ferait grossir sans borne.
    const MAX_LEN = 200;

    if (!String(title ?? '').trim() || !String(cinema ?? '').trim()) {
        throw createError({ statusCode: 400, statusMessage: 'Missing title or cinema' });
    }
    if (String(title).length > MAX_LEN || String(cinema).length > MAX_LEN) {
        throw createError({ statusCode: 400, statusMessage: 'Title or cinema too long' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date ?? ''))) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid date' });
    }

    // Salle hors réseau branché : réponse immédiate, aucune requête, aucune ligne de cache. C'est le
    // cas de l'immense majorité des salles parisiennes, et le client l'écarte déjà de son côté — ce
    // test-ci est la ceinture qui va avec les bretelles.
    if (!isKnownExhibitorVenue(cinema)) return { detail: null, source: null };

    const client = await serverSupabaseClient(event);
    const key = { cinema_key: cacheKey(cinema), date, title_key: cacheKey(title) };

    const { data: cached, error: readError } = await client
        .from('event_detail_cache')
        .select('detail, url, source, fetched_at')
        .match(key)
        .maybeSingle();

    // ⚠️ `isMissingSchema` et non `code === '42P01'` : PostgREST tranche sur son cache de schéma et
    // renvoie `PGRST205`. Le garde était donc inerte, la route retentait à chaque relevé et sortait sur
    // le réseau sans jamais rien mettre en cache — visible seulement en console.
    if (isMissingSchema(readError)) {
        console.warn('[événements] Table `event_detail_cache` absente — joue _ressources/sql/2608141200-add-seance-events.sql pour les libellés d\'exploitant.');
        return { detail: null, source: null, unavailable: true };
    }

    if (cached && isShowtimesFresh(cached.fetched_at, date)) {
        return { detail: cached.detail ?? null, url: cached.url ?? null, source: cached.source ?? null };
    }

    const { detail, url, source, unavailable } = await exhibitorDetail({
        title: String(title),
        date: String(date),
        cinema: String(cinema),
        // Liste séparée par des `|` : une URL de billetterie contient déjà des `&` et des `,`.
        bookings: String(bookings ?? '').slice(0, 4 * 300).split('|').filter(Boolean).slice(0, 4),
    });

    // Exploitant injoignable : rien en cache, pour que la prochaine ouverture réessaie. Graver l'échec
    // tairait le libellé jusqu'à expiration, et l'absence de texte est indistinguable d'une panne.
    if (unavailable) return { detail: null, source: null, unavailable: true };

    const { error: writeError } = await client
        .from('event_detail_cache')
        .upsert(
            { ...key, detail: detail ?? null, url: url ?? null, source: source ?? null, fetched_at: new Date().toISOString() },
            { onConflict: 'cinema_key,date,title_key' },
        );
    if (writeError && !isMissingSchema(writeError)) {
        console.error('[événements] Cache de libellé non écrit:', writeError.message);
    }

    return { detail: detail ?? null, url: url ?? null, source: source ?? null };
});
