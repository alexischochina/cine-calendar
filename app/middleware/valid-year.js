// `:year` invalide → redirige vers l'année courante en conservant la vue.
export default defineNuxtRouteMiddleware((to) => {
    if (parseYearParam(to.params.year) === undefined) {
        const currentYear = new Date().getFullYear()
        const view = String(to.name || '').endsWith('stats') ? 'stats' : 'timeline'
        return navigateTo(`/${currentYear}/${view}`, { replace: true })
    }
})
