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


## Architecture

```
app/pages/seances.vue              vue + 6 états non-heureux
app/components/seances/            DayStrip · SeanceFilters · SeanceGroup · TimeChip
app/composables/useSeances.js      TOUT l'état et la logique métier (les .vue ne font que rendre)
app/utils/travel.js                mise en forme du temps de trajet

server/api/allocine/resolve.js     titre TMDB → allocine_id (recherche interne Allociné, cache 12 h)
server/api/allocine/showtimes.js   lecture GROUPÉE du cache — ne sort jamais sur le réseau
server/api/allocine/refresh.js     rafraîchit UN (film, date) — la seule route qui appelle Allociné
server/utils/allocine.js           SOURCE UNIQUE de vérité du format Allociné
server/utils/showtimesFreshness.js règle de fraîcheur partagée par les deux routes
server/utils/promisePool.js        copie serveur du pool de concurrence
```

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

TTL : ~2 h pour aujourd'hui/demain, ~12 h au-delà, **+ invalidation forcée le mercredi** (jour où
les salles renouvellent leur programmation). Une journée sans séance est mise en cache comme les
autres — sinon on retaperait Allociné à chaque affichage.

Les filtres (jour mis à part), le regroupement et le toggle carte sont **purement dérivés** : en
changer ne déclenche jamais de requête.

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

`2608121539-seed-cinemas-ugc.sql` marque **33 salles sur 48**, liste validée le 12/08/2026 :
11 UGC, 10 MK2, 6 CIP, 6 divers (Grand Rex, Louxor, Elysées Lincoln, Cinq Caumartin, Sept
Parnassiens, Chaplin Saint Lambert). Les 15 « non » sont essentiellement le circuit Pathé, qui a sa
propre carte. Point de départ : le champ `loyaltyCards` d'Allociné, repris uniquement pour ne pas
partir d'une page blanche.

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
| **Contrat interne non garanti** | Allociné peut renommer la route ou changer la forme du JSON. Toute la connaissance du format est confinée à `server/utils/allocine.js` ; un échec donne `{ theaters: [] }` + message, **jamais** de 500. |
| **`state === 'inTheaters'` est collant** | Un film flaggé le reste même sorti des salles : il apparaît alors sans séance. Pas faux, juste bruyant. |
| **Distance à vol d'oiseau** | Pas de temps de trajet réel (exigerait une API de routage et une clé). Salle non géocodée → rien ne s'affiche, jamais de position approximée (les scores BAN < 0,5 sont rejetés). |

## Phase 2 — double-check « point vert » : spike conclu (12/08/2026)

Piste retenue : vérifier la vivacité du lien de billetterie qu'Allociné nous donne déjà, sans
rétro-ingénierer le moindre endpoint interne. Verdict : **on fait, mais UGC seulement.**

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
