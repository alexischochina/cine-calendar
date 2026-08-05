<script setup>
// Home = redirection vers l'année courante en timeline (auth d'abord via le middleware).
definePageMeta({ middleware: ['auth'] })

const currentYear = new Date().getFullYear()
await navigateTo(`/${currentYear}/timeline`, { redirectCode: 302, replace: true })
</script>

<template>
    <div />
</template>
