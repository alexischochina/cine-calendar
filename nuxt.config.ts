import svgLoader from "vite-svg-loader"
import {defineNuxtConfig} from "nuxt/config";
// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
    srcDir: 'app/',
    css: ['@/assets/styles/main.scss'],
    vite: {
        plugins: [
            svgLoader({
                svgoConfig: {
                    plugins: []
                }
            })
        ],
        css: {
            preprocessorOptions: {
                scss: {
                    additionalData: '@import "~/assets/styles/_variables.scss";@import "@/assets/styles/_typography-mixins.scss";@import "@/assets/styles/_functions.scss";@import "@/assets/styles/_transitions.scss";'
                }
            }
        },
    },
    vue: {
        compilerOptions: {
            isCustomElement: (tag) => ['swiper-container', 'swiper-slide'].includes(tag)
        }
    },
    modules: ["@nuxt/image", 'nuxt-swiper', '@nuxtjs/supabase', '@pinia/nuxt'],
    supabase: {
        url: process.env.SUPABASE_URL,
        key: process.env.SUPABASE_KEY,
        redirect: false,
    },
    runtimeConfig: {
        apiKey: '',
        apiBaseUrl: '',
        apiImgUrl: '',
    },
    routeRules: {
        '/': {prerender: true},
    },
    compatibilityDate: '2024-11-01',
    devtools: {enabled: true}
})