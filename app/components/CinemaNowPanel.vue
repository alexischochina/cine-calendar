<script setup>
// Deux rubriques, dans cet ordre :
//
//   1. « Événement à venir » — films avec une séance événement devant eux (avant-première, séance
//      unique, label de programmation). ⚠️ Ces films ne sont pas forcément à l'affiche : une
//      avant-première a lieu *avant* la sortie, donc le film n'est pas « en salle » (cf.
//      `useUpcomingEvents`). C'est la rubrique qui porte l'urgence — une avant-première ne se
//      rattrape pas, contrairement à un film qui restera trois semaines à l'affiche.
//
//      Elle ne montre que **le prochain** événement de chaque film, et l'annonce quand il y en a
//      d'autres (« +2 autres dates »). 26,4 rem de large ne portent pas cinq lignes datées de façon
//      lisible, et un rail qui essaie de tout dire ne dit plus rien : la liste complète vit sur
//      `/evenements`, vers laquelle l'en-tête renvoie.
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
    // Films de la rubrique « Événement à venir », déjà triés par imminence par `eventSoon`.
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

// Dates découpées à la main plutôt que passées à `new Date(chaîne)` : une chaîne `YYYY-MM-DD` est
// interprétée en UTC, ce qui décale d'un jour sur les fuseaux à offset négatif. Pattern déjà banni
// ailleurs dans le projet (cf. `parseYMD` dans `useYearStats.js`).
const parseYMD = (value) => {
    const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ''));
    return parts ? new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3])) : null;
};

const dateShort = (dateStr) => {
    const d = dateStr ? new Date(dateStr) : null;
    if (!d || isNaN(d)) return 'Sans date';
    return `${String(d.getDate()).padStart(2, '0')} ${MSHORT[d.getMonth()]}`;
};

// « auj. », « demain », puis « lun. 17 août ». Les deux premiers portent l'urgence bien mieux qu'une
// date à décoder — c'est l'information qui décide si on y va ce soir.
const eventDayLabel = (date) => {
    const local = parseYMD(date);
    if (!local) return '';

    const today = parseYMD(isoDay(0));
    const days = Math.round((local - today) / 86400000);
    if (days <= 0) return 'auj.';
    if (days === 1) return 'demain';

    return new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'long' }).format(local);
};

// Prochain événement d'un film, tel que persisté sur sa ligne `calendar`. Le rail n'appelle rien : il
// lit — la timeline ne sort pas sur le réseau, c'est la règle du projet.
const nextEvent = (movie) => nextMovieEvent(movie, eventBounds());

// Journées d'événement au-delà de la première. Annoncées et non affichées : c'est ce qui évite de
// laisser croire que le film n'a qu'une seule date (le défaut de la première version de ce rail).
const otherDays = (movie) => Math.max(0, groupEventsByDay(movieEvents(movie, eventBounds())).length - 1);

// « Avant-première · MK2 Bibliothèque ». La salle est là parce qu'une avant-première n'a lieu que dans
// une seule salle : sans elle, l'information est incomplète au point d'être inutilisable.
const eventLine = (movie) => {
    const event = nextEvent(movie);
    if (!event) return '';
    return [event.labels.join(' · '), event.cinema].filter(Boolean).join(' · ');
};

const posterUrl = (path) => path ? `https://image.tmdb.org/t/p/w342${path}` : null;

// ⚠️ L'item est un `<button>` porteur d'un `aria-label` : celui-ci **remplace** tout le texte interne
// pour un lecteur d'écran. Tout ce que le badge dit visuellement doit donc vivre ici aussi — sinon
// c'est visible et muet, exactement le défaut que le reste de la vue s'interdit.
const itemLabel = (movie) => {
    const base = movie.title ? `Voir les séances de ${movie.title}` : 'Voir les séances';
    const event = nextEvent(movie);
    if (!event) return base;

    const when = eventDayLabel(event.date);
    const others = otherDays(movie);
    return `${base} — ${event.labels.join(', ')} ${when}${event.cinema ? ` à ${event.cinema}` : ''}`
        + (others ? `, et ${others} autre${others > 1 ? 's' : ''} date${others > 1 ? 's' : ''}` : '');
};
</script>

<template>
    <section class="cinema-now" :class="[`-${variant}`, { scr: variant === 'rail' }]"
             v-if="movies.length || eventMovies.length">
        <!-- Rubrique événement. Au-dessus de « en ce moment » parce qu'elle est datée et périssable :
             c'est la seule information du rail qui se perd si on la lit trop tard. -->
        <template v-if="eventMovies.length">
            <!-- L'en-tête est un bouton : la rubrique ne montre que le prochain événement par film,
                 c'est donc elle qui doit ouvrir la liste complète. -->
            <button class="header -event -clickable" type="button"
                    aria-label="Voir tous les événements de la semaine" @click="goToEvents()">
                <span class="star" aria-hidden="true"><Svg name="star" /></span>
                <span class="label">Événement à venir</span>
                <span class="count">{{ eventMovies.length }}</span>
                <span class="spacer" />
                <span class="all" aria-hidden="true">Tout voir</span>
            </button>

            <div class="list -events" :class="{ '-hidden': variant === 'band' && !open }">
                <!-- La date part avec le clic : la carte annonce « dim. 16 août », la vue Séances doit
                     s'ouvrir sur ce jour-là et pas sur aujourd'hui. -->
                <button v-for="m in eventMovies" :key="`ev-${m.id}`" class="item -event" type="button"
                        :aria-label="itemLabel(m)"
                        @click="emits('select-movie', m.movie_id, nextEvent(m)?.date ?? null)">
                    <NuxtImg v-if="posterUrl(m.poster_path)" :src="posterUrl(m.poster_path)"
                             :alt="m.title ? `Affiche du film ${m.title}` : ''" class="poster" loading="lazy" />
                    <span v-else class="poster -placeholder" />
                    <span class="infos">
                        <span class="title">{{ m.title }}</span>
                        <!-- Le jour d'abord : c'est lui qui décide s'il faut y aller ce soir. -->
                        <span class="when">{{ eventDayLabel(nextEvent(m)?.date) }}</span>
                        <span class="what">{{ eventLine(m) }}</span>
                        <span v-if="otherDays(m)" class="more">
                            +{{ otherDays(m) }} autre{{ otherDays(m) > 1 ? 's' : '' }} date{{ otherDays(m) > 1 ? 's' : '' }}
                        </span>
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

            > .all {
                flex: none;
                color: $color-text-quiet;
                font: $semi-bold 1.05rem/1 $font-body;
                text-decoration: underline;
            }

            @media (hover: hover) {
                &.-clickable:hover > .all { color: $color-event-light; }
            }
        }
    }

    .item {
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

        .what {
            display: block;
            margin-top: .2rem;
            color: $color-text-muted;
            font: $normal 1.05rem/1.3 $font-body;
        }

        .more {
            display: block;
            margin-top: .3rem;
            color: $color-event-light;
            font: $semi-bold 1rem/1 $font-body;
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

            // Sur 8,6 rem de large, le libellé complet ne tient pas : le jour suffit, le reste est dans
            // le nom accessible et à un clic dans la vue Séances.
            .what { display: none; }
            .more { font-size: .95rem; }
        }
    }
}

@keyframes rosepulse {
    0%, 100% { box-shadow: 0 0 0 0 rgba($color-primary, .5); }
    50% { box-shadow: 0 0 0 5px rgba($color-primary, 0); }
}
</style>
