# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Approach
- Think before acting. Read existing files before writing code.
- Be concise in output but thorough in reasoning.
- Prefer editing over rewriting whole files.
- Do not re-read files you have already read unless the file may have changed.
- Skip files over 100KB unless explicitly required.
- Suggest running /cost when a session is running long to monitor cache ratio.
- Recommend starting a new session when switching to an unrelated task.
- Test your code before declaring done.
- No sycophantic openers or closing fluff.
- Keep solutions simple and direct.
- User instructions always override this file.

## Commands

```bash
npm run dev       # Start dev server at http://localhost:3000
npm run build     # Build for production
npm run generate  # Generate static site
npm run preview   # Preview production build
npm test          # Règles pures des vues Séances / Événements (scripts/test-seances-rules.mjs)
```

**Tests** — `npm test` couvre les règles **pures** des vues Séances et Événements : filtres et
regroupements, semaine ciné, report des salles disparues, vocabulaire d'événement, connecteurs
d'exploitant, verdicts « en salle » — plus la lecture des fiches Letterboxd (note et liens
réalisateurs), le slug et le « ce qu'il a que je n'ai pas » des listes partagées, et le regroupement
année → mois → jour commun aux deux timelines. Aucun framework — un script Node qui sort en code 1 au premier échec. Les composables (état, réseau, écritures) ne sont **pas** couverts : c'est là que se sont logés
les défauts trouvés en revue, à garder en tête avant d'y toucher.

⚠️ Ne pas lancer `npm run build` pendant qu'un serveur de dev tourne : il écrit dans `.nuxt` au format
production et le dev suivant échoue sur `#internal/nuxt/paths`. Nettoyer par
`rm -rf .nuxt .output .nitro && npx nuxt prepare`.

## Architecture

**Stack:** Nuxt 3 (Vue 3) + Pinia + Supabase + TMDB API. Source lives in `app/`.

**Routing:** File-based via `app/pages/`. Auth middleware (`app/middleware/auth.js`) protects the home route. Login/register use Supabase auth.

**Data flow:**
- Calendar entries are stored in Supabase table `calendar`. Columns: `id`, `movie_id`, `media`, `state`, `manual_release_date`, plus the **persisted TMDB metadata** `title`, `release_date` (resolved FR theatrical date, nullable), `poster_path` (relative TMDB path).
- ⚠️⚠️ **La lecture de `calendar` n'est plus cloisonnée par RLS** depuis les listes partagées
  (`2609231743`) : un compte approuvé lit aussi les lignes des comptes qui portent un
  `profiles.display_name`. Le filtre de propriétaire est donc porté par le **code**, et il n'est pas
  facultatif — `.eq('user_id', …)` sur toute lecture de `calendar` et de `profiles`. Six sites en
  dépendent, dont trois où l'oubli fait **lever** `maybeSingle()` avec un symptôme qui ne ressemble
  pas à sa cause (tout le monde sur `/pending`, 503 sur les routes gardées, Paris servi à un compte
  troyen). Détail et contrôle reproductible : `_ressources/README-listes-partagees.md`.
- ⚠️⚠️ **Ce filtre ne s'écrit jamais `user.value.id`.** `useSupabaseUser()` rend les **claims du
  JWT** (les deux plugins de `@nuxtjs/supabase` 2.0.5 y écrivent `getClaims()`), donc l'identifiant
  s'appelle `sub` et `.id` vaut `undefined` — au rendu serveur comme dans le navigateur. Toujours
  `userIdOf(user.value)` (`app/utils/currentUser.js`). En lecture, l'oubli donne un `22P02` que les
  replis fermés traduisent en « compte non validé » ; en écriture, la clé absente est rattrapée par
  `default auth.uid()` sur `calendar` mais **pas** sur `cinema_favorites`, qui n'en a pas.
