// Scraping de la note Letterboxd depuis le JSON-LD de la fiche film.
// Letterboxd n'expose pas d'API publique : letterboxd.com/tmdb/{id}/ redirige
// vers la fiche, dont le <script type="application/ld+json"> porte aggregateRating
// (ratingValue 0–5 + ratingCount). Cache long : la note bouge lentement.
// Tout échec (404, note absente, HTML changé) → { rating: null, count: null } sans throw.

export default defineCachedEventHandler(async (event) => {
    const id = event.context.params.id;
    if (!/^\d+$/.test(id)) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid movie id' });
    }

    try {
        // Timeout dur : une fiche lente ne doit jamais laisser la connexion sortante ouverte
        // indéfiniment (garde-fou ressources). Échec/annulation → catch → { rating: null }.
        const html = await $fetch(`https://letterboxd.com/tmdb/${id}/`, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; cine-calendar/1.0)' },
            signal: AbortSignal.timeout(8000),
        });

        const rating = extractLetterboxdRating(String(html));
        return rating;
    } catch (e) {
        return { rating: null, count: null };
    }
}, {
    maxAge: 60 * 60 * 24,
    staleMaxAge: 60 * 60 * 24 * 7,
    swr: true,
    getKey: (event) => `letterboxd:${event.context.params.id}`,
});

function extractLetterboxdRating(html) {
    // Le JSON-LD Letterboxd est enveloppé dans un commentaire CDATA à l'intérieur du <script>.
    const match = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    if (!match) return { rating: null, count: null };

    const raw = match[1].replace(/\/\*\s*<!\[CDATA\[\s*\*\//, '').replace(/\/\*\s*\]\]>\s*\*\//, '').trim();

    let data;
    try {
        data = JSON.parse(raw);
    } catch {
        return { rating: null, count: null };
    }

    const agg = data?.aggregateRating;
    if (!agg) return { rating: null, count: null };

    const rating = Number(agg.ratingValue);
    const count = Number(agg.ratingCount);

    return {
        rating: Number.isFinite(rating) ? rating : null,
        count: Number.isFinite(count) ? count : null,
    };
}
