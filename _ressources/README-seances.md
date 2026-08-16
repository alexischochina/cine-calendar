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

Puis, pour les séances événement (cf. la section dédiée plus bas) :

```
_ressources/sql/2608141200-add-seance-events.sql
```

Il crée `theater_events_cache` et ajoute `events` / `events_checked_at` à `calendar`. Idempotent.
Sans lui, la vue reste juste — il lui manque seulement les marqueurs d'événement et la rubrique
« Événements à venir » du rail, et le code se tait au lieu de retenter (`42P01` / `PGRST204` détecté une
fois, puis silence pour la visite).

Enfin, le resserrage des droits sur le référentiel des salles :

```
_ressources/sql/2608151000-tighten-cinemas-rls.sql
```

La policy d'origine ouvrait `cinemas` **en écriture à tout compte authentifié** — donc la curation
`accepts_ugc`, le géocodage et les temps de trajet, tous posés par des scripts qui tournent en
service-role. Celle-ci sépare les trois usages : lecture pour tous les authentifiés, `insert` pour la
découverte de salle par `/api/allocine/refresh`, `update` pour la bascule de favori, et rien d'autre.
Le fichier dit aussi ce qu'il ne fait pas — Postgres n'a pas de granularité par colonne dans une
policy. Idempotent, et sans effet visible sur l'usage.

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

### Le trou du gate hebdomadaire, et ce qui le bouche

⚠️ Le contrôle ne tourne qu'**une fois par semaine ciné**. Un film qui quitte l'affiche le jeudi reste
donc dans le rail jusqu'au mercredi suivant, avec zéro séance à montrer. Constaté le 14/08/2026 sur
quatre films — *Silent Friend*, *Plus fort que moi*, *The Plague*, *L'Inconnu de la Grande Arche* — tous
contrôlés le **12/08 à 23:10**, donc *après* le mercredi qui sert de gate : le contrôle les avait
légitimement gardés, et ne devait plus repasser avant le 19.

Or la preuve de leur départ était **déjà en cache** : les sept journées chargées, zéro salle
intra-muros partout. `horizonVerdict` (`app/utils/inTheaters.js`) la lit, et `pruneEmptyHorizon` retire
le film sans attendre le mercredi. Aucune requête — que du cache déjà payé.

Appelé depuis les deux endroits qui peuvent avoir l'horizon complet : le balayage de la page Événements
(qui charge les 7 journées par construction) et la vue Séances (dès que la navigation les a toutes
chargées ; sans effet avant).

> Le verdict n'est rendu que sur des preuves **complètes** : une seule journée manquante, en échec
> (`error`) ou servie depuis du périmé (`stale`), et on se tait. Garder un film de trop quelques jours
> vaut mieux que d'en retirer un sur une lacune — c'est la même discipline que les trois issues de
> `playingWithin`, où `null` signifie « on ne sait pas ».

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

## Le rail ouvre la vue Séances

Cliquer un film du rail (ou de la bande mobile) mène à `/seances?film=<tmdbId>`, **cadré sur ce
film** : la question qui suit « il est en salle » est toujours *où et quand*, jamais « où est-il dans
ma timeline ». Le cadrage s'affiche en clair, avec l'affiche et un bouton « Tous les films » qui le
retire — un filtre invisible est un bug pour qui le subit. Quand il ne reste qu'un groupe à l'écran,
il s'ouvre tout seul : arriver sur une carte fermée demanderait un clic de trop.

