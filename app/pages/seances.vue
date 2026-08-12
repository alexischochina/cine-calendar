<script setup>
// Vue « Séances » : où voir, à Paris, les films de ma liste encore à l'affiche.
// Route à la racine et non sous `/[year]/` — la vue ne dépend d'aucune année (cf. Step 11 du plan) :
// donc pas de middleware `valid-year`, et pas de `key` (rien à réutiliser entre années).
definePageMeta({ middleware: ['auth'] })
useHead({ title: 'Séances à Paris' })

const {
    days, dayIndex, group, version, arrondissement, ugcOnly, openCard,
    loading, error, stale, films, unresolved, byFilm, byCinema,
    nbFilms, nbSeances, hiddenByCard, arrondissements, nextDate, updatedAt,
    load, retry, selectDay, toggleFavorite,
} = useSeances()

const buckets = computed(() => group.value === 'film' ? byFilm.value : byCinema.value)

const toggleCard = (key) => { openCard.value = openCard.value === key ? null : key }

// Changer de regroupement rebat les cartes : garder une carte ouverte n'aurait plus de sens
// (la clé `f12` n'existe pas côté « par cinéma »).
watch(group, () => { openCard.value = null })

// « vendredi 4 septembre ». La date est découpée à la main plutôt que passée à `new Date(chaîne)` :
// une chaîne `YYYY-MM-DD` est interprétée en UTC, ce qui décale d'un jour sur les fuseaux à offset
// négatif. Le projet a déjà banni ce pattern (cf. `parseYMD` dans `useYearStats.js`).
const nextDateLabel = computed(() => {
    const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(nextDate.value ?? '')
    if (!parts) return null

    const local = new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]))
    return new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).format(local)
})

// Rien n'est chargé avant l'ouverture de l'onglet : le composable n'est monté que par cette page.
onMounted(load)

// ⚠️ Rechargement direct sur `/seances` : le layout charge `movies` dans SON `onMounted`, qui se
// déclenche *après* celui de la page (Vue monte les enfants avant les parents). Le `load` ci-dessus
// tomberait donc sur une liste vide. On relance une fois, quand les films arrivent — et une seule,
// d'où la garde sur la transition 0 → N (venir de la timeline trouve la liste déjà pleine).
watch(() => films.value.length, (count, before) => {
    if (count && !before) load()
})
</script>

<template>
    <div class="seances scr">
        <div class="head">
            <h1 class="title">Séances à Paris</h1>
            <!-- `aria-live` ici plutôt que sur la liste : changer de jour ou de filtre remplace tout
                 le contenu en silence, et ce sous-titre est justement le résumé de ce qui a changé.
                 Annoncer la liste entière serait assourdissant. -->
            <span class="sub" aria-live="polite">
                {{ nbFilms }} films de ma liste en salle · {{ nbSeances }} séances
            </span>
        </div>

        <SeancesDayStrip class="days" :days="days" :active-index="dayIndex" @select="selectDay" />

        <SeancesSeanceFilters class="filters" :group="group" :version="version"
                              :arrondissement="arrondissement" :ugc-only="ugcOnly"
                              :arrondissements="arrondissements"
                              @update:group="group = $event" @update:version="version = $event"
                              @update:arrondissement="arrondissement = $event"
                              @update:ugc-only="ugcOnly = $event" />

        <!-- Horaires servis depuis une entrée périmée : on les montre quand même (mieux qu'une page
             vide) mais on l'annonce, la billetterie restant l'arbitre. -->
        <p v-if="stale" class="warn">Horaires possiblement datés — à vérifier sur la billetterie.</p>

        <!-- 1. Chargement : squelette de cartes plutôt qu'un écran vide qui clignote. Décoratif pour
             le lecteur d'écran, qui reçoit l'information par `aria-busy` sur la région. -->
        <div v-if="loading && !buckets.length" class="skeleton" aria-hidden="true">
            <span v-for="n in 3" :key="n" class="ghost" />
        </div>

        <!-- 2. Échec réseau — priorité sur les états vides : sans ça « aucune séance » ferait
             croire à une programmation vide alors qu'on n'a rien pu joindre. -->
        <div v-else-if="error" class="state">
            <p class="msg">{{ error }}</p>
            <button class="action" type="button" @click="retry">Réessayer</button>
        </div>

        <!-- 3. Aucun film en salle dans la liste : la vue n'a rien à se mettre sous la dent. -->
        <div v-else-if="!films.length" class="state">
            <p class="msg">Aucun film de ta liste n'est marqué « En salle ».</p>
            <p class="hint">Marque des films « En salle » depuis la timeline pour les voir apparaître ici.</p>
        </div>

        <!-- 4. Le pré-filtre carte a tout mangé : message distinct, avec la sortie de secours. -->
        <div v-else-if="!buckets.length && hiddenByCard > 0" class="state">
            <p class="msg">Aucune séance acceptant la carte UGC pour ces critères.</p>
            <p class="hint">{{ hiddenByCard }} séance{{ hiddenByCard > 1 ? 's' : '' }} dans les autres salles parisiennes.</p>
            <button class="action" type="button" @click="ugcOnly = false">Ouvrir à tout Paris</button>
        </div>

        <!-- 5. Journée réellement vide : on exploite `nextDate` plutôt que de laisser sur un mur. -->
        <div v-else-if="!buckets.length" class="state">
            <p class="msg">Aucune séance pour ces critères.</p>
            <p v-if="nextDateLabel" class="hint">Prochaine séance le {{ nextDateLabel }}.</p>
        </div>

        <div v-else class="list" :aria-busy="loading">
            <SeancesSeanceGroup v-for="bucket in buckets" :key="bucket.key" :mode="group"
                                :bucket="bucket" :open="openCard === bucket.key"
                                @toggle="toggleCard(bucket.key)" @toggle-favorite="toggleFavorite" />
        </div>

        <!-- 6. Films non rapprochés d'une fiche Allociné : grisés et explicites plutôt que
             silencieusement absents — sinon on les croit sans séance. -->
        <div v-if="unresolved.length" class="unresolved">
            <p class="label">Non trouvés chez Allociné</p>
            <p v-for="movie in unresolved" :key="movie.id" class="item">
                {{ movie.title }} — impossible de retrouver ce film à l'affiche, ses séances ne sont pas listées.
            </p>
        </div>

        <p class="source">
            Séances Allociné · Paris intra-muros<template v-if="updatedAt"> · mis à jour à {{ updatedAt }}</template>
        </p>
    </div>
