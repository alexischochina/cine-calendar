// Endpoint unifié : un seul appel TMDB (append_to_response=release_dates)
// renvoie les métadonnées déjà résolues { title, poster_path, release_date }.
// La résolution de la date FR vit dans server/utils/tmdbDates.js (auto-import Nitro).

export default defineCachedEventHandler(async (event) => {
    const id = event.context.params.id;
    if (!/^\d+$/.test(id)) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid movie id' });
    }

    const config = useRuntimeConfig();
    const movie = await $fetch(`${config.apiBaseUrl}/movie/${id}?api_key=${config.apiKey}&language=fr-FR&region=FR&append_to_response=release_dates,credits`);

    return {
        title: movie.title,
        poster_path: movie.poster_path,
        release_date: resolveFrenchReleaseDate(movie.release_dates),
        director: extractDirector(movie.credits),
    };
}, {
    maxAge: 60 * 60 * 6,
    staleMaxAge: 60 * 60 * 24,
    swr: true,
    getKey: (event) => `movie_full:${event.context.params.id}`,
});