- **Metadata lives in the DB, not fetched on every load.** TMDB is called only (a) when adding a movie (`MovieAddForm` → `/api/movies/:id/full`, persisted on insert) and (b) when re-checking upcoming cinema release dates on load (`useMovieCalendar.recheckUpcomingCinema` — only `media==='cinema'`, no `manual_release_date`, date in the future/null). Normal page load reads Supabase only → no TMDB calls, no `429`.
- Server routes in `server/api/movies/` (repo root, not under `app/`): `search`, `[id]` (detail, used by `/movies/[id]`), `[id]/release_dates`, and `[id]/full` (single TMDB call with `append_to_response=release_dates`, returns resolved `{ title, poster_path, release_date }`). FR date resolution (type 3 theatrical, else CNC/Netflix/Amazon/Disney+ notes) lives in `server/utils/tmdbDates.js` — **single source of truth**, auto-imported by the route and imported explicitly by the backfill script.
- Posters are served from the `image.tmdb.org` CDN using the stored `poster_path`; the poster file itself is not downloaded/stored. The Letterboxd link **du film** is derived from `movie_id` (no column). Celui **du réalisateur** ne se
devine pas — homonymes suffixés, orthographes divergentes : il est lu sur la fiche film
(`director[].sameAs` du JSON-LD, page déjà chargée pour la note — `shared/utils/letterboxdFilm.js`) et
persisté dans `calendar.letterboxd_directors`. Le slug deviné de `app/utils/movieHelpers.js` est un
repli, pas une source.
- `manual_release_date` (user override) always wins over the stored `release_date`. `useMovieCalendar` keeps the raw stored TMDB date under `_tmdbReleaseDate` so clearing an override falls back correctly.
- One-shot backfill of pre-existing rows: `scripts/backfill-movies.mjs` (throttled to 8 concurrent via `app/utils/promisePool.js`). Migration SQL in `_ressources/sql/`.
- Pinia store at `app/stores/movies.js` manages filters / movies list state.

**Séances & Événements (Allociné + exploitants) :**
- Horaires parisiens depuis Allociné (`server/utils/allocine.js`), deux caches durables
  (`showtimes_cache`, `theater_events_cache`), un cache L1 de visite et un instantané L0 persistant
  (`useShowtimes`).
- **Trois niveaux de cache, et une distinction à ne pas perdre.** Le L0 (`localStorage`, cf.
  `app/utils/seancesSnapshot.js`) sert à **afficher** immédiatement le dernier état connu pendant que
  la page recharge. `useShowtimes` expose donc `payloadFor` (L1 puis L0, pour l'affichage) et
  `livePayloadFor` (L1 seul, pour **décider**). ⚠️ Règle sans exception : `payloadFor` n'apparaît que
  dans du code qui **affiche**. Tout ce qui écrit en base ou déclenche du réseau — `syncEvents`,
  `syncInTheaters`, `pruneEmptyHorizon`, `useUpcomingEvents`, `needsRevalidation` — lit
  `livePayloadFor` : un instantané d'hier n'est une preuve de rien aujourd'hui. L'inventaire à jour
  vit en tête de `livePayloadFor` ; `grep -n "payloadFor" app/composables/` le vérifie.
- Le cache durable est **préchauffé** par une tâche planifiée (`server/api/cron/warm.js`, déclenchée
  par `.github/workflows/warm-showtimes.yml`), pour que le visiteur ne paie plus l'aller-retour
  Allociné. ⚠️ Sa cadence **suit** le TTL de `showtimesFreshness.js`, elle ne l'autorise pas à
  s'allonger : changer l'un sans l'autre laisse une fenêtre froide ou fait mentir la vue.
- Le cycle qui sort chez Allociné vit dans `server/utils/refreshShowtimes.js` — **source unique**,
  partagée par la route à la demande et par le cron. Une divergence ici s'écrirait en base.
- ⚠️ **Deux endpoints Allociné, deux jeux de champs** : celui par film porte les horaires mais aucun
  marqueur d'événement ; celui par salle les porte. D'où une seconde passe ciblée (`useTheaterEvents`),
  qui rapproche les séances par `internalId`.
- Le **texte libre** d'un événement (« en présence du réalisateur ») n'existe pas chez Allociné : il
  vient des exploitants — UGC, Dulac, MK2 — via `server/utils/exhibitors.js` et ses modules frères.
- Les règles pures vivent dans `app/utils/{seancesGrouping,seanceEvents,inTheaters}.js` et
  `shared/utils/` (dépendance-free, importable app / serveur / scripts).
- Mode d'emploi complet et pièges documentés : `_ressources/README-seances.md`.

**Listes partagées entre comptes :**
- Un onglet par compte qui partage sa liste (`/[year]/listes/[user]`), en **lecture seule**, avec une
  bascule « Seulement ceux que je n'ai pas » et un ajout film par film chez soi.
- L'interrupteur est `profiles.display_name`, rempli **à la main** dans le dashboard Supabase :
  renseigné = partagé, `null` = invisible. Le partage est mutuel et total entre comptes nommés.
- ⚠️ `useSharedLists` ne fait **que lire**. Les policies d'écriture restent cloisonnées : un `update`
  sur la ligne d'un autre ne lève pas, il touche **zéro ligne**. Tout rattrapage écrit là (filet des
  métadonnées, promotion « en salle », revérif TMDB, notes Letterboxd) réessaierait indéfiniment en
  croyant réussir. Même raison à l'écran : pastilles inertes, jamais des sélecteurs neutralisés.
