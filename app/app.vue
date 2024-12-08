<script setup>
import { register } from 'swiper/element/bundle';

register()

useHead({
    htmlAttrs: {
        lang: 'fr'
    },
    link: [
        {rel: 'apple-touch-icon', sizes: '180x180', href: `/apple-touch-icon.png`},
        {rel: 'icon', sizes: '32x32', href: `/favicon-32x32.png`},
        {rel: 'icon', sizes: '16x16', href: `/favicon-16x16.png`},
        {rel: 'manifest', href: `/site.webmanifest`},
        {rel: 'preconnect', href: `https://firebasestorage.googleapis.com/`, crossorigin: "anonymous"}
    ],
    meta: [
        {name: 'msapplication-TileColor', content: '#3b0028'},
        {name: 'theme-color', content: '#ec008b'}
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
