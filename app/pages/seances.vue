<script setup>
// Vue « Séances » : où voir, à Paris, les films de ma liste encore à l'affiche.
// Route à la racine et non sous `/[year]/` — la vue ne dépend d'aucune année : donc pas de
// middleware `valid-year`, et pas de `key` (rien à réutiliser entre années).
definePageMeta({ middleware: ['auth'] })
useHead({ title: 'Séances à Paris' })

const {
    days, dayIndex, group, timeSlot, customRange, ugcOnly, openCard, focusFilmId,
    loading, error, stale, silentCinemas, hasUnconfirmed, films, focusFilm, unresolved, byFilm, byCinema,
    nbFilms, nbSeances, nbEvents, hiddenByCard, hiddenByTime, hiddenEvents, nextDate, updatedAt,
    load, retry, refreshDay, selectDay, toggleFavorite, jumpToNextAvailableDay, syncToday, refreshCinemas,
} = useSeances()

const route = useRoute()
const router = useRouter()

const buckets = computed(() => group.value === 'film' ? byFilm.value : byCinema.value)

const toggleCard = (key) => { openCard.value = openCard.value === key ? null : key }

// Résumé du sous-titre. Cadré sur un film, « 12 films en salle » serait faux : ce n'est plus le
// périmètre affiché.
const summary = computed(() => focusFilm.value
    ? `${nbSeances.value} séance${nbSeances.value > 1 ? 's' : ''} pour ce film`
    : `${nbFilms.value} film${nbFilms.value > 1 ? 's' : ''} de ma liste en salle · ${nbSeances.value} séances`)

// `?film=<tmdbId>` → id de ligne `calendar`. C'est la page qui fait la conversion : elle seule
// connaît la route, le composable ne raisonne qu'en identifiants de liste.
const applyFocusFromRoute = () => {
    const raw = route.query.film
    if (!raw) { focusFilmId.value = null; return }
    focusFilmId.value = films.value.find(m => String(m.movie_id) === String(raw))?.id ?? null
}

// `?jour=YYYY-MM-DD` → la journée à ouvrir. Posé par un clic sur un événement daté du rail ou de la
// page Événements : la carte annonçait « dim. 16 août », atterrir sur aujourd'hui obligerait à
// retrouver le jour à la main.
//
// Une date hors des sept jours affichés (lien vieilli, événement passé) est ignorée : mieux vaut
// aujourd'hui qu'un index invalide. Renvoie `true` si la journée a été appliquée — l'appelant s'en
// sert pour ne pas la faire corriger par le saut automatique juste après.
const applyDayFromRoute = () => {
    const wanted = String(route.query.jour ?? '')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(wanted)) return false

    const index = days.value.findIndex(d => d.date === wanted)
    if (index < 0) return false

    dayIndex.value = index
    openCard.value = null
    return true
}

// `replace` et non `push` : le retrait du cadrage n'a pas à créer une entrée d'historique, sinon le
// bouton « précédent » y ramène aussitôt.
const clearFocus = () => {
    focusFilmId.value = null
    router.replace({ path: '/seances' })
}

// Un seul groupe à l'écran (le cas normal quand on arrive du rail en mode « Par film ») : on
// l'ouvre. Arriver sur une carte fermée alors qu'on venait justement voir ses horaires serait un
// clic de trop.
watch([focusFilm, buckets], ([focus, list]) => {
    if (focus && list.length === 1) openCard.value = list[0].key
}, { immediate: true })

// Changer de regroupement rebat les cartes : garder une carte ouverte n'aurait plus de sens
// (la clé `f12` n'existe pas côté « par cinéma »).
watch(group, () => { openCard.value = null })

// `parseLocalDate` : `app/utils/localDate.js` — jamais `new Date('2026-08-17')`, qui se lit en UTC et
// retombe la veille sur un fuseau à offset négatif.
//
// « 13 août » pour le signalement d'une salle absente…
const silenceLabel = (date) => {
    const local = parseLocalDate(date)
    return local ? new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' }).format(local) : '?'
}

// … et « vendredi 4 septembre » pour la prochaine séance.
const nextDateLabel = computed(() => {
    const local = parseLocalDate(nextDate.value)
    return local
        ? new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).format(local)
        : null
})

// Âge du dernier chargement, pour ne pas relire à chaque retour d'onglet (cf. `onVisible`).
let lastLoadedAt = 0

// Le saut vers le premier jour avec séances n'a lieu qu'à l'**arrivée** sur un film, jamais après.
// Sans cette mémoire, choisir soi-même un jour vide se ferait corriger dans le dos au premier
// rafraîchissement de la liste — le choix de l'utilisateur prime toujours sur le nôtre.
let jumpedFor = null

