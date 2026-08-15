<script setup>
// Vue « Événements » : les séances particulières de la semaine — avant-premières, séances uniques,
// labels de programmation — film par film.
//
// Route à la racine et non sous `/[year]/` : comme `/seances`, la vue ne dépend d'aucune année. Donc
// pas de middleware `valid-year`, et pas de `key`.
definePageMeta({ middleware: ['auth'] })
useHead({ title: 'Événements' })

const { films, nbEvents, scanning, scanned, days, scan } = useEvents()
const { goToSeances } = useCalendarNav()

const summary = computed(() => {
    if (!films.value.length) return 'Aucun événement repéré cette semaine'
    const f = films.value.length
    return `${f} film${f > 1 ? 's' : ''} · ${nbEvents.value} événement${nbEvents.value > 1 ? 's' : ''} dans les 7 jours`
})

// « auj. », « demain », puis « lundi 17 août ». Les deux premiers portent l'urgence bien mieux qu'une
// date à décoder.
//
// Dates découpées à la main plutôt que passées à `new Date(chaîne)` : une chaîne `YYYY-MM-DD` est
// interprétée en UTC, ce qui décale d'un jour sur les fuseaux à offset négatif. Pattern déjà banni
// ailleurs dans le projet (cf. `parseYMD` dans `useYearStats.js`).
const parseYMD = (value) => {
    const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ''))
    return parts ? new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3])) : null
}

const dayLabel = (date) => {
    const local = parseYMD(date)
    if (!local) return '?'

    const offset = Math.round((local - parseYMD(isoDay(0))) / 86400000)
    if (offset <= 0) return "Aujourd'hui"
    if (offset === 1) return 'Demain'

    return new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).format(local)
}

const posterUrl = (path) => path ? `https://image.tmdb.org/t/p/w342${path}` : null

// Sortie du film, pour situer une avant-première (« sortie le 19 août »). C'est ce qui explique
// pourquoi la séance est un événement, et pourquoi elle ne se rattrape pas.
const releaseLabel = (movie) => {
    const local = parseYMD(movie.release_date)
    if (!local) return null

    const upcoming = movie.release_date > isoDay(0)
    const when = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' }).format(local)
    return upcoming ? `Sortie le ${when}` : `Sorti le ${when}`
}

onMounted(() => scan())
</script>

<template>
    <div class="events scr">
        <div class="head">
            <h1 class="title">Événements</h1>
            <!-- `aria-live` : le relevé se poursuit après le premier rendu, et ce sous-titre est le
                 résumé de ce qui a changé. -->
            <span class="sub" aria-live="polite">{{ summary }}</span>
        </div>

        <!-- Le relevé est long à froid (7 journées) et la page se remplit en cours de route : le taire
             ferait lire une liste incomplète comme une liste complète. -->
        <p v-if="scanning" class="scanning" aria-live="polite">
            Relevé de la semaine en cours… {{ scanned }}/{{ days.length }} journées
        </p>

        <div v-if="films.length" class="list">
            <article v-for="{ movie, days: eventDays } in films" :key="movie.id" class="card">
                <!-- ⚠️ L'affiche est décorative et **hors du flux de tabulation** : elle menait au même
                     endroit que le titre, ce qui donnait deux arrêts clavier pour une seule action. Un
                     seul contrôle porte la navigation — le titre, qui la nomme. -->
                <NuxtImg v-if="posterUrl(movie.poster_path)" :src="posterUrl(movie.poster_path)"
                         :alt="''" aria-hidden="true" class="poster" loading="lazy" />
                <span v-else class="poster -placeholder" aria-hidden="true" />

                <div class="body">
                    <button class="name" type="button"
                            :aria-label="`Voir les séances de ${movie.title}`"
                            @click="goToSeances(movie.movie_id)">
                        {{ movie.title }}
                    </button>
                    <p v-if="releaseLabel(movie)" class="release">{{ releaseLabel(movie) }}</p>

                    <ul class="days">
                        <!-- Chaque journée est cliquable : elle ouvre la vue Séances sur ce jour-là,
                             cadrée sur le film. C'est la question qui suit « il y a un événement » —
                             à quelle heure, et est-ce que je peux y être. -->
                        <li v-for="day in eventDays" :key="day.date" class="day">
                            <button class="when" type="button"
                                    :aria-label="`Voir les séances de ${movie.title} le ${dayLabel(day.date)}`"
                                    @click="goToSeances(movie.movie_id, day.date)">{{ dayLabel(day.date) }}</button>
                            <span class="what">{{ day.labels.join(' · ') }}</span>
                            <span v-if="day.cinemas.length" class="where">{{ day.cinemas.join(' · ') }}</span>
                            <!-- Texte libre de l'exploitant : « en présence du réalisateur », « suivie
                                 d'une dégustation… ». Allociné ne le fournit pas — il vient du site de
                                 la salle (Dulac à ce jour, cf. `server/utils/dulac.js`). Absent la
                                 plupart du temps, donc jamais un trou dans la mise en page. -->
                            <a v-if="day.detail && day.url" class="detail" :href="day.url"
                               target="_blank" rel="noopener noreferrer"
                               :title="`Fiche de la salle — nouvel onglet`">{{ day.detail }}</a>
                            <span v-else-if="day.detail" class="detail">{{ day.detail }}</span>
                        </li>
                    </ul>
                </div>
            </article>
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
            Séances Allociné · Paris intra-muros
            <button class="refresh" type="button" :disabled="scanning" @click="scan({ force: true })">
                {{ scanning ? 'Relevé…' : 'Actualiser' }}
            </button>
        </p>
    </div>
