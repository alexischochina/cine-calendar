export default defineCachedEventHandler(async (event) => {
    const id = event.context.params.id;
    if (!/^\d+$/.test(id)) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid movie id' });
    }
    const config = useRuntimeConfig();
    return $fetch(`${config.apiBaseUrl}/movie/${id}/release_dates?api_key=${config.apiKey}`);
}, {
    maxAge: 60 * 60 * 6,
    staleMaxAge: 60 * 60 * 24,
    swr: true,
    getKey: (event) => `release_dates:${event.context.params.id}`,
});
