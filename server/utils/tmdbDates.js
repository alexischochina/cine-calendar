// Résolution de la date FR théâtrale à partir de la réponse TMDB `release_dates`.
// Source unique de vérité, partagée par la route serveur `/api/movies/[id]/full`
// (auto-import Nitro) et le script `scripts/backfill-movies.mjs` (import explicite).

export const formatDate = (fullDate) => {
    const date = new Date(fullDate);
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    return `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
};

// type 3 = sortie théâtrale ; sinon on retient les notes CNC / Netflix / Amazon / Disney+.
export const resolveFrenchReleaseDate = (releaseDates) => {
    let frenchDates = null;
    let frenchDate = '';

    releaseDates?.results?.forEach((lang) => {
        if (lang.iso_3166_1 === 'FR') frenchDates = lang.release_dates;
    });

    const theatrical = frenchDates?.find(d => d.type === 3);
    if (theatrical) {
        frenchDate = theatrical.release_date;
    } else {
        frenchDates?.forEach((date) => {
            if (date.note === '' || /CNC/i.test(date.note) || date.note === 'Netflix' || date.note === 'Amazon' || date.note === 'Disney+') {
                frenchDate = date.release_date;
            }
        });
    }

    return frenchDate ? formatDate(frenchDate) : null;
};
