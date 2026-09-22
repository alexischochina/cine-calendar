<script setup>
// Vue « Événements » : les séances particulières de la semaine — avant-premières, séances uniques,
// labels de programmation.
//
// Route à la racine et non sous `/[year]/` : comme `/seances`, la vue ne dépend d'aucune année. Donc
// pas de middleware `valid-year`, et pas de `key`.
//
// Deux regroupements du même lot d'événements, comme la vue Séances :
//   - « Par film » répond à « qu'est-ce qui se passe autour de ce film » ;
//   - « Par jour » répond à « qu'est-ce qu'il y a ce soir », la question du samedi après-midi.
// Aucun des deux ne déclenche de requête : tout est dérivé du relevé déjà fait.
definePageMeta({ middleware: ['auth'] })

// Le périmètre annoncé en pied de page suit la ville du profil, jamais un nom en dur.
const { cityInfo } = useProfile()
useHead({ title: 'Événements' })

const { films, scanning, scanned, days, scan } = useEvents()
const { goToSeances } = useCalendarNav()

const group = ref('film')
const kind = ref('all')
const openCard = ref(null)

// Types réellement présents cette semaine, et pas une liste figée : offrir un filtre qui ne trouve
// rien serait pire que ne pas l'offrir.
//
// ⚠️ Sur `entryKinds`, donc sur **tout ce que les pastilles montrent**, précisions d'exploitant
// comprises. Le tri alphabétique range chaque précision sous sa famille (« Avant-première », puis
// « Avant-première avec équipe »), et filtrer la famille garde bien les deux.
const kinds = computed(() =>
    [...new Set(films.value.flatMap(f => f.entries.flatMap(entryKinds)))].sort((a, b) => a.localeCompare(b))
)

// ⚠️ Un type peut **disparaître** en cours de relevé : ceux des exploitants tiennent à un connecteur
// qui peut échouer ou ne répondre qu'en partie (cf. `fetchUgcLabels`), là où ceux d'Allociné sont
// stables. Rester dessus donnait une page vide et un menu affichant une valeur qui n'existe plus.
watch(kinds, (list) => {
    if (kind.value !== 'all' && !list.includes(kind.value)) kind.value = 'all'
})

const filtered = computed(() => {
    if (kind.value === 'all') return films.value

    return films.value
        .map(f => ({ ...f, entries: f.entries.filter(e => entryKinds(e).includes(kind.value)) }))
        .filter(f => f.entries.length)
})

const nbFiltered = computed(() => filtered.value.reduce((n, f) => n + f.entries.length, 0))

const byFilm = computed(() =>
    filtered.value.map(f => ({ key: `f${f.movie.id}`, movie: f.movie, entries: f.entries }))
)

// Même matière, retournée : chaque couple (film, séance événement) est reversé dans sa journée. Les
// journées sont triées par date — une chaîne `YYYY-MM-DD` se trie comme la date qu'elle décrit — et
// les films gardent l'ordre d'imminence que `useEvents` leur a donné.
const byDay = computed(() => {
    const buckets = new Map()

    for (const { movie, entries } of filtered.value) {
        for (const entry of entries) {
            if (!buckets.has(entry.date)) buckets.set(entry.date, { key: `d${entry.date}`, date: entry.date, entries: [] })
            buckets.get(entry.date).entries.push({ movie, entry })
        }
    }

    return [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date))
})

const buckets = computed(() => group.value === 'film' ? byFilm.value : byDay.value)

const summary = computed(() => {
    if (!films.value.length) return 'Aucun événement repéré cette semaine'
    if (!nbFiltered.value) return 'Aucun événement de ce type cette semaine'

    return `${nbFiltered.value} événement${nbFiltered.value > 1 ? 's' : ''} · 7 jours`
})

const toggleCard = (key) => { openCard.value = openCard.value === key ? null : key }

// La première carte s'ouvre toute seule, et se recale quand le lot change (changement de
// regroupement, de filtre, ou fin du relevé). Un accordéon entièrement fermé à l'arrivée cacherait
// la seule chose qu'on vient chercher ; laisser une clé morte (`f12` n'existe pas côté « par jour »)
// reviendrait au même.
watch([buckets, group, kind], () => {
    if (buckets.value.some(b => b.key === openCard.value)) return
    openCard.value = buckets.value[0]?.key ?? null
}, { immediate: true })

// La date part avec le clic : la ligne annonce « dimanche 16 août », la vue Séances doit s'ouvrir sur
// ce jour-là et pas sur aujourd'hui.
const openSeances = (movie, date) => goToSeances(movie.movie_id, date)

onMounted(() => scan())
</script>

