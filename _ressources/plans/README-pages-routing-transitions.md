# Réorganisation en pages routées avec transitions continues

Implémentation du plan `2608050929-pages-routing-transitions.md`.

## Ce qui a changé

Avant : une seule page (`index.vue`) gérait tout via des refs locales (`selectedYear`, `viewMode`).
Après : arborescence routée `/{year}/{view}` avec un chrome persistant dans le layout, pour que
les micro-animations survivent à la navigation.

### URLs

| URL | Contenu |
|-----|---------|
| `/` | Redirige (302) vers `/{annéeCourante}/timeline` |
| `/{year}/timeline` | Calendrier de l'année (ex. `/2024/timeline`) |
| `/{year}/stats` | Statistiques de l'année |
| `/undated/timeline` · `/undated/stats` | Films « Sans date » (année interne `null`) |
| Année invalide | Redirigée vers l'année courante (middleware `valid-year`) |

Toutes les URLs sont partageables/bookmarkables ; back/forward navigateur fonctionnels.

## Pourquoi les animations survivent

1. **Chrome persistant dans le layout** (`app/layouts/default.vue`) : rails, pastille de vue,
   en-tête mobile, notice catchup, menu année ne se démontent jamais → la pastille rose *glisse*
   au switch de vue (nœud DOM unique dont la classe `-view-stats` bascule).
2. **State singleton** : `useMovieCalendar` est backé par `useState` → layout et pages partagent
   la même liste `movies`, chargée une seule fois (garde-fou `loaded` sur `getMovies`).
3. **Clés de page** (`definePageMeta({ key })`) : `key: 'timeline'` / `key: 'stats'` constantes sur
   l'année → changer d'année *réutilise* l'instance (les barres `StatsMeter` tweenent leur largeur) ;
   seul le changement de vue déclenche la `pageTransition` (crossfade `.view-*`).

## Fichiers

**Créés**
- `app/pages/[year]/timeline.vue`, `app/pages/[year]/stats.vue` — pages fines
- `app/composables/useCalendarNav.js` — année/vue dérivées de la route + navigation + scroll
- `app/composables/useCatchupFlow.js` — flux d'ajout depuis Stats + notice éphémère (state partagé)
- `app/utils/yearSlug.js` — mapping `undated` ↔ `null` (source unique de vérité)
- `app/middleware/valid-year.js` — rattrape un `:year` invalide
- `app/layouts/bare.vue` — layout minimal (search, détail film)

**Modifiés**
- `app/pages/index.vue` → redirection home
- `app/layouts/default.vue` → shell persistant complet
- `app/composables/useMovieCalendar.js` → `useState` + garde `loaded` ; suppression de l'event mort `years-updated`
- `app/pages/search/index.vue`, `app/pages/movies/[id].vue` → `layout: 'bare'`
- `app/assets/styles/main.scss` → CSS de transition `.view-*` (+ `prefers-reduced-motion`)
- `nuxt.config.ts` → `app.pageTransition` (`view`, mode simultané)

## Vérifications

- `npm run build` OK (aucune erreur de prerender).
- Dev server : `/` → 302 `/login` (auth OK), `/login` 200, `/search` 200, `/{year}/{view}` matchés
  (pas de 404).

## Tests manuels restants (nécessitent une session authentifiée)

- Switch Timeline ↔ Stats : la pastille glisse, crossfade doux.
- `/2024/stats` → `/2025/stats` : les barres transitionnent (pas de reset/fondu).
- Ajout/suppression/édition de date depuis la timeline ; go-to-movie depuis Stats.
- Aucun re-fetch Supabase en naviguant timeline ↔ stats (onglet réseau).
