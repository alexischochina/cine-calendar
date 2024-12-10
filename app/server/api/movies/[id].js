export default defineEventHandler(async (event) => {
    const id = event.context.params.id;
    const config = useRuntimeConfig();
    return $fetch(`${config.apiBaseUrl}/movie/${id}?api_key=${config.apiKey}&language=fr-FR`);
});