<template>
    <div class="events-page scr">
        <div class="head">
            <h1 class="title">Événements &amp; avant-premières</h1>
            <!-- `aria-live` : le relevé se poursuit après le premier rendu, et ce sous-titre est le
                 résumé de ce qui a changé. -->
            <span class="sub" aria-live="polite">{{ summary }}</span>
        </div>

        <EventsEventFilters v-if="films.length" class="filters" :group="group" :kind="kind" :kinds="kinds"
                            @update:group="group = $event" @update:kind="kind = $event" />

        <!-- Le relevé est long à froid (7 journées) et la page se remplit en cours de route : le taire
             ferait lire une liste incomplète comme une liste complète. -->
        <p v-if="scanning" class="scanning" aria-live="polite">
            Relevé de la semaine en cours… {{ scanned }}/{{ days.length }} journées
        </p>

        <div v-if="buckets.length" class="list">
            <EventsCard v-for="bucket in buckets" :key="bucket.key" :mode="group" :bucket="bucket"
                        :open="openCard === bucket.key" @toggle="toggleCard(bucket.key)"
                        @select="openSeances" />
        </div>

        <!-- Le filtre a tout mangé : message distinct de la page vide, avec la sortie de secours.
             Sans ça, « aucun événement » se lirait comme une semaine creuse. -->
        <div v-else-if="films.length" class="state">
            <p class="msg">Aucun événement de ce type dans les 7 prochains jours.</p>
            <button class="action" type="button" @click="kind = 'all'">Voir tous les types</button>
        </div>

        <!-- Vide, mais pas forcément vide : tant que le relevé tourne, on ne conclut rien. -->
        <div v-else-if="!scanning" class="state">
            <p class="msg">Aucun événement repéré dans les 7 prochains jours.</p>
            <p class="hint">
                Avant-premières, séances uniques et labels de programmation des films de ta liste
                apparaissent ici. Le relevé se fait sur les séances Allociné.
            </p>
            <button class="action" type="button" @click="scan({ force: true })">Relever à nouveau</button>
        </div>

        <p class="source">
            Séances Allociné · {{ cityInfo.scopeLabel }}
            <button class="refresh" type="button" :disabled="scanning" @click="scan({ force: true })">
                {{ scanning ? 'Relevé…' : 'Actualiser' }}
            </button>
        </p>
    </div>
</template>

<style lang="scss" scoped>
// Chrome de page repris tel quel de `/seances` — même gouttière, même en-tête, mêmes états vides,
// même pied de source. Les deux vues sont voisines dans la navigation : une différence de gabarit
// entre elles se lirait comme un changement d'application.
.events-page {
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 1.6rem 2.4rem 11rem;

    > .filters { margin-bottom: 1.6rem; }

    > .scanning {
        margin-bottom: 1.6rem;
        color: $color-event-light;
        font: $normal 1.2rem/1.4 $font-body;
    }

    > .list {
        display: flex;
        flex-direction: column;
        gap: 1.4rem;
    }

    > .state {
        padding: 6rem 0;
        text-align: center;

        > .msg {
            color: $color-text-muted;
            font: $normal 1.4rem/1.5 $font-body;
        }

        > .hint {
            max-width: 52rem;
            margin: .8rem auto 0;
            color: $color-text-quiet;
            font: $normal 1.25rem/1.5 $font-body;
        }

        > .action {
            @include focusRing($color: $color-event-light);
            margin-top: 1.6rem;
            padding: .8rem 1.6rem;
            background: $color-surface-1;
            border: 1px solid $color-event;
            border-radius: 1rem;
            color: $color-event-light;
            font: $semi-bold 1.25rem/1 $font-body;
            cursor: pointer;
        }
    }

    > .source {
        display: flex;
        align-items: baseline;
        flex-wrap: wrap;
        gap: .8rem;
        margin-top: 2rem;
        color: $color-text-quiet;
        font: $normal 1.15rem/1.4 $font-body;

        > .refresh {
            @include focusRing($color: $color-event-light);
            padding: .4rem .9rem;
            background: transparent;
            border: 1px solid $color-border-4;
            border-radius: 999px;
            color: $color-text-dim;
            font: $semi-bold 1.1rem/1 $font-body;
            cursor: pointer;

            &:disabled { opacity: .5; cursor: default; }

            @media (hover: hover) {
                &:not(:disabled):hover { color: $color-event-light; border-color: $color-event; }
            }
        }
    }
}

.head {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 1.2rem;
    margin-bottom: 1.6rem;

    > .title {
        color: $color-text;
        font: 800 2.6rem/1 $font-title;
        letter-spacing: -.06rem;
    }

    > .sub {
        color: $color-text-quiet;
        font: $normal 1.3rem/1 $font-body;
    }
}

@media (max-width: 999px) {
    .events-page { padding: 1.4rem 1.4rem 11rem; }
}
</style>
