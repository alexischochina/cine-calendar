# Carte du monde des films vus — page Statistiques

Carte choroplèthe interactive ajoutée en bas de la vue **Stats** (`/` → bascule Stats).
Chaque pays est coloré selon le nombre de films **vus** produits dans ce pays sur l'année
sélectionnée (dégradé de vert séquentiel), gris pour les pays sans film vu.

Plan source : [`plans/2607271500-carte-monde-stats.md`](plans/2607271500-carte-monde-stats.md).

## Ce qui a été fait

| # | Fichier | Rôle |
|---|---------|------|
| Deps | `package.json` | `d3-geo`, `topojson-client`, `world-atlas`, `d3-interpolate` (bundlés en local, pas de CDN runtime) |
| 2 | `app/utils/isoCountries.js` | `iso2ToNumeric` / `numericToIso2` — table ISO 3166-1 alpha-2 ↔ numérique (auto-import Nuxt) |
| 3 | `app/composables/useYearStats.js` | computed `countryMap` (`{ [iso2]: { iso, name, numericId, seen, todo, total, movies[] } }`) + `maxSeen` |
| 4 | `app/components/stats/WorldMap.vue` | composant carte (`<StatsWorldMap>`) — rendu SVG déclaratif, survol, sélection, panneau films |
| 5 | `app/components/StatsView.vue` | câblage `<StatsWorldMap>` pleine largeur, en dernière position, dans `<ClientOnly>` |

## Comment ça marche

- **Données** : `calendar.countries` stocke des codes **ISO alpha-2** (source TMDB). Le fichier
  world-atlas (`countries-110m.json`) identifie les pays par leur code **ISO numérique**
  (`feature.id`). `isoCountries.js` fait le pont. Un film multi-pays compte dans chaque pays.
- **Rendu** : au mount **client uniquement**, import dynamique de l'atlas (~105 KB → chunk lazy,
  hors bundle initial), projection `geoNaturalEarth1().fitSize([960,440])` + `geoPath` pour générer
  le `d` de chaque `<path>`. Le fill se recalcule réactivement depuis `countryMap`.
- **Couleurs (fidélité maquette, constantes JS)** :
  - vus : `interpolateRgb('#1e4a33','#4fe89a')(0.25 + 0.75 · seen/maxSeen)`
  - à voir seulement : `#33383f` · aucun film : `#20232c`
  - stroke défaut `$color-bg`, sélection `$color-primary` (SCSS)
- **Interaction** : survol → bulle « Pays · X vus · Y à voir » ; clic sur un pays ayant des films →
  panneau déplié dessous (liste 2 colonnes, pastille verte ciné / orange streaming / gris à voir) ;
  re-clic ou « Fermer » referme ; changement d'année referme le panneau.
- **Prerender-safe** : `<ClientOnly>` + import dynamique → la carto ne tourne jamais en SSR,
  `npm run build` et `npm run generate` passent (route `/` prerendered).

## Vérifications effectuées

- `npm run build` ✓ · `npm run generate` ✓ (7 routes prerendered, aucune ref carto au SSR)
- Mapping ISO validé contre l'atlas (US=840, FR=250, GB=826 ; 3 features atlas sans `id` officiel —
  N. Cyprus, Somaliland, Kosovo — non matchables par nature, rendues en gris « aucun film »)
- Agrégat multi-pays + split seen/todo testé en isolation
- Pipeline de rendu (177 features → `d` valides + dégradé) testé contre l'atlas réel

## Reste à faire (test interactif)

Le test visuel live (survol / clic / responsive) nécessite une session Supabase authentifiée et
des données réelles : `npm run dev` → se connecter → `/` → bascule **Stats** → vérifier la carte
tout en bas.
