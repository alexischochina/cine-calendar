// Résolution TMDB → Allociné : `GET /api/allocine/resolve?title=…&release_date=…&director=…`.
//
// Aucun identifiant croisé n'existe entre les deux catalogues : on passe par le titre, via la
// recherche interne d'Allociné, avec la date de sortie FR et le réalisateur (déjà en base tous les
// deux) pour départager les homonymes. Toute la mécanique de rapprochement vit dans
// `server/utils/allocine.js` — cette route ne fait que valider, cacher et répondre.
//
// Ne throw jamais sur un échec de match : un film introuvable renvoie `{ allocine_id: null }` en
// 200, que l'appelant horodate via `calendar.allocine_checked_at` pour ne pas s'acharner.

// Pas de cache de réponse ici, volontairement : une résolution est faite **une fois par film** puis
// persistée dans `calendar.allocine_id`, donc un cache ne servirait qu'à ré-servir… un échec. Or
// mettre en cache 12 h un « pas trouvé » dû à une coupure réseau est exactement ce qu'on cherche à
// éviter. Le coût est d'une requête sortante par film, une seule fois dans la vie de la ligne.
// Au-delà, ce n'est plus un titre de film. Même borne que `server/api/events/detail.js` : la valeur
// part dans une URL sortante, une chaîne démesurée la ferait grossir sans borne.
const MAX_LEN = 200;

export default defineEventHandler(async (event) => {
    // ⚠️ Cette route est la plus exposée du lot : aucune lecture en base, un `title` de forme libre,
    // et une sortie chez Allociné **garantie** à chaque appel. La garde passe donc avant tout le reste
    // (cf. `server/utils/requireUser.js`).
    await requireUser(event);

    const { title, release_date: releaseDate, director } = getQuery(event);

    if (typeof title !== 'string' || !title.trim()) {
        throw createError({ statusCode: 400, statusMessage: 'Missing title' });
    }
    if (title.length > MAX_LEN) {
        throw createError({ statusCode: 400, statusMessage: 'Title too long' });
    }

    const { allocineId, unavailable } = await resolveAllocineId({
        title,
        releaseDate: typeof releaseDate === 'string' ? releaseDate : null,
        director: typeof director === 'string' ? director : null,
    });

    // `unavailable` dit à l'appelant de **ne pas** horodater sa tentative : le film n'a pas été
    // déclaré introuvable, on n'a simplement pas pu demander.
    return { allocine_id: allocineId, unavailable };
});
