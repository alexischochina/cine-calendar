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

// `Date` (ou chaîne parsable) → `YYYY-MM-DD` **en heure locale**.
//
// ⚠️ Surtout pas `toISOString().slice(0, 10)`, qui convertit en UTC : à l'est de Greenwich, une date
// à minuit local repart la veille.
export function toLocalIsoDay(value) {
    const date = new Date(value)
    if (isNaN(date)) return null
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${date.getFullYear()}-${month}-${day}`
}

// La date qui fait foi : l'override manuel s'il existe, la date TMDB stockée sinon.
//
// **Source unique** — ma timeline et celle d'un compte partagé doivent ranger un film au même
// endroit, et une seconde écriture le ferait apparaître en mars chez l'un et en avril chez l'autre.
export function effectiveReleaseDate(row) {
    return row?.manual_release_date
        ? toLocalIsoDay(row.manual_release_date)
        : (row?.release_date || null)
}
