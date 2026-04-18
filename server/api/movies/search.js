export default defineEventHandler((event) => {
    const {query, page} = getQuery(event);
    const config = useRuntimeConfig();
    return $fetch(`${config.apiBaseUrl}/search/movie?api_key=${config.apiKey}&query=${query}&page=${page}&language=fr-FR`)
})