L'identifiant passe par l'URL et non par un `useState` : le lien est partageable et survit à un
rechargement. Un `?film=` qui ne correspond à aucun film en salle (lien vieilli, film sorti de
l'affiche depuis) vaut absence de cadrage — la page entière plutôt qu'un écran vide inexplicable.

Le cadrage est appliqué **à la source** (`visibleFilms`) et non en bout de chaîne : compteurs,
« prochaine séance le … » et les décomptes masqués par les filtres en découlent tous, et restent
donc d'accord entre eux.

### Le périmètre de la vue, ce n'est pas `cinemaNow`

⚠️ C'est `seanceFilms` — **les deux rubriques du rail réunies**. Piège introduit puis corrigé : `cinemaNow`
retire les films pris en charge par « Événements à venir », pour ne pas les afficher deux fois. S'en
servir comme périmètre de **données** avait une conséquence qu'on ne voyait qu'au clic — le film ouvrait
`/seances?film=…`, n'y était pas trouvé, donc n'était ni cadré ni chargé. Le cas d'une avant-première
était pire : le film n'est pas `inTheaters`, il n'a jamais été dans `cinemaNow`.

### Un événement daté ouvre **sa** journée

Cliquer « dim. 16 août » sur une carte ajoute `?jour=2026-08-16`, et la vue s'ouvre sur ce jour-là. Sans
ça il faudrait retrouver la date à la main dans la bande, alors qu'on venait de la lire.

Une date hors des sept jours affichés est ignorée — mieux vaut aujourd'hui qu'un index invalide. Et
quand la journée est demandée explicitement, le **saut automatique** vers le premier jour avec séances
(ci-dessous) est désactivé : corriger dans le dos un choix que l'utilisateur vient de faire est
exactement ce que le reste de la vue s'interdit.

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

## Séances événement

```
_ressources/sql/2608141200-add-seance-events.sql   → éditeur SQL Supabase
```

Une avant-première, une séance unique, une séance jeune public ne se rattrapent pas la semaine
suivante. C'est la seule information de la vue qui **périme**, donc la seule qui mérite de passer
devant les autres. Trois endroits la portent :

| où | ce qu'on voit |
|---|---|
| chip d'horaire | le chip passe au violet, avec le libellé en clair sous l'heure (« Avant-première ») |
| en-tête de carte | pastille « 1 ÉVÉNEMENT » / « 3 ÉVÉNEMENTS » à côté du sous-titre |
| page `/evenements` | la liste complète : un film par carte, toutes ses journées d'événement |
| rail, rubrique « Événements à venir » | le film et le **jour** de son prochain événement, un badge d'affiche pour le nombre de journées, et un lien vers la page |
| bandeau de la vue | « N séance(s) événement hors carte UGC — masquée(s) par le pré-filtre » (voir plus bas) |

Violet et non rose : le rose dit déjà « en salle » sur toute la liste, il ne peut pas dire deux choses
à la fois. Le décompte de la carte est calculé **après filtrage** — il promet ce que le dépliage
montrera, pas ce que le pré-filtre carte vient d'écarter.

Vérifié de bout en bout le 14/08/2026 sur *Fjord* (`188280`, sortie le 19/08), qui a **trois** journées
d'avant-première : 3 salles le 16, MK2 Bibliothèque le 17, UGC Les Halles le 18. Les cinq séances sont
marquées, aux bonnes dates et aux bonnes salles.

### Le libellé exact vient d'un vocabulaire fermé, pas d'un texte libre

Allociné ne livre **aucune description d'événement**. Relevé le 14/08/2026 sur 2 293 séances de
49 salles parisiennes sur 7 jours : ni champ `comment`, ni `title`, rien. Le HTML public de la fiche
film n'en porte pas davantage (`/seance/film-188280/`, 253 Ko, zéro occurrence de « en présence »).

Ce qui existe est une table de correspondance, tenue dans `showtimeEventLabels`
(`server/utils/allocine.js`) — le seul endroit du projet où un tag Allociné devient du texte affiché :

| signal Allociné | libellé |
|---|---|
| `isPreview: true` ou `Showtime.Event.Preview` | Avant-première |
| `Showtime.Event.OnlySession` | Séance unique |
| `BoostPos.XpEtLabels.JeunePublic` | Jeune public |
| `BoostPos.XpEtLabels.LenfanceDeLart` | L'enfance de l'art |

Un membre inconnu de **`Showtime.Event.*`** est affiché quand même, sous une forme dégradée
(`Showtime.Event.CineClub` → « Cine club ») et signalé en console : taire un événement est pire que
l'annoncer imparfaitement. C'est le namespace d'événements d'Allociné, on peut lui faire confiance.

> ⚠️⚠️ **`BoostPos.XpEtLabels.*` n'en est pas un, et l'avoir cru a mis des badges absurdes en
> production.** « XpEtLabels » veut dire « expériences **et labels** » : ça mélange dispositifs de
> programmation et **identités de salles**. Relevé sur 267 journées-salles réelles le 14/08/2026, sur
> 202 libellés enregistrés **161 étaient du bruit** — « Artet essai » ×54 (label posé sur *chaque*
> séance d'un art et essai), « Diffusion salle le club / le studio / laudito » ×60, « Salle infinite »
> et « Salle1 youssef chahine » ×32, « Premier » ×14, « St anglais », « Headline ». Ne restaient de
> vrais que « Avant-première » ×16, « Jeune public » ×11, « L'enfance de l'art » ×11, « Séance unique »
> ×3.
>
> Ce namespace n'accepte donc plus que sa **liste blanche**, sans aucun repli : un membre inconnu y est
> ignoré, pas deviné. L'erreur d'origine était une généralisation sur deux exemples — le sondage initial
> n'avait croisé que `JeunePublic` et `LenfanceDeLart`, et j'en ai conclu que le namespace entier
> qualifiait des séances.

⚠️ Cette table reste **côté serveur**, et l'app ne compare jamais ces chaînes — elle ne fait que les
afficher. L'avant-première, qui est la seule qualification à porter une **conséquence métier** (la
carte UGC ne la couvre pas), voyage donc à part, en booléen sur `isPreview`, via `isPreviewShowtime` et
`previews`. Faire trancher `isCardEligible` sur le texte « Avant-première » aurait adossé une règle
métier à un libellé d'interface : le premier reformulage aurait cassé la règle sans un mot.

### Le texte libre, lui, vient de l'exploitant

```
server/utils/exhibitors.js       registre des sources
server/utils/ugc.js              numéro de séance ← jointure exacte
server/utils/dulac.js            JSON-LD schema.org/Event
server/utils/mk2.js              description SEO
server/utils/exhibitorText.js    helpers de texte communs
server/api/events/detail.js      route + cache durable
shared/utils/exhibitorVenues.js  quelles salles sont couvertes (pré-filtre app)
```

Allociné dit « Avant-première ». Les salles disent la suite :

| source | exemple |
|---|---|
| UGC · Les Halles | « Avant-première avec équipe » |
| Dulac · L'Arlequin | « Séance en présence du réalisateur, suivie d'une dégustation de produits boliviens (assurée par l'Ambassade de Bolivie) » |
| MK2 · Bibliothèque | « La séance sera présentée par le réalisateur Cristian Mungiu. » |

**Trois réseaux, trois niveaux de confiance — dans l'ordre où le registre les interroge :**

**UGC** (11 salles parisiennes) est le plus sûr, et pas grâce à la qualité de son HTML : il publie le
**numéro de séance de sa billetterie** dans chaque tuile
(`reservationSeances.html?id=330171840281`), et Allociné nous donne *le même numéro* dans l'URL de
réservation. La jointure est une **égalité d'identifiants** — ni titre à normaliser, ni date à
interpréter, ni salle à comparer. Rien ne peut dériver.

⚠️ Le paramètre qui débloque tout : **`cinemaId`**. Sans lui,
`actusAjaxAction!getActusAndFilters.action` rend une grille d'affiches sans date ni libellé — c'est ce
qui m'avait fait conclure à tort qu'UGC ne publiait rien. Avec lui, il rend les sections « Séances
Spéciales » et « Avant-Premières » de la salle demandée. Aucune session, aucun cookie, aucun compte.
Les 11 `cinemaId` parisiens viennent de leur propre liste
(`cinemasQuickFilterAjaxAction!getAllList.action`).

⚠️ Et sur le `robots.txt` : `Disallow: /AjaxAction!` est un **préfixe**, il ne couvre pas
`/actusAjaxAction!…`. Ce chemin est autorisé. J'avais d'abord affirmé le contraire — c'était un artefact
d'une regex qui avalait le préfixe. Ce qui reste fermé, c'est `/AjaxAction!` tout court, l'endpoint des
horaires, auquel on ne touche pas (les horaires viennent d'Allociné).

**Dulac** (5 salles) publie un `application/ld+json` au format `schema.org/Event` — donnée structurée,
donc ce n'est **pas** du parsing HTML, ce que le projet s'était justement interdit. **MK2** (~10 salles)
n'expose pas de JSON-LD exploitable : on y lit l'`og:description`. Moins sûr, mais une balise `og:` ne se
remanie pas à la légère — le référencement en dépend — et si la rédaction change, le connecteur se tait,
il ne ment pas. Les deux se rapprochent par (titre, date, salle).

Ajouter une source = une entrée dans `exhibitors.js` + un module frère. Chaque connecteur décide
lui-même s'il couvre une salle, plutôt qu'une carte centrale qui divergerait des modules.

Trois économies, dans cet ordre :

1. **`isKnownExhibitorVenue` avant tout appel.** Vit dans `shared/utils/` parce que c'est **l'app** qui
   s'en sert le plus : sans ce test, on ferait un aller-retour HTTP par séance événement de Paris pour
   se faire répondre non la plupart du temps. MK2 se reconnaît à son préfixe (aucun autre cinéma
   parisien ne porte « mk2 ») plutôt qu'à une liste en dur qui vieillirait à chaque ouverture de salle.
2. **On part du titre, pas du sitemap.** On connaît déjà le film, la salle et la date par Allociné : on
   ne lit que les fiches dont le **slug** contient le titre normalisé. Une requête de sitemap (mise en
   cache 10 min en mémoire d'instance) plus une ou deux fiches, au lieu des 111 du sitemap.
3. **Cache durable qui mémorise les absences** (`event_detail_cache`, `detail is null`). La plupart des
   séances événement ne sont pas chez Dulac ; sans cache négatif on ressortirait sur le réseau à chaque
   relevé. L'absence est relue à chaque nouvelle semaine ciné — une fiche peut être publiée après coup.

⚠️ **Rapprochement sur date + salle, jamais sur l'heure.** Les exploitants horodatent l'**événement** et
non la projection : la fiche Dulac de *La Fille Condor* annonce `18:00` pour une séance à 20:00. Le titre
sert à trouver la fiche, la date et la salle à la valider. Ça évite au passage le problème de
rapprochement de titres qui plafonnait à 83 % dans le spike Cinéfil : ici l'espace de recherche est un
jour et une salle.

#### Trois bugs attrapés en construisant ça, tous du même genre : faux en silence

> **1. Indices croisés.** L'extraction Dulac coupait la phrase à un index calculé sur la chaîne
> *normalisée* puis appliqué à la chaîne *d'origine*. La normalisation retirant accents, apostrophes et
> parenthèses, la phrase perdait ses cinq derniers caractères : « … de Bolivi » au lieu de
> « … de Bolivie) ». D'où `fold()`, qui replie en conservant une table de correspondance des positions.

> **2. Date trop lâche.** La validation MK2 cherchait la date ISO dans la **page entière**. Une fiche en
> porte plusieurs dans ses payloads : la séance du 18 héritait du libellé de celle du 17. On valide
> désormais sur la date annoncée dans la **description** (`mentionsDate`, « le 17 août »), la seule qui
> qualifie l'événement. Sans preuve de date, on ne qualifie pas.

> **3. En-tête reconnu au mauvais signe.** On écartait la formule d'ouverture en cherchant le titre du
> film dedans. MK2 l'omet parfois (« Avant-première le mardi 8 septembre à 20h00 au mk2 bibliothèque »),
> et tout l'en-tête passait alors dans le libellé. `isEventHeadline` se fie maintenant à la **date** ou
> à la **salle**, présentes dans tous les cas observés.

**Ce que ça ne couvre pas.** Les autres salles gardent le vocabulaire d'Allociné : Studio Galande
(« Séance animée par les Time Slips »), Studio des Ursulines, Saint-André des Arts, Le Louxor,
L'Entrepôt, Les 7 Parnassiens… chacune demanderait son connecteur. Les cycles et rétrospectives
échappent aussi au rapprochement chez Dulac : leur `startDate` est celle du cycle, pas de chaque séance.

⚠️ **Limite structurelle des libellés d'exploitant : ils *enrichissent*, ils ne *détectent* pas.** Un
libellé n'est cherché que pour une séance qu'Allociné (ou la déduction par dates) a **déjà** qualifiée
d'événement. Or UGC annonce aussi des « Concert » et des « Rencontre » sur des films **déjà sortis**,
qu'Allociné ne marque pas et que la déduction par dates ne peut pas trouver — ceux-là restent invisibles.
Les retourner demanderait de faire d'UGC une **source d'événements** à part entière : parcourir sa carte
`numéro de séance → libellé` et marquer toute séance qui s'y trouve, au lieu d'interroger séance par
séance. C'est la suite naturelle, et elle est peu coûteuse — la carte est déjà construite en un bloc
(11 requêtes, mises en cache 10 min).

> ⚠️ **Le piège PostgREST, troisième variante.** Le projet savait déjà qu'une **colonne** absente remonte
> `42703` en lecture mais `PGRST204` en écriture. Une **table** absente ne remonte pas `42P01` du tout
> quand PostgREST tranche sur son cache de schéma : c'est `PGRST205`, message « Could not find the table
> … in the schema cache ». Les gardes ne testaient que `42P01` : ils étaient donc **inertes**, la route
> retentait à chaque relevé et sortait chez l'exploitant sans jamais rien mettre en cache — visible
> uniquement en console. D'où `server/utils/pgErrors.js` et son `isMissingSchema`, utilisé partout.

Le tri est délibérément étroit. `Format.*`, `Auditorium.Experience.*` (4DX, Dolby Atmos),
`Localization.*`, `Showtime.Accessibility.*`, `BoostPos.Autres.PopCorn`, `BoostPos.Son.*` décrivent la
copie, la salle ou l'accessibilité — pas la séance. Les accepter aurait marqué **1 656 séances sur
2 293** : un badge sur presque tout, donc un badge qui ne dit plus rien. Les événements sont rares, et
c'est le propos : 6 sur 2 293 dans le relevé.

> **Ce que paris-cine.info a et qu'on n'a pas.** Son onglet Événements affiche « Avant-première en
> présence du réalisateur », « … de l'équipe du film ». Ce texte n'est **nulle part** chez Allociné :
> il agrège chez les exploitants (cf. « Pourquoi paris-cine.info l'a et pas nous » plus bas), et cette
> porte est fermée pour nous — `ugc.fr` sert ses horaires par un `/AjaxAction!` que son `robots.txt`
> interdit, motif qui avait déjà fait écarter MK2. On affiche donc « Avant-première », pas la raison de
> l'avant-première. Y accéder voudrait dire ouvrir le chantier « seconde source de listes ».

### Pourquoi une seconde passe par salle — et pourquoi elle est partielle

⚠️ **Piège central.** Le même `Showtime` n'est pas sélectionné pareil selon la route Allociné, à
`internalId` égal (vérifié le 14/08/2026, id `80248550361` des deux côtés) :

| endpoint | porte les champs d'événement ? |
|---|---|
| `/_/showtimes/theater-{code}/d-{date}/` | **oui** — `isPreview`, `isWeeklyMovieOuting`, tags `Showtime.Event.*` |
| `/_/showtimes/movie-{id}/near-{loc}/d-{date}/` ← **production** | **non**. Ni le booléen, ni les tags. |

D'où le montage : les horaires continuent de venir de l'endpoint film — film-centré, ~14 requêtes par
journée contre ~53 pour balayer Paris —, et une **seconde passe ciblée** interroge l'endpoint salle
pour les seules salles qui jouent des films de la liste (~25 un jour ordinaire). Le rapprochement se
fait sur `internalId`, jamais sur l'heure : une salle peut programmer deux séances à la même minute
dans deux de ses salles.

Coût : +~25 requêtes la **première** fois qu'une journée est affichée, ~0 ensuite — `theater_events_cache`
est le jumeau de `showtimes_cache` (même clé composite, même règle de fraîcheur, même ménage
hebdomadaire). La passe est lancée **hors du chemin d'affichage** : la vue apparaît dès que les
horaires sont là, les marqueurs se posent une fraction de seconde après, sans écran de chargement.

⚠️ **La couverture est partielle, et c'est structurel.** L'endpoint par salle est **creux** — mesuré le
13/08/2026 (cf. le spike Cinéfil plus bas) : `theater-C0159` rendait *1 jour sur 7* là où
`movie-…/near-Paris` en rendait 6. Confondre « pas rendu » avec « pas d'événement » est **exactement**
le faux positif qui avait fait déclarer Les Halles muette par `check-seances.mjs`. La passe rend donc
`seen` — la liste des `internalId` réellement observés — et `graftEvents` ne se prononce que sur
ceux-là :

- séance **vue et marquée** → libellé posé ;
- séance **vue sans libellé** → remise à vide (l'événement a quitté la programmation) ;
- séance **non vue** → intouchée. Elle garde ce qu'elle avait, faute de savoir.

Conséquence assumée : des événements seront manqués. Le montage est bâti pour ne jamais se tromper
dans l'autre sens — un événement manqué est un badge en moins, un faux badge envoie quelqu'un à une
séance qui n'existe pas.

Le payload mis en cache est donc `{ events, seen, previews }` : les libellés, la preuve de ce qu'on a
vu, et le drapeau d'avant-première. `graftEvents` pose `events` **et** `isPreview` sur les seules
séances vues.

### La rubrique « Événements à venir » : le cas que tout le reste manquait

⚠️ **Une avant-première a lieu *avant* la sortie.** Le film n'est donc pas « en salle », et rien ne le
regardait : `useInTheatersSync` filtre sur `release_date <= aujourd'hui`, le rail sur
`state === 'inTheaters'`. *Fjord* le 14/08/2026 — sortie le 19, avant-premières les 16, 17 et 18 — était
invisible de bout en bout, alors que c'est **exactement** la séance qu'on ne veut pas manquer, puisqu'
elle ne se rattrape pas.

D'où `useUpcomingEvents`, un balayage hebdomadaire des films **à venir** (cinéma, pas vus, sortie dans
les 21 jours). Il coûte peu, parce qu'il ne sonde presque rien :

1. **Une requête par film**, sur aujourd'hui. On ne veut que `nextDate` — Allociné le livre justement
   quand le film n'a aucune séance à la date demandée, ce qui est le cas normal d'un film à venir.
2. `nextDate` dans l'horizon **et avant la sortie** → c'est une avant-première. Les autres films sortent
   du cache mémoire sans rien coûter de plus.
3. On sonde alors les journées de `nextDate` jusqu'à la veille de la sortie (bornées à 3). ⚠️ On les
   **énumère** : `nextDate` n'existe que sur une journée *vide*, donc dès qu'on atterrit sur un jour qui
   a des séances il vaut `null` et il n'y a plus de piste à suivre.
4. La passe salle tourne sur ces journées pour le libellé exact.

Mesuré sur *Fjord* : **4 requêtes** à l'endpoint film pour les trois journées, plus la passe salle.

> **Le repli qui rend la rubrique fiable.** Une séance antérieure à la sortie **est** une
> avant-première — c'est une tautologie, pas une heuristique. Quand la passe salle ne rend rien pour une
> journée (elle est creuse, cf. plus haut), on nomme quand même l'événement à partir des dates. C'est ce
> qui empêche la rubrique de dépendre du point faible de la chaîne : la date, elle, est certaine.

Le tri est par **imminence** et l'affichage dit « auj. » / « demain » / « lun. 17 août » — un
« 17 AOÛ » demanderait de compter. Les films de la rubrique sont **retirés** de « Au ciné en ce
moment » (cf. `cinemaNow`) : les lire deux fois au même endroit de l'écran n'apporte rien, et la version
datée est strictement plus informative.

⚠️ Le rail ne montre que **le prochain** événement par film, et annonce le reste (« +2 autres dates »).
26,4 rem de large ne portent pas cinq lignes datées lisiblement — un rail qui essaie de tout dire ne dit
plus rien. La liste complète vit sur la page dédiée, vers laquelle l'en-tête de la rubrique renvoie.

### La page `/evenements`

Quatrième onglet, à côté de Timeline / Stats / Séances. Un film par carte, ses journées d'événement
listées dedans, triées par imminence — la forme qu'a aussi retenue paris-cine.info, et la seule qui
tienne quand un film a trois avant-premières dans trois salles différentes. La sortie du film est
rappelée (« Sortie le 19 août ») : c'est ce qui explique *pourquoi* la séance est un événement.

> ⚠️ **Le passage à quatre onglets a forcé l'en-tête mobile en icône seule.** Mesuré sur 375 px : après
> paddings et gaps il reste ~57 px de texte par onglet, et « Événements » en demande ~10 caractères. Le
> nom ne disparaît pas pour autant — il vit dans `aria-label` et `title`. Le rail desktop, lui, garde
> ses libellés (il empile).

**C'est le seul endroit qui balaie les 7 journées.** Les deux contrôles hebdomadaires ne regardent
qu'une journée chacun : `useInTheatersSync` aujourd'hui, `useUpcomingEvents` les jours d'avant-première
d'un film à venir. Un film déjà à l'affiche qui a un ciné-club samedi n'était donc repéré que si on
ouvrait le samedi dans la vue Séances. Cette page a précisément pour objet de ne rien manquer sur la
semaine, donc le balayage complet s'y justifie — et nulle part ailleurs.

**Qui est balayé.** Les films `inTheaters`, plus les **sorties de la semaine ciné encore `unseen`**
(`isFreshRelease`, `shared/utils/seanceScope.js`). Ce second lot bouchait un trou franc : l'état ne
bascule qu'au contrôle hebdomadaire, qui ne regarde que la journée d'aujourd'hui, si bien qu'un film
sorti mercredi et resté `unseen` — relevé raté, retrait sur horizon vide, hoquet Allociné — traversait
la semaine sans que ses six autres journées soient regardées **par personne** : `useUpcomingEvents`
s'arrête à la sortie, le balayage ne prenait que les `inTheaters`. La règle est bornée des deux côtés,
et c'est tout son intérêt : avant le mercredi c'est l'affaire du contrôle hebdomadaire, après aujourd'hui
celle de `useUpcomingEvents`, qui sait le faire en une requête par film là où le balayage en coûte sept.
Elle est partagée avec le préchauffage (`scopeFilms` dans `warm.js`), sinon le visiteur repaierait les
sept journées de ces films-là.

Coût à froid : 7 journées × (~12 films + ~25 salles), soit l'équivalent exact de cliquer les sept jours
de la vue Séances. Le cache L2 le rend gratuit ensuite (même règle de fraîcheur), et un retour sur
l'onglet le même jour ne rebalaie pas. Le relevé est **séquentiel**, hors du chemin d'affichage, et la
page se remplit au fur et à mesure en annonçant son avancement (« 3/7 journées ») — un écran vide
pendant une minute se lirait comme « aucun événement », ce qui serait faux.

Gate hebdomadaire porté par `events_checked_at`, que `syncEvents({ stamp: true })` réécrit à chaque
passage — **y compris quand il n'a rien trouvé**. Sans cette trace, le balayage repartirait à chaque
chargement de l'app pour tous les films à venir.

#### La pastille ne dit pas « Avant-première » cinq fois de suite

Le vocabulaire d'Allociné tient en deux entrées. Rendu tel quel, il donne une page où **chaque** ligne
porte la même pastille : vrai, et sans aucun intérêt — ce qu'on vient lire, c'est ce que cette
séance-là a de particulier, et ça vit chez l'exploitant. `eventChips` (`app/utils/seanceEvents.js`,
testé) arbitre entre les deux formes que prend ce texte :

- **un libellé** (≤ 48 caractères, pas de phrase) — « Avant-première avec équipe ». C'est le mot
  d'Allociné en plus précis : il le **remplace** dans la pastille, et la pastille devient le lien vers
  la fiche de la salle. Le libellé d'Allociné qu'il contient déjà disparaît (comparaison accents et
  ponctuation dépliés), sinon la même chose se lit deux fois ;
- **une phrase** — « La séance sera présentée par le réalisateur Cristian Mungiu. » Elle ne tient pas
  dans une pastille : celle d'Allociné reste, la phrase se lit dessous en toutes lettres.

> ⚠️ **La page travaille sur les entrées brutes, pas sur `groupEventsByDay`.** Le texte d'exploitant est
> attaché à une **salle**, et le regroupement par journée n'en garde qu'un (le premier). Une
> avant-première dans trois UGC affichait donc la précision de l'un des trois sur la ligne des trois, et
> taisait celle des autres. D'où une ligne par couple (journée, salle) : la journée se répète, chaque
> salle porte sa pastille. Le rail, lui, continue de regrouper — il n'a la place que d'un compteur.

Le menu « Type » propose **exactement ce que les pastilles montrent** — `entryKinds`, dérivée de
`eventChips`. Filtrer sur les seuls libellés d'Allociné laissait un tag « Avant-première avec équipe »
visible sur une ligne et introuvable dans le menu.

Deux règles tiennent la cohérence :

- **union et pas substitution** — quand le mot de l'exploitant absorbe celui d'Allociné dans la
  pastille, la famille reste filtrable. Trié alphabétiquement, le menu se lit alors en hiérarchie :
  « Avant-première », puis « Avant-première avec équipe » juste dessous ;
- **la phrase rédigée n'est pas un type** — elle décrit une séance au lieu de la qualifier, et ferait
  autant de filtres que de séances. Elle reste en note sous les pastilles.

Le dédoublonnage se fait sur la forme repliée, et la forme accentuée d'Allociné gagne. Côté barre, le
libellé du bouton est tronqué : un type d'exploitant monte à 48 caractères (`CHIP_MAX`). Un type peut
aussi **disparaître** d'un relevé à l'autre quand un connecteur échoue — la page retombe alors sur
« tous » plutôt que de filtrer sur une valeur qui n'existe plus.

### Le rail a besoin de colonnes, la vue non

La vue Séances marque ses chips directement depuis le payload. Le rail, lui, vit sur la timeline, qui
**ne lit que Supabase** et ne sort jamais sur le réseau (règle posée par
`README-persist-movie-metadata`). Un badge calculé sur le cache mémoire de la vue Séances
n'apparaîtrait donc qu'après un passage par la vue Séances — jamais au moment où il sert, puisque
c'est lui qui doit y envoyer. D'où `calendar.event_labels` + `events_checked_at`, écrits par
`useSeanceEvents` depuis les journées déjà chargées, sans une requête réseau de plus.

Les entrées sont **datées** : `[{ date, cinema, labels }]`, un couple (jour, salle). C'est ce qui permet
de trier par imminence et d'écrire « demain » — un simple tableau de libellés ne disait pas s'il fallait
y aller ce soir ou samedi.

Trois règles s'y jouent :

- **Union, jamais remplacement.** Chaque passage ne voit que les journées chargées — souvent une seule.
  Remplacer ferait clignoter la rubrique au rythme de la navigation : l'avant-première repérée samedi
  disparaîtrait en revenant sur aujourd'hui, puis reviendrait. Seules les journées **relues** voient
  leurs entrées remplacées, ce qui laisse un événement déprogrammé disparaître.
- **Élagage par la date.** Une entrée dont le jour est passé sort d'elle-même, sans dépendre d'aucun
  horodatage. Plus juste que l'ancienne borne à la semaine ciné : un événement de mardi ne survit plus
  jusqu'au mercredi suivant.
- **Élagage par l'horodatage.** `events_checked_at` antérieur au dernier mercredi → entrées ignorées à
  la lecture, même si leurs dates sont futures : un relevé d'avant le renouvellement des grilles ne dit
  plus rien de la programmation. Les deux gardes ne disent pas la même chose et il faut les deux.

Le rail vérifie enfin que le film n'est pas déjà vu (`hasUpcomingEvent`). Cette condition n'est **pas**
redondante : la rubrique contient désormais des films qui ne sont pas `inTheaters` du tout, donc rien ne
garantit plus que l'état exclue `'seen'`.

### Le paradoxe de l'avant-première, et ce qu'on en fait

Une avant-première est **hors carte UGC** (`isCardEligible`), et le pré-filtre carte est actif par
défaut. C'est donc l'événement le plus fréquent — 5 des 6 relevés — qui est **masqué à l'arrivée sur la
page**. Sur *Fjord*, les trois séances marquées sont écartées par le filtre.

On ne bricole pas le filtre pour autant : ce serait mentir sur ce que la carte paie. Mais on ne peut pas
non plus laisser le badge du rail promettre un événement et la page rester muette sur son absence. D'où
`hiddenEvents`, et son bandeau :

> *3 séances événement hors carte UGC (une avant-première n'est pas couverte) — masquées par le
> pré-filtre.* **[Ouvrir à tout Paris]**

C'est la règle générale de la vue appliquée à un cas de plus : rien ne disparaît en silence.
`hiddenByCard` compte les séances, `hiddenByTime` celles hors créneau, `hiddenEvents` les événements —
même chaîne de filtres (`countMatching` avec un prédicat), donc aucun risque de divergence.

⚠️ Ce test n'était **inerte** que faute de donnée : l'endpoint de production ne livrant pas `isPreview`,
rien ne pouvait l'exclure. Depuis la seconde passe, il mord — et seulement sur les séances qu'elle a
vues.

## Barre de filtres : la plage horaire à la place de VO/VF et de l'arrondissement

Trois contrôles seulement — regroupement, **heures**, pré-filtre carte.

La version (VO/VF) et l'arrondissement ont été retirés : la version se lit déjà sur **chaque** chip
d'horaire (`VOST` / `VF`), l'arrondissement sur chaque ligne de salle, et le tri remonte de toute
façon les salles proches en premier. Filtrer sur une information déjà visible partout coûtait deux
contrôles pour rien. À l'inverse, la vraie contrainte quand on cherche une séance — *à quelle heure
suis-je libre ?* — n'était filtrable nulle part.

Le menu « Heures » propose **Toutes**, **Matin** (8h–12h), **Après-midi** (12h–18h), **Soir**
(18h–00h) et une plage libre (« Choisir plage… ») réglée au double-curseur, de 08:00 à 24:00 par pas
de 30 minutes. Le bouton fermé affiche le créneau, ou la plage elle-même (« 14:00 – 20:00 ») :
écrire « Personnalisé » obligerait à rouvrir la popin pour savoir ce qu'on filtre.

Quatre décisions dans `app/utils/seancesGrouping.js`, toutes couvertes par `npm test` :

- **Tout se compte en minutes depuis minuit.** Un entier se compare, s'interpole (le curseur) et se
  teste sans fuseau, contrairement à une `Date`.
- **Borne basse incluse, borne haute exclue.** 12:00 appartient à « Après-midi » et pas au matin —
  sinon une séance de midi serait comptée dans les deux selon le filtre choisi.
- **Les séances d'après minuit appartiennent à la soirée.** Allociné rattache un « 00:20 » au jour de
  la *soirée*, pas au lendemain. Comparé brut, il tomberait dans le petit matin et sortirait de
  « Soir » — donc on le projette au-delà de minuit (00:20 → 1460 min), et une borne haute posée sur
  minuit se lit « jusqu'à la fin de la soirée » plutôt que « strictement avant 24:00 ». Sans ça,
  filtrer le soir perdait justement les séances les plus tardives.
- **Les trois créneaux nommés partitionnent la journée entière.** « Matin » part techniquement de
  **minuit** alors que son libellé annonce 8 h : avec une borne à 8 h, une séance à 07:30 ne tombait
  dans aucun créneau et ne réapparaissait que sous « Toutes ». Un test balaie neuf horaires (00:10 →
  23:50) et vérifie que chacun tombe dans **exactement un** créneau.

Un horaire illisible est **gardé**, jamais écarté : faire disparaître une séance qui existe sur une
donnée qu'on n'a pas su lire est le contraire de ce que fait un filtre. Symétriquement, la plage
libre est la seule entrée de forme libre de la chaîne (elle survit en `useState` à la navigation) :
elle est donc validée au seuil par `sanitizeRange` — inversée, vide, `NaN` ou hors journée, elle est
refusée plutôt qu'appliquée. Un `NaN` non filtré aurait désactivé le filtre en silence, un couple
inversé aurait vidé la page sans explication.

Les décomptes « ce que le filtre masque » passent par `countMatching` et non par
`countShowtimes(applyFilters(…))` : même réponse (un test le vérifie sur quatre combinaisons de
filtres), sans reconstruire une entrée ni allouer un tableau d'horaires par salle pour n'en garder
qu'un entier.

Côté popin : le focus entre sur la première poignée à l'ouverture, tourne en rond dans la modale au
Tab, revient sur le bouton « Heures » à la fermeture, et le scroll de l'arrière-plan est gelé le
temps de l'ouverture. Sans ça, `aria-modal` mentait — le bouton d'origine est démonté avec le menu,
donc le focus retombait sur `<body>`. Les poignées font 28 px dans une bande de 44 px : la cible
tactile tient sur l'axe vertical, celui où le doigt rate. Et la piste dessinée est calée sur le
trajet réel du centre de la poignée (`largeur − poignée`), sinon le remplissage et les repères se
décalent d'une demi-poignée aux extrémités.

Comme pour le pré-filtre carte, une journée vidée par le créneau a son propre message et sa propre
porte de sortie (`hiddenByTime` → « Voir toutes les heures »). Sans ce décompte, une journée pleine
mais hors créneau afficherait « aucune séance ce jour-là », suivi d'un « prochaine séance le … »
franchement faux : il y en a une, on a simplement demandé à ne pas la voir.

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
app/pages/seances.vue              vue + 7 états non-heureux
app/components/seances/            DayStrip · SeanceFilters · SeanceGroup · TimeChip
app/composables/useSeances.js      état, chargement et dérivés de la page
app/composables/useShowtimes.js    résolution + chargement d'une journée + cache L1 (partagés)
app/composables/useInTheatersSync.js  contrôle hebdomadaire de l'état « En salle »
app/utils/seancesGrouping.js       filtres, tri, regroupements — fonctions PURES, donc testables
app/utils/seancesSnapshot.js       élagage + datation de l'instantané L0 — PURES aussi
app/utils/maps.js                  itinéraire vers une salle (Plans / Google Maps)
app/utils/travel.js                mise en forme du temps de trajet
shared/utils/cineWeek.js           semaine ciné — source unique app + serveur + scripts

server/api/allocine/resolve.js     titre TMDB → allocine_id (recherche interne Allociné, cache 12 h)
server/api/allocine/showtimes.js   lecture GROUPÉE du cache — ne sort jamais sur le réseau
server/api/allocine/refresh.js     rafraîchit UN (film, date) à la demande du navigateur
server/api/cron/warm.js            préchauffage planifié — même cœur, sans visiteur qui attend
server/utils/refreshShowtimes.js   LE cycle qui sort chez Allociné, partagé par les deux ci-dessus
server/utils/allocine.js           SOURCE UNIQUE de vérité du format Allociné
server/utils/showtimesFreshness.js règle de fraîcheur partagée par les routes et le cron
server/utils/promisePool.js        copie serveur du pool de concurrence

.github/workflows/warm-showtimes.yml  les deux cadences du préchauffage

scripts/test-seances-rules.mjs     354 tests des règles pures →  npm test
scripts/check-seances.mjs          contrôle de santé          →  npm run check:seances
scripts/spikes/cinefil.mjs          mesure de la seconde source (cf. plus bas)
```

### Les règles pures sont testées

```bash
npm test        # 354 assertions, aucune dépendance réseau ni base, < 1 s
```

Dix familles, toutes importées **du code réel** (aucune copie) — la liste à jour vit en tête de
`scripts/test-seances-rules.mjs`. Les dernières arrivées : la fraîcheur anticipée du préchauffage
(`isShowtimesFresh` avec son horizon) et l'instantané persistant (`pruneSnapshot`,
`relevePourAffichage`).

⚠️ `showtimesFreshness.js` lit `isoDay` / `lastWednesday` comme des **globales** — c'est l'auto-import
Nitro de `shared/utils/`. Ne pas « corriger » ça par un import relatif : Nitro le résout depuis son
bundle et non depuis la source, ce qui casse *toutes* les routes serveur d'un coup. Le script de test
pose les deux sur `globalThis`, exactement comme Nitro.

Pourquoi celles-là et pas d'autres : elles sont **pures** — donc triviales à tester — et leurs
erreurs sont **silencieuses**. Un cache qui perd une salle, un film qui reste « en salle » de trop,
un mercredi mal calculé, un filtre carte qui laisse passer une séance IMAX : rien de tout cela ne
lève d'exception, ça affiche simplement quelque chose de faux. C'est exactement le genre de bug que
ce projet a passé sa journée à traquer à la main.

### Les trois caches

| | Où | Portée | Rôle |
|---|---|---|---|
| **L0** | `localStorage`, clé `seances:snapshot:v1` | entre les visites | la page s'ouvre sur le dernier état connu au lieu d'un écran vide, pendant qu'elle recharge |
| **L1** | `useState` clé `allocineId:date` | la visite | changer de jour puis revenir ne refetch rien (0,6 Mo pour 7 jours) |
| **L2** | table `showtimes_cache` | durable, partagé | survit au cold start Vercel, que le cache mémoire Nitro ne sait pas faire |

### Le L0 s'affiche, il ne décide de rien

Le L1 est une mémoire de **visite** : un F5, un retour depuis Timeline, une reprise d'onglet le
matin, et la page repartait d'un écran vide le temps d'un aller-retour. Le L0 garde un instantané du
L1 dans `localStorage` et l'affiche immédiatement.

Ce n'est **pas un cache de plus** : `fetchMissing` n'établit ce qui manque qu'à partir du L1, donc
tout ce qui vient de l'instantané est rechargé dans la foulée. C'est un stale-while-revalidate.

⚠️ D'où deux accesseurs dans `useShowtimes`, et la distinction n'est pas cosmétique :

| | Lit | Pour |
|---|---|---|
| `payloadFor` | L1 puis L0 | **afficher** — `entries`, `nextDate`, `updatedAt`, `stale` |
| `livePayloadFor` | L1 seul | **décider** — `syncEvents` (écrit `calendar.events`), `syncInTheaters` (fait passer un film à `unseen`), `pruneEmptyHorizon` (retire un film de l'affiche), `useUpcomingEvents` (écrit les avant-premières dérivées), `needsRevalidation` (déclenche du réseau) |

Servir un instantané de la veille à ces trois-là, c'est écrire hier dans la base d'aujourd'hui :
`mergeEventEntries` remplace pour les dates qu'on lui déclare, et `pruneEmptyHorizon` conclurait
« plus aucune séance » sur une lecture périmée que sa corroboration n'a aucun moyen de détecter.
C'est le même appauvrissement silencieux que `carryOverMissing` et `graftEvents` s'interdisent
ailleurs, sous une autre forme.

Ce que l'instantané jette à la relecture (`pruneSnapshot`, testé) : les journées passées, les
relevés d'avant le dernier mercredi, et tout payload qu'on ne sait pas dater — un instantané sans âge
est pire qu'une absence d'instantané, puisque la ligne de provenance ne pourrait plus dire d'où il
sort. Plafond de 160 entrées, les journées proches d'abord : le contrôle « en salle » charge ~91
films d'un coup, et sans plafond il en déposerait un demi-mégaoctet dans le navigateur.

Corollaire dans l'UI : `updatedAt` est **daté** dès que le relevé n'est pas d'aujourd'hui
(« relevé hier à 21:34 », « relevé le 13/08 à 21:34 »). Un `HH:MM` nu se lirait « il y a un
instant » précisément au moment où l'utilisateur a besoin de savoir que ça date.

### Le préchauffage planifié — `/api/cron/warm`

Le TTL est de 2 h (aujourd'hui, demain) et 3 h (au-delà). Un utilisateur qui passe deux ou trois
fois dans la journée tombait donc presque toujours sur un cache expiré, et payait l'aller-retour
Allociné — une quinzaine de sorties réseau — avant de voir quoi que ce soit. La tâche planifiée fait
payer ce coût à un cron plutôt qu'à lui.

⚠️ **Ce n'est pas une invitation à relâcher le TTL.** Préchauffer tous les trois jours n'aurait de
sens qu'en allongeant `FRESH_NEAR` / `FRESH_FAR` d'autant — et c'est exactement le bug documenté en
tête de `showtimesFreshness.js`. La cadence **suit** le TTL, elle ne le remplace pas.

Deux périmètres, deux cadences (`.github/workflows/warm-showtimes.yml`) :

| Périmètre | Journées | Cadence | Pourquoi |
|---|---|---|---|
| `near` | aujourd'hui, demain | toutes les 2 h, 6h→20h UTC | la grille bouge en cours de journée ; personne ne consulte à 4 h du matin |
| `far` | J+2 → J+6 | 2 ×/jour | fenêtre d'ouverture des ventes, qui bouge par à-coups — cinq journées, donc cinq fois le coût |

La route juge la fraîcheur à `maintenant + cadence` (`isShowtimesFresh(fetchedAt, date, at)`) et non
au présent : la question est « cette entrée tiendra-t-elle jusqu'à mon prochain passage ? ». Sans ça,
une entrée écrite par une **visite** 30 minutes avant le cron est jugée fraîche, ignorée, et expire
une heure et demie plus tard — sur le dos du visiteur suivant.

> Conséquence à connaître : la cadence étant calée sur le TTL, `skipped` reste **0 par
> construction**. Ce n'est pas un réglage à corriger, c'est le prix de « le visiteur ne tombe jamais
> sur un cache froid ». Mesuré : `near` = 30 rafraîchissements en ~2,5 s, `far` = 75 en ~4 s.

Deux réglages, une fois :

```
Vercel → Settings → Environments → Production → Environment Variables
    NUXT_CRON_SECRET            secret partagé, généré par `openssl rand -hex 24`
    NUXT_SUPABASE_SECRET_KEY    clé service-role — n'était jusque-là que locale

GitHub → Settings → Secrets and variables → Actions
    onglet Secrets   : CRON_SECRET   même valeur que NUXT_CRON_SECRET
    onglet Variables : SITE_URL      ex. https://cine-calendar.vercel.app
```

⚠️ **Redéployer après avoir posé les variables Vercel** : elles sont injectées dans l'environnement de
la fonction au déploiement, pas à chaud. Tant qu'on n'a pas redéployé, la route répond 503.

⚠️ **Vercel Deployment Protection.** Le projet a « Vercel Authentication » activé : certaines URLs
exigent une session Vercel, qu'un runner GitHub n'a pas. Le mur répond alors une page HTML
d'authentification — donc un 401 **qui ne vient pas de la route**, et qu'on lirait à tort comme un
`CRON_SECRET` erroné. En Standard Protection le domaine de production reste ouvert et il n'y a rien à
faire ; sinon, générer un secret dans *Settings → Deployment Protection → Protection Bypass for
Automation* et le poser dans GitHub sous `VERCEL_AUTOMATION_BYPASS_SECRET`. Le workflow envoie alors
l'en-tête `x-vercel-protection-bypass` ; le secret est **optionnel**, son absence ne change rien.

La clé service-role est nécessaire parce qu'un cron n'a pas de session et que les politiques RLS de
`showtimes_cache` et `cinemas` sont réservées à `authenticated`. Sans `NUXT_CRON_SECRET`, la route
répond 503 : elle sort sur le réseau, elle ne s'ouvre donc pas faute de configuration, elle s'éteint.

⚠️ Deux limites de GitHub Actions : les crons peuvent être décalés de plusieurs minutes aux heures
chargées (sans conséquence, l'horizon de fraîcheur absorbe), et les workflows planifiés sont
**désactivés après 60 jours sans activité** sur le dépôt.

Ce que ça ne couvre pas : la liste des films vient de Supabase à chaque chargement, et cette
requête-là reste. Cache chaud + instantané, le plancher est de ~2 allers-retours Supabase.

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
node scripts/spikes/cinefil.mjs
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

### Canari paris-cine.info (15/08/2026) — le verrou du spike Cinéfil saute, le gain n'est pas où on croyait

```bash
node scripts/spikes/pci.mjs                    # tout (~2 min)
node scripts/spikes/pci.mjs --contract         # 2 requêtes — à relancer chaque jour
node scripts/spikes/pci.mjs --coverage --films=6
```

Lecture seule, aucune écriture, rien de branché. Successeur du spike Cinéfil, qui butait sur le
rapprochement des titres (83 % : « il faudra un mapping par identifiant, pas par chaîne »).

⚠️ **Ce mapping existe.** Le site est du PHP nu servant du JSON à jQuery / FullCalendar / DataTables —
c'est sa page « technologies » qui a mis sur la piste. Deux endpoints en GET, sans session ni jeton
(l'authentification Google n'y sert qu'aux favoris) :

| endpoint | ce qu'il rend |
|---|---|
| `get_movies.php` | l'affiche parisienne — **`id` est l'identifiant Allociné** (188280 → *Fjord*), `i_id` l'IMDb |
| `get_showtimes.php?mov_id=…` | 10 jours de séances en **une** requête — **`tid` est le code salle Allociné**, plus `com` (texte libre), `srcs` (provenance), `screen_name` (n° de salle), `csup` (supplément) |

La jointure est donc une **égalité d'identifiants**, comme celle d'UGC par numéro de séance. Mesuré :
**14/14** de nos films en salle retrouvés, zéro rapprochement de titre. Et `i_id` renseigné sur
400/416 films (96 %) — de quoi résoudre TMDB sans la similarité de titres de `resolve.js`.

**Premier relevé — et il refroidit la piste « seconde source de listes » :**

| mesure | résultat |
|---|---|
| Séances communes (4 films, 7 jours) | 248 |
| **Vues seulement par paris-cine.info** | **0** |
| Vues seulement par Allociné | 8 (3 %, sur un film à 239 séances) |
| Provenances `srcs` | `AO` 1468 · `AB` 48 — **aucune sans Allociné** |

La lacune du 13/08 reste donc **accidentelle**, pas structurelle : ce jour-là, ce site n'aurait rien
apporté de plus. C'est exactement ce que le canari devait trancher, et il tranche dans le sens qui
évite un chantier. À reconduire quelques jours : c'est la **récurrence** qui ferait la différence.

**Le gain est ailleurs — les libellés, et dans les salles qu'on ne couvre pas :**

```
10 libellés sur 1492 séances (18 films)
   2 en salle déjà couverte : MK2 Bibliothèque, UGC Les Halles (Fjord)
   8 en salle qu'AUCUN connecteur ne couvre :
       Le Louxor    — « présenté par l'équipe du film »
       L'Entrepôt   — « Ciné-bébé » (×5, deux journées)
```

Soit **80 % de gain net** : Le Louxor et L'Entrepôt sont nommément dans la liste des salles que le
README dit demander « chacune son connecteur ». Et « Ciné-bébé » n'existe dans aucun vocabulaire
Allociné — c'est un événement que rien, aujourd'hui, ne peut nous faire voir.

⚠️ Le contrôle balaie les films **en salle et à venir** (21 j, même population que `useUpcomingEvents`).
Restreint à l'affiche, il ratait les deux libellés de *Fjord* — une avant-première précède la sortie,
donc son film n'est jamais `inTheaters`. Piège attrapé au premier run.

**Ce que le canari ne dit pas, et qu'aucun code ne dira.** Le `robots.txt` ne pose aucune directive
(vérifié : seul le bloc « content signals » par défaut de Cloudflare), mais l'agrégation
multi-exploitants **est** le travail de l'auteur, pas une donnée qu'il relaierait comme Allociné.
Le script se déclare dans son User-Agent, mémoïse tout et espace ses requêtes ; brancher quoi que ce
soit en production sans lui avoir écrit est un autre débat, et il ne se tranche pas dans un script.

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
| ~~**`isPreview` n'existe pas**~~ | **Résolu le 14/08/2026, et le diagnostic d'origine était mal cadré.** Le champ existe chez Allociné — mais seulement sur l'endpoint *par salle*, jamais sur l'endpoint *par film* qu'utilise la production (même séance, même `internalId`, jeu de champs différent). Ce n'était donc pas « le payload ne porte rien », c'était « cette route ne le sélectionne pas ». La seconde passe par salle le récupère, `graftEvents` le pose, et l'exclusion des avant-premières du filtre carte **mord désormais** — cf. « Séances événement ». |
| **Les libellés d'événement sont pauvres hors Dulac** | Allociné n'a **aucun** texte libre (2 293 séances JSON, pages `salle_gen_csalle=` et `/seance/film-`). Enquête du 14/08/2026 : paris-cine.info le sert dans le champ `com` de son `get_showtimes.php`, avec `srcs: "AO"` ou `"AB"` — **deux** sources d'une lettre chacune (son UI affiche « vérifié par 2 sources »), donc un connecteur par exploitant. **Dulac est branché** (5 salles, JSON-LD, cf. « Le texte libre »). Les autres gardent « Avant-première ». ⚠️ **Correction au Step 13** : `mk2.com/robots.txt` dit `Allow: /` et n'interdit que `/panier`, `/mon-compte`, `/_next/static` — sa page salle est donc autorisée, contrairement à ce qui avait été conclu. C'est UGC qui ferme la porte (`/AjaxAction!`). MK2 est le prochain candidat le plus accessible. |
| **La détection d'événement est partielle** | L'endpoint par salle est creux : les événements des journées qu'il ne rend pas ne sont pas vus. Le montage ne se trompe jamais dans l'autre sens (aucun faux marqueur), mais il en manquera. |
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
