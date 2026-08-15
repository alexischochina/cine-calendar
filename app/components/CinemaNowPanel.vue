<script setup>
// Deux rubriques, dans cet ordre :
//
//   1. « Événements à venir » — films avec une séance événement devant eux (avant-première, séance
//      unique, label de programmation). ⚠️ Ces films ne sont pas forcément à l'affiche : une
//      avant-première a lieu *avant* la sortie, donc le film n'est pas « en salle » (cf.
//      `useUpcomingEvents`). C'est la rubrique qui porte l'urgence — une avant-première ne se
//      rattrape pas, contrairement à un film qui restera trois semaines à l'affiche.
//
//      Elle ne dit que **le film et le jour** de son prochain événement. 26,4 rem de large ne portent
//      pas cinq lignes datées de façon lisible, et un rail qui essaie de tout dire ne dit plus rien :
//      le type d'événement, la salle et les autres dates vivent sur `/evenements`, vers laquelle
//      l'en-tête renvoie. Seul le badge de l'affiche garde trace du nombre de journées.
//   2. « Au ciné en ce moment » — films `state === 'inTheaters'`, c'est-à-dire, depuis
//      `useInTheatersSync`, ceux qui ont une séance à Paris dans les 7 jours qui viennent. Les films
//      remontés en 1 en sont retirés pour ne pas se lire deux fois (cf. `cinemaNow`).
//
//  - variant 'rail'  : colonne de droite (desktop)
//  - variant 'band'  : bande horizontale repliable en haut de la timeline (mobile)
//
// Clic sur un item → vue Séances cadrée sur ce film. C'est la suite naturelle de « il est en salle » :
// la question d'après est toujours *où et quand*, jamais « où est-il dans ma timeline ».
const props = defineProps({
    movies: {
        type: Array,
        default: () => [],
    },
    // Films de la rubrique « Événements à venir », déjà triés par imminence par `eventSoon`.
    eventMovies: {
        type: Array,
        default: () => [],
    },
    variant: {
        type: String,
        default: 'rail',
        validator: (v) => ['rail', 'band'].includes(v),
    },
});

const emits = defineEmits(['select-movie']);

const { eventBounds } = useMovieCalendar();
const { goToEvents } = useCalendarNav();

// `useState` et non `ref` : le panneau est démonté quand on passe aux stats, un état local
// repartirait à « ouvert » au retour.
const open = useState('cinemaNowBandOpen', () => true);

const MSHORT = ['JAN', 'FÉV', 'MAR', 'AVR', 'MAI', 'JUN', 'JUL', 'AOÛ', 'SEP', 'OCT', 'NOV', 'DÉC'];

const dateShort = (dateStr) => {
    const d = dateStr ? new Date(dateStr) : null;
    if (!d || isNaN(d)) return 'Sans date';
    return `${String(d.getDate()).padStart(2, '0')} ${MSHORT[d.getMonth()]}`;
};

// « auj. », « demain », puis « lun. 17 août ». Les deux premiers portent l'urgence bien mieux qu'une
// date à décoder — c'est l'information qui décide si on y va ce soir.
// `parseLocalDate` / `daysBetween` : `app/utils/localDate.js` — jamais `new Date('2026-08-17')`, qui
// se lit en UTC et retombe la veille sur un fuseau à offset négatif.
const eventDayLabel = (date) => {
    const local = parseLocalDate(date);
    if (!local) return '';

    const days = daysBetween(isoDay(0), date);
    if (days <= 0) return 'auj.';
    if (days === 1) return 'demain';

    return new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'long' }).format(local);
};

const posterUrl = (path) => path ? `https://image.tmdb.org/t/p/w342${path}` : null;

// ⚠️ L'item est un `<button>` porteur d'un `aria-label` : celui-ci **remplace** tout le texte interne
// pour un lecteur d'écran. Tout ce que le badge dit visuellement doit donc vivre ici aussi — sinon
// c'est visible et muet, exactement le défaut que le reste de la vue s'interdit.
//
// D'où les autres dates, que seul le badge résume désormais — et ni le type ni la salle, que la carte
// n'affiche plus : les annoncer décrirait une carte qui n'existe pas.
const itemLabel = (movie, event, others) => {
    const base = movie.title ? `Voir les séances de ${movie.title}` : 'Voir les séances';
    if (!event) return base;

    return `${base} — ${eventDayLabel(event.date)}`
        + (others ? `, et ${others} autre${others > 1 ? 's' : ''} date${others > 1 ? 's' : ''}` : '');
};