const focusThenLoad = async () => {
    applyFocusFromRoute()
    // Avant le chargement : `load()` ne demande que la journée sélectionnée, la poser après coup
    // ferait un aller-retour réseau pour rien.
    const pinnedDay = applyDayFromRoute()
    lastLoadedAt = Date.now()
    await load()

    if (!focusFilmId.value) { jumpedFor = null; return }
    if (jumpedFor === focusFilmId.value) return

    jumpedFor = focusFilmId.value
    // Journée demandée explicitement : on n'y touche pas. Le saut automatique existe pour éviter un
    // mur vide quand on ne sait pas où regarder — ici on sait, et corriger le choix de l'utilisateur
    // dans son dos est précisément ce que le reste de la vue s'interdit.
    if (!pinnedDay) await jumpToNextAvailableDay()
}

// Retour sur l'onglet : la page a pu rester ouverte des heures, voire passer minuit. On recale la
// semaine si la date a changé, sinon on relit le jour affiché — dans les deux cas sans écran de
// chargement, puisqu'il y a déjà quelque chose à l'écran.
//
// ⚠️ Un `onMounted` seul ne suffit pas : une page qu'on laisse ouverte n'est jamais remontée, et son
// cache mémoire ressert indéfiniment la journée telle qu'elle était au chargement (constaté le
// 13/08/2026 sur une visite de la veille, cache serveur pourtant expiré). Relire à chaque retour
// d'onglet serait exagéré — un alt-tab de dix secondes ferait clignoter l'état de chargement pour
// rien. On ne relit que si l'écran a vieilli ; un changement de date, lui, passe toujours.
const RELOAD_AFTER_MS = 5 * 60 * 1000

const onVisible = async () => {
    if (document.visibilityState !== 'visible') return

    if (await syncToday()) { lastLoadedAt = Date.now(); return }
    if (Date.now() - lastLoadedAt < RELOAD_AFTER_MS) return

    lastLoadedAt = Date.now()
    // Le référentiel est lu une fois par visite : sans ce rappel, un signalement posé par
    // `check-seances.mjs` pendant que la page est ouverte n'apparaîtrait qu'au prochain
    // rechargement complet. 53 lignes, on peut se le permettre toutes les cinq minutes.
    refreshCinemas()
    load()
}

// Rien n'est chargé avant l'ouverture de l'onglet : le composable n'est monté que par cette page.
//
// ⚠️ Second `visibilitychange` de la vue : `useShowtimes.wireSnapshot` en pose un autre, qui survit à
// la navigation à dessein. Celui-ci meurt avec la page, puisqu'il la recharge.
onMounted(() => {
    document.addEventListener('visibilitychange', onVisible)
    focusThenLoad()
})

onBeforeUnmount(() => document.removeEventListener('visibilitychange', onVisible))

// Deux causes de recadrage, **un seul watch**, et c'est délibéré :
//
//   - la route — naviguer d'un film à l'autre depuis le rail ne remonte pas la page (même route),
//     c'est ce watch qui recadre. La journée en fait partie : cliquer deux événements du même film à
//     des dates différentes ne change que `?jour` ;
//   - la composition de `films` — rechargement direct sur `/seances`, où le layout charge `movies`
//     dans SON `onMounted`, déclenché *après* celui de la page (Vue monte les enfants avant les
//     parents) : le `load` du montage tomberait sur une liste vide. On surveille la composition et
//     pas seulement la longueur, le contrôle « en salle » pouvant remplacer un film par un autre.
//
// ⚠️ Deux `watch` séparés se déclenchaient **tous les deux** au retour de `useInTheatersSync` quand
// il ajoute un film alors qu'on arrive avec un `?film` : deux `focusThenLoad` concurrents, donc deux
// `applyDayFromRoute` et surtout deux `jumpToNextAvailableDay` — celui-ci enchaîne jusqu'à trois
// `load()` et déplace la journée affichée. Le coût réseau était nul (le L1 absorbe), le saut de jour
// en double, lui, se voyait. Une source unique règle les deux d'un coup.
const focusKey = computed(() =>
    [route.query.film ?? '', route.query.jour ?? '', films.value.map(m => m.id).join(',')].join('|')
)

watch(focusKey, (now, before) => {
    if (now === before) return
    focusThenLoad()
})
</script>