- ⚠️ Rejouer `2609221213` ou `2609231045` **supprime ou invalide** la policy de partage, sans le
  dire. Rejouer `2609231743` derrière, **puis `2609241150`** — le `create or replace function` de la
  première réinitialise l'ACL et rouvre `shared_list_owner_ids()` à `public`.
- ⚠️ `create function` accorde `execute` à **`public`**, dont `anon` est membre : un
  `revoke … from anon` seul ne ferme rien. C'est `2609241150` qui révoque à `public`.
- Les règles pures vivent dans `app/utils/{sharedLists,moviesGrouping}.js` et sont couvertes par
  `npm test`.
- Mode d'emploi complet et pièges documentés : `_ressources/README-listes-partagees.md`.

**Écrans d'authentification (login / register / pending / mot de passe oublié) :**
- Cinq écrans sur un layout commun (`app/layouts/auth.vue`) + `app/components/auth/`. Aucun ne porte
  le middleware `auth` : on y arrive sans session utilisable.
- ⚠️ Le parcours « mot de passe oublié » dépend de **deux réglages du dashboard Supabase**, pas du
  dépôt : l'URL `<site>/nouveau-mot-de-passe` dans les *Redirect URLs*, et un expéditeur d'e-mails
  capable d'écrire à l'adresse visée.
- ⚠️ Le lien de récupération est en flux **PKCE** : il ne fonctionne que dans le navigateur qui l'a
  demandé. Ouvert ailleurs, il donne « Lien expiré ou déjà utilisé » — c'est le comportement attendu.
- `app/error.vue` rend la page d'erreur (404 et les autres), hors layout et hors middleware.
  ⚠️ Elle dépend de `app/plugins/pinia-payload-guard.js` : sans lui, le *payload reducer* de
  `@pinia/nuxt` 0.9 plante à la sérialisation (`hasOwnProperty` sur le payload racine, créé sans
  prototype) et **toute** page d'erreur sort en 500. Défaut antérieur au chantier, corrigé avec lui.
- Mode d'emploi complet et pièges documentés : `_ressources/README-pages-auth.md`.

**Key pages:**
- `/` — Calendar home, movies grouped by year → month → day
- `/[year]/listes/[user]` — La timeline d'un autre compte, en lecture seule
- `/seances` — Séances parisiennes des films de la liste
- `/evenements` — Avant-premières et séances spéciales de la semaine
- `/search` — TMDB movie search with debounce
- `/movies/[id]` — Movie detail page

**Components:** `MovieListItem.vue` (per-movie row with media type + watch state dropdowns), `SelectBtn.vue` (shared dropdown), `nav/Header.vue` (bottom-floating nav with add-movie form), `Svg.vue` (SVG icon wrapper).

## Environment Variables

Required in `.env` (voir `.env.example`) :
```
SUPABASE_URL=
SUPABASE_KEY=
TMD_TOKEN=          # TMDB bearer token
NUXT_API_KEY=       # TMDB API key
NUXT_API_BASE_URL=  # TMDB API base URL
NUXT_API_IMG_URL=   # TMDB image CDN base URL
NUXT_CRON_SECRET=   # secret du préchauffage — vide = /api/cron/warm éteinte (503), jamais ouverte
NUXT_PUBLIC_SITE_URL= # URL publique — Open Graph, et lien de réinitialisation de mot de passe
```

⚠️ `NUXT_PUBLIC_SITE_URL` sert au `redirectTo` de `resetPasswordForEmail` (`/mot-de-passe-oublie`).
Vide, `useRequestURL().origin` prend le relais — acceptable en local, faux en production. Et l'URL
`<site>/nouveau-mot-de-passe` doit figurer dans les *Redirect URLs* du dashboard Supabase.

⚠️ **Le parcours « mot de passe oublié » dépend d'un expéditeur d'e-mails**, qui ne se règle pas dans
le dépôt : le SMTP intégré de Supabase est plafonné à quelques messages par heure et, sur les projets
récents, n'écrit qu'aux adresses **membres du projet**. « Compte approuvé » (`profiles.approved`) et
« adresse membre du projet Supabase » sont deux listes sans rapport : un compte parfaitement approuvé
peut ne jamais recevoir son lien. Un SMTP tiers (Brevo, Resend) lève la limite.

