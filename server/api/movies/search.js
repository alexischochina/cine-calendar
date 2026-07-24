export default defineEventHandler((event) => {
    const { query, page } = getQuery(event);
    const config = useRuntimeConfig();

    const term = (query ?? '').toString().trim().slice(0, 200);
    if (!term) {
        return { page: 1, results: [], total_pages: 0, total_results: 0 };
    }

    const q = encodeURIComponent(term);
    const n = Number(page);
    const p = Number.isInteger(n) && n >= 1 && n <= 1000 ? n : 1;

    return $fetch(`${config.apiBaseUrl}/search/movie?api_key=${config.apiKey}&query=${q}&page=${p}&language=fr-FR`);
})
