# Persistance des métadonnées films + optimisation du chargement

Feature implémentée depuis le plan `_ressources/plans/2607241048-persist-movie-metadata-and-optimize-load.md`.

## Problème résolu

Avant : chaque chargement du calendrier tirait ~2 requêtes TMDB par film (~800 appels pour ~400 films) → `429 Too Many Requests`. Les métadonnées sont désormais **stockées en base à l'ajout** ; le chargement lit Supabase seul, zéro appel TMDB en régime normal.

## Ce qui a changé

| Fichier | Changement |
|---------|-----------|
| `_ressources/sql/2607241048-add-movie-metadata-columns.sql` | Migration : colonnes `title`, `release_date`, `poster_path` sur `calendar` |
| `server/api/movies/[id]/full.js` | **Nouveau** endpoint : 1 seul appel TMDB (`append_to_response=release_dates`) → `{ title, poster_path, release_date }`. Source unique de la résolution date FR. |
| `app/components/nav/MovieAddForm.vue` | `addMovie()` récupère `/full` et persiste les métadonnées à l'insert |
| `app/utils/promisePool.js` | **Nouveau** helper : N promesses max en parallèle (throttle anti-429) |
| `scripts/backfill-movies.mjs` | **Nouveau** script one-shot de backfill des lignes existantes |
| `app/composables/useMovieCalendar.js` | `getMovies()` lit la BDD seule (+ filet de sécurité) ; revérif des dates cinéma à venir ; suppression de `getReleaseDateFromId` |
| `app/composables/useMovieScroll.js` | Data-driven : déduit l'année cible des données, déplie, puis scrolle (compat montage paresseux) |
| `app/components/MovieListItem.vue` | Reçoit `title`/`poster-path` en props, plus de fetch `onMounted` ; poster `loading="lazy"` |
| `app/pages/index.vue` | Passe `:title`/`:poster-path` ; années repliées en `v-if` (montage paresseux) |
| `CLAUDE.md` | Section Data flow mise à jour |

## Étapes manuelles à exécuter (dans l'ordre)

1. **Migration SQL** — exécuter `_ressources/sql/2607241048-add-movie-metadata-columns.sql` dans le SQL editor Supabase.
2. **Backfill** — lancer une seule fois, avant que les users rechargent :
   ```bash
   node scripts/backfill-movies.mjs --dry-run   # vérification
   node scripts/backfill-movies.mjs             # écriture
   ```
   Le script utilise `SUPABASE_SERVICE_KEY` si présent dans `.env` (recommandé, contourne la RLS), sinon `SUPABASE_KEY` (anon — l'update échouera si la RLS exige un user authentifié).

Un filet de sécurité côté client (`getMovies`) résout à la volée toute ligne résiduelle sans `title`, donc l'app reste fonctionnelle même si le backfill n'est pas passé.

## Modèle mental

- **TMDB n'est appelé qu'à** : l'ajout d'un film, la revérif des sorties cinéma à venir, le filet de sécurité, la page détail `/movies/[id]`.
- `manual_release_date` (override user) > `release_date` (TMDB stockée). Le raw TMDB est conservé localement sous `_tmdbReleaseDate` pour retomber dessus si l'override est retiré.
- Posters servis depuis `image.tmdb.org` via `poster_path` (rien téléchargé). Lien Letterboxd dérivé de `movie_id`.

## Note

L'endpoint `server/api/movies/[id]/release_dates.js` n'est plus consommé côté client (remplacé par `/full`) mais est conservé (inoffensif). `/api/movies/[id]` reste utilisé par la page détail.
