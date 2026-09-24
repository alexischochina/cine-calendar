# Listes partagées — mode d'emploi et pièges

Comment un compte voit la liste d'un autre, ce qu'il en fait, et surtout ce qui casse si on touche
au mauvais endroit.

Plan d'origine : `_ressources/plans/2609231743-listes-partagees-entre-comptes.md`.
Migrations : `_ressources/sql/2609231743-add-shared-lists.sql`, puis
`_ressources/sql/2609241150-fix-shared-function-grants.sql` (les deux, dans cet ordre).

---

## 1. Ouvrir un partage

Un seul geste, dans le SQL editor du dashboard Supabase :

```sql
update profiles set display_name = 'Papa'
where user_id = (select id from auth.users where email = '<son adresse>');
```

À partir de là, **tous** les comptes approuvés voient un onglet « Liste de Papa » dans le rail, et
Papa voit les leurs. Le partage est mutuel et total : il n'y a pas d'émetteur et de destinataire, il
y a des listes nommées et des listes anonymes.

Pour refermer :

```sql
update profiles set display_name = null where user_id = '…';
```

⚠️ **`null`, jamais `''`.** La contrainte `profiles_display_name_shape` refuse la chaîne vide,
précisément pour que la confusion lève au lieu de partager la liste sous un slug vide — donc sous une
URL cassée que personne ne saurait diagnostiquer.

⚠️ **Deux conditions, pas une.** Un profil est visible s'il est **nommé** *et* **approuvé**, et il
n'est visible que d'un appelant lui-même approuvé. Un compte fraîchement inscrit ne voit rien et
n'est vu de personne, même si on lui donne un nom par mégarde.

---

## 2. Ce que l'autre voit exactement

