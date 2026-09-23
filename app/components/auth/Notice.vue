<template>
    <!-- Le message d'erreur d'un formulaire d'authentification.
         ⚠️ `role="alert"` : le message apparaît **après** la soumission, donc hors du flux de
         lecture. Sans lui, un lecteur d'écran ne l'annonce jamais et l'utilisateur attend une
         réponse qui est déjà à l'écran. -->
    <p class="auth-notice" role="alert">
        <slot />
    </p>
</template>

<style lang="scss" scoped>
.auth-notice {
    padding: 1rem 1.6rem;
    background-color: rgba($color-primary, .08);
    border-radius: 10px;
    color: $color-primary-lighter;
    font: $medium 1.35rem/1.4 $font-body;
}
</style>
