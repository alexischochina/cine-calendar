// Écriture des liens Letterboxd des réalisateurs — auto-importé par Nuxt (dossier app/utils/).
//
// Ici plutôt que dans useMovieCalendar : les deux points d'insertion d'un film ne passent pas par le
// même composable, et résoudre depuis `handleMovieAdded` raterait le formulaire du header sous le
// layout `bare` (recherche, fiche film), qui **émet** `movie-added` sans poser de listener.

// ⚠️ Une colonne absente remonte `PGRST204` **en écriture** — et non `42703` comme en lecture, cf.
// shared/utils/pgErrors.js — et fait échouer le patch entier : sans ce repli, tant que la migration
// 2608161000 n'est pas passée, ajouter les liens réalisateurs ferait aussi perdre la note.
export const patchCalendarRow = async (client, id, patch) => {
    const { error } = await client.from('calendar').update(patch).eq('id', id);
    if (!error) return patch;
    if (!isMissingSchema(error) || !('letterboxd_directors' in patch)) throw new Error(error.message);

    const { letterboxd_directors, ...rest } = patch;
    if (!Object.keys(rest).length) return null;
    const { error: retryError } = await client.from('calendar').update(rest).eq('id', id);
    if (retryError) throw new Error(retryError.message);
    return rest;
};

// Silencieux et jamais attendu par l'appelant : le slug deviné reste affiché tant que la résolution
// n'a pas abouti, et un ajout ne doit ni échouer ni traîner parce que Letterboxd tousse.
export const resolveLetterboxdDirectors = async (client, row) => {
    if (!row?.id || !row.movie_id || !row.director || row.letterboxd_directors?.length) return null;
    try {
        const { directors } = await $fetch(`/api/movies/${row.movie_id}/letterboxd`);
        if (!directors?.length) return null;
        const applied = await patchCalendarRow(client, row.id, { letterboxd_directors: directors });
        return applied ? directors : null;
    } catch (e) {
        console.error('Liens réalisateurs Letterboxd indisponibles pour', row.movie_id, e);
        return null;
    }
};