| | |
|---|---|
| **Voit** | Tes films, leur affiche, leur titre, leur date, leur réalisateur, ton média (ciné / Netflix / …), ton état de visionnage, ta note Letterboxd |
| **Ne voit pas** | Ta liste de rattrapage (`catchup*`), tes contrôles Allociné (`in_theaters_checked_at`, `events`, `allocine_id`), ton adresse e-mail (elle n'est pas dans `profiles`) |
| **Peut faire** | Parcourir tes années, filtrer sur « ceux qu'il n'a pas », ajouter un de tes films **chez lui** |
| **Ne peut pas faire** | Changer quoi que ce soit chez toi |

Le dernier point est garanti par la base, pas par l'écran : les trois policies d'écriture de
`calendar` restent `user_id = auth.uid() and is_approved()`. Voir une liste ne donne aucun droit
dessus.

La colonne `city` et la date de création du profil sortent aussi de la policy `profiles`
(RLS est par ligne, pas par colonne). Rien de sensible, mais autant le dire.

---

## 3. Ce qui se recopie à l'ajout, et ce qui ne se recopie pas

`useMovieCalendar.addFromSharedList` — **le seul point d'insertion du projet qui ne paie aucun
aller-retour réseau**, parce que les métadonnées TMDB sont déjà persistées dans la ligne d'en face.

**Recopié :** `title`, `poster_path`, `release_date`, `director`, `genres`, `countries`, `tmdb_vote`,
et `media` — ce dernier parce que c'est un fait sur le film (il sort au ciné, il est sur Netflix), pas
une préférence. Puis, dans un second temps, `letterboxd_rating` et `letterboxd_directors`.

⚠️ Les deux colonnes Letterboxd sont posées **après** l'insertion, par `patchCalendarRow`, et pas
dans le `insert`. Raison : une colonne absente remonte `PGRST204` **en écriture** et ferait échouer
l'insertion entière — perdre un lien est acceptable, perdre l'ajout ne l'est pas. Le helper porte
déjà ce repli et il est testé ; l'écrire une seconde fois à la main créerait un chemin de plus que
personne n'emprunte. L'insertion garde ainsi exactement la forme des deux autres.

**Pas recopié :**

- `state` → forcé à `unseen`. Son visionnage n'est pas le mien.
- `catchup`, `catchup_year`, `catchup_at` → sa liste de rattrapage par année n'a aucun sens chez moi.
- `in_theaters_checked_at`, `events`, `allocine_id` → état de synchronisation, recalculé par
  `useInTheatersSync` au prochain passage. Le recopier ferait croire à un contrôle qui n'a pas eu
  lieu, et retarderait le vrai d'une semaine ciné.
- `manual_release_date` → son correctif de date à lui.

⚠️ **Conséquence assumée du dernier point :** un film dont il a corrigé la date à la main peut
atterrir dans une **autre année** chez moi que chez lui. C'est correct — sa correction est une donnée
personnelle — mais c'est surprenant, et ça se remarque d'abord comme un bug.

---

## 4. ⚠️⚠️ Le piège central : le cloisonnement est passé dans le code

**Avant ce chantier**, `calendar` était cloisonnée en lecture par RLS
(`user_id = auth.uid()`). Le code pouvait faire `select('*')` sans filtre : la base ne rendait que
les lignes de l'appelant. Plusieurs commentaires du dépôt disaient même explicitement de **ne pas**
ajouter de filtre, pour ne pas laisser croire que c'est lui qui protège.

**Depuis la policy « calendar: lecture des listes partagées »**, ce n'est plus vrai. Un compte
approuvé lit aussi les lignes des comptes nommés. Le filtre de propriétaire est donc porté par le
code, et **il n'est pas facultatif**.

Six sites d'appel en dépendaient. Cinq étaient dans le plan ; le sixième a été trouvé en implémentant :

| Fichier | Si on retire le filtre |
|---|---|
| `useMovieCalendar.getMovies` | Ma timeline affiche les films de l'autre, mélangés aux miens |
| `useMovieCalendar.addCatchupMovie` | Le contrôle « déjà là » matche sa ligne → l'ajout échoue en silence |
| `nav/MovieAddForm.addMovie` | `maybeSingle()` **lève** dès qu'on a un film en commun → ajout impossible |
| `useProfile.fetchProfile` | `maybeSingle()` **lève** → repli fermé → **tout le monde sur `/pending`** |
| `server/utils/requireUser.js` | `maybeSingle()` **lève** → 503 sur les cinq routes gardées → **la vue Séances tombe** |
| `server/utils/userCity.js` | L'erreur est avalée par le repli du fichier → **un compte troyen se voit servir Paris en silence** |

Les trois derniers sont les pires : le symptôme ne ressemble pas du tout à sa cause.

### ⚠️⚠️ Et le filtre ne s'écrit pas `user.value.id`

`useSupabaseUser()` **ne rend pas un objet utilisateur, il rend les claims du JWT** — sur
`@nuxtjs/supabase` 2.0.5, les deux plugins du module écrivent `getClaims()` dans le même `useState` :
`plugins/supabase.server.js` au rendu serveur, `plugins/supabase.client.js` sur `page:start` et sur
`onAuthStateChange`. L'identifiant s'appelle donc **`sub`**, et `user.value.id` vaut `undefined`
partout, tout le temps.

Toujours passer par `userIdOf(user.value)` (`app/utils/currentUser.js`).

Ce que ça donne quand on l'oublie :

- **en lecture**, PostgREST reçoit `user_id=eq.undefined`, Postgres répond
  `22P02 invalid input syntax for type uuid`, et le repli fermé de `useProfile` traduit ça en
  **« ton compte n'est pas encore validé »** sur un compte parfaitement approuvé (constaté le
  24/09/2026, à la première connexion après la migration) ;
- **en écriture**, une clé à `undefined` est simplement absente du JSON envoyé. Sur `calendar`, le
  `default auth.uid()` de la colonne rattrape et la ligne atterrit au bon endroit — correcte par
  accident. Sur `cinema_favorites`, dont le `user_id` est `not null` **sans défaut**, l'insertion
  échouait : le toggle « cinéma favori » était cassé depuis le chantier multi-comptes, pour cette
  seule raison.

Contrôle reproductible :

```bash
grep -rn "from('calendar')\|from('profiles')" app server | grep -i select
```

Chaque ligne doit porter un filtre de propriétaire, **sauf** :

- `useSharedLists.fetchRows`, qui vise délibérément une autre liste (`.eq('user_id', <l'autre>)`) ;
- `server/api/cron/warm.js` et les scripts de `scripts/`, en service-role — RLS ne les regarde pas.

