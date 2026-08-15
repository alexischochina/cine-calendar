<script setup>
// Un horaire de séance. Ajout par rapport à la maquette : quand Allociné fournit l'URL de
// billetterie de l'exploitant, le chip devient un lien direct vers la réservation — c'est aussi
// l'échappatoire quand la programmation Allociné se trompe (elle se trompe parfois).
const props = defineProps({
    showtime: {
        type: Object,
        required: true,
    },
});

// VO sous-titrée → « VOST », sinon la version brute. La distinction se lit sur la séance,
// jamais sur le bucket dont elle provient.
const versionLabel = computed(() =>
    props.showtime.version === 'VO' && props.showtime.subtitled ? 'VOST' : props.showtime.version
);

// Séance événement : avant-première, séance unique, label de programmation. Les libellés arrivent
// déjà traduits dans le payload (cf. `showtimeEventLabels`, server/utils/allocine.js) — il n'y a
// rien à interpréter ici.
//
// ⚠️ Allociné ne fournit **aucun texte libre** : pas de « En présence de l'équipe du film ». Ce
// qu'on affiche est donc son vocabulaire à lui, et c'est tout ce qui existe.
const events = computed(() => showtimeEvents(props.showtime));

// Plusieurs libellés sur une même séance (une avant-première jeune public) : on les met bout à bout
// plutôt que d'en choisir un — le chip s'élargit, ce qui est le bon comportement pour une séance qui
// sort de l'ordinaire.
const eventLabel = computed(() => events.value.join(' · '));

// Nom accessible du lien : « VO » épelé ne dit rien, et un lien qui ouvre un onglet doit l'annoncer.
// Posé uniquement quand le chip est un lien — `aria-label` sur un `<span>` sans rôle est ignoré par
// une partie des lecteurs d'écran, et le texte visible s'y lit très bien tel quel.
const SPOKEN_VERSION = { VO: 'version originale', VOST: 'version originale sous-titrée', VF: 'version française' };

const spokenLabel = computed(() =>
    `Réserver la séance de ${props.showtime.time.replace(':', ' h ')}, `
    + `${SPOKEN_VERSION[versionLabel.value] ?? versionLabel.value} — nouvel onglet`
);

// Le mot « événement » n'est pas dans le texte visible : le violet, l'étoile et le compteur de la
// carte le disent déjà, et le répéter sur chaque chip mangerait la place du libellé, qui est
// l'information utile. Il est en revanche indispensable à l'oral, où ni la couleur ni l'icône ne
// passent — d'où ce préfixe, servi soit dans l'`aria-label` du lien, soit dans un contenu réservé
// aux lecteurs d'écran quand le chip n'est pas cliquable.
const spokenEvent = computed(() => events.value.length ? `Séance événement — ${eventLabel.value}` : null);

const accessibleLabel = computed(() => {
    if (props.showtime.booking) {
        return spokenEvent.value ? `${spokenLabel.value}. ${spokenEvent.value}` : spokenLabel.value;
    }
    return undefined;
});

const hint = computed(() => {
    const parts = [
        spokenEvent.value,
        props.showtime.booking ? 'Réserver — ouvre la billetterie dans un nouvel onglet' : null,
    ].filter(Boolean);
    return parts.length ? parts.join(' · ') : undefined;
});
</script>

<template>
    <component :is="showtime.booking ? 'a' : 'span'" class="seances-timechip"
               :class="[`-${showtime.version.toLowerCase()}`, { '-event': events.length }]"
               :href="showtime.booking || undefined"
               :target="showtime.booking ? '_blank' : undefined"
               :rel="showtime.booking ? 'noopener noreferrer' : undefined"
               :title="hint"
               :aria-label="accessibleLabel">
        <span class="when">
            {{ showtime.time }}<span class="ver">{{ versionLabel }}</span>
        </span>
        <!-- Le libellé est du texte visible, pas seulement un `title` : un survol ne se fait ni au
             doigt ni au clavier, et c'est précisément l'information qu'on vient chercher. -->
        <span v-if="events.length" class="event">
            <Svg name="star" aria-hidden="true" />
            <span class="txt">{{ eventLabel }}</span>
            <!-- Doublon volontaire pour l'oral, uniquement quand le chip n'est pas un lien : le lien,
                 lui, porte déjà la mention dans son `aria-label`. -->
            <span v-if="!showtime.booking" class="sr">. Séance événement.</span>
        </span>
    </component>
</template>

<style lang="scss" scoped>
// Contenu lu par les lecteurs d'écran, jamais affiché. Recette standard : hors flux, 1 px, découpé —
// surtout pas `display: none` ni `visibility: hidden`, qui le retireraient aussi de l'arbre
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

.seances-timechip {
    display: inline-flex;
    flex-direction: column;
    align-items: flex-start;
    gap: .3rem;
    padding: .8rem 1rem;
    background: $color-surface-4;
    border: 1px solid $color-border-4;
    border-radius: .8rem;
    color: $color-text-body;
    transition: border-color .18s ease;

    > .when {
        display: inline-flex;
        align-items: center;
        gap: .5rem;
        font: $bold 1.25rem/1 $font-mono;

        > .ver {
            font: $semi-bold .95rem/1 $font-body;
            letter-spacing: .03rem;
        }
    }

    // Vert / ambre repris de la légende « vu au ciné » / « vu en streaming » : ce sont les mêmes
    // tokens ailleurs dans l'app, autant garder l'œil cohérent.
    &.-vo > .when > .ver { color: $color-green; }
    &.-vf > .when > .ver { color: $color-yellow; }

    // Séance événement : le chip change de famille de couleur, et l'heure passe en blanc titre —
    // c'est la seule séance de la rangée qu'on veut voir avant les autres.
    &.-event {
        background: rgba($color-event, .12);
        border-color: rgba($color-event, .45);
        color: $color-text;

        > .event {
            display: inline-flex;
            align-items: center;
            gap: .4rem;
            max-width: 22rem;
            color: $color-event-light;
            font: $semi-bold .95rem/1.2 $font-body;
            letter-spacing: .02rem;

            > :deep(svg) {
                width: .9rem;
                height: .9rem;
                flex: none;
            }

            // Un libellé long ne doit pas étirer la rangée de chips au point de la faire déborder :
            // il se coupe, et le `title` (comme la mention lue) porte le texte entier.
            > .txt {
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
        }
    }

    @media (hover: hover) {
        &[href]:hover { border-color: $color-primary; }
        &.-event[href]:hover { border-color: $color-event; }
    }
}
</style>
