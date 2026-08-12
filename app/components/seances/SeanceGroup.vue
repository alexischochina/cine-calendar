<script setup>
// Carte accordéon d'un regroupement. Un seul composant pour les deux modes : ce sont les mêmes
// couples (film, salle) vus par un bout ou par l'autre, seuls l'en-tête et la ligne changent.
//   - mode 'film'   : en-tête = affiche + titre du film,  lignes = salles + horaires
//   - mode 'cinema' : en-tête = pictogramme + nom de salle, lignes = films + horaires
//
// L'étoile « favori » est disponible dans les deux modes : sur l'en-tête côté cinéma, sur chaque
// ligne de salle côté film — c'est là qu'on découvre une salle, autant pouvoir l'épingler sans
// changer de regroupement.
const props = defineProps({
    mode: {
        type: String,
        default: 'film',
        validator: (v) => ['film', 'cinema'].includes(v),
    },
    bucket: {
        type: Object,
        required: true,
    },
    open: {
        type: Boolean,
        default: false,
    },
});

const emit = defineEmits(['toggle', 'toggle-favorite']);

const poster = (path) => path ? `https://image.tmdb.org/t/p/w342${path}` : null;
const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;

const title = computed(() => props.mode === 'film' ? props.bucket.movie.title : props.bucket.cinema.name);

// `bucket.key` est déjà unique et stable dans la liste (`f12` / `cC0102`) : il fait un identifiant
// de panneau sans compteur global ni génération aléatoire, qui différerait entre serveur et client.
const panelId = computed(() => `seances-panel-${props.bucket.key}`);

// « 3e arr. · 24 min » — le temps de trajet disparaît si la salle n'est pas encore géocodée : on
// n'affiche pas de tiret de remplissage.
const placeLabel = (cinema) => [
    cinema.arrondissement ? `${arrondissementLabel(cinema.arrondissement)} arr.` : null,
    formatTransit(cinema.transitMinutes),
].filter(Boolean).join(' · ');

// « 7 séances · 3 cinémas » côté film, « 3e arr. · 24 min · 2 films · 7 séances » côté salle.
const filmSubtitle = ({ nbSeances, entries }) =>
    `${plural(nbSeances, 'séance')} · ${plural(entries.length, 'cinéma')}`;

const cinemaSubtitle = ({ cinema, nbSeances, entries }) => [
    placeLabel(cinema),
    plural(entries.length, 'film'),
    plural(nbSeances, 'séance'),
].filter(Boolean).join(' · ');

const subtitle = computed(() =>
    props.mode === 'film' ? filmSubtitle(props.bucket) : cinemaSubtitle(props.bucket));

const favoriteLabel = (cinema) => cinema.favorite
    ? `Retirer ${cinema.name} des cinémas favoris`
    : `Ajouter ${cinema.name} aux cinémas favoris`;
</script>

<template>
    <section class="seances-group">
        <!-- En-tête en deux boutons distincts et non un bouton dans un bouton : imbriquer deux
             contrôles cliquables est du HTML invalide, et le lecteur d'écran n'en annoncerait qu'un. -->
        <div class="head">
            <button v-if="mode === 'cinema'" class="fav -head" type="button"
                    :class="{ '-on': bucket.cinema.favorite }" :aria-pressed="bucket.cinema.favorite"
                    :aria-label="favoriteLabel(bucket.cinema)"
                    @click="emit('toggle-favorite', bucket.cinema.code)">
                <Svg name="star-outline" aria-hidden="true" />
            </button>

            <button class="toggle" type="button" :aria-expanded="open" :aria-controls="panelId"
                    @click="emit('toggle')">
                <template v-if="mode === 'film'">
                    <NuxtImg v-if="poster(bucket.movie.poster_path)" :src="poster(bucket.movie.poster_path)"
                             :alt="bucket.movie.title ? `Affiche du film ${bucket.movie.title}` : ''"
                             class="poster" loading="lazy" />
                    <span v-else class="poster -placeholder" />
                </template>
                <span v-else class="ico" aria-hidden="true"><Svg name="ticket" /></span>

                <span class="infos">
                    <span class="title">{{ title }}</span>
                    <span class="sub">{{ subtitle }}</span>
                </span>

                <span class="chevron" :class="{ '-collapsed': !open }" aria-hidden="true"><Svg name="chevron" /></span>
            </button>
        </div>

        <div v-if="open" :id="panelId" class="body">
            <div v-for="entry in bucket.entries" :key="mode === 'film' ? entry.cinema.code : entry.movie.id"
                 class="row" :class="`-${mode}`">
                <template v-if="mode === 'film'">
                    <span class="place">
                        <button class="fav" type="button" :class="{ '-on': entry.cinema.favorite }"
                                :aria-pressed="entry.cinema.favorite" :aria-label="favoriteLabel(entry.cinema)"
                                @click="emit('toggle-favorite', entry.cinema.code)">
                            <Svg name="star-outline" aria-hidden="true" />
                        </button>
                        <span class="txt">
                            <span class="name">{{ entry.cinema.name }}</span>
                            <span class="meta">{{ placeLabel(entry.cinema) }}</span>
                        </span>
                    </span>
                </template>
                <template v-else>
                    <NuxtImg v-if="poster(entry.movie.poster_path)" :src="poster(entry.movie.poster_path)"
                             :alt="entry.movie.title ? `Affiche du film ${entry.movie.title}` : ''"
                             class="thumb" loading="lazy" />
                    <span v-else class="thumb -placeholder" />
                </template>

                <span class="detail">
                    <span v-if="mode === 'cinema'" class="name">{{ entry.movie.title }}</span>
                    <span class="times">
                        <SeancesTimeChip v-for="showtime in entry.showtimes" :key="showtime.startsAt + showtime.version"
                                         :showtime="showtime" />
                    </span>
                </span>
            </div>
        </div>
    </section>