<template>
    <div class="seances-page scr">
        <div class="head">
            <h1 class="title">Séances à Paris</h1>
            <!-- `aria-live` ici plutôt que sur la liste : changer de jour ou de filtre remplace tout
                 le contenu en silence, et ce sous-titre est justement le résumé de ce qui a changé.
                 Annoncer la liste entière serait assourdissant. -->
            <span class="sub" aria-live="polite">{{ summary }}</span>
        </div>

        <!-- Cadrage sur un film (arrivée depuis « Au ciné en ce moment »). Toujours visible et
             toujours réversible en un clic : un filtre qu'on ne voit pas est un bug pour celui qui
             le subit. -->
        <div v-if="focusFilm" class="focus">
            <NuxtImg v-if="focusFilm.poster_path" :src="`https://image.tmdb.org/t/p/w342${focusFilm.poster_path}`"
                     :alt="''" class="poster" aria-hidden="true" loading="lazy" />
            <span class="txt">Séances de <strong>{{ focusFilm.title }}</strong></span>
            <button class="clear" type="button" @click="clearFocus">Tous les films</button>
        </div>

        <SeancesDayStrip class="days" :days="days" :active-index="dayIndex" @select="selectDay" />

        <SeancesSeanceFilters class="filters" :group="group" :time-slot="timeSlot"
                              :custom-range="customRange" :ugc-only="ugcOnly"
                              @update:group="group = $event" @update:time-slot="timeSlot = $event"
                              @update:custom-range="customRange = $event"
                              @update:ugc-only="ugcOnly = $event" />

        <!-- Séances événement écartées par le pré-filtre carte — le cas d'une avant-première, que la
             carte UGC ne couvre pas. Dit et non tu : le badge du rail promet un événement, la page
             doit expliquer pourquoi il n'y est pas et rouvrir d'un clic. -->
        <p v-if="hiddenEvents" class="warn -event">
            {{ hiddenEvents }} séance{{ hiddenEvents > 1 ? 's' : '' }} événement hors carte UGC
            (une avant-première n'est pas couverte) — masquée{{ hiddenEvents > 1 ? 's' : '' }} par le pré-filtre.
            <button class="link" type="button" @click="ugcOnly = false">Ouvrir à tout Paris</button>
        </p>

        <!-- Horaires servis depuis une entrée périmée : on les montre quand même (mieux qu'une page
             vide) mais on l'annonce, la billetterie restant l'arbitre. -->
        <p v-if="stale" class="warn">Horaires possiblement datés — à vérifier sur la billetterie.</p>

        <!-- Salles retirées de la source mais vues récemment : gardées à l'écran plutôt que
             silencieusement effacées. Le badge sur la ligne dit lesquelles, ce message dit pourquoi. -->
        <p v-if="hasUnconfirmed" class="warn">
            Certaines séances viennent d'un relevé précédent et ne sont plus confirmées par la source
            (marquées « non confirmé ») — elles existent probablement, mais la billetterie tranche.
        </p>

        <!-- Salle absente de la source. Dit à la place de la vue ce que la vue ne peut pas montrer :
             sans ça, l'absence se lit comme « ce cinéma ne joue rien », ce qui est faux. -->
        <p v-for="cinema in silentCinemas" :key="cinema.name" class="warn">
            {{ cinema.name }} n'est plus publié par Allociné depuis le {{ silenceLabel(cinema.since) }} —
            ses séances existent peut-être, mais ne peuvent pas être listées ici. À vérifier sur le site de la salle.
        </p>

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

        <!-- 3. Aucun film en salle dans la liste : la vue n'a rien à se mettre sous la dent. L'état
             « En salle » étant désormais contrôlé sur les séances Allociné, il n'y a plus rien à
             faire à la main — on le dit, plutôt que d'envoyer marquer des films dans la timeline. -->
        <div v-else-if="!films.length" class="state">
            <p class="msg">Aucun film de ta liste n'est actuellement à l'affiche à Paris.</p>
            <p class="hint">La liste se met à jour toute seule chaque semaine, à partir des séances Allociné.</p>
        </div>

        <!-- 4. Le pré-filtre carte a tout mangé : message distinct, avec la sortie de secours. -->
        <div v-else-if="!buckets.length && hiddenByCard > 0" class="state">
            <p class="msg">Aucune séance acceptant la carte UGC pour ces critères.</p>
            <p class="hint">{{ hiddenByCard }} séance{{ hiddenByCard > 1 ? 's' : '' }} dans les autres salles parisiennes.</p>
            <button class="action" type="button" @click="ugcOnly = false">Ouvrir à tout Paris</button>
        </div>

        <!-- 4 bis. Le filtre horaire a tout mangé : on le dit et on rouvre la journée d'un clic,
             plutôt que d'annoncer une journée vide qui ne l'est pas. -->
        <div v-else-if="!buckets.length && hiddenByTime > 0" class="state">
            <p class="msg">Aucune séance dans cette plage horaire.</p>
            <p class="hint">{{ hiddenByTime }} séance{{ hiddenByTime > 1 ? 's' : '' }} en dehors du créneau choisi.</p>
            <button class="action" type="button" @click="timeSlot = 'all'">Voir toutes les heures</button>
        </div>

        <!-- 5. Journée réellement vide : on exploite `nextDate` plutôt que de laisser sur un mur.
             Cadré sur un film, on nomme le film — « aucune séance » sans sujet laisserait croire que
             la journée entière est vide. -->
        <div v-else-if="!buckets.length" class="state">
            <p class="msg">Aucune séance {{ focusFilm ? `pour « ${focusFilm.title} »` : 'pour ces critères' }} ce jour-là.</p>
            <p v-if="nextDateLabel" class="hint">Prochaine séance le {{ nextDateLabel }}.</p>
            <button v-if="focusFilm" class="action" type="button" @click="clearFocus">Voir tous les films</button>
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

        <!-- Quand la vue et le site de la salle divergent, c'est cet horodatage qui tranche.
             ⚠️ `aria-live` sur le **seul horodatage**, jamais sur le `<p>` : celui-ci contient le
             bouton, dont le libellé bascule à chaque chargement — la région annoncerait
             « Actualisation… » en boucle et noierait la seule information qui compte. -->
        <p class="source">
            Séances Allociné · Paris intra-muros<span v-if="updatedAt" aria-live="polite"> · relevé {{ updatedAt }}</span>
            <!-- `aria-disabled` plutôt que `disabled` : un bouton désactivé sort du parcours clavier au
                 moment où l'utilisateur vient de l'actionner, et le focus retombe en début de page. -->
            <button class="refresh" type="button" :aria-disabled="loading" @click="loading || refreshDay()">
                {{ loading ? 'Actualisation…' : 'Actualiser' }}
            </button>
        </p>
    </div>
</template>

<style lang="scss" scoped>
.seances-page {
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 1.6rem 2.4rem 11rem;

    > .days { margin-bottom: 1.6rem; }
    > .filters { margin-bottom: 1.6rem; }

    > .focus {
        display: flex;
        align-items: center;
        gap: 1.2rem;
        margin-bottom: 1.6rem;
        padding: .8rem 1.2rem .8rem .8rem;
        background: rgba($color-primary, .12);
        border: 1px solid rgba($color-primary, .35);
        border-radius: 1.2rem;

        > .poster {
            width: 3.2rem;
            height: 4.8rem;
            flex: none;
            border-radius: .6rem;
            object-fit: cover;
        }

        > .txt {
            flex: 1;
            min-width: 0;
            color: $color-text-muted;
            font: $normal 1.3rem/1.3 $font-body;

            > strong { color: $color-text; font-weight: $bold; }
        }

        > .clear {
            @include focusRing;
            flex: none;
            padding: .6rem 1.2rem;
            background: transparent;
            border: 1px solid $color-border-4;
            border-radius: 999px;
            color: $color-text-dim;
            font: $semi-bold 1.15rem/1 $font-body;
            cursor: pointer;
            transition: color .18s ease, border-color .18s ease;

            @media (hover: hover) {
                &:hover { color: $color-text; border-color: $color-primary; }
            }
        }
    }

    > .warn {
        margin-bottom: 1.6rem;
        color: $color-yellow;
        font: $normal 1.2rem/1.4 $font-body;

        // Violet et non ambre : celui-ci ne met pas en garde sur la fraîcheur d'une donnée, il explique
        // où sont passés les événements. Même famille de couleur que les marqueurs auxquels il renvoie.
        &.-event { color: $color-event-light; }

        > .link {
            @include focusRing;
            padding: 0;
            background: none;
            border: 0;
            color: inherit;
            font: inherit;
            text-decoration: underline;
            cursor: pointer;

            @media (hover: hover) {
                &:hover { color: $color-text; }
            }
        }
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
            @include focusRing;
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
        display: flex;
        align-items: baseline;
        flex-wrap: wrap;
        gap: .8rem;
        margin-top: 2rem;
        color: $color-text-quiet;
        font: $normal 1.15rem/1.4 $font-body;

        > .refresh {
            @include focusRing;
            padding: .4rem .9rem;
            background: transparent;
            border: 1px solid $color-border-4;
            border-radius: 999px;
            color: $color-text-dim;
            font: $semi-bold 1.1rem/1 $font-body;
            cursor: pointer;
            transition: color .18s ease, border-color .18s ease;

            // `[aria-disabled]` et non `:disabled` : le bouton reste focusable (cf. le gabarit).
            &[aria-disabled='true'] { opacity: .5; cursor: default; }

            @media (hover: hover) {
                &:not(:disabled):hover { color: $color-primary-light; border-color: $color-primary; }
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

@keyframes seancesghost {
    0%, 100% { opacity: 1; }
    50% { opacity: .55; }
}

@media (max-width: 999px) {
    .seances-page { padding: 1.4rem 1.4rem 11rem; }
}
</style>
