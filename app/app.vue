<script setup>
import { register } from 'swiper/element/bundle';

register()

useHead({
    htmlAttrs: {
        lang: 'fr'
    },
    titleTemplate: (title) => title ? `${title} — CinéCal` : 'CinéCal',
    link: [
        {rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg'},
        {rel: 'icon', type: 'image/x-icon', href: '/favicon.ico'},
        {rel: 'apple-touch-icon', sizes: '180x180', href: `/apple-touch-icon.png`},
        {rel: 'preconnect', href: `https://firebasestorage.googleapis.com/`, crossorigin: "anonymous"}
    ],
    meta: [
        {name: 'msapplication-TileColor', content: '#3b0028'},
        {name: 'theme-color', content: '#ec008b'},
        {name: 'description', content: 'Mon calendrier de films perso — suis tes sorties ciné et séries au fil des mois.'},
        {property: 'og:type', content: 'website'},
        {property: 'og:title', content: 'CinéCal'},
        {property: 'og:description', content: 'Mon calendrier de films perso — suis tes sorties ciné et séries au fil des mois.'},
        {property: 'og:image', content: '/og-image.svg'},
        {name: 'twitter:card', content: 'summary_large_image'},
        {name: 'twitter:title', content: 'CinéCal'},
        {name: 'twitter:description', content: 'Mon calendrier de films perso — suis tes sorties ciné et séries au fil des mois.'},
        {name: 'twitter:image', content: '/og-image.svg'},
    ]
})
</script>

<template>
    <div id="full-wrapper">
        <NuxtLayout>
            <NuxtPage/>
        </NuxtLayout>
    </div>
</template>

<style scoped lang="scss">
.full-wrapper {
    overflow: hidden;
}
</style>