// Tout ce qu'une carte affiche, calculé **une fois par film** — et non par des fonctions appelées
// depuis le template, où le compte de journées se refaisait trois fois par carte à chaque rendu. Un
// `computed` suit `eventMovies`, ce qui est la bonne fréquence : ces lignes viennent de Supabase.
//
// Le rail ne sort pas sur le réseau, il lit ce que `useSeanceEvents` a persisté sur la ligne
// `calendar` — la règle de la timeline. Les règles de lecture, elles, restent celles de
// `app/utils/seanceEvents.js` : appelées, jamais recopiées, quitte à passer deux fois sur les
// événements d'un film.
const eventRows = computed(() => {
    const bounds = eventBounds();

    return props.eventMovies.map((movie) => {
        const next = nextMovieEvent(movie, bounds);
        // Les **journées** et non les entrées : trois salles le même soir restent une seule occasion
        // d'y aller. C'est ce que compte le badge posé sur l'affiche.
        const days = groupEventsByDay(movieEvents(movie, bounds)).length;
        // Au-delà de la première : plus écrites sur la carte, mais annoncées au lecteur d'écran, sans
        // quoi le film paraîtrait n'avoir qu'une seule date.
        const others = Math.max(0, days - 1);

        return { movie, days, date: next?.date ?? null, when: eventDayLabel(next?.date), label: itemLabel(movie, next, others) };
    });
});
</script>

<template>
    <section class="cinema-now" :class="[`-${variant}`, { scr: variant === 'rail' }]"
             v-if="movies.length || eventMovies.length">
        <!-- Rubrique événement. Au-dessus de « en ce moment » parce qu'elle est datée et périssable :
             c'est la seule information du rail qui se perd si on la lit trop tard. -->
        <template v-if="eventMovies.length">
            <!-- L'en-tête est un bouton : la rubrique ne montre que le prochain événement par film,
                 c'est donc elle qui doit ouvrir la liste complète. ⚠️ Le chevron est sa **seule** marque
                 de clic ; un effet de survol n'en serait pas une sur `band`, qui est le tactile. -->
            <button class="header -event -clickable" type="button"
                    aria-label="Voir tous les événements de la semaine" @click="goToEvents()">
                <span class="star" aria-hidden="true"><Svg name="star" /></span>
                <span class="label">Événements à venir</span>
                <span class="go" aria-hidden="true"><Svg name="chevron" /></span>
            </button>

            <div class="list -events" :class="{ '-hidden': variant === 'band' && !open }">
                <!-- La date part avec le clic : la carte annonce « dim. 16 août », la vue Séances doit
                     s'ouvrir sur ce jour-là et pas sur aujourd'hui. -->
                <button v-for="row in eventRows" :key="`ev-${row.movie.id}`" class="item -event" type="button"
                        :aria-label="row.label"
                        @click="emits('select-movie', row.movie.movie_id, row.date)">
                    <NuxtImg v-if="posterUrl(row.movie.poster_path)" :src="posterUrl(row.movie.poster_path)"
                             :alt="row.movie.title ? `Affiche du film ${row.movie.title}` : ''" class="poster" loading="lazy" />
                    <span v-else class="poster -placeholder" />
                    <!-- Étoile + compteur sur l'affiche. Décoratif au sens strict — `itemLabel` dit
                         déjà tout ce que le badge résume — d'où `aria-hidden` : le lire donnerait
                         « 3 » sans sujet, juste après la phrase qui l'explique. -->
                    <span v-if="row.days" class="badge" aria-hidden="true">
                        <Svg name="star" />{{ row.days }}
                    </span>
                    <span class="infos">
                        <span class="title">{{ row.movie.title }}</span>
                        <!-- Le jour d'abord : c'est lui qui décide s'il faut y aller ce soir. -->
                        <span class="when">{{ row.when }}</span>
                    </span>
                </button>
            </div>
        </template>

        <component :is="variant === 'band' ? 'button' : 'div'" class="header"
                   :class="{ '-clickable': variant === 'band' }"
                   :type="variant === 'band' ? 'button' : undefined"
                   :aria-expanded="variant === 'band' ? open : undefined"
                   @click="variant === 'band' && (open = !open)">
            <span class="pulse" aria-hidden="true" />
            <span class="label">Au ciné en ce moment</span>
            <template v-if="variant === 'band'">
                <span class="count">{{ movies.length }}</span>
                <span class="spacer" />
                <span class="chevron" :class="{ '-collapsed': !open }" aria-hidden="true"><Svg name="chevron" /></span>
            </template>
        </component>

        <div class="list" :class="{ '-hidden': variant === 'band' && !open }">
            <button v-for="m in movies" :key="m.id" class="item" type="button"
                    :aria-label="itemLabel(m)"
                    @click="emits('select-movie', m.movie_id)">
                <NuxtImg v-if="posterUrl(m.poster_path)" :src="posterUrl(m.poster_path)"
                         :alt="m.title ? `Affiche du film ${m.title}` : ''" class="poster" loading="lazy" />
                <span v-else class="poster -placeholder" />
                <span class="infos">
                    <span class="title">{{ m.title }}</span>
                    <span class="date">{{ dateShort(m.release_date) }}</span>
                </span>
            </button>
        </div>
    </section>