⚠️ `server/utils/userCity.js` paie désormais un `serverSupabaseUser()` pour connaître l'appelant.
L'en-tête du fichier (« pas d'aller-retour d'authentification par affichage ») reste vrai : le mémo
de 5 minutes est consulté **avant**, donc l'appel a lieu au plus une fois par session et par TTL.

---

## 5. ⚠️ Rejouer une migration antérieure annule celle-ci, en silence

- **`2609221213`** purge **toutes** les policies de `calendar` par énumération, puis en repose
  quatre. La policy de partage disparaîtrait sans un mot — et son bloc de contrôle final
  (« exactement 4 policies ») lèverait, puisqu'il y en a cinq maintenant.
- **`2609231045`** vérifie que **toute** policy de `calendar` mentionne `auth.uid()`. La policy de
  partage ne le mentionne pas : elle ne cloisonne pas par propriétaire, c'est son objet même.

Dans les deux cas : **rejouer `2609231743-add-shared-lists.sql` derrière.** Il est idempotent.

⚠️ Et **`2609241150` derrière lui**, systématiquement : le `create or replace function` de `2609231743`
réinitialise l'ACL de `shared_list_owner_ids()` et rend le droit d'exécution à `public`.

---

## 6. Écarts assumés par rapport à la maquette

`_ressources/tmpl/Timeline.html` (le markup réel est un JSON dans
`<script type="__bundler/template">`, ligne 382).

1. **Pas de `backdrop-filter` sur l'en-tête.** La maquette en met un ; le projet l'a déjà retiré de
   `.month-head` pour une raison qui vaut ici à l'identique : sur un `sticky`, le flou interdit au
   compositeur de suivre l'élément pendant le scroll, et c'est ce décrochage qui laissait voir les
   films au-dessus. Fond plein.
2. **Comparaison par `movie_id`, pas par titre normalisé.** La maquette compare des titres faute
   d'identifiants. Le faire ici confondrait deux films homonymes, et raterait un même film sous son
   titre original et son titre français.
3. **Les filtres état / média ne sont pas réinitialisés à l'entrée** (la maquette les remet à
   `all`). Remettre à zéro un réglage global sans le dire est pire qu'une liste vide qu'on sait
   expliquer — et « ne voir que ce qu'il a vu » est une lecture légitime.
4. **Le mobile est traité**, alors que la maquette ne le couvre pas (`showOther` n'apparaît pas dans
   sa section `isMobile`).
5. **L'onglet reste dans le groupe « Ma liste »**, comme la maquette. ⚠️ Ça se lit mal
   (« Ma liste › Liste de Papa ») et ça empirera à trois listes : un groupe « Listes partagées »
   serait alors plus juste. C'est un déplacement de trois lignes dans `ViewTabs.GROUPS`.

---

## 7. Où vit quoi

| Fichier | Rôle |
|---|---|
| `_ressources/sql/2609231743-add-shared-lists.sql` | La colonne, la fonction, les deux policies |
| `_ressources/sql/2609241150-fix-shared-function-grants.sql` | Ferme `shared_list_owner_ids()` à `anon` |
| `app/utils/currentUser.js` | `userIdOf` — l'identifiant du compte connecté, `sub` et non `id` |
| `app/utils/sharedLists.js` | Règles **pures** : slug, initiale, `missingFrom`, `sharedListStat` |
| `app/utils/moviesGrouping.js` | Règle **pure** : `groupByYearMonthDay`, `yearsOf` — partagée par les deux timelines |
| `app/utils/movieDate.js` | `effectiveReleaseDate` — source unique de « à quelle date ce film se range » |
| `app/composables/useSharedLists.js` | Lecture des profils et des listes. **N'écrit jamais.** |
| `app/composables/useMovieCalendar.js` | `addFromSharedList` — l'ajout chez moi |
| `app/pages/[year]/listes/[user].vue` | La vue |
| `app/components/SharedListHeader.vue` | Le bandeau sticky + la bascule |
| `app/components/AddToListAction.vue` | Le menu ⋯ à une entrée |
| `app/components/{TimelineList,MovieListItem}.vue` | Mode `shared` (lecture seule) |
| `app/components/nav/{ViewTabs,SideNav}.vue` | Les onglets |
| `app/layouts/default.vue` | Rail des années selon la liste affichée, toast |
| `scripts/test-seances-rules.mjs` | Familles 15 et 16 |