</template>

<style lang="scss" scoped>
.events {
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 1.6rem 2.4rem 11rem;

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

// Carte film. Bord violet plutôt que la surface neutre des cartes de séances : la page entière parle
// d'événements, autant que la couleur le dise une fois pour toutes.
.card {
    display: flex;
    gap: 1.6rem;
    padding: 1.6rem;
    background: $color-surface-1;
    border: 1px solid rgba($color-event, .3);
    border-radius: 1.6rem;

    > .poster {
        display: block;
        width: 6.4rem;
        height: 9.6rem;
        flex: none;
        border-radius: .8rem;
        object-fit: cover;

        &.-placeholder { background: $color-surface-4; }
    }

    > .body {
        flex: 1;
        min-width: 0;

        > .name {
            display: block;
            padding: 0;
            background: none;
            border: 0;
            text-align: left;
            color: $color-text;
            font: $bold 1.6rem/1.2 $font-body;
            cursor: pointer;

            @media (hover: hover) {
                &:hover { color: $color-event-light; }
            }
        }

        > .release {
            margin-top: .3rem;
            color: $color-text-quiet;
            font: $normal 1.15rem/1 $font-body;
        }

        > .days {
            display: flex;
            flex-direction: column;
            gap: .8rem;
            margin-top: 1.2rem;

            > .day {
                padding-left: 1.2rem;
                border-left: 2px solid rgba($color-event, .45);

                > .when {
                    display: block;
                    padding: 0;
                    background: none;
                    border: 0;
                    text-align: left;
                    color: $color-event-light;
                    font: $bold 1.2rem/1.2 $font-body;
                    letter-spacing: .04rem;
                    text-transform: uppercase;
                    cursor: pointer;

                    @media (hover: hover) {
                        &:hover { color: $color-text; text-decoration: underline; }
                    }
                }

                > .what {
                    display: block;
                    margin-top: .2rem;
                    color: $color-text-body;
                    font: $semi-bold 1.3rem/1.3 $font-body;
                }

                > .where {
                    display: block;
                    margin-top: .1rem;
                    color: $color-text-muted;
                    font: $normal 1.2rem/1.3 $font-body;
                }

                > .detail {
                    display: block;
                    margin-top: .4rem;
                    color: $color-event-light;
                    font: $normal 1.25rem/1.4 $font-body;

                    &[href] {
                        text-decoration: underline;
                        text-decoration-color: rgba($color-event, .5);

                        @media (hover: hover) {
                            &:hover { color: $color-text; }
                        }
                    }
                }
            }
        }
    }
}

@media (max-width: 999px) {
    .events { padding: 1.4rem 1.4rem 11rem; }
}
</style>
