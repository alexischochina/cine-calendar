<script setup>
// Home = redirection vers l'année courante en timeline.
//
// ⚠️ La redirection vit dans la **chaîne de middlewares**, pas dans le `<script setup>`. Elle y était,
// et ça produisait une URL menteuse : `auth` laissait passer (session valide), le setup redirigeait
// vers `/2026/timeline` en `replace`, puis le middleware `auth` de la timeline découvrait que le
// compte n'est pas approuvé et renvoyait sur `/pending`. La page affichée était donc `/pending` avec
// `/2026/timeline` dans la barre d'adresse — l'entrée d'historique ayant déjà été remplacée.
//
// En middleware, la chaîne se résout en une passe et dans le bon ordre : si `auth` rend un
// `navigateTo`, la suite n'est jamais atteinte. Un compte non approuvé n'entame donc plus un voyage
// vers la timeline qu'il faudra annuler.
//
// ⚠️ L'ordre des deux est le propos : `auth` **avant** la redirection d'année, jamais l'inverse.
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
