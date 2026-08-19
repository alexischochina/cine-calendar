// Date de sortie exploitable d'un film, ou null si absente/invalide.
//
// **Source unique** du verdict « ce film est-il daté ? » : la section « Sans date » de la timeline,
// l'année de l'URL cible et le classement de la recherche doivent trancher à l'identique.
export function releaseDateOf(m) {
    if (!m?.release_date) return null
    const d = new Date(m.release_date)
    return isNaN(d) ? null : d
}

// Année de sortie effective d'un film, ou null si absente/invalide.
export function yearOfMovie(m) {
    const d = releaseDateOf(m)
    return d === null ? null : d.getFullYear()
}
