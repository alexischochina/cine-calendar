<script setup>
// La timeline d'un autre compte, en lecture seule.
//
// ⚠️ `key` **par compte** et non constante comme la timeline : changer d'année ne doit pas remonter
// la page, mais changer de liste doit la remonter.
definePageMeta({
    key: route => `liste-${route.params.user}`,
    middleware: ['auth', 'valid-year'],
})

const route = useRoute()
const store = useMoviesStore()

const { movies, addFromSharedList, handleMovieAdded } = useMovieCalendar()
const { selectedYear } = useCalendarNav()
const {
    loadSharedProfiles, loadSharedList, profileBySlug, rowsOf,
    onlyMissingFor, toggleOnlyMissing, sharedGrouped, sharedNotice,
} = useSharedLists()

const slug = computed(() => String(route.params.user || ''))

// ⚠️ Attendu, contrairement au chargement de fond du layout : sans lui, un rechargement direct
// rendrait 404 avant même d'avoir demandé qui partage.
await loadSharedProfiles()

const profile = computed(() => profileBySlug(slug.value))

// Slug inexistant, nom effacé, partage retiré : 404 plutôt qu'une redirection silencieuse — une
// liste qui disparaît sans rien dire se lit comme un bug.
if (!profile.value) {
    throw createError({ statusCode: 404, statusMessage: 'Liste introuvable', fatal: true })
}

useHead({ title: `Liste de ${profile.value.display_name}` })

await loadSharedList(profile.value.user_id)

// `key` remonte la page en principe, mais s'y fier ferait dépendre le contenu d'un détail de routage.
watch(() => profile.value?.user_id, (userId) => { if (userId) loadSharedList(userId) })

const theirFilms = computed(() => rowsOf(profile.value.user_id))

// Les `movie_id` que j'ai déjà. Un `Set` construit une fois, pas une recherche par ligne.
const ownedIds = computed(() => new Set(movies.value.map(m => Number(m.movie_id))))

const missing = computed(() => missingFrom(theirFilms.value, movies.value))

// ⚠️ Ma liste n'est remplie qu'au `onMounted` du layout : en arrivant directement sur une liste
// partagée, la comparaison « ce qu'il a que je n'ai pas » vaudrait « tout ». On attend.
const ready = computed(() => movies.value.length > 0)

const stat = computed(() => ready.value
    ? sharedListStat(theirFilms.value.length, missing.value.length)
    : `${theirFilms.value.length} film${theirFilms.value.length > 1 ? 's' : ''}`)

// La bascule, propre à **cette** liste (cf. `useSharedLists`).
const onlyMissing = computed(() => onlyMissingFor(profile.value.user_id))

// ⚠️ Ordre imposé : bascule, **puis** filtres, **puis** regroupement — regrouper avant de filtrer
// ferait mentir les compteurs de mois.
//
// Les filtres état / média s'appliquent aussi ici et ne sont **pas** réinitialisés à l'entrée
// (contrairement à la maquette) : remettre à zéro un réglage global sans le dire est pire qu'une
// liste vide qu'on sait expliquer.
const visibleFilms = computed(() => {
    const base = (onlyMissing.value && ready.value) ? missing.value : theirFilms.value
    return base.filter(film => matchesFilters(film, store.filters))
})

const grouped = computed(() => groupByYearMonthDay(visibleFilms.value))

// Posé pour le layout, qui en tire le rail des années.
watchEffect(() => { sharedGrouped.value = grouped.value })

// ⚠️ **N'efface que si personne n'a pris la main.** La `pageTransition` est en `mode: 'default'` : la
// page entrante monte **avant** le démontage de la sortante, donc d'une liste partagée à une autre un
// effacement inconditionnel écraserait le regroupement que la nouvelle vient de poser.
onBeforeUnmount(() => {
    if (sharedGrouped.value === grouped.value) sharedGrouped.value = null
})

const monthsOfYear = computed(() =>
    selectedYear.value === null ? null : (grouped.value.grouped[selectedYear.value] || {})
)

const hasContent = computed(() =>
    selectedYear.value === null
        ? grouped.value.undated.length > 0
        : Object.keys(monthsOfYear.value).length > 0
)

// Une bascule qui vide la liste est une bonne nouvelle ; « Aucun film ne correspond. » ferait croire
// à un réglage de travers.
const emptyMessage = computed(() => {
    if (onlyMissing.value && !missing.value.length) return 'Tu as déjà tous ses films.'
    if (onlyMissing.value) return `Rien de nouveau dans cette année.`
    return 'Aucun film ne correspond.'
})

let noticeTimer = null

const onAddToList = async (film) => {
    const entry = await addFromSharedList(film)
    if (!entry) return

    // Même chemin que les deux autres points d'insertion : la timeline et le compteur de l'onglet se
    // mettent à jour seuls, tous deux dérivant de `movies`.
    await handleMovieAdded({ detail: { newEntry: entry } })

    sharedNotice.value = { title: entry.title || 'Le film' }
    clearTimeout(noticeTimer)
    noticeTimer = setTimeout(() => { sharedNotice.value = null }, 4500)
}

onBeforeUnmount(() => clearTimeout(noticeTimer))
</script>

<template>
    <div class="shared-list-page">
        <TimelineList shared :selected-year="selectedYear" :months-of-year="monthsOfYear"
                      :movies-without-date="grouped.undated" :has-content="hasContent"
                      :owned-ids="ownedIds" :empty-message="emptyMessage"
                      @add-to-list="onAddToList">
            <template #header>
                <SharedListHeader :name="profile.display_name" :initial="profile.initial" :stat="stat"
                                  :only-missing="onlyMissing" :ready="ready"
                                  @toggle-missing="toggleOnlyMissing(profile.user_id)" />
            </template>
        </TimelineList>
    </div>
</template>

<style lang="scss" scoped>
// `min-height: 0` pour que la liste scrolle — même besoin que `timeline-page`.
.shared-list-page {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
}
</style>