⚠️ **`useSharedLists` ne fait que lire, et ce n'est pas une convention — c'est une nécessité.** Les
policies d'écriture restent cloisonnées : un `update` sur une ligne d'en face ne lève pas, il touche
**zéro ligne**. Un mécanisme de rattrapage écrit là (filet des métadonnées manquantes, promotion
« en salle », revérification TMDB, notes Letterboxd) réessaierait à chaque visite, indéfiniment, en
croyant chaque fois avoir réussi.

Même raison côté écran : dans une liste partagée, les sélecteurs média / état cèdent la place à des
pastilles **inertes**. Un contrôle qui a l'air d'écrire et n'écrit pas ne produirait aucun signal.

---

## 8. Détails d'implémentation qui se paient cher si on les défait

- **`--shared-head-h`** est déclarée sur `.timeline-list` et consommée par trois endroits : le
  bandeau (sa hauteur), les en-têtes de mois (leur `top`), la plaque `.headmask` (sa hauteur). Un
  chiffre écrit en dur dans `SharedListHeader` ferait glisser un `sticky` sous l'autre au premier
  ajustement.
- **Le slot `header` de `TimelineList` est rendu avant le `v-if="hasContent"`.** Il porte la bascule
  « Seulement ceux que je n'ai pas » : conditionné au contenu, il disparaîtrait exactement quand la
  bascule vide la liste, et plus rien ne permettrait de la décocher.
- **`sharedGrouped` transite par le composable**, posé par la page et lu par le layout. Recalculé de
  son côté, le rail pourrait annoncer des années que la vue ne montre pas. Il est remis à `null` au
  démontage, sinon le rail garde les années de la liste partagée en revenant sur ma timeline.
- **Ordre dans la page : bascule → filtres → regroupement.** Regrouper avant de filtrer ferait mentir
  les compteurs de mois.
- **Le compteur de l'onglet ne charge qu'une colonne.** Deux lectures distinctes : `movie_id` seul
  pour tous les comptes partagés au démarrage (`loadSharedIds`), les quatorze colonnes d'affichage
  seulement à l'ouverture d'une liste (`loadSharedList`). Les fusionner rendrait le démarrage aussi
  cher que l'ouverture.
- **`ready`** — le compteur, le sous-titre et la bascule attendent que **ma** liste soit chargée
  (`movies.value.length`). Le layout ne la remplit qu'au `onMounted` : en arrivant directement sur
  `/2026/listes/david`, la comparaison « ce qu'il a que je n'ai pas » vaudrait « tout », pendant une
  fraction de seconde.
- **La bascule est indexée par `user_id`.** Globale, elle restait cochée en passant d'une liste à
  l'autre : un réglage invisible qui vide une liste se lit comme un bug.
- **`sharedGrouped` n'est effacé au démontage que s'il est encore le sien** (`=== grouped.value`). La
  `pageTransition` est en `mode: 'default'` : la page entrante monte **avant** que la sortante ne se
  démonte, donc un effacement inconditionnel écraserait le regroupement que la nouvelle vient de
  poser — et le rail retomberait sur mes années.
- **`definePageMeta({ key: route => 'liste-' + route.params.user })`** — par compte, pas constante :
  changer d'année ne doit pas remonter la page, changer de liste doit la remonter.
- **`shared_list_owner_ids()` est sans argument et `stable`**, pour que le planificateur la replie en
  InitPlan. Une variante `is_shared_list_owner(uuid)` serait appelée une fois par ligne, sur la
  lecture la plus chaude du projet.
- **L'unicité en base porte sur `lower(display_name)`**, alors que `listSlug` retire aussi accents et
  ponctuation : « Jean-Éric » et « Jean Eric » produisent le même slug sans que la base les refuse.
  `useSharedLists` tranche de façon déterministe et le signale en console. Un test fige le fait.
