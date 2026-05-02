export default defineCachedEventHandler(async (event) => {
    const id = event.context.params.id;
    const config = useRuntimeConfig();
    return $fetch(`${config.apiBaseUrl}/movie/${id}?api_key=${config.apiKey}&language=fr-FR&region=FR`);
}, {
    maxAge: 60 * 60 * 24 * 7,
    staleMaxAge: 60 * 60 * 24 * 30,
    swr: true,
    getKey: (event) => `movie:${event.context.params.id}`,
});
