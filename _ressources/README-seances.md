# Vue « Séances » — mode d'emploi

Troisième vue de la cinémathèque, à côté de Timeline et Stats. Elle répond à une question :
*parmi les films de ma liste encore à l'affiche, où et quand puis-je les voir à Paris, avec ma
carte UGC ?*

Plan de référence : [`_ressources/plans/2608121539-page-seances-paris.md`](plans/2608121539-page-seances-paris.md).
Ce README couvre la **Phase 1** (page utilisable, source unique Allociné). La Phase 2 (double-check
UGC/MK2, « point vert ») reste conditionnée au spike du Step 13.

## Mise en route (3 étapes, dans cet ordre)

### 1. Migrations SQL

Dans l'éditeur SQL Supabase, exécuter :

```
_ressources/sql/2608121539-add-allocine-showtimes.sql
```

Il ajoute `allocine_id` / `allocine_checked_at` à `calendar`, et crée `cinemas` +
`showtimes_cache` avec leurs politiques RLS. Idempotent.

### 2. Premier passage sur la vue

Ouvrir `/seances`. C'est ce passage qui :

- résout les `allocine_id` des films `state === 'inTheaters'` et les **persiste** ;
- **peuple `cinemas`** automatiquement (toute salle croisée dans une réponse y entre).

Tant que ce passage n'a pas eu lieu, les deux scripts ci-dessous n'ont rien à traiter.

### 3. Seed carte UGC + géocodage

```bash
# a. acceptation de la carte — LISTE À VALIDER, cf. plus bas
#    → éditeur SQL Supabase : _ressources/sql/2608121539-seed-cinemas-ugc.sql

# b. coordonnées + arrondissement (Base Adresse Nationale, sans clé)
node scripts/geocode-cinemas.mjs --dry-run   # contrôle
node scripts/geocode-cinemas.mjs             # écriture
```

Le script est **relançable** : il ne traite que les salles sans coordonnées, donc on le rejoue à
chaque nouvelle salle apparue. `--force` reprend tout.

Beaucoup d'adresses Allociné ne sont pas des adresses : elles empilent les entrées d'un même cinéma
ou son contexte (« 30 Rue Saint-André des Arts : caisse, salles 1 & 2 - 12 rue Gît-le-Cœur »,
« 2 Pl. de la Prte Maillot, Palais des Congres, les Boutiques du Palais »). Le script tente donc
l'adresse brute d'abord — la plus précise quand elle est propre — puis, seulement si le score
déçoit, une version nettoyée (premier segment, abréviations dépliées). Sur ces trois cas réels le
score passe de **0,37–0,47 à 0,97–0,98**.

Un score bas mais accepté (0,57–0,70) est normal : la BAN pénalise les abréviations d'Allociné
(« Bd » → « Boulevard », « 66bis » → « 66B ») alors que l'adresse résolue est la bonne. Contrôlé sur
les quatre plus faibles.

> ⚠️ **Les deux sont à rejouer quand une nouvelle salle apparaît.** `cinemas` se peuple au fil des
> films consultés : une salle découverte plus tard entre avec `accepts_ugc = false` et sans
> coordonnées. Constaté dès le premier passage — 6 codes du seed n'étaient pas encore dans le
> référentiel. Rejouer le `.sql` puis le script remet tout d'aplomb.

### 4. Temps de trajet en transports (PRIM)

```
_ressources/sql/2608121620-add-cinema-transit.sql   → éditeur SQL Supabase
```

Puis un jeton gratuit sur [prim.iledefrance-mobilites.fr](https://prim.iledefrance-mobilites.fr),
dans `.env` :

```
PRIM_TOKEN=…
```

```bash
node scripts/transit-times.mjs --dry-run
node scripts/transit-times.mjs
```

Le domicile étant fixe, le trajet vers une salle donnée est une **constante** : ~46 requêtes une
fois, stockées en base, **zéro appel sortant au chargement de la page**. Le créneau de référence est
figé (vendredi 20 h par défaut, `--datetime` pour en changer) afin que deux salles restent
comparables et qu'une relance ne fasse pas bouger les chiffres.

L'UI affiche `3e arr. · 24 min`. Une salle sans trajet calculé (apparue depuis le dernier passage
du script) n'affiche que son arrondissement — jamais une valeur estimée.

> 🔒 Les coordonnées du domicile ne quittent **jamais** le `.env` : elles ne servent qu'à ce script.
> Une première version calculait la distance dans le navigateur, ce qui obligeait à les exposer via
> `runtimeConfig.public` — donc à les embarquer dans le payload client, lisibles dans les devtools de
> n'importe quel visiteur du site déployé.

✅ Exécuté le 12/08/2026 : **50/50 salles**, 0 échec. Ordre de grandeur depuis le domicile —
Pathé La Villette 14 min (2,0 km), UGC Paris 19 25 min (2,3 km), MK2 Bibliothèque 55 min (8,8 km),
Pathé Aquaboulevard 63 min (12,9 km). Médiane 43 min. Aucune incohérence distance/trajet.


## L'état « En salle » est contrôlé sur les séances, plus sur une date

```
_ressources/sql/2608131000-add-in-theaters-check.sql   → éditeur SQL Supabase
```

