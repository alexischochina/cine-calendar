// Note + liens réalisateurs, scrapés du JSON-LD de la fiche film. Letterboxd n'expose pas d'API
// publique : letterboxd.com/tmdb/{id}/ redirige vers la fiche.
// Cache long : la note bouge lentement, les réalisateurs jamais.
// Tout échec (404, JSON-LD absent, HTML changé) → charge utile vide sans throw.
//
// ⚠️ Route qui **sort sur le réseau**, d'où `requireUser` (cf. server/utils/requireUser.js) : le
// cache borne la répétition par identifiant, pas l'espace des identifiants.
//
// La garde est dans le handler et le cache **en dessous**, pas l'inverse : sous
// `defineCachedEventHandler`, le corps — donc la garde — ne tourne qu'en défaut de cache.

const fetchLetterboxdFilm = defineCachedFunction(async (id) => {
    try {
        // Timeout dur : une fiche lente ne doit pas laisser la connexion sortante ouverte.
        const html = await $fetch(`https://letterboxd.com/tmdb/${id}/`, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; cinegenda/1.0)' },
            signal: AbortSignal.timeout(8000),
        });

        return parseLetterboxdFilm(String(html));
    } catch (e) {
        return { rating: null, count: null, directors: [] };
    }
}, {
    name: 'letterboxd',
    maxAge: 60 * 60 * 24,
    staleMaxAge: 60 * 60 * 24 * 7,
    swr: true,
    // `v2` : la charge utile a gagné `directors`, les entrées encore en stale renverraient l'ancienne.
    getKey: (id) => `v2:${id}`,
});

export default defineEventHandler(async (event) => {
    await requireUser(event);

    const id = event.context.params.id;
    if (!/^\d+$/.test(id)) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid movie id' });
    }

    return fetchLetterboxdFilm(id);
});