</template>

<style lang="scss" scoped>
.seances {
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 1.6rem 2.4rem 11rem;

    > .days { margin-bottom: 1.6rem; }
    > .filters { margin-bottom: 1.6rem; }

    > .warn {
        margin-bottom: 1.6rem;
        color: $color-yellow;
        font: $normal 1.2rem/1.4 $font-body;
    }

    > .list {
        display: flex;
        flex-direction: column;
        gap: 1.4rem;
    }

    > .skeleton {
        display: flex;
        flex-direction: column;
        gap: 1.4rem;

        > .ghost {
            height: 9.8rem;
            background: $color-surface-1;
            border: 1px solid $color-border-2;
            border-radius: 1.6rem;
            animation: seancesghost 1.4s ease-in-out infinite;
        }
    }

    > .state {
        padding: 6rem 0;
        text-align: center;

        > .msg {
            color: $color-text-muted;
            font: $normal 1.4rem/1.5 $font-body;
        }

        > .hint {
            margin-top: .8rem;
            color: $color-text-quiet;
            font: $normal 1.25rem/1.5 $font-body;
        }

        > .action {
            margin-top: 1.6rem;
            padding: .8rem 1.6rem;
            background: $color-surface-1;
            border: 1px solid $color-primary;
            border-radius: 1rem;
            color: $color-primary-light;
            font: $semi-bold 1.25rem/1 $font-body;
            cursor: pointer;
            transition: color .18s ease;

            @media (hover: hover) {
                &:hover { color: $color-primary-lighter; }
            }
        }
    }

    > .unresolved {
        margin-top: 1.6rem;
        padding: 1.6rem;
        background: $color-surface-4;
        border: 1px solid $color-border-2;
        border-radius: 1.6rem;

        > .label {
            margin-bottom: .8rem;
            color: $color-text-quiet;
            font: $bold 1.1rem/1 $font-body;
            letter-spacing: .12rem;
            text-transform: uppercase;
        }

        > .item {
            color: $color-text-quiet;
            font: $normal 1.25rem/1.5 $font-body;
        }
    }

    > .source {
        margin-top: 2rem;
        color: $color-text-quiet;
        font: $normal 1.15rem/1.4 $font-body;
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

@keyframes seancesghost {
    0%, 100% { opacity: 1; }
    50% { opacity: .55; }
}

@media (max-width: 999px) {
    .seances { padding: 1.4rem 1.4rem 11rem; }
}
</style>