Avant, un film cinéma sorti dans l'année en cours passait « En salle » et **n'en sortait jamais** :
un film de janvier restait dans le rail « Au ciné en ce moment » en décembre, et dans la vue Séances
sans une seule séance à montrer (c'était la limite « `inTheaters` est collant », plus bas). L'état
répond désormais à la seule question qui vaille : **ce film a-t-il une séance à Paris dans les 7
jours qui viennent ?**

- **Quand.** Une fois par semaine ciné, en tâche de fond au chargement de l'app (`syncInTheaters()`
  dans `layouts/default.vue`, sans `await` : jamais devant le premier rendu). Le gate est le
  **mercredi**, pas « il y a 7 jours » — un contrôle du mardi soir n'a plus rien à dire de la grille
  du mercredi matin. Même règle que la fraîcheur du cache de séances, volontairement.
- **Qui.** Tous les films `unseen` ou `inTheaters` en `media = 'cinema'` et déjà sortis, **sans
  borne d'ancienneté**. « Vu » et « Téléchargeable » sont des décisions de l'utilisateur : le
  contrôle n'y touche pas.
- **Comment.** Une requête par film, sur la journée du jour. Séances aujourd'hui → en salle ; sinon
  le `nextDate` que livre Allociné tranche (un film qui ne joue que samedi, ou qui ressort mercredi,
  est bien en salle cette semaine). En régime chaud — vue Séances déjà ouverte aujourd'hui —
  **aucune sortie réseau** : le contrôle et la vue partagent le même cache (`useShowtimes`), donc
  chacun préchauffe l'autre.
- **Ce qu'on ne fait pas.** Allociné injoignable, horaires périmés, film non rapproché d'une fiche :
  le verdict est *suspendu*, jamais « retiré ». Sans ce troisième cas, une panne d'un jour sortirait
  un film du rail pour une semaine entière.

Une seule promotion reste faite sur la date : celle d'un film **jamais contrôlé**, le jour de sa
sortie (`applyAutoInTheaters`), pour ne pas attendre le prochain mercredi. Dès qu'une ligne porte un
`in_theaters_checked_at`, Allociné est seul juge — sans cette garde, un film retiré par le contrôle
serait re-flaggé au chargement suivant, puis re-retiré : un va-et-vient perpétuel.

> Le contrôle est **silencieux tant que la migration n'est pas jouée** : la première écriture
> échoue en `42703`, il se désactive pour la session et le dit en console. Rien n'est écrit à
> moitié — appliquer les états sans pouvoir horodater relancerait une salve de requêtes à chaque
> ouverture de l'app. `node scripts/check-seances.mjs` le signale aussi.

### Pourquoi aucune borne d'ancienneté

Une première version ne reprenait que les sorties de moins de 120 jours, pour ne pas « interroger
Allociné sur tout le catalogue ». Elle ratait exactement le cas qui justifie ce contrôle : **le film
de février qu'une salle art et essai reprogramme une semaine en août.** Une programmation tardive
n'a pas de date de péremption.

Le volume mesuré au 13/08/2026 tranche le débat — la prudence coûtait plus qu'elle ne rapportait :

| fenêtre | films interrogés / semaine |
|---|---|
| 120 j | 12 |
| 365 j | 36 |
| **aucune** | **91** (~13 requêtes/jour) |

Le passage complet sur les 91 films a pris **1 seconde pour 91 requêtes** (87 identifiants Allociné
étaient déjà en base, hérités des passages précédents de la vue Séances). Et il a trouvé **3 films
en salle que la borne à 120 jours manquait** : *Ça tourne à Séoul !* (sorti le 08/11/2023),
*Tardes de soledad* (26/03/2025), *L'Inconnu de la Grande Arche* (05/11/2025) — une salle
parisienne chacun, ce jour-là. L'ouverture est donc un gain en soi : une ressortie en copie
restaurée remonte d'elle-même dans « Au ciné en ce moment ».

### Ce que le contrôle coûte vraiment

Il ne touche **jamais** le premier rendu : lancé sans `await` après `getMovies()`, il ne rend la
main à rien. Et il ne fait quelque chose qu'une fois par semaine ciné — les six autres jours, il
sort sur un `filter` qui ne trouve aucun candidat.

| | avant | après |
|---|---|---|
| Requêtes Allociné | ~0 hors consultation | **~91/semaine** (~13/jour) |
| Lectures groupées du cache | 1 | 2 (paquets de 50) |
| Cache mémoire L1 après contrôle | — | ~12 films gardés, ~80 relâchés |
| `showtimes_cache` | +14 entrées/passage | +91, **moins les journées révolues** |

Trois pièges de volume traités au passage, tous nés de l'élargissement à 91 films :

1. **La lecture groupée cassait en silence.** `server/api/allocine/showtimes.js` refuse plus de 60
   identifiants (`MAX_IDS`) — vérifié : 91 → **HTTP 400**. Le client retombait alors sur son chemin
   de secours, un `refresh` unitaire par film : 91 invocations serverless et 91 lectures Supabase là
   où deux requêtes suffisent. Le client découpe désormais en paquets de 50 (`CACHE_BATCH`), envoyés
   ensemble puisqu'ils ne font que lire.
