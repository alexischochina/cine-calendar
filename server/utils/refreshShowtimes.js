// Rafraîchissement d'un film pour une date **dans une ville** — **le** chemin qui sort chez Allociné
// et réécrit `showtimes_cache`. Partagé par `server/api/allocine/refresh.js` (demande d'un visiteur)
// et `server/api/cron/warm.js` (préchauffage planifié) : deux copies de ce cycle divergeraient, et
// une divergence ici s'écrit **en base**, dans le cache que tout le reste lit.
//
// ⚠️⚠️ LA VILLE FAIT PARTIE DE LA CLÉ, PAS DU CONTENU. Elle apparaît à trois endroits qui doivent
// rester d'accord : le `.eq('city', …)` de la relecture, l'`onConflict` de l'écriture, et l'argument
// passé à `fetchCityShowtimes`. En oublier un ne lève **aucune erreur** — Postgres accepte la ligne,
// Allociné répond normalement — et les deux villes se recouvrent par intermittence selon qui
// rafraîchit en dernier. C'est le défaut le plus silencieux du chantier multi-villes ; la migration
// `2609221215` retire le `default 'paris'` de la colonne pour qu'au moins l'oubli le plus grossier
// (ne rien écrire du tout) échoue bruyamment.
//
// Cycle : relire le cache → décider → rafraîchir → réécrire. ⚠️ Un fetch en échec ne remplace jamais
// une entrée existante : on renvoie le périmé avec `stale: true`, des horaires un peu vieux valant
// mieux qu'une page vide.
//
// Le cache vit en base et non en mémoire Nitro, qui meurt au cold start.

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

// Rend `{ payload, refreshed }` : `payload` est le contrat du client, `refreshed` la télémétrie du
// préchauffage. Les mélanger faisait voyager jusqu'au navigateur un champ qui ne lui dit rien.
//
// `force`   : sortir chez Allociné même si l'entrée est réputée fraîche. Réservé au geste explicite
//             de l'utilisateur (bouton « Actualiser »), jamais à un chargement automatique — les
//             exploitants ajoutent des séances en cours de journée, et aucun TTL ne peut deviner quand.
// `freshAt` : instant auquel juger la fraîcheur, par défaut maintenant. Le préchauffage le porte dans
//             le futur pour rafraîchir ce qui expirera avant son prochain passage (cf. `cron/warm.js`).
//
// ⚠️ `city` est un paramètre **positionnel et obligatoire**, pas une option avec un défaut : une
// option manquante se lit comme un choix, un argument manquant se voit. Cf. l'encadré en tête.
export const refreshShowtimes = async (client, allocineId, date, city, { force = false, freshAt } = {}) => {
    const { data: cached } = await client
        .from('showtimes_cache')
        .select('payload, fetched_at')
        .eq('allocine_id', allocineId)
        .eq('city', city)
        .eq('date', date)
        .maybeSingle();

    // Relecture volontaire : entre la lecture groupée et cet appel, un autre onglet a pu rafraîchir
    // la même entrée. Une requête en base coûte infiniment moins qu'une sortie inutile chez Allociné.
    if (!force && cached && isShowtimesFresh(cached.fetched_at, date, freshAt)) {
        return { payload: { ...cached.payload, stale: false, fetchedAt: cached.fetched_at }, refreshed: false };
    }

    const fresh = await fetchCityShowtimes(allocineId, date, city);

    // Allociné injoignable : on ne détruit pas ce qu'on a. Entrée périmée → on la sert telle
    // quelle en l'annonçant ; rien en cache → vide honnête, l'appelant affichera « réessayer ».
    if (!fresh.ok) {
        if (cached) return { payload: { ...cached.payload, stale: true, fetchedAt: cached.fetched_at }, refreshed: false };
        return { payload: { nextDate: null, theaters: [], stale: false, fetchedAt: null, error: true }, refreshed: false };
    }

    // Report des salles que cette lecture a perdues (cf. `carryOverMissing`), puis re-tri sur le
    // même critère que le client : code postal, puis nom.
    const carried = cached
        ? carryOverMissing(cached.payload?.theaters, fresh.theaters, cached.fetched_at)
        : [];
    if (carried.length) console.warn(`[allocine] ${carried.length} salle(s) disparue(s) pour ${allocineId} au ${date} (${city}), reportées : ${carried.map(t => t.name).join(', ')}`);

    const theaters = [...fresh.theaters, ...carried]
        .sort((a, b) => String(a.zip).localeCompare(String(b.zip)) || String(a.name).localeCompare(String(b.name)));

    const payload = { nextDate: fresh.nextDate, theaters };
    const fetchedAt = new Date().toISOString();

    // Une journée sans séance est un résultat, pas un échec : elle est mise en cache comme les autres.
    // Un résultat **amputé d'une page**, lui, ne rentre pas — on l'affiche, on ne le fige pas : un cache
    // vide se rattrape au prochain affichage, un cache faux ne se rattrape pas.
    if (fresh.partial) {
        console.warn(`[allocine] Résultat partiel pour ${allocineId} au ${date} (${city}) — non mis en cache`);
        return { payload: { ...payload, stale: false, fetchedAt }, refreshed: true };
    }

    const { error } = await client
        .from('showtimes_cache')
        .upsert({ allocine_id: allocineId, city, date, payload, fetched_at: fetchedAt }, { onConflict: 'allocine_id,city,date' });
    if (error) console.error('[allocine] Cache séances non écrit:', error.message);

    await rememberTheaters(client, fresh.theaters);

    return { payload: { ...payload, stale: false, fetchedAt }, refreshed: true };
};
