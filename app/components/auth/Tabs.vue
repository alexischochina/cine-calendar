<script setup>
// L'état actif vient de la route, jamais d'un `ref` : un état local dupliquerait la même vérité et
// finirait par en diverger (retour arrière, lien direct).
const route = useRoute();
const isRegister = computed(() => route.path.startsWith('/register'));
</script>

<template>
    <div class="auth-tabs">
        <NuxtLink class="tab" :class="{ '-active': !isRegister }" to="/login">Connexion</NuxtLink>
        <NuxtLink class="tab" :class="{ '-active': isRegister }" to="/register">Inscription</NuxtLink>
    </div>
</template>

<style lang="scss" scoped>
.auth-tabs {
    display: grid;
    grid-template-columns: 1fr 1fr;
    // ⚠️ `.4rem` volontairement non arrondi : c'est le liseré qui laisse voir le fond du conteneur
    // autour de l'onglet actif, pas du spacing. L'arrondi de la règle l'enverrait à 0 ou à .8rem.
    gap: .4rem;
    padding: .4rem;
    background-color: $color-surface-1;
    border: 1px solid $color-border-2;
    border-radius: 12px;

    > .tab {
        padding: 1rem;
        border-radius: 9px;
        color: $color-text-muted;
        text-align: center;
        transition: background-color .15s ease, color .15s ease;
        font: $semi-bold 1.4rem/1 $font-body;

        @include focusRing();

        &.-active {
            background-color: $color-hover-strong;
            color: $color-text;
        }

        @media (hover: hover) {
            &:hover:not(.-active) {
                color: $color-text;
            }
        }
    }
}
</style>
