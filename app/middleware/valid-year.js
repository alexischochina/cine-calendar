// `:year` invalide → redirige vers l'année courante en conservant la vue.
//
// ⚠️ Une liste partagée porte en plus le compte regardé : sans sa branche, `/abcd/listes/papa`
// renverrait sur `/2026/timeline` — on perdrait la liste consultée sur une faute de frappe.
export default defineNuxtRouteMiddleware((to) => {
    if (parseYearParam(to.params.year) !== undefined) return

    const currentYear = new Date().getFullYear()
    const name = String(to.name || '')

    if (name === 'year-listes-user' && to.params.user) {
        return navigateTo(`/${currentYear}/listes/${to.params.user}`, { replace: true })
    }

    const view = name.endsWith('stats') ? 'stats' : 'timeline'
    return navigateTo(`/${currentYear}/${view}`, { replace: true })
})
