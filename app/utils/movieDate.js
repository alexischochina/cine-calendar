// Année de sortie effective d'un film, ou null si absente/invalide.
export function yearOfMovie(m) {
    if (!m?.release_date) return null
    const d = new Date(m.release_date)
    return isNaN(d) ? null : d.getFullYear()
}
