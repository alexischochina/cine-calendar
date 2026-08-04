# Top 10 Letterboxd & liste « À rattraper » — page Statistiques

Deux sliders ajoutés à la vue **Stats** (`/` → bascule Stats), pleine largeur, empilés,
après les top-listes genres/pays et avant la carte du monde (ordre maquette) :

1. **Top 10 Letterboxd** — les films de l'année sélectionnée non encore vus et déjà sortis,
   classés par note Letterboxd décroissante. Clic sur une carte → fiche Letterboxd.
2. **À rattraper** — films personnellement marqués « à rattraper », + slots « Ajouter » (dashed)
   jusqu'à 10. Clic carte → le film dans la timeline. Clic « Ajouter » → popin de recherche
   (suggestions dans ma liste, fallback API TMDB).

Plan source : [`plans/2608031000-stats-top10-letterboxd-et-liste-rattrapage.md`](plans/2608031000-stats-top10-letterboxd-et-liste-rattrapage.md).

## Ce qui a été fait

| # | Fichier | Rôle |
|---|---------|------|
| 1 | `_ressources/sql/2608031000-add-catchup-and-letterboxd-columns.sql` | Migration : `catchup`, `letterboxd_rating`, `letterboxd_rating_at`, `tmdb_vote` |
| 2 | `server/api/movies/[id]/letterboxd.js` | Scrape la note Letterboxd (JSON-LD `aggregateRating`), cache 24 h, échec → `null` |
| 2 | `server/api/movies/[id]/full.js` | Retourne aussi `vote_average` (fallback de tri gratuit) |
| 3 | `app/composables/useMovieCalendar.js` | `setCatchup`, `refreshLetterboxdRatings`, `addCatchupMovie` + persistance `tmdb_vote` |
| 3 | `app/components/nav/MovieAddForm.vue` | Persiste `tmdb_vote` à l'insert d'un film |
| 4 | `app/pages/index.vue` | Wiring events + refresh des notes à l'ouverture Stats |
| 5 | `app/components/stats/TopRated.vue` | Slider Top 10 (`<StatsTopRated>`) |
| 6 | `app/components/stats/Catchup.vue` | Slider À rattraper + popin recherche (`<StatsCatchup>`) |
| 7 | `app/components/StatsView.vue` | Intégration pleine largeur dans la grille + relais des events |
| 5 | `app/assets/svg/star.svg` | Picto étoile (note Letterboxd) |
| 8 | `scripts/backfill-letterboxd.mjs` | Backfill one-shot des notes des lignes existantes |

## Comment ça marche

- **Notes Letterboxd** : Letterboxd n'a pas d'API publique. `letterboxd.com/tmdb/{id}/` redirige
  vers la fiche film, dont le `<script type="application/ld+json">` porte `aggregateRating.ratingValue`
  (échelle 0–5). La route scrape ce bloc, cache 24 h. **Persistance en BDD** (`letterboxd_rating` +
  `letterboxd_rating_at`) : pas de scraping à chaque render.
- **Refresh** : `refreshLetterboxdRatings(year)` ne tourne qu'à l'ouverture de l'onglet Stats (watch
  sur `viewMode`/`selectedYear`), throttlé à 8 requêtes concurrentes, et **skip les notes fraîches**
  (< 7 j). Un seul réassign de `movies.value` (pattern `recheckUpcomingCinema`).
- **Fallback de tri** : quand la note Letterboxd manque (scrape échoué / film sans fiche), on trie et
  affiche sur `tmdb_vote` (`vote_average` TMDB, /10 ramené sur /5), déjà fetché via `/full` (coût nul).
  Le Top 10 reste donc toujours triable même si le scrape casse. Note fallback affichée sans étoile,
  teinte atténuée.
- **Catchup** : colonne booléenne `catchup` sur `calendar`, persistée. Toggle (`setCatchup`) patch
  local sans refetch. Ajout d'un film absent de la liste (`addCatchupMovie`) : insère une ligne
  `calendar` (`state:'unseen'`, `catchup:true`, métadonnées `/full`) puis intégration locale via
  `handleMovieAdded` → le film apparaît aussi dans la timeline.
- **Popin recherche** : query vide → 10 derniers non-vus de l'année dans ma liste (date desc) ;
  saisie → filtre titre sur les non-vus de l'année (max 5), et si 0 résultat → fallback
  `/api/movies/search` (max 5). Suggestion « liste » → toggle catchup ; suggestion « TMDB » → insert.
- **Prerender-safe** : les sliders swiper (web-components) sont dans `<ClientOnly>` → jamais rendus
  en SSR/prerender, `npm run build` passe (route `/` prerendered).

## Vérifications effectuées

- `npm run build` ✓ (TopRated, Catchup, route letterboxd, StatsView compilent ; homepage prerendered OK)
- Scrape Letterboxd validé contre films réels : Inception `4.24`, Interstellar `4.45`, id bogus → `null` propre
- Extraction JSON-LD partagée entre la route et le script de backfill

## Reste à faire

1. **Exécuter la migration SQL** `_ressources/sql/2608031000-add-catchup-and-letterboxd-columns.sql`
   dans le SQL editor Supabase (prérequis des composants et du backfill).
2. *(Optionnel)* Peupler les notes existantes : `node scripts/backfill-letterboxd.mjs`
   (`--dry-run` pour un essai à blanc).
3. **Test interactif** (session Supabase authentifiée + données réelles) : `npm run dev` → se
   connecter → `/` → bascule **Stats** → vérifier les deux sliders, le clic Letterboxd, le toggle
   catchup (persistant après reload), la popin (liste puis fallback TMDB), et l'ajout d'un film TMDB
   à rattraper qui apparaît dans la timeline.