2. **Mémoire.** Le contrôle charge ~91 payloads pour n'en garder qu'une douzaine à l'écran. Les
   autres sont relâchés du L1 aussitôt le verdict rendu (~3 Ko l'unité, ~0,25 Mo récupérés) ; le L2
   les garde, c'est là qu'ils servent.
3. **Stockage.** Mesuré le 13/08/2026 : 185 entrées, 0,62 Mo, **3 Ko l'entrée** — soit ~16 Mo/an au
   rythme de 91 entrées par semaine, pour des journées que plus rien ne relira (la vue ne regarde
   que J → J+6). Le contrôle en profite donc pour supprimer les entrées de dates passées : une
   requête, au seul endroit qui passe une fois par semaine et non à chaque chargement.

Contrôlé en conditions réelles le 13/08/2026 sur les 14 films flaggés : 11 confirmés, 3 retirés
(*Silent Friend*, *The Plague*, *Plus fort que moi* — recoupés à **0 séance sur les 7 jours**, et
`nextDate` au 04/09 pour le dernier), et *Bait* conservé alors qu'il n'a aucune séance aujourd'hui,
sa reprise du 16/08 tombant dans la fenêtre. Une requête par film, pas sept.

## « Au ciné en ce moment » ouvre la vue Séances

Cliquer un film du rail (ou de la bande mobile) mène à `/seances?film=<tmdbId>`, **cadré sur ce
film** : la question qui suit « il est en salle » est toujours *où et quand*, jamais « où est-il dans
ma timeline ». Le cadrage s'affiche en clair, avec l'affiche et un bouton « Tous les films » qui le
retire — un filtre invisible est un bug pour qui le subit. Quand il ne reste qu'un groupe à l'écran,
il s'ouvre tout seul : arriver sur une carte fermée demanderait un clic de trop.

L'identifiant passe par l'URL et non par un `useState` : le lien est partageable et survit à un
rechargement. Un `?film=` qui ne correspond à aucun film en salle (lien vieilli, film sorti de
l'affiche depuis) vaut absence de cadrage — la page entière plutôt qu'un écran vide inexplicable.

Le cadrage est appliqué **à la source** (`visibleFilms`) et non en bout de chaîne : compteurs,
arrondissements proposés, « prochaine séance le … » et le décompte masqué par le filtre carte en
découlent tous, et restent donc d'accord entre eux.

### Arrivée sur le premier jour qui a des séances

Un film cadré sans séance aujourd'hui fait avancer la vue jusqu'au premier jour qui en a : arriver
sur un mur vide alors que le film joue dimanche n'apprend rien, l'information qu'on vient chercher
est *quand*. Le repérage ne coûte **aucune requête** — `nextDate` est déjà dans le payload du jour,
Allociné le livre précisément quand il n'a rien à cette date. Vérifié sur *Bait* le 13/08/2026 :
`13/08 → 0 salle, nextDate 16/08` puis `16/08 → L'Archipel`, un seul saut.

Trois garde-fous : la boucle est **bornée à 3 sauts** (`nextDate` est calculé sur Paris *et sa
couronne*, il peut désigner un jour où le film ne joue qu'en banlieue, donc vide ici) ; le saut se
base sur les séances **existantes** et non filtrées (une journée vidée par le pré-filtre carte a son
propre message et sa propre porte de sortie, l'enjamber la masquerait) ; et il n'a lieu **qu'à
l'arrivée** sur un film — un jour choisi à la main n'est jamais corrigé dans le dos.

## Itinéraire vers une salle

Une épingle à côté de l'étoile, dans les deux regroupements — en en-tête « Par cinéma », sur chaque
ligne de salle « Par film ». Le nom lui-même n'est pas le lien : l'en-tête entier sert à déplier, et
lui voler le clic coûterait plus que ça ne rapporte.

- **iOS / iPadOS** → `maps.apple.com`, que le système remet à Plans ; **partout ailleurs** → Google
  Maps, qui bascule seul dans l'app sur Android et reste une page web sur ordinateur. iPadOS se
  présentant comme un Mac, c'est l'écran tactile qui les sépare.
- **Aucun point de départ n'est transmis** : laissé vide, les deux services partent de la position
  actuelle. On n'a donc jamais à demander la géolocalisation, ni à stocker quoi que ce soit —
  cohérent avec le parti pris de `travel.js` sur les coordonnées du domicile.
- **Mode transports en commun**, la même unité que le `24 min` affiché juste à côté.
- **Destination = les coordonnées géocodées**, pas l'adresse Allociné (qui n'est pas toujours une
  adresse). Repli sur « nom, code postal Paris » pour une salle pas encore passée au géocodage.

## Architecture

```
app/pages/seances.vue              vue + 6 états non-heureux
app/components/seances/            DayStrip · SeanceFilters · SeanceGroup · TimeChip
app/composables/useSeances.js      état, chargement et dérivés de la page
app/composables/useShowtimes.js    résolution + chargement d'une journée + cache L1 (partagés)
app/composables/useInTheatersSync.js  contrôle hebdomadaire de l'état « En salle »
app/utils/seancesGrouping.js       filtres, tri, regroupements — fonctions PURES, donc testables
app/utils/maps.js                  itinéraire vers une salle (Plans / Google Maps)
app/utils/travel.js                mise en forme du temps de trajet
shared/utils/cineWeek.js           semaine ciné — source unique app + serveur + scripts

server/api/allocine/resolve.js     titre TMDB → allocine_id (recherche interne Allociné, cache 12 h)
server/api/allocine/showtimes.js   lecture GROUPÉE du cache — ne sort jamais sur le réseau
server/api/allocine/refresh.js     rafraîchit UN (film, date) — la seule route qui appelle Allociné
server/utils/allocine.js           SOURCE UNIQUE de vérité du format Allociné
server/utils/showtimesFreshness.js règle de fraîcheur partagée par les deux routes
server/utils/promisePool.js        copie serveur du pool de concurrence

scripts/test-seances-rules.mjs     30 tests des règles pures  →  npm test
scripts/check-seances.mjs          contrôle de santé          →  npm run check:seances
scripts/spike-cinefil.mjs          mesure de la seconde source (cf. plus bas)
```

### Les règles pures sont testées

```bash
npm test        # 30 assertions, aucune dépendance réseau ni base, < 1 s
```

Trois familles, toutes importées **du code réel** (aucune copie) : le report des salles disparues
(`carryOverMissing`), les repères de la semaine ciné (`cineWeek`) et les filtres / tri /
regroupements (`seancesGrouping`).

Pourquoi celles-là et pas d'autres : elles sont **pures** — donc triviales à tester — et leurs
erreurs sont **silencieuses**. Un cache qui perd une salle, un film qui reste « en salle » de trop,
un mercredi mal calculé, un filtre carte qui laisse passer une séance IMAX : rien de tout cela ne
lève d'exception, ça affiche simplement quelque chose de faux. C'est exactement le genre de bug que
ce projet a passé sa journée à traquer à la main.

### Les deux caches

| | Où | Portée | Rôle |
|---|---|---|---|
| **L1** | `useState` clé `allocineId:date` | la visite | changer de jour puis revenir ne refetch rien (0,6 Mo pour 7 jours) |
| **L2** | table `showtimes_cache` | durable, partagé | survit au cold start Vercel, que le cache mémoire Nitro ne sait pas faire |

### Pourquoi deux routes plutôt qu'une

Le chargement d'un jour se fait en deux temps : **une** lecture groupée du cache pour tous les films,
puis un rafraîchissement film par film pour ce qui manque seulement.

- **Chemin chaud** (cas courant, cache plein) : 1 requête HTTP + 1 requête Supabase, au lieu d'une
  paire par film. Mesuré sur 11 films : **252 ms → 92 ms** sur la seule lecture en base, et 13
  invocations de fonction serverless épargnées à chaque changement de jour.
- **Chemin froid** : l'éventail reste côté client. Sérialiser une journée entière dans une seule
  fonction serveur prendrait plusieurs secondes et flirterait avec la limite d'exécution ; en
  parallélisant depuis le navigateur, chaque appel reste court et indépendant.

`refresh` relit volontairement l'entrée avant de sortir sur le réseau : entre les deux appels, un
autre onglet a pu la rafraîchir, et une requête en base coûte infiniment moins qu'une sortie inutile
chez Allociné.

TTL : ~2 h pour aujourd'hui/demain, ~3 h au-delà, **+ invalidation forcée le mercredi** (jour où
les salles renouvellent leur programmation). Une journée sans séance est mise en cache comme les
autres — sinon on retaperait Allociné à chaque affichage.

> ⚠️ Le TTL lointain était de **12 h**, sur l'idée qu'« au-delà de demain, la programmation est
> posée ». C'est faux, et ça s'est vu : le 13/08/2026, l'entrée du dimanche 16 pour *La fin d'Oak
> Street* — écrite à 09 h 20 — portait 23 salles parisiennes, sans UGC Ciné Cité Les Halles,
> qu'Allociné servait pourtant l'après-midi même avec 7 séances (09:00 → 22:00, identiques à
> `ugc.fr`). Les exploitants ouvrent leurs ventes par vagues sur les jours à venir. Une demi-journée
> de cache fige donc un état incomplet et fait mentir la vue face au site de la salle.

**Le TTL ne suffit pas, et c'est mesuré.** Le canari (ci-dessous) a repris le même écart le jour
même sur *Les matins merveilleux* — même salle, même jour cible, sur une entrée de **41 minutes**.
Les deux cas tombent à J+3 : c'est la fenêtre d'ouverture des ventes (les exploitants mettent en
vente à J-3 / J-4, Allociné intègre par vagues dans la journée). Aucun TTL défendable ne couvre ça —
il faudrait rafraîchir en permanence les sept jours pour en rattraper trois. La pagination, elle, a
été mise hors de cause : trois lectures complètes d'affilée rendent le même résultat, sans doublon
ni manque.

**Cinq garde-fous** ajoutés dans la foulée :

- **Détection des salles muettes.** `check-seances.mjs` interroge chaque salle acceptant la carte
  (41 aujourd'hui) et signale celles qui ne rendent **aucune** séance sur deux jours écartés. Un
  multiplexe qui ne joue rien de la semaine n'existe pas : c'est cette invraisemblance qu'on teste.
  ⚠️ En **deux temps** : `theater-<code>` filtre (il est direct, mais creux — cf. plus bas), puis
  chaque suspecte est **confirmée** par `movie-<id>`, l'endpoint de production, sur un film témoin
  largement diffusé. Sans cette confirmation, le contrôle accusait une salle parfaitement programmée
  et la vue affichait un avertissement faux — pire que pas d'avertissement du tout.

- **Revalidation en arrière-plan sur J+2 → J+4.** Le cache s'affiche immédiatement, puis une seconde
  lecture forcée part sans bloquer si l'entrée servie a plus de 30 minutes ; la vue se complète
  toute seule. Restreinte à ces trois jours et à ce seuil, parce que c'est là et seulement là que la
  grille bouge en cours de journée. Sans boucle possible : la relecture réécrit `fetched_at`, la
  condition retombe.
- **Un canari qui compare cache et source.** `node scripts/check-seances.mjs` relit Allociné en
  direct pour un échantillon de films à J+3 et **nomme les salles absentes du cache**. C'est ce qui
  manquait le 13/08 : l'écart n'était visible qu'en ouvrant `ugc.fr` à côté. Le contrôle ne suppose
  aucune cause — TTL trop long, page perdue, salle sortie du référentiel donnent le même symptôme,
  et c'est le symptôme qu'on mesure.

- **« Actualiser »**, dans la ligne de provenance en bas de page : ressort chez Allociné pour le jour
  affiché en ignorant les deux caches (`force=1` sur `/api/allocine/refresh`). Geste explicite,
  jamais déclenché tout seul — c'est la porte de sortie quand la vue et le site de la salle
  divergent, et aucun TTL ne peut deviner à quelle heure un exploitant ouvre ses ventes.
- **Un résultat amputé d'une page n'entre plus en cache.** Un blockbuster tient sur 5 pages ; si
  l'une échoue, le payload reste parfaitement bien formé, simplement privé de 15 salles — aucun
  signal, et le trou serait gravé jusqu'à expiration. Il est désormais affiché (mieux que rien) mais
  pas figé : `fetchParisShowtimes` remonte `partial`, `refresh` s'abstient d'écrire. Un cache vide se
  rattrape au prochain affichage, un cache faux ne se rattrape pas.

Les filtres (jour mis à part), le regroupement et le toggle carte sont **purement dérivés** : en
changer ne déclenche jamais de requête.

## Quand la lacune est chez Allociné

Le 13/08/2026, toujours sur *La fin d'Oak Street* : `ugc.fr` affichait 7 séances aux Halles pour le
lundi 17, la vue n'en montrait aucune, et « Actualiser » n'y changeait rien. Le diagnostic a écarté,
dans l'ordre :

| piste | verdict |
|---|---|
| Cache périmé | non — relecture forcée, même résultat |
| Page perdue dans la pagination | non — `totalItems: 74`, les 5 pages lues, `p-6` en erreur |
| Troncature d'Allociné à N salles | non — Conflans et Evry sont rendus, Les Halles non : ce n'est pas une question de rayon |
| Pagination instable | non — trois lectures complètes d'affilée, résultat identique, zéro doublon |
| Filtre 75xxx / référentiel | non — `C0159`, `75001`, `accepts_ugc: true` |

**La salle avait disparu d'Allociné.** Interrogée par film comme par salle
(`/_/showtimes/theater-C0159/`), sur les 7 jours : `0 film`, `next.showtime.on`. Au même moment, UGC
Maillot rendait ses 16 films par jour. Et nos entrées de cache écrites quelques heures plus tôt la
contenaient encore — elle s'est donc évaporée en cours de journée.

Aucune ligne de ce projet ne peut inventer ces séances : **quand la source ne les a pas, la vue ne
les a pas.** Le seul palier au-dessus serait une **seconde source de listes** (le site de l'exploitant,
UGC en tête) — pas le double-check de la Phase 2, qui vérifie les séances présentes et ne peut rien
dire des absentes. C'est un chantier à part entière, à n'ouvrir que si le contrôle des salles muettes
montre que le cas est fréquent plutôt qu'accidentel.

### Pourquoi paris-cine.info l'a et pas nous

Parce qu'il ne lit pas la même chose. Son référentiel de salles porte des identifiants **numériques
maison** (`Le Grand Rex: 103`, `MK2 Beaubourg: 105`) et non les codes Allociné : il agrège chez les
exploitants et ne se sert d'Allociné que pour les fiches et les notes. Une lacune d'Allociné ne
l'atteint donc pas.

Refaire la même chose pour UGC a été exploré, et **la porte est fermée** : la page cinéma publique
(`ugc.fr/cinema.html?id=10`) ne rend aucun horaire côté serveur — 0 sur 106 Ko —, les séances
arrivent par un appel `/AjaxAction!`, que leur `robots.txt` interdit explicitement. C'est
exactement le motif qui avait fait écarter MK2 au Step 13 ; le même standard s'applique à UGC.

Restent, si le cas devenait fréquent : une source ouverte tierce, ou demander l'accès à UGC. Aucune
des deux n'est un après-midi de travail.

### Spike Cinéfil (13/08/2026) — la piste tient, et le problème est plus large que prévu

```bash
node scripts/spike-cinefil.mjs
```

Protocole : deux salles saines (témoins, qui valident le parseur) et la salle en panne (qui mesure
le gain). Résultats sur les 7 jours affichables :

| salle | Cinéfil | Allociné |
|---|---|---|
| UGC Maillot (témoin) | 362 séances · **7/7 jours** | 362 séances · 6/7 jours |
| UGC Bercy (témoin) | 450 séances · **7/7 jours** | 141 séances · **2/7 jours** |
| UGC Les Halles (en panne) | 909 séances · **7/7 jours** | 140 séances · **1/7 jour** |

Trois enseignements, dont un qu'on ne cherchait pas :

1. **Le parseur est juste.** Sur Maillot, les deux sources donnent le *même total exact* (362). Un
   écart ici aurait été un bug de parsing ; il n'y en a pas.
2. **Cinéfil rendrait bien la salle perdue** : 909 séances aux Halles, dont *La fin d'Oak Street*
   avec ses 7 séances — celles-là mêmes qu'ugc.fr affichait et qu'Allociné avait perdues.
3. ~~La profondeur de publication d'Allociné est très inégale.~~ **Faux — et l'erreur valait d'être
   trouvée.** Le spike interroge `theater-<code>`, alors que la production utilise
   `movie-<id>/near-Paris`. Les deux n'ont pas la même profondeur du tout :

   | salle | `/theater/` | `/movie/` (production) |
   |---|---|---|
   | Bercy | 2/7 jours | **6/7** |
   | Les Halles | 1/7 jours | **6/7**, 7 séances/jour |
   | Maillot | 6/7 jours | 6/7 |

   L'endpoint par salle est **creux**, celui qu'on utilise ne l'est pas. Comparer Cinéfil à `theater-`
   revenait à mesurer la faiblesse du mauvais endpoint et à l'attribuer à la source. **Conséquence
   directe : le contrôle des salles muettes, bâti sur `theater-`, produisait un faux positif** — il
   a déclaré Les Halles muette alors que la production la voyait. Il confirme désormais chaque
   suspecte avec `movie-` avant de conclure (cf. ci-dessous).

Ce que le spike ne dit pas : la **stabilité du HTML de Cinéfil dans le temps**. C'est le vrai coût
de la piste — le projet a précisément abandonné le parsing HTML d'Allociné pour cette raison. À
relancer quelques jours de suite avant de s'engager.

Reste aussi à régler le **rapprochement des titres** : 83 % seulement sur le témoin, alors que les
deux sources disent la même chose. Un slug (`la-bataille-de-gaulle-lage-de-fer`) et un titre rédigé
(« La Bataille de Gaulle : L'Âge de fer ») ne se recoupent pas de façon fiable — il faudra un
mapping par identifiant, pas par chaîne.

### Ce qu'on fait à la place : le dire

```
_ressources/sql/2608131800-add-cinema-silence.sql   → éditeur SQL Supabase
```

`check-seances.mjs` persiste son verdict (`cinemas.allocine_silent_since`) et la vue l'affiche :
« *UGC Ciné Cité Les Halles n'est plus publié par Allociné depuis le 13 août — ses séances existent
peut-être, mais ne peuvent pas être listées ici.* » Une salle qui manque ne fait aucun bruit,
contrairement à une salle dont les horaires seraient faux : sans ce signalement, l'absence se lit
comme « ce cinéma ne joue rien », ce qui est faux et ruine la confiance dans tout le reste. Un
avertissement de plus de 7 jours ne s'affiche pas — mieux vaut se taire qu'alerter sur une salle qui
a peut-être reparlé depuis.

> Piège rencontré en écrivant ce contrôle : une colonne absente remonte `42703` en **lecture** mais
> `PGRST204` en **écriture** (PostgREST refuse sur son cache de schéma, sans atteindre la base). Ne
> tester que le premier faisait échouer le script en silence.

## Cinémas favoris

```
_ressources/sql/2608121820-add-cinema-favorite.sql   → éditeur SQL Supabase
```

Une étoile sur chaque salle — dans l'en-tête en mode « Par cinéma », sur chaque ligne de salle en
mode « Par film », puisque c'est là qu'on découvre une salle. Les favoris remontent en tête du
regroupement « Par cinéma », et leurs séances en tête de chaque film dans « Par film ». L'ordre
complet est : **favoris → arrondissement → nom**.

La bascule est optimiste (la carte se réordonne au clic, retour en arrière si l'écriture échoue) et
la préférence vit en base, pas en `localStorage` : elle doit suivre d'un appareil à l'autre, comme
`accepts_ugc`.

> Tant que la migration n'est pas jouée, le composable retombe automatiquement sur une lecture sans
> la colonne et prévient en console. Sans ce filet, le référentiel entier devenait illisible — donc
> plus d'`accepts_ugc`, donc une page vide, le pré-filtre carte étant actif par défaut.

## Ajouter / retirer une salle de la liste carte UGC

```bash
node scripts/set-cinema-ugc.mjs --list           # toutes les salles et leur état (★ = carte acceptée)
node scripts/set-cinema-ugc.mjs --list --ugc     # seulement celles qui l'acceptent
node scripts/set-cinema-ugc.mjs "MK2 Nation" on  # par fragment de nom…
node scripts/set-cinema-ugc.mjs C0102 off        # …ou par code salle Allociné
```

Un fragment ambigu (« MK2 ») liste les candidates et ne touche à rien. Après modification, reporter
le changement dans `2608121539-seed-cinemas-ugc.sql`, qui reste la remise à plat de référence.

**Les nouvelles salles n'arrivent plus à `false` d'office.** À la *création* d'une ligne — et
seulement là — `accepts_ugc` prend ce qu'Allociné annonce dans `loyaltyCards`. Sans ça, une salle
découverte après le seed disparaissait de la vue sans le moindre signal, le filtre étant actif par
défaut (constaté sur Les 3 Luxembourg). Une ligne existante n'est **jamais** réécrite : la curation
reste la vérité.

## Liste `accepts_ugc`

`2608121539-seed-cinemas-ugc.sql` marque **34 salles sur 49**, liste validée le 12/08/2026 :
11 UGC, 10 MK2, 7 CIP, 6 divers (Grand Rex, Louxor, Elysées Lincoln, Cinq Caumartin, Sept
Parnassiens, Chaplin Saint Lambert). Les 15 « non » sont essentiellement le circuit Pathé, qui a sa
propre carte. Point de départ : le champ `loyaltyCards` d'Allociné, repris uniquement pour ne pas
partir d'une page blanche.

> **13/08/2026 — Reflet Medicis (C0074) ajouté.** Salle apparue après le seed initial, donc entrée
> avec la valeur d'Allociné plutôt qu'avec une décision. Retenue : Allociné la classe
> `cip_cinemas_independants_parisiens`, et les six autres CIP du référentiel (Épée de bois, Grand
> Action, Saint-André des Arts, 3 Luxembourg, Escurial, Nouvel Odéon) sont déjà marquées acceptantes
> — le « oui » est cohérent avec la curation, pas hérité par défaut. Non recoupé sur le site du
> cinéma, `lesecransdeparis.fr` répondant 522 ce jour-là.

Pourquoi curée à la main plutôt que scrapée : Allociné porte bien cette donnée mais a déjà été pris
en défaut dessus (cas rapporté d'une salle annoncée comme prenant la carte CIP, contredite par
toutes les autres sources). Le fichier liste les 15 salles « non » en commentaire — déplacer une
ligne d'un bloc à l'autre suffit à l'amender, puis on rejoue le `.sql`.

## Ce qui a été vérifié en conditions réelles (12/08/2026)

- Endpoint séances : 27 salles / 201 séances sur un blockbuster, **7 requêtes pour 7 pages**,
  0 code postal hors 75, lien de billetterie sur **201/201** séances.
- Index `/film/aucinema/` : 210 films en 14 requêtes, 0 sans date de sortie, 15/15 cartes parsées
  par page.
- Résolution : correcte jusqu'aux films de la page 12 (donc index complet) ; 1ᵉʳ appel 0,9 s →
  suivants 0,02 s (index caché) ; titre inconnu → `{ allocine_id: null }` en 200.
- Cas dégradés : film inexistant (404) et date lointaine → aucun throw, `{ theaters: [] }`.
- Route séances : 4 cas de paramètres invalides → 400 ; appel sans session → 200 dégradé (RLS bloque
  l'écriture du cache, jamais de 500).
- En base après le premier passage : **49 salles** dans `cinemas` (27 marquées carte UGC),
  **46 géocodées**, 11 films sur 14 résolus, 18 entrées de cache écrites.
- Distances recoupées à la main depuis le domicile : UGC Paris 19 → 2,3 km · Les Halles → 6,8 km ·
  Pathé Aquaboulevard → 12,9 km. Aucun arrondissement en désaccord avec son code postal.
- `npm run build` passe.

### Deux bugs trouvés et corrigés en cours de route

1. **Journée sans séance confondue avec une panne.** Allociné annonce « aucune séance à cette date »
   par `error: true` + `message: "next.showtime.on"` + un `nextDate` exploitable. Le client y voyait
   un échec réseau : la journée vide n'était jamais mise en cache (Allociné retapé à chaque
   affichage) et le `nextDate` était jeté, donc le message « prochaine séance le … » ne pouvait pas
   se déclencher. Seule l'absence totale de réponse vaut désormais échec.
2. **Deep-link sur `/seances` : vue vide.** Le `onMounted` de la page se déclenche *avant* celui du
   layout (Vue monte les enfants avant les parents), or c'est le layout qui charge `movies`. Le
   premier chargement tombait sur une liste vide. Corrigé par un `watch` sur la transition 0 → N.
   Invisible en venant de la timeline — à tester en priorité sur un rechargement direct.
3. **Résolution aveugle à l'art et essai** (signalé par recoupement avec paris-cine.info). Le
   résolveur parcourait `/film/aucinema/` — 14 pages de HTML, 210 titres — et exigeait un titre
   normalisé **identique**. Deux trous : les films d'art et essai n'y figurent pas du tout
   (*Silent Friend*, à l'affiche aux 3 Luxembourg, était absent), et le moindre écart de rédaction
   faisait échouer le match (« Chronique » vs « Chroniques du Caire »). Remplacé par la recherche
   interne d'Allociné (`/_/autocomplete/`) : **une** requête au lieu de 14, plus de parsing HTML — donc
   la pièce la plus fragile du client en moins — et le moteur fait lui-même le rapprochement flou. On
   ne tranche que ses candidats, sur similarité de titre (`label` **ou** `original_label`), puis
   réalisateur, puis écart de date. Résultat sur les 14 films en salle : **14/14 résolus**, aucun
   identifiant déjà en base modifié, titres bidon toujours à `null`.
4. **Salles apparues après le seed masquées en silence** (conséquence du nº 3 : les nouveaux films
   amènent de nouvelles salles). Voir « Ajouter / retirer une salle » ci-dessus.

## Limites assumées

| Limite | Détail |
|---|---|
| **`isPreview` n'existe pas** | Contrairement à ce qu'annonçait le plan, le payload Allociné ne porte aucun marqueur d'avant-première (ni champ, ni tag). Le test est écrit et **inerte** : il se réveillera seul si le champ réapparaît. L'exclusion des avant-premières du filtre carte est donc aujourd'hui sans effet. |
| **Exclusions carte approximatives** | Le filtre est juste sur le gros (salle acceptante + formats majorés listés dans `CARD_EXCLUDED_FORMATS`), approximatif sur les cas exotiques. **Le lien billetterie reste l'arbitre.** |
| **`robots.txt` Allociné** | `Disallow: /_/` couvre l'endpoint des séances. Compromis assumé et documenté en tête de `server/utils/allocine.js` : volume dérisoire, cache durable, User-Agent identifiable, concurrence bornée à 4, aucun contournement anti-bot. Les voies conformes ont été explorées et ne tiennent pas. |
| **Une salle peut disparaître d'Allociné** | Constaté sur UGC Ciné Cité Les Halles le 13/08/2026 : absente de *toutes* les réponses pendant que le site de la salle affichait ses séances. Indétectable dans la vue (une salle qui manque ne fait pas de bruit), et irrattrapable sans seconde source. Le contrôle des salles muettes est là pour ça. |
| **Contrat interne non garanti** | Allociné peut renommer la route ou changer la forme du JSON. Toute la connaissance du format est confinée à `server/utils/allocine.js` ; un échec donne `{ theaters: [] }` + message, **jamais** de 500. |
| **« En salle » = en salle *à Paris intra-muros*** | Le contrôle hebdomadaire tranche sur les salles 75xxx, comme le reste de la vue. Un film qui ne joue plus qu'en banlieue sort donc du rail — cohérent avec le périmètre de l'app, mais ce n'est pas « plus à l'affiche » au sens général. |
| **Une reprise est vue avec au plus une semaine de retard** | Le contrôle passe une fois par semaine ciné. Une reprise qui démarre un mercredi est donc vue le mercredi même (le film joue déjà) ou, au pire, détectée d'avance par le `nextDate` du contrôle précédent. Une reprise d'une seule journée en milieu de semaine peut passer entre les mailles. |
| **Distance à vol d'oiseau** | Pas de temps de trajet réel (exigerait une API de routage et une clé). Salle non géocodée → rien ne s'affiche, jamais de position approximée (les scores BAN < 0,5 sont rejetés). |

## Phase 2 — double-check « point vert » : spike conclu (12/08/2026)

Piste retenue : vérifier la vivacité du lien de billetterie qu'Allociné nous donne déjà, sans
rétro-ingénierer le moindre endpoint interne. Verdict : **on fait, mais UGC seulement.**

> ⚠️ **Ce double-check ne répond pas au problème des séances manquantes.** Il vérifie qu'une séance
> qu'on affiche existe bien ; il ne peut rien dire d'une séance qu'on n'affiche pas. Une absence ne
> se détecte qu'en comparant des listes — c'est le rôle du canari de `check-seances.mjs`.

- **UGC ✅** — `reservationSeances.html?id=…` est rendu côté serveur et discrimine parfaitement :
  identifiant réel 21 950 o, identifiant trafiqué **et** identifiant bidon 21 474 o, octet pour
  octet identiques. Et la page re-décrit la séance (film, cinéma, date, heure, **heure de fin**,
  version, PMR, **numéro de salle**) — c'est une vraie seconde source, pas un ping. Robots OK.
- **Pathé ❌** — 403 sur tout, identifiant réel compris. Anti-bot, aucun pouvoir discriminant.
- **MK2 ❌** — l'URL de billetterie est sous `/panier`, que leur `robots.txt` exclut explicitement.
- **16 autres plateformes** — longue traîne d'indépendants, ratio effort/couverture désastreux.

Couverture : ~30 % des séances d'un jour, mais **100 % de celles en salle acceptant la carte**.
L'UI devra donc distinguer *confirmé* de *non vérifiable* — jamais un « non confirmé » qui se lirait
comme un doute.

⚠️ L'obstacle est volumétrique, pas technique : un jour entier = ~100 requêtes vers ugc.fr contre
~20 vers Allociné. Vérification à l'ouverture d'une carte uniquement, verdict caché à la même durée
de vie que les séances.

## Hors périmètre

Séances hors Paris intra-muros · tri par proximité et filtre de rayon · double-check Pathé/Gaumont ·
séances « hors les murs » · numéro de salle en multiplexe · notifications · réservation dans l'app ·
filtres 3D/IMAX/accessibilité exposés à l'utilisateur · préchauffage par cron (un préchargement des
7 jours coûterait ~140 requêtes/jour **constantes** contre ~0 en régime chaud avec le lazy).
