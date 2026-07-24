# Refonte visuelle Timeline — notes d'implémentation

Applique le style « Claude Design » (`_ressources/Timeline.html`) à la page calendrier (`/`).
Plan : `_ressources/plans/2607241545-refonte-style-timeline.md`. Branche : `feature/refonte-style-timeline`.

Seule la **couche présentation** change + une colonne DB `director`. Toute la logique métier
(Supabase, TMDB, overrides de date, auto-inTheaters, revérif) est inchangée.

## Ce qui a changé

### Design tokens & fontes
- `app/assets/styles/_variables.scss` : nouvelle palette (fond `#0C0D11`, texte, accent rose
  `#FF3D77`, vert/ambre/gris statut, surfaces/bordures/nuances de texte). Noms historiques
  (`$color-primary/green/yellow/orange`) conservés mais réaffectés → propagation auto dans les
  composants. Ajout `$font-title` (Bricolage Grotesque), `$font-body` (Schibsted Grotesk),
  `$font-mono` (Space Mono).
- `app/assets/styles/_ui.scss` : `body` en `#0C0D11` / texte `#E8E9ED` ; classe `.scr`
  (scrollbar fine).
- `app/assets/styles/_typography-mixins.scss` : mixins rebranchés sur les nouvelles fontes.
- **Fontes self-hébergées** (`app/assets/fonts/*.woff2`, sous-ensemble latin couvrant le
  français) : Bricolage Grotesque + Schibsted Grotesk (variables) + Space Mono 400/700,
  déclarées en `@font-face` dans `_fonts.scss`. Pas de dépendance Google Fonts (ni requête
  tierce, ni fuite d'IP). `display: swap`.
- Les `@font-face` Futura/Do Hyeon sont **conservés** (encore référencés par des composants
  hors périmètre via `$font-futura` / `$font-do-hyeon`).

### Réalisateur (nouveau champ `director`)
- Migration SQL : `_ressources/sql/2607241545-add-director-column.sql` (**à exécuter dans
  Supabase**).
- `server/utils/tmdbDates.js` : helper `extractDirector(credits)` (source unique).
- `server/api/movies/[id]/full.js` : `append_to_response=release_dates,credits` + `director`.
- `MovieAddForm.vue`, `useMovieCalendar.js` (filet de sécurité + revérif) : persistance /
  propagation de `director`.
- `scripts/backfill-movies.mjs` : renseigne `director` (sélectionne aussi les lignes déjà
  backfillées mais sans réalisateur). **À relancer** : `node scripts/backfill-movies.mjs`.

### Layout & composants
- `app/pages/index.vue` : shell 3 colonnes (rail gauche / timeline scrollable / rail droit),
  **scroll continu** (accordéon supprimé), en-têtes mois + compteur « N films », surlignage
  de l'année active au scroll, en-tête mobile (titre + pastille année + segmented), menu année
  mobile, bande « Au ciné » mobile.
- `app/components/nav/SideNav.vue` *(nouveau)* : rail gauche (titre, toggle Timeline|Stats —
  **Stats = placeholder inactif**, années + compteurs, légende STATUTS).
- `app/components/CinemaNowPanel.vue` *(nouveau)* : « Au ciné en ce moment », variantes
  `rail` (desktop) / `band` (mobile repliable). Clic → scroll vers la ligne.
- `app/components/MediaBadge.vue` *(nouveau)* : pastilles média CSS (pellicule / N / P / D+ /
  play). Mapping `vod → play`, `unknown → play`.
- `app/components/MovieListItem.vue` : nouvelle ligne `[jour] [poster] [titre / sous-titre]
  [média] [état] [⋮]`, bord gauche 3px + fond teinté par état, sous-titre = réalisateur sinon
  libellé.
- `app/components/SelectBtn.vue` : dropdowns interactifs conservés, restylés (média = MediaBadge,
  état = icônes ticket/œil/download).
- `app/components/MovieActionsBtn.vue`, `nav/Header.vue`, `nav/FilterPanel.vue`,
  `nav/MovieAddForm.vue` : restylés (popover / barre flottante pill / filtres) sur la maquette.
  `YearPicker.vue` supprimé (rail gauche desktop + pastille année mobile le remplacent).
- SVG (`app/assets/svg/`) : icônes repointées sur le set de la maquette (`unseen`=œil vide,
  `seen`=œil, `inTheaters`=ticket, `downloadAvailable`=download) + nouveaux
  `film`/`play`/`chevron`/`list`/`chart` (tous en `currentColor`).

## Breakpoint
Bascule desktop / mobile à **1000px** (repris de la maquette, ≠ breakpoints projet 767/1024).

## Reste à faire (hors code)
1. Exécuter la migration SQL `director` dans Supabase.
2. Relancer `node scripts/backfill-movies.mjs` pour renseigner les réalisateurs existants.
3. **QA fonctionnelle connectée** (Step 10) : ajout, filtres, changement média/état, édition/
   retrait de date, suppression, scroll-to-today, recherche, panneau « au ciné », auto-inTheaters,
   revérif TMDB — nécessite une session Supabase authentifiée.