Requis **par l'app et par les scripts** :
```
NUXT_SUPABASE_SECRET_KEY=  # clé service-role, contourne RLS — repli : SUPABASE_SERVICE_KEY, SUPABASE_KEY
```
⚠️ Plus « scripts uniquement » depuis le préchauffage : `server/api/cron/warm.js` en a besoin — une
tâche planifiée n'a pas de session, et les politiques RLS de `showtimes_cache` / `cinemas` sont
réservées à `authenticated`. Elle doit donc exister **sur l'hébergement**, pas seulement en local.

Requis **par les scripts uniquement** (`scripts/`), jamais lus par Nuxt :
```
PRIM_TOKEN=                # Île-de-France Mobilités, pour scripts/transit-times.mjs
HOME_LAT=                  # domicile, pour le calcul des temps de trajet
HOME_LNG=
```

⚠️ `HOME_LAT` / `HOME_LNG` **ne doivent pas** reprendre le préfixe `NUXT_PUBLIC_` qu'elles portaient
avant : c'est lui qui expose une variable au navigateur dès qu'une clé correspondante existe dans
`runtimeConfig.public`. Les coordonnées du domicile ne quittent jamais le serveur — c'est toute la
raison d'être du `transit_minutes` pré-calculé (cf. `app/utils/travel.js`).

Runtime config is exposed to server-side code via `useRuntimeConfig()` in `nuxt.config.ts`.

**Routes serveur & authentification** — `app/middleware/auth.js` protège les *pages*, pas les
handlers Nitro. Toute route `server/api/` qui **sort sur le réseau** doit appeler `requireUser(event)`
(`server/utils/requireUser.js`) : sans elle, n'importe qui peut faire émettre des requêtes vers
Allociné ou les exploitants depuis l'IP du déploiement. Les routes qui ne font que lire un cache
(`showtimes`, `events`) s'en passent — RLS suffit, et la garde coûterait un aller-retour sur le chemin
le plus chaud du projet — mais elles appellent `rateLimit(event)`
(`server/utils/rateLimit.js`) : ce qui restait ouvert n'était pas la donnée, c'était la dépense en
invocations serverless. Compteur en mémoire d'instance, donc écrêtage de l'abus trivial, pas un WAF.

⚠️ **Exception : `server/api/cron/warm.js`.** Elle sort sur le réseau mais ne peut pas appeler
`requireUser` — une tâche planifiée n'a pas de session. Elle se garde par un **secret partagé**
(`NUXT_CRON_SECRET`, comparé à durée constante) et **échoue fermée** : secret non configuré → 503,
jamais un accès ouvert. Toute future route sans visiteur devant elle suit ce modèle, pas le silence.

**Règles partagées entre l'app, le serveur et les scripts** — `shared/utils/` est auto-importé des
deux côtés depuis Nuxt 3.14 et sans dépendance, donc importable aussi par un script Node nu. Trois
invariants y vivent, chacun parce qu'une copie divergente y avait déjà causé un bug silencieux :
`cineWeek.js` (la semaine ciné), `exhibitorVenues.js` (quelles salles ont une source de libellés),
`pgErrors.js` (`isMissingSchema` — ⚠️ une colonne absente remonte `42703` en **lecture** mais
`PGRST204` en **écriture**, une table absente `PGRST205` et non `42P01`). Ne pas réécrire ces tests à
la main : c'est exactement ce qui avait rendu cinq gardes inertes.

## Styling

SCSS with global styles in `app/assets/styles/`. Variables (colors, fonts, breakpoints) are auto-injected via `additionalData` in `nuxt.config.ts` — no need to import `_variables.scss` manually in components.

Breakpoints: mobile ≤767px, tablet ≤1024px, desktop ≥1024px, large ≥1275px.

Dark theme. Primary accent: hot pink (`#ec008b`). Font families: `'f'` (Futura), `'d'` (Do Hyeon).

## Nuxt Config Notes

- `srcDir: 'app/'` — all source under `app/`
- SVG loader Vite plugin enabled for custom element support
- Modules: `@nuxt/image`, `nuxt-swiper`, `@nuxtjs/supabase`, `@pinia/nuxt`
- Homepage (`/`) configured as prerendered in route rules
