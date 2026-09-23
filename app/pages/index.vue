<script setup>
// Home = redirection vers l'année courante en timeline.
//
// ⚠️ La redirection vit dans la **chaîne de middlewares**, pas dans le `<script setup>` : là, elle
// s'exécutait avant que le middleware de la cible ait tranché, et laissait `/2026/timeline` dans la
// barre d'adresse d'une page `/pending`. En middleware, un `navigateTo` arrête la chaîne.
//
// ⚠️ L'ordre est le propos : `auth` **avant** la redirection d'année, jamais l'inverse.
definePageMeta({
    middleware: [
        'auth',
        () => navigateTo(`/${new Date().getFullYear()}/timeline`, { redirectCode: 302, replace: true }),
    ],
})
</script>

<template>
    <div />
</template>
