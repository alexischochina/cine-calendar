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

// Séances événement de la carte, comptées après filtrage (cf. `nbEvents` dans `seancesGrouping.js`).
// La pastille est sur l'en-tête et pas seulement sur les chips : elle sert à décider si ça vaut le
// coup de déplier, ce qui n'a d'intérêt que carte fermée.
const eventLabels = computed(() => eventLabelsOf(props.bucket.entries.flatMap(e => e.showtimes)));

const eventHint = computed(() => eventLabels.value.join(' · '));

const favoriteLabel = (cinema) => cinema.favorite
    ? `Retirer ${cinema.name} des cinémas favoris`
    : `Ajouter ${cinema.name} aux cinémas favoris`;

// Nom de salle → itinéraire depuis la position actuelle (cf. `utils/maps.js`). Le nom **est** le
// lien, dans les deux regroupements : c'est le mot qu'on regarde quand on se demande si on peut y
// être à temps.
const mapsLabel = (cinema) => `Itinéraire vers ${cinema.name} — nouvel onglet`;

// Salle vue récemment mais qu'Allociné ne rend plus (cf. `carryOverMissing`). On continue de
// l'afficher — la séance a toutes les chances d'exister — mais jamais sans le dire.
const UNCONFIRMED_HINT = 'Horaires vus lors d\'un relevé précédent : la source ne les confirme plus. À vérifier sur le site de la salle.';

// Le badge ne portait son explication que dans un `title` — invisible au clavier comme au doigt.
// Le texte visible reste court (« non confirmé »), l'explication complète part dans un contenu
// réservé aux lecteurs d'écran, et `role="note"` la rattache à la salle qu'elle qualifie.
</script>

<template>
    <section class="seances-group">
        <!-- En-tête en contrôles distincts et non imbriqués : un bouton (ou un lien) dans un bouton
             est du HTML invalide, et le lecteur d'écran n'en annoncerait qu'un. L'en-tête entier
             déplie — c'est le geste principal — et l'itinéraire vit dans sa propre icône, à côté de
             l'étoile : deux actions sur la salle, au même endroit, sans voler le clic de dépliage. -->
        <div class="head">
            <template v-if="mode === 'cinema'">
                <button class="fav -head" type="button"
                        :class="{ '-on': bucket.cinema.favorite }" :aria-pressed="bucket.cinema.favorite"
                        :aria-label="favoriteLabel(bucket.cinema)"
                        @click="emit('toggle-favorite', bucket.cinema.code)">
                    <Svg name="star-outline" aria-hidden="true" />
                </button>

                <a v-if="directionsUrl(bucket.cinema)" class="dir -head" :href="directionsUrl(bucket.cinema)"
                   target="_blank" rel="noopener noreferrer" :aria-label="mapsLabel(bucket.cinema)"
                   :title="mapsLabel(bucket.cinema)">
                    <Svg name="location" aria-hidden="true" />
                </a>
            </template>

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
                    <span class="title">
                        {{ title }}
                        <span v-if="mode === 'cinema' && bucket.cinema.unconfirmedSince" class="unconfirmed"
                              role="note" :title="UNCONFIRMED_HINT">non confirmé<span class="sr">. {{ UNCONFIRMED_HINT }}</span></span>
                    </span>
                    <span class="sub">
                        {{ subtitle }}
                        <!-- Le décompte est du texte visible ; les libellés partent dans le `title`
                             et dans un contenu lu, la place manquant pour les afficher tous ici.
                             Chaque chip porte le sien, une fois la carte dépliée. -->
                        <span v-if="bucket.nbEvents" class="events" role="note" :title="eventHint">
                            <Svg name="star" aria-hidden="true" />
                            {{ eventCountLabel(bucket.nbEvents) }}<span class="sr">&nbsp;: {{ eventHint }}.</span>
                        </span>
                    </span>
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
                        <a v-if="directionsUrl(entry.cinema)" class="dir" :href="directionsUrl(entry.cinema)"
                           target="_blank" rel="noopener noreferrer" :aria-label="mapsLabel(entry.cinema)"
                           :title="mapsLabel(entry.cinema)">
                            <Svg name="location" aria-hidden="true" />
                        </a>
                        <span class="txt">
                            <span class="name">
                                {{ entry.cinema.name }}
                                <span v-if="entry.cinema.unconfirmedSince" class="unconfirmed"
                                      role="note" :title="UNCONFIRMED_HINT">non confirmé<span class="sr">. {{ UNCONFIRMED_HINT }}</span></span>
                            </span>
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

