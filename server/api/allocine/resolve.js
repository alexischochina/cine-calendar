// Résolution TMDB → Allociné : `GET /api/allocine/resolve?title=…&release_date=…&director=…`.
//
// Aucun identifiant croisé n'existe entre les deux catalogues : on passe par le titre, via la
// recherche interne d'Allociné, avec la date de sortie FR et le réalisateur (déjà en base tous les
// deux) pour départager les homonymes. Toute la mécanique de rapprochement vit dans
// `server/utils/allocine.js` — cette route ne fait que valider, cacher et répondre.
//
// Ne throw jamais sur un échec de match : un film introuvable renvoie `{ allocine_id: null }` en
// 200, que l'appelant horodate via `calendar.allocine_checked_at` pour ne pas s'acharner.

export default defineCachedEventHandler(async (event) => {
    const { title, release_date: releaseDate, director } = getQuery(event);

    if (typeof title !== 'string' || !title.trim()) {
        throw createError({ statusCode: 400, statusMessage: 'Missing title' });
    }

    const allocineId = await resolveAllocineId({
        title,
        releaseDate: typeof releaseDate === 'string' ? releaseDate : null,
        director: typeof director === 'string' ? director : null,
    });

    return { allocine_id: allocineId };
}, {
    maxAge: 60 * 60 * 12,
    name: 'allocine',
    // Clé sur le titre normalisé + la date : deux films distincts ne se marchent pas dessus, et le
    // même film redemandé pendant la visite ne relance pas de recherche.
    getKey: (event) => {
        const { title, release_date: releaseDate } = getQuery(event);
        return `resolve:${normalizeTitle(String(title ?? ''))}:${releaseDate ?? ''}`;
    },
});
