<script setup>
// ⚠️ Les URL de ces pastilles et de cette note viennent des **exploitants** (UGC, Dulac, MK2) via
// `event_detail_cache`, donc de tiers, et elles finissent dans des `href`. Elles passent toutes par
// `safeUrl` **au rendu** : filtrer à l'ingestion ne protège que ce qui passe par l'ingestion, et ce
// cache est atteignable autrement (cf. `shared/utils/safeUrl.js`). Une URL refusée retombe sur le
// rendu sans lien, qui existe déjà pour le cas « pas d'URL ».

// Carte accordéon de la vue Événements. Un seul composant pour les deux regroupements : ce sont les
// mêmes couples (film, journée) vus par un bout ou par l'autre, seuls l'en-tête et la ligne changent.
//   - mode 'film' : en-tête = affiche + titre du film,   lignes = journées
//   - mode 'day'  : en-tête = pictogramme + journée,     lignes = films
//
// Décalque de `SeancesSeanceGroup` — mêmes métriques d'en-tête, de ligne et de filet : les deux vues
// montrent la même matière et n'ont aucune raison de se ressembler à moitié. Seule la rangée diffère,
// des horaires là-bas, les qualifications de la séance ici (« Avant-première », « Ciné-club »).
const props = defineProps({
    mode: {
        type: String,
        default: 'film',
        validator: (v) => ['film', 'day'].includes(v),
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

const emit = defineEmits(['toggle', 'select']);

const poster = (path) => path ? `https://image.tmdb.org/t/p/w342${path}` : null;
const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;

// `bucket.key` est déjà unique et stable dans la liste (`f12` / `d2026-08-17`) : il fait un
// identifiant de panneau sans compteur global ni génération aléatoire, qui différerait entre serveur
// et client.
const panelId = computed(() => `events-panel-${props.bucket.key}`);

// « Aujourd'hui », « Demain », puis « lundi 17 août ». Les deux premiers portent l'urgence bien mieux
// qu'une date à décoder — c'est l'information qui décide si on y va ce soir.
//
// `parseLocalDate` / `daysBetween` : `app/utils/localDate.js` — jamais `new Date('2026-08-17')`, qui
// se lit en UTC et retombe la veille sur un fuseau à offset négatif.
const dayLabel = (date) => {
    const local = parseLocalDate(date);
    if (!local) return '?';

    const offset = daysBetween(isoDay(0), date);
    if (offset <= 0) return "Aujourd'hui";
    if (offset === 1) return 'Demain';

    return new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).format(local);
};

// `Intl` rend « lundi 17 août » en minuscules — correct en français dans une phrase, bancal en titre
// de carte. La capitale se pose ici et pas dans `dayLabel`, qui sert aussi en cours de ligne.
const title = computed(() => {
    if (props.mode === 'film') return props.bucket.movie.title;

    const label = dayLabel(props.bucket.date);
    return label.charAt(0).toUpperCase() + label.slice(1);
});

// Lignes normalisées : le template n'a plus qu'un seul `v-for`, et les deux modes ne divergent que
// sur ce qu'ils montrent dans la colonne de gauche (une journée ou une affiche).
//
// Une ligne = **une entrée**, c'est-à-dire un couple (journée, salle), et non une journée entière.
// C'est ce qui permet à chaque salle de porter sa propre pastille : le texte de l'exploitant est
// attaché à une salle, une avant-première dans trois UGC n'a pas la même précision partout.
const rows = computed(() => (props.mode === 'film'
    ? props.bucket.entries.map(entry => ({ movie: props.bucket.movie, entry }))
    : props.bucket.entries)
    .map(row => ({
        key: `${row.movie.id}-${row.entry.date}-${row.entry.cinema ?? ''}`,
        ...row,
        ...eventChips(row.entry),
    })));

// « 3 journées » côté film, « 2 films » côté journée — le compte des séances événement, lui, vit dans
// la pastille, comme côté Séances. Écrire les deux dans le sous-titre les ferait se répéter : chaque
// ligne de la carte **est** un événement.
const subtitle = computed(() => props.mode === 'film'
    ? plural(new Set(rows.value.map(r => r.entry.date)).size, 'journée')
    : plural(new Set(rows.value.map(r => r.movie.id)).size, 'film'));

// Libellés distincts de la carte, pour l'infobulle de la pastille — ceux d'Allociné, la famille à
// laquelle appartiennent ces séances. Le détail de chacune est sur sa ligne.
const eventHint = computed(() =>
    [...new Set(rows.value.flatMap(r => r.entry.labels))].join(' · ')
);

// Sortie du film, pour situer une avant-première (« sortie le 19 août »). C'est ce qui explique
// pourquoi la séance est un événement, et pourquoi elle ne se rattrape pas.
const releaseLabel = (movie) => {
    const local = parseLocalDate(movie.release_date);
    if (!local) return null;

    const upcoming = movie.release_date > isoDay(0);
    const when = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' }).format(local);
    return upcoming ? `Sortie le ${when}` : `Sorti le ${when}`;
};

const rowLabel = (row) => `Voir les séances de ${row.movie.title} le ${dayLabel(row.entry.date)}`;
</script>

<template>
    <section class="events-card">
        <div class="head">
            <button class="toggle" type="button" :aria-expanded="open" :aria-controls="panelId"
                    @click="emit('toggle')">
                <template v-if="mode === 'film'">
                    <NuxtImg v-if="poster(bucket.movie.poster_path)" :src="poster(bucket.movie.poster_path)"
                             :alt="bucket.movie.title ? `Affiche du film ${bucket.movie.title}` : ''"
                             class="poster" loading="lazy" />
                    <span v-else class="poster -placeholder" />
                </template>
                <span v-else class="ico" aria-hidden="true"><Svg name="star" /></span>

                <span class="infos">
                    <span class="title">{{ title }}</span>
                    <span class="sub">
                        {{ subtitle }}
                        <!-- Le décompte est du texte visible ; les libellés partent dans le `title`
                             et dans un contenu lu, la place manquant pour les afficher tous ici.
                             Chaque ligne porte les siens, une fois la carte dépliée. -->
                        <span class="events" :title="eventHint">
                            <Svg name="star" aria-hidden="true" />
                            {{ eventCountLabel(rows.length) }}<span class="sr">&nbsp;: {{ eventHint }}.</span>
                        </span>
                    </span>
                </span>

                <span class="chevron" :class="{ '-collapsed': !open }" aria-hidden="true"><Svg name="chevron" /></span>
            </button>
        </div>

        <div v-if="open" :id="panelId" class="body">
            <div v-for="row in rows" :key="row.key" class="row" :class="`-${mode}`">
                <!-- Colonne d'identification, à la place de la salle des cartes de séances. Par film
                     c'est la journée et sa salle ; par journée c'est l'affiche du film. -->
                <span v-if="mode === 'film'" class="place">
                    <span class="txt">
                        <button class="name" type="button" :aria-label="rowLabel(row)"
                                @click="emit('select', row.movie, row.entry.date)">{{ dayLabel(row.entry.date) }}</button>
                        <span v-if="row.entry.cinema" class="meta">{{ row.entry.cinema }}</span>
                    </span>
                </span>
                <template v-else>
                    <NuxtImg v-if="poster(row.movie.poster_path)" :src="poster(row.movie.poster_path)"
                             :alt="row.movie.title ? `Affiche du film ${row.movie.title}` : ''"
                             class="thumb" loading="lazy" />
                    <span v-else class="thumb -placeholder" />
                </template>

                <span class="detail">
                    <template v-if="mode === 'day'">
                        <button class="name" type="button" :aria-label="rowLabel(row)"
                                @click="emit('select', row.movie, row.entry.date)">{{ row.movie.title }}</button>
                        <span v-if="releaseLabel(row.movie)" class="release">{{ releaseLabel(row.movie) }}</span>
                    </template>

                    <!-- Une pastille par qualification, à la place de la rangée d'horaires. Le mot de
                         l'exploitant passe devant celui d'Allociné quand il tient en un libellé —
                         c'est la même information, en plus précis (cf. `eventChips`). Quand il porte
                         une URL, la pastille **est** le lien vers la fiche de la salle.

                         ⚠️ Chacune se retrouve dans le menu « Type » de la page, qui dérive de la même
                         règle (`entryKinds`). -->
                    <span class="labels">
                        <component :is="safeUrl(chip.url) ? 'a' : 'span'" v-for="chip in row.chips" :key="chip.text"
                                   class="chip" :class="{ '-link': safeUrl(chip.url) }" :href="safeUrl(chip.url) || undefined"
                                   :target="safeUrl(chip.url) ? '_blank' : undefined"
                                   :rel="safeUrl(chip.url) ? 'noopener noreferrer' : undefined"
                                   :title="safeUrl(chip.url) ? 'Fiche de la salle — nouvel onglet' : undefined">
                            <Svg name="star" aria-hidden="true" />{{ chip.text }}
                        </component>
                    </span>

                    <span v-if="mode === 'day' && row.entry.cinema" class="where">{{ row.entry.cinema }}</span>

                    <!-- Phrase de l'exploitant : « La séance sera présentée par le réalisateur… ».
                         Trop longue pour une pastille, elle reste en toutes lettres. Absente la
                         plupart du temps, donc jamais un trou dans la mise en page. -->
                    <a v-if="safeUrl(row.note?.url)" class="note" :href="safeUrl(row.note.url)"
                       target="_blank" rel="noopener noreferrer"
                       title="Fiche de la salle — nouvel onglet">{{ row.note.text }}</a>
                    <span v-else-if="row.note" class="note">{{ row.note.text }}</span>
                </span>
            </div>
        </div>
    </section>
</template>

<style lang="scss" scoped>
// Contenu lu par les lecteurs d'écran (cf. `srOnly` dans `assets/styles/_a11y.scss`).
.sr { @include srOnly; }

// Pastille « N ÉVÉNEMENTS » de l'en-tête, à l'identique des cartes de séances.
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

.events-card {
    background: $color-surface-1;
    border: 1px solid $color-border-2;
    border-radius: 1.6rem;
    overflow: hidden;

    > .head {
        display: flex;
        align-items: center;

        > .toggle {
            @include focusRing($offset: -2px);
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

            // Pictogramme du regroupement « Par jour » : il tient la place de l'affiche, sinon les
            // deux modes ne s'alignent pas d'une carte à l'autre. Même gabarit que le pictogramme de
            // salle des cartes de séances, en violet — c'est la couleur du sujet de la page.
            > .ico {
                display: grid;
                place-items: center;
                width: 3.8rem;
                height: 3.8rem;
                flex: none;
                border-radius: 1rem;
                background: $color-border-2;
                color: $color-event-light;

                > :deep(svg) { width: 1.8rem; height: 1.8rem; }
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
        animation: eventspop .16s ease;

        > .row {
            display: flex;
            gap: 1.6rem;
            padding-top: 1.2rem;
            border-top: 1px solid $color-border-2;

            > .place {
                display: flex;
                align-items: flex-start;
                width: 23rem;
                flex: none;

                > .txt {
                    min-width: 0;

                    // La journée reste violette : c'est la date d'un événement, et c'est elle qu'on
                    // vient chercher. Le gabarit, lui, est celui du nom de salle des cartes de
                    // séances — même graisse, même corps, même interligne.
                    > .name {
                        @include focusRing;
                        display: block;
                        padding: 0;
                        text-align: left;
                        color: $color-event-light;
                        font: $semi-bold 1.3rem/1.2 $font-body;
                        cursor: pointer;

                        @media (hover: hover) {
                            &:hover { color: $color-text; text-decoration: underline; }
                        }
                    }

                    > .meta {
                        display: block;
                        margin-top: .2rem;
                        color: $color-text-quiet;
                        font: $normal 1.15rem/1.3 $font-body;
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
                    @include focusRing;
                    display: block;
                    padding: 0;
                    text-align: left;
                    color: $color-text-body;
                    font: $semi-bold 1.3rem/1.2 $font-body;
                    cursor: pointer;

                    @media (hover: hover) {
                        &:hover { color: $color-event-light; }
                    }
                }

                > .release {
                    display: block;
                    margin-top: .2rem;
                    color: $color-text-quiet;
                    font: $normal 1.15rem/1 $font-body;
                }

                // Même rangée que les horaires des cartes de séances : mêmes écarts, même retour à
                // la ligne.
                > .labels {
                    display: flex;
                    flex-wrap: wrap;
                    gap: .7rem;
                    margin-top: .7rem;

                    > .chip {
                        display: inline-flex;
                        align-items: center;
                        gap: .5rem;
                        padding: .5rem .9rem;
                        border: 1px solid rgba($color-event, .4);
                        border-radius: .8rem;
                        background: rgba($color-event, .14);
                        color: $color-event-light;
                        font: $semi-bold 1.2rem/1 $font-body;

                        > :deep(svg) {
                            width: 1rem;
                            height: 1rem;
                            flex: none;
                        }

                        // Une pastille cliquable le dit : sans ça, seule la moitié des pastilles mène
                        // quelque part et rien ne distingue laquelle.
                        &.-link {
                            @include focusRing;
                            text-decoration: none;

                            @media (hover: hover) {
                                &:hover {
                                    background: rgba($color-event, .26);
                                    border-color: $color-event;
                                    color: $color-text;
                                }
                            }
                        }
                    }
                }

                > .where {
                    display: block;
                    margin-top: .6rem;
                    color: $color-text-quiet;
                    font: $normal 1.15rem/1.3 $font-body;
                }

                > .note {
                    display: block;
                    margin-top: .5rem;
                    color: $color-event-light;
                    font: $normal 1.2rem/1.4 $font-body;

                    &[href] {
                        text-decoration: underline;
                        text-decoration-color: rgba($color-event, .5);

                        @media (hover: hover) {
                            &:hover { color: $color-text; }
                        }
                    }
                }
            }

            &.-film { align-items: flex-start; }
            &.-day { align-items: flex-start; }
        }
    }
}

// En dessous du desktop, la journée passe au-dessus de ses pastilles : 23 rem de libellé et une
// rangée de chips ne tiennent pas côte à côte sur un téléphone. Même bascule que les cartes de
// séances.
@media (max-width: 999px) {
    .events-card > .body > .row.-film {
        flex-direction: column;
        gap: .8rem;

        > .place { width: auto; }
    }
}

@keyframes eventspop {
    from { opacity: 0; transform: translateY(-.4rem); }
    to { opacity: 1; transform: none; }
}
</style>