</template>

<style lang="scss" scoped>
.cinema-now {
    .header {
        // Les deux en-têtes sont des boutons quand ils mènent quelque part : le repli de la bande
        // mobile, et « Tout voir » de la rubrique événement. Sans effet sur la variante `<div>`.
        @include focusRing;
        display: flex;
        align-items: center;
        gap: .7rem;
        width: 100%;
        background: none;
        border: 0;
        text-align: left;
        color: inherit;
        font: inherit;

        > .pulse {
            width: .7rem;
            height: .7rem;
            border-radius: 50%;
            background: $color-primary;
            flex-shrink: 0;
            animation: rosepulse 2s infinite;
        }

        > .label {
            color: $color-primary-light;
            font: $bold 1.1rem/1 $font-body;
            letter-spacing: .14rem;
            text-transform: uppercase;
        }

        > .count {
            font: $normal 1.05rem/1 $font-mono;
            color: $color-text-weak;
        }

        > .spacer { flex: 1; }

        > .chevron {
            display: grid;
            place-items: center;
            color: $color-text-muted;
            transition: transform .2s ease;

            > :deep(svg) { width: 1.8rem; height: 1.8rem; }

            &.-collapsed { transform: rotate(-90deg); }
        }

        // En-tête de la rubrique événement : violet, et une étoile au lieu du point qui pulse. Le rose
        // dit déjà « en salle » juste en dessous, il ne peut pas dire deux choses à la fois.
        &.-event {
            > .star {
                display: grid;
                place-items: center;
                color: $color-event;
                flex-shrink: 0;

                > :deep(svg) { width: 1.3rem; height: 1.3rem; }
            }

            > .label { color: $color-event-light; }

            &.-clickable { cursor: pointer; }

            // Couché vers la droite comme celui du repli quand il est fermé : dans cette app, un
            // chevron horizontal veut dire « ça continue par là ».
            > .go {
                display: grid;
                place-items: center;
                flex: none;
                color: $color-text-quiet;
                transform: rotate(-90deg);
                transition: color .18s ease;

                > :deep(svg) { width: 1.4rem; height: 1.4rem; }
            }

            @media (hover: hover) {
                &.-clickable:hover > .label { color: $color-text; }
                &.-clickable:hover > .go { color: $color-event-light; }
            }
        }
    }

    .item {
        @include focusRing($offset: -2px);
        display: flex;
        position: relative;
        cursor: pointer;
        text-align: left;

        .poster {
            border-radius: .8rem;
            border: 1.5px solid $color-primary;
            flex: none;
            object-fit: cover;

            &.-placeholder { background: $color-surface-1; }
        }

        .title {
            display: block;
            color: $color-text;
            font: $semi-bold 1.3rem/1.2 $font-body;
        }

        .date {
            display: block;
            font: $normal 1.1rem/1 $font-mono;
            color: $color-text-weaker;
            margin-top: .3rem;
        }

        // Le jour de l'événement, en tête d'affiche : « demain » se lit d'un coup d'œil là où
        // « 17 AOÛ » demande de compter.
        .when {
            display: block;
            margin-top: .3rem;
            color: $color-event-light;
            font: $bold 1.1rem/1 $font-body;
            letter-spacing: .04rem;
            text-transform: uppercase;
        }

        // Badge d'affiche : violet plein, en haut à gauche. Calé sur `.item` (et non sur l'affiche,
        // qui n'a pas de conteneur propre) — les deux variantes posant l'affiche en haut à gauche du
        // bouton, le repère est le même dans le rail et dans la bande.
        //
        // Plein et non cerclé comme la pastille des cartes de séances : posé sur une image, un chip
        // translucide se lit selon ce qu'il y a dessous, c'est-à-dire mal.
        .badge {
            position: absolute;
            top: .5rem;
            left: .5rem;
            display: inline-flex;
            align-items: center;
            gap: .3rem;
            padding: .3rem .6rem;
            border-radius: .6rem;
            background: rgba($color-event, .94);
            color: $color-event-ink;
            font: $bold 1rem/1 $font-mono;

            > :deep(svg) {
                width: .9rem;
                height: .9rem;
                flex: none;
            }
        }

        // Affiche cerclée de violet : sans ça, le film se noierait visuellement dans la liste rose
        // juste en dessous, et la rubrique perdrait sa lisibilité au premier coup d'œil.
        &.-event .poster { border-color: $color-event; }
    }

    // Rail (desktop) : colonne verticale.
    &.-rail {
        width: 26.4rem;
        flex: none;
        border-left: 1px solid $color-border-1;
        padding: 2.4rem 2rem;
        overflow: auto;

        > .header { margin-bottom: 1.4rem; }

        // La rubrique événement se sépare de « en ce moment » par un filet : deux listes d'affiches
        // à la suite, sans rupture, se liraient comme une seule.
        > .list.-events {
            padding-bottom: 2rem;
            margin-bottom: 2rem;
            border-bottom: 1px solid $color-border-2;
        }

        > .list {
            display: flex;
            flex-direction: column;
            gap: 1.3rem;
        }

        .item {
            gap: 1.1rem;
            align-items: flex-start;

            .poster { width: 5.2rem; height: 7.8rem; }
            .infos { min-width: 0; flex: 1; }
        }
    }

    // Bande (mobile) : posters en rangée scrollable.
    &.-band {
        padding: 1rem 1.8rem 0;
        border-bottom: 1px solid $color-border-1;
        background: $color-bg;

        > .header {
            padding-bottom: 1.1rem;

            &.-clickable { cursor: pointer; }
        }

        > .list {
            padding-bottom: 1.2rem;
            @include stripScroll(1.8rem, 1.1rem);

            &.-hidden { display: none; }
        }

        > .list.-events {
            margin-bottom: 1.1rem;
            border-bottom: 1px solid $color-border-2;
        }

        .item {
            flex: none;
            width: 8.6rem;
            flex-direction: column;

            .poster {
                width: 8.6rem;
                height: 12.8rem;
                border-radius: 1rem;
                box-shadow: 0 0 0 3px rgba($color-primary, .16);
            }

            &.-event .poster { box-shadow: 0 0 0 3px rgba($color-event, .22); }

            .infos { margin-top: .6rem; }

            .title {
                overflow: hidden;
                display: -webkit-box;
                -webkit-line-clamp: 2;
                -webkit-box-orient: vertical;
                font-size: 1.15rem;
                color: $color-text-body;
            }

            .date { font-size: 1rem; }
            .when { font-size: 1rem; }
        }
    }
}

@keyframes rosepulse {
    0%, 100% { box-shadow: 0 0 0 0 rgba($color-primary, .5); }
    50% { box-shadow: 0 0 0 5px rgba($color-primary, 0); }
}
</style>
