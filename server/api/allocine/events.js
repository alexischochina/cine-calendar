// Lecture groupée du cache d'événements par salle :
// `GET /api/allocine/events?codes={C0146,C0159}&date=YYYY-MM-DD`
//
// **Cette route ne sort jamais sur le réseau.** Jumelle de `showtimes.js`, pour la seconde passe :
// elle lit `theater_events_cache` en **une** requête pour toutes les salles du jour, renvoie ce qui
// est frais, et laisse à l'appelant la liste de ce qui reste à rafraîchir (`events-refresh`, une
// salle à la fois).
//
// Pourquoi une seconde passe existe : l'endpoint film d'Allociné ne porte aucun champ d'événement,
// seul l'endpoint salle les a (cf. l'encadré « Deux endpoints, deux jeux de champs » dans
// `server/utils/allocine.js`). Les horaires continuent donc de venir de l'endpoint film — film-centré
// et ~4× moins coûteux — et cette passe n'ajoute qu'une qualification, sur les seules salles qui
// jouent des films de la liste.
//
// Le payload d'une salle est `{ events, seen, previews }` et non la seule carte des événements :
// l'endpoint salle est **creux**, donc il faut savoir quelles séances il a réellement rendues pour ne
// se prononcer que sur celles-là, et l'avant-première voyage en booléen parce qu'elle décide de
// l'éligibilité à la carte UGC (cf. `fetchTheaterEvents` et `graftEvents`).

import { serverSupabaseClient } from '#supabase/server';

// Garde-fou : les salles parisiennes qui jouent des films de la liste tiennent largement dedans
// (~25 mesurées), et ça borne la longueur d'URL comme la taille de la clause `in`.
const MAX_CODES = 60;

// Codes salle Allociné : une lettre puis des chiffres (`C0146`). Validé au seuil — la valeur finit
// dans une clause `in`, et le format est stable depuis toujours.
const CODE = /^[A-Z]\d{3,6}$/;

export default defineEventHandler(async (event) => {
    const { codes, date } = getQuery(event);

    const wanted = [...new Set(String(codes ?? '').split(',').filter(Boolean))];
    if (!wanted.length || !wanted.every(code => CODE.test(code))) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid theater codes' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date ?? ''))) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid date' });
    }
    if (wanted.length > MAX_CODES) {
        throw createError({ statusCode: 400, statusMessage: 'Too many codes' });
    }

    const client = await serverSupabaseClient(event);

    const { data, error } = await client
        .from('theater_events_cache')
        .select('theater_code, payload, fetched_at')
        .in('theater_code', wanted)
        .eq('date', date);

    if (error) {
        // Table absente (migration pas jouée) ou cache illisible : on ne bloque pas. On renvoie
        // `unavailable` pour que l'appelant se taise au lieu de lancer ~25 rafraîchissements qui
        // échoueront tous à l'écriture — la vue reste juste, simplement sans marqueur d'événement.
        // Même piège que partout : une table absente peut remonter `PGRST205` plutôt que `42P01`.
        if (isMissingSchema(error)) {
            console.warn('[allocine] Table `theater_events_cache` absente — joue _ressources/sql/2608141200-add-seance-events.sql pour marquer les séances événement.');
            return { theaters: {}, missing: [], unavailable: true };
        }
        console.error('[allocine] Lecture groupée du cache d\'événements échouée:', error.message);
        return { theaters: {}, missing: wanted };
    }

    const theaters = {};
    const fresh = new Set();

    for (const row of data ?? []) {
        // Même règle de fraîcheur que les séances : c'est la même grille, au même rythme hebdomadaire.
        if (!isShowtimesFresh(row.fetched_at, date)) continue;
        fresh.add(row.theater_code);
        theaters[row.theater_code] = {
            events: row.payload?.events ?? {},
            seen: row.payload?.seen ?? [],
            previews: row.payload?.previews ?? [],
        };
    }

    return { theaters, missing: wanted.filter(code => !fresh.has(code)) };
});
