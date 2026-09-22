# Comptes multi-utilisateurs et périmètre par ville

Mode d'emploi et pièges de l'ouverture de Cinégenda à un second compte (plan
`_ressources/plans/2609221212-comptes-multi-utilisateurs-paris-troyes.md`).

---

## 1. Ce qu'il faut faire pour que ça marche

**Rien de ce qui suit n'est automatique.** Le code est déployable, mais il ne fonctionnera qu'une
fois les quatre migrations jouées.

### Les migrations, dans cet ordre

Dans le SQL editor Supabase, **une par une**, en lisant la sortie de chacune :

| Ordre | Fichier | Ce qu'il pose |
|---|---|---|
| 1 | `_ressources/sql/2609221212-add-profiles.sql` | `profiles` (ville + approbation), et le profil d'Alexis |
| 2 | `_ressources/sql/2609221213-add-calendar-owner.sql` | `calendar.user_id`, backfill, RLS par propriétaire |
| 3 | `_ressources/sql/2609221214-per-user-cinema-favorites.sql` | `cinema_favorites`, et ferme l'écriture navigateur sur `cinemas` |
| 4 | `_ressources/sql/2609221215-showtimes-cache-city.sql` | `showtimes_cache.city` et la clé à trois colonnes |

### Relevé sur la base réelle, le 22/09/2026

Fait en lecture seule **avant** d'écrire quoi que ce soit, pour que les migrations ne reposent pas sur
des suppositions. Ce qu'il a changé :

| Constat | Conséquence |
|---|---|
| `calendar.user_id` **existait déjà**, et ses **444 lignes** portaient toutes l'identifiant d'Alexis | Le backfill n'a rien à réécrire. La migration n°2 se réduit aux contraintes et aux policies — c'est le gros du risque qui disparaît |
| La colonne préexistante n'avait pas forcément sa clé étrangère | `add column if not exists` ne l'aurait **pas** posée : un bloc dédié la vérifie et l'ajoute |
| `profiles` et `cinema_favorites` n'existent pas | Conforme. *(Une première détection les avait crus présents : `head: true` ne remonte pas l'erreur PostgREST. Le contrôle négatif — interroger une table bidon — a démasqué le faux positif.)* |
| `showtimes_cache` : 179 entrées, pas de colonne `city` | Conforme |
| `cinemas` : 66 salles, **4** favorites | 4 lignes à reprendre dans `cinema_favorites` |
| `auth.users` : **un seul** compte, `alexchoc521@gmail.com` | Les migrations 1 et 2 visent juste |

**Ce que l'inspection n'a pas pu voir, et ce qu'on en a fait.** `pg_policies` et `pg_constraint` ne
sont pas exposés par PostgREST : impossible de vérifier d'avance le nom de la policy historique sur
`calendar`, ni celui de la clé primaire de `showtimes_cache`. Plutôt que de deviner, les migrations
ont été rendues **indépendantes de ces noms** :

- n°2 — **énumère et supprime toutes** les policies de `calendar` avant de poser les quatre bonnes.
  C'était le risque le plus grave du chantier : un `drop policy if exists` qui rate son nom laisse
  survivre une policy `using (true)`, les policies s'additionnent, et le cloisonnement paraît en
  place sans l'être. Un bloc de contrôle final lève si les quatre policies ne sont pas là, ou si
  l'une d'elles ne filtre pas sur `auth.uid()`.
- n°3 — supprime toute policy d'`update` sur `cinemas`, quel que soit son nom (et **seulement**
  celles-là : lecture et découverte de salle doivent survivre).
- n°4 — lit le nom de la clé primaire dans `pg_constraint` au lieu de l'écrire en dur.

⚠️ **Sauvegarde avant la n°2.** C'est la seule qui touche des données irremplaçables — le reste
(`showtimes_cache`, `theater_events_cache`, `event_detail_cache`) se reconstruit seul depuis Allociné.

