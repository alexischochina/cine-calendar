# Page Statistiques par année — Implémentation

Récapitulatif de la feature implémentée depuis le plan
[`2607271048-page-statistiques-par-annee.md`](./2607271048-page-statistiques-par-annee.md).

## Ce que fait la feature

Un switch **Timeline | Stats** (rail gauche desktop + en-tête mobile) bascule la zone
principale du calendrier vers une vue Statistiques de l'**année sélectionnée**, sans
changer de route (`viewMode` en mémoire dans `index.vue`). Changer d'année met à jour
la Timeline **et** les Stats.

La vue Stats affiche 6 blocs, alimentés par les données réelles de l'année :

1. **Total films** (hero number)
2. **Ratio vu / à voir** — `vu = state 'seen'`, `à voir = le reste` (+ `% vu`)
3. **Ratio cinéma / streaming** — `cinéma = media 'cinema'`, `streaming = le reste`
4. **Top 5 genres**
5. **Top 5 pays** (codes ISO → nom FR via `Intl.DisplayNames`)
6. **Graphe bâtons mensuel** — films **vus** par mois (mois de `release_date`), en
   colonnes empilées : surcouche **ciné** (vert) + **streaming** (jaune)

## Architecture

- **Métadonnées en base, pas d'appel TMDB au chargement** (principe CLAUDE.md). Deux
  nouvelles colonnes `genres text[]` et `countries text[]` sur la table `calendar`,
  peuplées à l'ajout + backfill, comme `title` / `director` / `poster_path`.
- Résolution genres/pays centralisée dans `server/utils/tmdbDates.js`
  (`extractGenres`, `extractCountries`) — source unique partagée par la route `/full`
  et le script de backfill.
- Agrégats dans le composable `useYearStats(movies, year)` (tout en `computed`,
  tolérant aux `genres`/`countries` `null` des lignes pré-backfill).
- Rendu dans `StatsView.vue` : visuels hand-rollés en CSS (pas de dépendance npm),
  palette = tokens sémantiques du projet (`$color-green` = ciné, `$color-yellow` =
  streaming, `$color-primary` = accent). Identité des séries portée par
  position + légende + labels + gap de surface, jamais par la couleur seule
  (cf. skill `dataviz` — séparation CVD vert/jaune sous le seuil).

## Fichiers

**Créés**
- `_ressources/sql/2607271048-add-genres-countries-columns.sql` — migration colonnes
- `app/composables/useYearStats.js` — agrégats de l'année
- `app/components/StatsView.vue` — la vue et ses 6 blocs

**Modifiés**
- `server/utils/tmdbDates.js` — `extractGenres` / `extractCountries`
- `server/api/movies/[id]/full.js` — renvoie `genres` + `countries`
- `app/components/nav/MovieAddForm.vue` — persiste genres/pays à l'ajout
- `app/composables/useMovieCalendar.js` — filet de sécurité `getMovies` +
  patch `recheckUpcomingCinema`
- `scripts/backfill-movies.mjs` — backfill genres/pays des lignes existantes
- `app/pages/index.vue` — état `viewMode`, câblage du switch, rendu `StatsView`
- `app/components/nav/SideNav.vue` — switch Timeline|Stats actif (émet `select-view`)

## Actions manuelles requises (⚠️ avant que les tops genres/pays se remplissent)

L'implémentation code est complète, mais deux étapes s'exécutent **à la main**, comme
pour les migrations précédentes du repo :

1. **Exécuter la migration SQL** dans le SQL editor Supabase :
   `_ressources/sql/2607271048-add-genres-countries-columns.sql`
2. **Lancer le backfill** pour peupler les lignes existantes :
   ```bash
   node scripts/backfill-movies.mjs --dry-run   # vérifier
   node scripts/backfill-movies.mjs             # écrire en base
   ```

Tant que ce n'est pas fait, les blocs **Top genres** / **Top pays** affichent
« Aucun genre/pays renseigné » (état vide propre) ; les 4 autres blocs fonctionnent
déjà avec les données existantes. Les nouveaux ajouts persistent genres/pays
automatiquement dès la migration exécutée.

## Vérification effectuée

Vue rendue en desktop (dev server + navigateur) : les 6 blocs s'affichent, les
comptages sont cohérents (vu + à voir = total ; ciné + streaming = total), le graphe
montre 12 mois avec la surcouche ciné distincte, aucune erreur console, aucune
dépendance npm ajoutée.