</template>

<style lang="scss" scoped>
// Étoile de favori, identique en en-tête et en ligne — une seule définition, deux points d'usage.
// L'icône est un contour ; l'état actif la **remplit** en plus de la colorer, si bien que le favori
// se distingue à la forme et pas seulement à la couleur.
@mixin favStar($size) {
    display: grid;
    place-items: center;
    width: $size + .8rem;
    height: $size + .8rem;
    flex: none;
    border-radius: 50%;
    // ⚠️ Pas le gris de la maquette (#3f444d) : mesuré à 1,85:1 sur cette surface, il passe sous le
    // seuil WCAG 1.4.11 (3:1 pour un composant d'interface) et l'étoile devient invisible en basse
    // vision — on ne peut pas épingler un cinéma qu'on ne voit pas. Ce ton-ci est le plus effacé de
    // la palette qui tienne le seuil (3,74:1), l'intention « discret » est préservée.
    color: $color-text-weaker;
    cursor: pointer;
    transition: color .18s ease, transform .18s ease;

    > :deep(svg) { width: $size; height: $size; display: block; }

    &.-on {
        color: $color-yellow;

        > :deep(svg) > path { fill: currentColor; }
    }

    @media (hover: hover) {
        &:hover { color: $color-yellow; transform: scale(1.12); }
    }
}

.seances-group {
    background: $color-surface-1;
    border: 1px solid $color-border-2;
    border-radius: 1.6rem;
    overflow: hidden;

    > .head {
        display: flex;
        align-items: center;

        // L'étoile porte son propre retrait à gauche et rien à droite : le padding gauche du
        // bouton de dépliage fait office d'espacement, et le mode « Par film » (sans étoile)
        // garde exactement le même retrait, sans padding conditionnel.
        > .fav.-head {
            margin-left: 1.6rem;
            @include favStar(1.7rem);
        }

        > .toggle {
            display: flex;
            align-items: center;
            gap: 1.4rem;
            flex: 1;
            min-width: 0;
            padding: 1.6rem;
            text-align: left;
            cursor: pointer;

            > .poster {
                width: 4.4rem;
                height: 6.6rem;
                flex: none;
                border-radius: .7rem;
                object-fit: cover;

                &.-placeholder { background: $color-surface-4; }
            }

            > .ico {
                display: grid;
                place-items: center;
                width: 3.8rem;
                height: 3.8rem;
                flex: none;
                border-radius: 1rem;
                background: $color-border-2;
                color: $color-primary-light;

                > :deep(svg) { width: 1.9rem; height: 1.9rem; }
            }

            > .infos {
                flex: 1;
                min-width: 0;

                > .title {
                    display: block;
                    color: $color-text;
                    font: $bold 1.5rem/1.2 $font-body;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }

                > .sub {
                    display: block;
                    margin-top: .3rem;
                    color: $color-text-muted;
                    font: $normal 1.2rem/1 $font-body;
                }
            }

            > .chevron {
                display: grid;
                place-items: center;
                flex: none;
                color: $color-text-quiet;
                transition: transform .18s ease;

                > :deep(svg) { width: 1.6rem; height: 1.6rem; }

                &.-collapsed { transform: rotate(-90deg); }
            }
        }

    }

    > .body {
        display: flex;
        flex-direction: column;
        gap: 1.2rem;
        padding: 0 1.6rem 1.6rem;
        animation: seancespop .16s ease;

        > .row {
            display: flex;
            gap: 1.6rem;
            padding-top: 1.2rem;
            border-top: 1px solid $color-border-2;

            > .place {
                display: flex;
                align-items: flex-start;
                gap: .6rem;
                width: 23rem;
                flex: none;

                > .fav { @include favStar(1.4rem); }

                > .txt {
                    min-width: 0;

                    > .name {
                        display: block;
                        color: $color-text-body;
                        font: $semi-bold 1.3rem/1.2 $font-body;
                    }

                    > .meta {
                        display: block;
                        margin-top: .2rem;
                        color: $color-text-quiet;
                        font: $normal 1.05rem/1 $font-mono;
                    }
                }
            }

            > .thumb {
                width: 3rem;
                height: 4.5rem;
                flex: none;
                border-radius: .5rem;
                object-fit: cover;

                &.-placeholder { background: $color-surface-4; }
            }

            > .detail {
                flex: 1;
                min-width: 0;

                > .name {
                    display: block;
                    margin-bottom: .7rem;
                    color: $color-text-body;
                    font: $semi-bold 1.3rem/1.2 $font-body;
                }

                > .times {
                    display: flex;
                    flex-wrap: wrap;
                    gap: .7rem;
                }
            }

            &.-film { align-items: center; }
            &.-cinema { align-items: flex-start; }
        }
    }
}

// En dessous du desktop, la salle passe au-dessus de ses horaires : 23rem de libellé + une
// rangée de chips ne tiennent pas côte à côte sur un téléphone.
@media (max-width: 999px) {
    .seances-group > .body > .row.-film {
        flex-direction: column;
        align-items: flex-start;
        gap: .8rem;

        > .place { width: auto; }
    }
}

@keyframes seancespop {
    from { opacity: 0; transform: translateY(-.4rem); }
    to { opacity: 1; transform: none; }
}
</style>