// Marqueur « non confirmé ». Ambre comme l'avertissement de fraîcheur de la page : c'est la même
// famille d'information — ce qui est affiché mérite un coup d'œil sur la billetterie.
// Contenu lu par les lecteurs d'écran, jamais affiché. Recette standard : hors flux, 1 px, découpé
// — surtout pas `display: none` ni `visibility: hidden`, qui le retireraient aussi de l'arbre
// d'accessibilité et le rendraient donc muet pour tout le monde.
.sr {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
    border: 0;
}

// Pastille « N ÉVÉNEMENTS » de l'en-tête. Ni pleine ni criarde : elle vit à côté d'un sous-titre gris
// et doit attirer l'œil sans devenir le sujet de la carte — le sujet reste le film ou la salle.
@mixin eventTag {
    display: inline-flex;
    align-items: center;
    gap: .4rem;
    padding: .2rem .7rem;
    border: 1px solid rgba($color-event, .4);
    border-radius: .6rem;
    background: rgba($color-event, .14);
    color: $color-event-light;
    font: $bold .95rem/1.3 $font-body;
    letter-spacing: .03rem;
    white-space: nowrap;
    cursor: help;

    > :deep(svg) {
        width: .9rem;
        height: .9rem;
        flex: none;
    }
}

@mixin unconfirmedTag {
    display: inline-block;
    margin-left: .6rem;
    padding: .15rem .5rem;
    vertical-align: .1rem;
    border: 1px solid rgba($color-yellow, .45);
    border-radius: .5rem;
    color: $color-yellow;
    font: $semi-bold .95rem/1.3 $font-body;
    letter-spacing: .02rem;
    white-space: nowrap;
    cursor: help;
}

// Épingle « itinéraire », jumelle de l'étoile : même gabarit, même cible tactile, même discrétion
// au repos. Elle vire au rose plutôt qu'au jaune — c'est une sortie de l'app, pas une préférence.
@mixin dirPin($size) {
    display: grid;
    place-items: center;
    width: $size + .8rem;
    height: $size + .8rem;
    flex: none;
    border-radius: 50%;
    color: $color-text-weaker;
    cursor: pointer;
    transition: color .18s ease, transform .18s ease;

    > :deep(svg) { width: $size; height: $size; display: block; }

    @media (hover: hover) {
        &:hover { color: $color-primary-light; transform: scale(1.12); }
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

        // L'itinéraire se colle à l'étoile : même gabarit, même retrait nul à droite. Les deux
        // actions sur la salle tiennent ainsi dans la même colonne, et le reste de la ligne
        // continue de déplier.
        > .dir.-head { @include dirPin(1.6rem); }

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

                    > .unconfirmed { @include unconfirmedTag; }
                }

                > .sub {
                    display: flex;
                    align-items: center;
                    flex-wrap: wrap;
                    gap: .8rem;
                    margin-top: .3rem;
                    color: $color-text-muted;
                    font: $normal 1.2rem/1.3 $font-body;

                    > .events { @include eventTag; }
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
                > .dir { @include dirPin(1.35rem); }

                > .txt {
                    min-width: 0;

                    > .name {
                        display: block;
                        color: $color-text-body;
                        font: $semi-bold 1.3rem/1.2 $font-body;

                        > .unconfirmed { @include unconfirmedTag; }
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
