import svgLoader from "vite-svg-loader"
import {defineNuxtConfig} from "nuxt/config";
// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
    srcDir: 'app/',
    dir: {
        public: 'app/public',
        server: 'server',
    },
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
                    additionalData: '@import "~/assets/styles/_variables.scss";@import "@/assets/styles/_typography-mixins.scss";@import "@/assets/styles/_functions.scss";@import "@/assets/styles/_transitions.scss";',
                    silenceDeprecations: ['import']
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
        redirect: false,
        types: false,
        cookieOptions: {
            maxAge: 60 * 60 * 24 * 365,
            sameSite: 'lax',
            secure: true,
        },
    },
    runtimeConfig: {
        apiKey: '',
        apiBaseUrl: '',
        apiImgUrl: '',
        public: {
            siteUrl: '',
        },
    },
    routeRules: {
        '/': {ssr: true},
    },
    compatibilityDate: '2024-11-01',
    devtools: {enabled: true}
})