⚠️ **L'ordre n'est pas décoratif.** La n°1 doit exister avant la n°2 (qui backfille vers le compte
qu'elle crée), et la n°2 backfille **avant** de poser sa policy : l'inverse rendrait les lignes
invisibles à la requête de backfill elle-même, qui toucherait alors zéro ligne sans erreur.

Les fichiers 1 et 2 s'arrêtent d'eux-mêmes avec un message explicite si l'adresse
`alexchoc521@gmail.com` ne correspond à aucun compte `auth.users`. Si ça arrive, corrige l'adresse
dans les deux fichiers plutôt que de continuer.

### Créer le compte du père

1. Il va sur `/register`, saisit e-mail + mot de passe + **Troyes**.
2. Il atterrit sur `/pending`. **Il ne peut rien faire** — ni voir de liste, ni déclencher d'appel
   réseau.
3. Dans Supabase → Table editor → `profiles`, passe son `approved` à `true`.
4. Il clique « J'ai été validé » sur `/pending` et entre dans l'application. Pas besoin qu'il se
   reconnecte.

---

## 2. Ce qui a changé, et pourquoi

### `calendar` a un propriétaire

Avant, `useMovieCalendar.getMovies` faisait `select('*')` sans filtre et la policy disait
`for all to authenticated using (true)`. Sur une application à un compte, l'écart entre la policy et
le besoin ne se voyait pas. Au second compte, il devenait **le** défaut : le nouveau venu n'aurait
pas vu une liste vide, il aurait vu celle d'Alexis, et ses ajouts y auraient atterri.

Quatre policies remplacent l'ancienne, sur `user_id = auth.uid()`. Les lectures et les mises à jour
sont donc filtrées **par la base** : aucun `.eq('user_id', …)` n'est nécessaire côté app, et il ne
faut pas en ajouter — ça suggérerait que c'est le code qui protège.

⚠️ **Seule l'insertion doit dire explicitement pour qui elle écrit.** Deux points d'insertion, les
mêmes que ceux que `app/utils/letterboxdDirectors.js` mentionnait déjà :
`app/components/nav/MovieAddForm.vue` et `useMovieCalendar.addCatchupMovie`. Les deux posent
`user_id` à la main, bien que la colonne porte `default auth.uid()` — le défaut est un filet, pas le
contrat, et il vaut `null` partout où il n'y a pas de session (scripts, cron).

### La ville est un paramètre de premier ordre

`shared/utils/cities.js` est le **quatrième invariant** de `shared/`, aux côtés de `cineWeek.js`,
`exhibitorVenues.js` et `pgErrors.js`. Il décide trois choses d'un coup :

1. la **localisation** demandée à Allociné (`near-115755` / `near-87008`) ;
2. les **salles gardées** de sa réponse (préfixe `75` / liste blanche `P0983`, `W1015`) ;
3. la **partition de cache** où le résultat est écrit (`showtimes_cache.city`).

Les trois doivent rester d'accord. C'est pour ça qu'ils vivent dans le même objet plutôt que
dispersés — une localisation branchée sans son filtre laisserait entrer toute la couronne.

**Chiffres relevés le 22/09/2026**, à re-vérifier si la vue se vide :

| | Paris | Troyes |
|---|---|---|
| Localisation Allociné | `115755` | `87008` |
| Règle d'appartenance | zip commençant par `75` | codes `P0983`, `W1015` |
| Salles rendues | ~50 (sur 73 dont 22 en 75xxx) | **exactement 2** |
| Carte UGC | oui | non |
| Temps de trajet | oui | non |
| Arrondissements | oui | non (commune) |

⚠️ **« Utopia Troyes » n'existe pas sous ce nom.** L'enseigne est **Utopia Pont-Sainte-Marie**,
commune limitrophe (`10150`). Ne pas « corriger » en cherchant une salle intra-muros, il n'y en a pas.

⚠️ **Liste blanche de codes et non préfixe `10`.** Les deux donnent le même résultat aujourd'hui.
Le préfixe laisserait entrer sans préavis toute salle auboise qu'Allociné rattacherait plus tard à
Troyes. La demande nomme deux cinémas ; la règle en nomme deux.

### L'approbation est une serrure, pas un affichage

Elle vit à **trois** niveaux, et les trois sont nécessaires :

| Niveau | Fichier | Ce qu'il empêche |
|---|---|---|
| Base | `profiles` sans policy d'écriture | Qu'un compte s'auto-approuve |
| Routes | `server/utils/requireUser.js` → 403 | Qu'un compte non approuvé fasse sortir le déploiement chez Allociné / UGC / Dulac / MK2 |
| Pages | `app/middleware/auth.js` → `/pending` | Qu'il voie un écran vide sans comprendre |

⚠️ **Le niveau « routes » est le seul qui soit une vraie serrure.** Le middleware ne protège que les
pages Nuxt : les handlers Nitro restent joignables directement. C'est le même raisonnement que
l'en-tête de `requireUser.js` tenait déjà pour l'authentification.

⚠️ **Profil absent ou illisible = non approuvé**, partout. Une garde qui s'ouvre sur une donnée
manquante n'est pas une garde. `requireUser` rend même 503 (et non 403) quand la lecture échoue :
« je ne sais pas » ne vaut pas « oui », et le code doit orienter vers la bonne cause.

---

## 3. Les pièges

### ⚠️⚠️ La ville fait partie de la clé de cache, pas du contenu

**Le défaut le plus silencieux du chantier.** `showtimes_cache` a pour clé
`(allocine_id, city, date)`. Cette ville apparaît à **trois** endroits de
`server/utils/refreshShowtimes.js` qui doivent rester d'accord : le `.eq('city', …)` de la relecture,
l'`onConflict` de l'écriture, et l'argument passé à `fetchCityShowtimes`.

En oublier un ne lève **aucune erreur** — Postgres accepte la ligne, Allociné répond normalement — et
les deux villes se recouvrent par intermittence selon qui rafraîchit en dernier. Un bug d'affichage
qui ressemble à une bizarrerie d'Allociné, et qu'on chercherait longtemps ailleurs.

La migration retire le `default 'paris'` de la colonne après avoir migré les lignes existantes,
pour qu'au moins l'oubli le plus grossier échoue bruyamment.

### ⚠️ La lecture et le rafraîchissement doivent viser la même ville

`/api/allocine/showtimes` répond « voici le frais, voilà ce qui manque », et le client rappelle
`/api/allocine/refresh` pour ce qui manque. Si les deux ne s'accordent pas sur la ville, l'entrée
écrite n'est jamais celle qui était cherchée : `missing` revient identique à chaque tour et le client
boucle sur Allociné indéfiniment — sans erreur, juste une facture.

C'est pourquoi **la ville ne vient jamais de la query string**, des deux côtés. `refresh` la tient de
`requireUser` (qui lit déjà le profil pour l'approbation) ; `showtimes`, qui n'appelle pas
`requireUser` parce que c'est le chemin le plus chaud du projet, la tient de
`server/utils/userCity.js` — un mémo en mémoire d'instance calqué sur `rateLimit.js`, une lecture de
`profiles` par session toutes les 5 min au lieu d'une par affichage.

### ⚠️ `theater_events_cache` et `event_detail_cache` n'ont **pas** de ville, et c'est voulu

Leurs clés portent un `theater_code` / `cinema_key`, et une salle appartient à une ville et une
seule : la dimension est déjà là, portée par la clé. Leur ajouter une colonne `city` en ferait une
donnée **dérivée**, donc une donnée qui peut diverger de la salle qu'elle prétend décrire. Les deux
routes correspondantes portent ce « pourquoi pas » en commentaire, pour qu'on n'y lise pas un oubli.

### ⚠️⚠️ `serverSupabaseUser` rend des **claims JWT**, pas un objet utilisateur

Le piège le plus coûteux rencontré sur ce chantier, et il ne vient pas du code métier.

Depuis `@nuxtjs/supabase` 2.0.5, `serverSupabaseUser(event)` appelle `client.auth.getClaims()` et
rend `data.claims` — c'est-à-dire les claims du jeton, où l'identifiant de l'utilisateur s'appelle
**`sub`**. Pas `id`.

Une première version de `requireUser` écrivait `.eq('user_id', user.id)`, « pour la clarté ».
`user.id` valait `undefined`, PostgREST répondait `invalid input syntax for type uuid: "undefined"`,
la garde tombait dans sa branche « profil illisible » et rendait **503 sur les cinq routes
protégées, pour tout le monde** — comptes approuvés compris. La vue Séances n'aurait plus rien pu
rafraîchir.

Deux enseignements :

1. **Ne pas réécrire côté code ce que RLS fait déjà.** La policy `profiles: lecture de son profil`
   ne rend que la ligne de l'appelant : `maybeSingle()` suffit. Le filtre en double n'ajoutait
   aucune garantie et offrait une seconde occasion de se tromper — c'est elle qui a servi.
2. **`requireUser` normalise l'identifiant** (`user.sub ?? user.id`) avant de rendre `{ user,
   profile }`, pour qu'aucun appelant n'ait à connaître la forme rendue par le module.

⚠️ Ce défaut ne se voyait **pas** dans le navigateur : le middleware de page redirigeait
correctement, les pages s'affichaient, et seules les routes Nitro échouaient. Il a fallu appeler les
routes avec une vraie session pour le découvrir.

### ⚠️ Tout `<button>` porteur de texte doit avoir la classe `btn`

`components/_btn.scss` fait `button { @extend .ico-btn }`, et `.ico-btn:not(.btn)` pose
`font-size: 0` : le projet suppose qu'un bouton est une icône tant qu'on ne dit pas l'inverse.

L'ancienne page `/login` y échappait en déclarant `font-size: 1.4rem` en dur dans son style scoped.
En retirant ces déclarations manuelles (ce que `f-typography-mixins` demande, à juste titre), on
supprime l'override — et `.ico-btn:not(.btn)` (spécificité 0,2,0) l'emporte sur `.input-body`
(0,1,0). Les trois pages d'authentification se sont retrouvées avec des boutons au libellé
**présent dans le DOM mais rendu à 0 px**.

⚠️ **Un test qui lit `textContent` ne voit rien de ce défaut** — il renvoie fidèlement « Se
connecter ». C'est ce qui s'est passé : la première vérification headless annonçait les boutons
comme corrects. Mesurer `getComputedStyle(el).fontSize` et la largeur du texte, jamais sa seule
présence.

### ⚠️ Le filtre carte UGC est actif par défaut

`useCinemas` notait déjà ce que ça coûte quand `accepts_ugc` est illisible : « une page vide alors
que le pré-filtre carte est actif par défaut ». À Troyes ce n'est pas une panne mais l'état normal —
aucune salle n'a la carte.

Le bouton est donc **masqué et l'état neutralisé** : `useSeances` expose `effectiveUgcOnly`
(= `ugcOnly && hasUgcCard`), et c'est lui que lisent tous les décomptes. L'état `ugcOnly` lui-même
n'est pas forcé à `false` — il est partagé entre visites, et le remettre à zéro perdrait le choix
d'un utilisateur parisien.

### ⚠️ Les noms de ville en dur dans l'interface

Neuf chaînes portaient « Paris » en constante, réparties dans cinq fichiers. Elles ne se voyaient
pas tant qu'il n'y avait qu'une ville : le rail annonçait « À PARIS » à un compte troyen, la page
Séances s'intitulait « Séances à Paris », et le pied de page créditait « Paris intra-muros ».

Toutes viennent désormais de `cityInfo`, donc du profil. Deux libellés distincts dans `CITIES`, et la
distinction compte :

- **`label`** nomme la ville (« Paris », « Troyes ») — pour les titres et le rail ;
- **`scopeLabel`** décrit ce que la vue **montre** (« Paris intra-muros », « Troyes et
  Pont-Sainte-Marie ») — pour la mention de source. Les deux ne coïncident pas : la localisation
  Allociné ratisse la couronne et on n'en garde que l'intra-muros ; à Troyes on montre au contraire
  une salle située dans la commune voisine.

⚠️⚠️ **L'une des neuf n'était pas cosmétique.** `app/utils/maps.js` construisait l'adresse
d'itinéraire comme `[nom, code postal, 'Paris']`. Pour une salle troyenne, le lien de carte aurait
pointé « CGR Troyes, 10000, **Paris** » et envoyé à 150 km. Un lien qui se trompe de ville est pire
qu'un lien absent — on le suit. La commune vient maintenant de la salle (`cinema.city`), et ce
chemin sert précisément aux salles **pas encore géocodées**, donc aux troyennes tant que
`scripts/geocode-cinemas.mjs` n'est pas repassé : il n'est pas marginal.

⚠️ Ce défaut a été trouvé **par l'utilisateur, sur une capture d'écran**, pas par les contrôles
automatiques. Un `grep "Paris"` sur `app/` le sortait en trois secondes ; personne ne l'avait lancé.
À refaire avant d'ajouter une troisième ville.

### ⚠️ `transit_minutes` est calculé depuis **un** domicile

`scripts/transit-times.mjs` le calcule depuis `HOME_LAT` / `HOME_LNG`, qui sont parisiens. À Troyes,
la valeur est mise à `null` à la source (`useSeances`) plutôt que masquée à l'affichage : un trajet
depuis Paris annoncé comme partant de chez soi serait un chiffre faux **et crédible**, donc pire
qu'une absence.

### ⚠️ Les scripts tournent en service-role et ignorent RLS

`backfill-movies.mjs` et `backfill-letterboxd.mjs` travaillent sur les lignes de **tous** les comptes,
et c'est correct : ce qu'ils écrivent — titre, affiche, date, réalisateur, genres, pays, note et
liens Letterboxd — décrit le **film**, pas le rapport d'un utilisateur au film. Deux comptes qui
suivent le même film doivent en lire les mêmes métadonnées.

La frontière est nette et vaut pour tout script futur : **ce qui appartient à un compte, c'est
`state`, `media`, `catchup`, `manual_release_date`.** Aucun script ne doit les toucher en masse.

`check-seances.mjs` ne lit `calendar` que pour diagnostiquer. En revanche il a fallu lui ajouter
`CHECKED_CITY` : il compare le cache au direct, et sans filtre de ville il aurait confronté des
entrées troyennes à des séances parisiennes, donc signalé un écart massif et faux.

### ⚠️ Le budget du préchauffage est par ville

`MAX_FETCHES_PER_CITY_DAY` (60) remplace `MAX_FETCHES_PER_DAY`. Un plafond global partagé se serait
resserré tout seul à chaque ville branchée : le budget parisien aurait fondu sans que rien ne change
à Paris, et la troncature — qui ne fait qu'un `warn` — aurait laissé des journées froides.

Le résumé journalisé porte maintenant le détail par ville (`cities: [{city, films}]`) : un total qui
bouge peu masquerait une ville tombée à zéro.

⚠️ **La cadence du cron ne se règle toujours pas sur la durée d'un passage**, mais sur le TTL de
`showtimesFreshness.js`. Si un passage devient trop long, la sortie est de le découper avec le
paramètre `days` qui existe déjà — pas d'allonger `FRESH_NEAR` / `FRESH_FAR`.

---

## 4. La reconnexion tous les deux jours : ce n'est pas le cookie

Diagnostiqué le 22/09/2026, **avant** de toucher à quoi que ce soit — et rien n'a été touché, parce
que rien n'était faux :

| Vérification | Résultat |
|---|---|
| `cookieOptions.maxAge` dans `nuxt.config.ts` | `60 * 60 * 24 * 365` — un an. Le défaut du module est 8 h, l'override est donc bien présent |
| La version installée l'honore-t-elle ? | Oui. `@nuxtjs/supabase` 2.0.5 transmet `cookieOptions` à `@supabase/ssr` des **deux** côtés (`plugins/supabase.client.js`, `plugins/supabase.server.js`, `server/services/serverSupabaseClient.js`) |
| `secure: true` gêne-t-il en dev ? | Non sur Chrome, qui traite `localhost` comme une origine sûre |

Un cookie d'un an ne sert à rien si le **refresh token** qu'il transporte meurt avant : le JWT expire
en 1 h et n'est renouvelable que tant que le refresh token vit.

**À vérifier dans Supabase → Authentication → Sessions :**

1. **Inactivity timeout** — le suspect principal. Réglé à ~2 jours, il explique exactement le
   symptôme pour quelqu'un qui passe sur le site de façon espacée.
2. **Time-box user sessions** — même effet, en durée absolue.
3. **Refresh token rotation** et son *reuse interval* — deux onglets qui rafraîchissent en même
   temps peuvent s'invalider l'un l'autre.

---

## 5. Ce qui n'a pas été fait

Hors périmètre sur décision explicite (« projet fermé, besoins très précis ») : changement de ville
depuis l'interface, mot de passe oublié, invitation par e-mail, interface d'administration des
comptes, troisième ville, partage de liste, temps de trajet par utilisateur, connecteur d'exploitant
pour le CGR ou l'Utopia.

**Une exception, validée le 22/09/2026 :** un bouton « Se déconnecter » existe sur `/pending`, et
seulement là. Sans lui, une inscription avec le mauvais compte enfermerait sur cette page — le cookie
dure un an, et un compte non approuvé ne voit jamais la navigation. C'est une sortie de secours, pas
la fonctionnalité de déconnexion écartée du périmètre : elle n'apparaît nulle part ailleurs.

**Deux dettes laissées derrière :**

- `NUXT_PUBLIC_HOME_LAT` / `NUXT_PUBLIC_HOME_LNG` **ont été renommées** en `HOME_LAT` / `HOME_LNG`
  dans `.env` le 22/09/2026, et le repli sur les anciens noms a été **retiré** de
  `scripts/transit-times.mjs`. Le garder aurait maintenu le mauvais nom fonctionnel, donc
  reproductible — or c'est le préfixe `NUXT_PUBLIC_` qui expose une variable au navigateur dès
  qu'une clé correspondante existe dans `runtimeConfig.public`. L'exposition n'avait jamais été
  active (`runtimeConfig.public` ne déclare que `siteUrl`), mais le piège était armé.
  *(Sans rapport avec les comptes multi-utilisateurs — corrigé au passage, c'est une règle du
  CLAUDE.md que le `.env` réel enfreignait.)*
- `$font-futura` et `$font-do-hyeon` ne sont plus référencées nulle part dans `app/`, mais leurs
  `@font-face` (`'f'` et `'d'`) restent déclarées dans `_fonts.scss` et listées dans `fonts.json` —
  des fichiers téléchargés que plus personne n'utilise. Les retirer touche au pipeline de fontes,
  ce qui dépassait ce chantier.
- `cinemas.favorite` reste en base, marquée obsolète en commentaire. Elle est la trace du backfill
  vers `cinema_favorites` ; la supprimer n'apporte rien et casserait une relecture d'historique.

---

## 6. Vérifier que tout va bien

```bash
npm test          # 456 tests, dont les familles « cities » et « placeOf »
npm run dev       # puis /login, /register, /pending
```

### Vérifié en conditions réelles le 22/09/2026

Contrôles menés avec de **vraies sessions**, ouvertes via `admin.generateLink` (service-role, sans
mot de passe). C'est la seule façon d'exercer les policies : la clé service-role contourne RLS par
construction, et la clé anonyme n'a pas de session — ni l'une ni l'autre ne prouve quoi que ce soit
sur `user_id = auth.uid()`.

**Compte non approuvé** — ne voit aucun des 444 films ni aucun des 4 favoris, ne voit que son propre
profil, ne peut ni s'auto-approuver, ni écrire dans la liste de l'autre (`42501`), ni réécrire le
référentiel des salles. `/api/allocine/refresh` et `/api/movies/:id/letterboxd` lui rendent **403**,
là où l'absence de session rend **401** — ce qui prouve que le refus vient bien de l'approbation et
non d'un simple défaut d'authentification.

**Compte approuvé** — retrouve ses 444 films, ses 4 favoris, son profil `paris`, le référentiel des
salles, et passe les routes serveur (`refresh` → 200 avec 5 salles parisiennes réelles).

⚠️ Ne pas lancer `npm run build` pendant qu'un serveur de dev tourne : il écrit dans `.nuxt` au
format production et le dev suivant échoue sur `#internal/nuxt/paths`. Nettoyage :
`rm -rf .nuxt .output .nitro && npx nuxt prepare`.

**Le test qui compte vraiment n'est pas automatisable** : ouvrir l'application dans deux sessions
simultanées (une fenêtre privée pour le second compte) et vérifier qu'aucune liste, aucun favori,
aucune séance ne traverse. Le cloisonnement est le cœur de ce chantier, et c'est le seul endroit où
une erreur ne se verrait pas autrement.
