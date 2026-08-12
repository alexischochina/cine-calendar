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

// Nom accessible du lien : « VO » épelé ne dit rien, et un lien qui ouvre un onglet doit l'annoncer.
// Posé uniquement quand le chip est un lien — `aria-label` sur un `<span>` sans rôle est ignoré par
// une partie des lecteurs d'écran, et le texte visible s'y lit très bien tel quel.
const SPOKEN_VERSION = { VO: 'version originale', VOST: 'version originale sous-titrée', VF: 'version française' };

const spokenLabel = computed(() =>
    `Réserver la séance de ${props.showtime.time.replace(':', ' h ')}, `
    + `${SPOKEN_VERSION[versionLabel.value] ?? versionLabel.value} — nouvel onglet`
);
</script>

<template>
    <component :is="showtime.booking ? 'a' : 'span'" class="seances-timechip"
               :class="`-${showtime.version.toLowerCase()}`"
               :href="showtime.booking || undefined"
               :target="showtime.booking ? '_blank' : undefined"
               :rel="showtime.booking ? 'noopener noreferrer' : undefined"
               :title="showtime.booking ? 'Réserver — ouvre la billetterie dans un nouvel onglet' : undefined"
               :aria-label="showtime.booking ? spokenLabel : undefined">
        {{ showtime.time }}<span class="ver">{{ versionLabel }}</span>
    </component>
</template>

<style lang="scss" scoped>
.seances-timechip {
    display: inline-flex;
    align-items: center;
    gap: .5rem;
    padding: .8rem 1rem;
    background: $color-surface-4;
    border: 1px solid $color-border-4;
    border-radius: .8rem;
    color: $color-text-body;
    font: $bold 1.25rem/1 $font-mono;
    transition: border-color .18s ease;

    > .ver {
        font: $semi-bold .95rem/1 $font-body;
        letter-spacing: .03rem;
    }

    // Vert / ambre repris de la légende « vu au ciné » / « vu en streaming » : ce sont les mêmes
    // tokens ailleurs dans l'app, autant garder l'œil cohérent.
    &.-vo > .ver { color: $color-green; }
    &.-vf > .ver { color: $color-yellow; }

    @media (hover: hover) {
        &[href]:hover { border-color: $color-primary; }
    }
}
</style>
