<script setup>
// Carte du monde choroplèthe des films de l'année : chaque pays est coloré selon le
// nombre de films VUS produits dans ce pays (dégradé de vert séquentiel — magnitude,
// cf. dataviz), gris pour les pays avec seulement des films à voir, gris foncé sinon.
// Survol → bulle nom FR + « X vus · Y à voir ». Clic → panneau des films sous la carte.
//
// Rendu déclaratif Vue : les `<path>` sont générés une fois au mount client (projection +
// geoPath sur l'atlas), le fill/stroke se recalcule réactivement depuis `countryMap`.
// L'atlas (~100 KB) est chargé en import dynamique → hors chunk initial, jamais en SSR.
import { geoNaturalEarth1, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';
import { interpolateRgb } from 'd3-interpolate';

const props = defineProps({
    // { [iso2]: { iso, name, numericId, seen, todo, total, movies[] } } — cf. useYearStats.
    countryMap: { type: Object, default: () => ({}) },
    maxSeen: { type: Number, default: 0 },
});

// Couleurs FONCTIONNELLES de la carte (fidélité maquette) — gardées en constantes JS,
// distinctes du chrome (fond/bordure/titre) porté par les variables SCSS du projet.
const RAMP_LOW = '#1e4a33';   // vus faible
const RAMP_HIGH = '#4fe89a';  // vus élevé
const FILL_TODO = '#33383f';  // le pays n'a que des films à voir
const FILL_NONE = '#20232c';  // aucun film de l'année dans ce pays
// Légende « moins → plus » (swatches).
const LEGEND = ['#20232c', '#1e4a33', '#2a7a4f', '#3ab873', '#4fe89a'];

const ramp = interpolateRgb(RAMP_LOW, RAMP_HIGH);

// Index numericId → agrégat pays, pour relier une `feature` (feature.id numérique) à ses films.
const byNumeric = computed(() => {
    const idx = {};
    for (const bucket of Object.values(props.countryMap)) {
        if (bucket.numericId) idx[bucket.numericId] = bucket;
    }
    return idx;
});

const bucketOf = (path) => byNumeric.value[path.id] || null;

// --- Géométrie : construite une fois au mount (client-only, hors SSR) ---
const paths = shallowRef([]); // [{ id, d, iso, name, cx, cy }]
const failed = ref(false);

let regionNames = null;
const countryName = (iso) => {
    if (!iso) return iso;
    try {
        if (!regionNames) regionNames = new Intl.DisplayNames(['fr'], { type: 'region' });
        return regionNames.of(iso) || iso;
    } catch {
        return iso;
    }
};

onMounted(async () => {
    try {
        const topo = (await import('world-atlas/countries-110m.json')).default;
        const fc = feature(topo, topo.objects.countries);
        const projection = geoNaturalEarth1().fitSize([960, 440], fc);
        const pathGen = geoPath(projection);
        paths.value = fc.features
            .map((f) => {
                const d = pathGen(f);
                if (!d) return null; // pays sans géométrie projetable → ignoré
                const iso = numericToIso2(f.id);
                const [cx, cy] = pathGen.centroid(f); // pour positionner la bulle au focus clavier
                return {
                    id: String(f.id), d, iso,
                    name: iso ? countryName(iso) : f.properties?.name,
                    cx: Number.isFinite(cx) ? cx : 0,
                    cy: Number.isFinite(cy) ? cy : 0,
                };
            })
            .filter(Boolean);
    } catch (e) {
        console.error('Chargement de la carte du monde échoué', e);
        failed.value = true;
    }
});

// Métadonnées de rendu par pays (fill + accessibilité), précalculées : ne dépendent que de
// `countryMap`/`maxSeen`/`paths`, jamais du curseur ni de la sélection. Le survol ne touchant
// qu'à `hovered`/`tipPos`, on évite ainsi de rejouer 177 interpolations de couleur (et le
// calcul des labels ARIA) à chaque `mousemove`. `focusable` = le pays a au moins un film.
const meta = computed(() => {
    const out = {};
    for (const p of paths.value) {
        const b = byNumeric.value[p.id] || null;
        const fill = b && b.seen > 0
            ? ramp(0.25 + 0.75 * (b.seen / Math.max(1, props.maxSeen)))
            : b && b.total > 0 ? FILL_TODO : FILL_NONE;
        out[p.id] = {
            fill,
            focusable: !!b,
            aria: b ? `${p.name} : ${b.seen} vu${b.seen > 1 ? 's' : ''}, ${b.todo} à voir. Entrée pour voir les films.` : null,
        };
    }
    return out;
});

// --- Survol : bulle qui suit la souris dans le conteneur ---
const container = ref(null);
const hovered = ref(null); // { name, seen, todo, hasFilm }
const tipPos = ref({ x: 0, y: 0 });

const onEnter = (path) => {
    const b = bucketOf(path);
    hovered.value = {
        name: path.name,
        seen: b ? b.seen : 0,
        todo: b ? b.todo : 0,
        hasFilm: !!(b && b.total > 0),
    };
};
// Délégation sur le <svg> : la bulle suit le pays réellement sous le curseur, et disparaît
// dès qu'on est sur le fond (océan) — un @mouseleave sur le conteneur ne suffisait pas
// (survoler l'océan reste « dans » le conteneur, donc la bulle restait figée).
const onOver = (e) => {
    const el = e.target;
    if (el?.classList?.contains('country')) {
        const path = paths.value.find(p => p.id === el.dataset.id);
        if (path) onEnter(path);
    } else {
        hovered.value = null;
    }
};
const onMove = (e) => {
    const rect = container.value?.getBoundingClientRect();
    if (rect) tipPos.value = { x: e.clientX - rect.left, y: e.clientY - rect.top };
};
const onLeave = () => { hovered.value = null; };

// Focus clavier d'un pays : même bulle qu'au survol, positionnée sur le centroïde du pays.
// La largeur du <svg> = celle du conteneur (width:100%), viewBox large de 960 → facteur k.
const onFocusCountry = (path) => {
    onEnter(path);
    const k = (container.value?.clientWidth || 0) / 960;
    tipPos.value = { x: path.cx * k, y: path.cy * k };
};

// --- Clic : sélection d'un pays (seulement s'il a des films) + panneau détail ---
const selectedIso = ref(null);
const onSelect = (path) => {
    const b = bucketOf(path);
    if (!b || b.total === 0) return;
    selectedIso.value = selectedIso.value === path.iso ? null : path.iso;
};
const selected = computed(() => (selectedIso.value ? props.countryMap[selectedIso.value] || null : null));
const isSelected = (path) => !!selectedIso.value && path.iso === selectedIso.value;

// Referme le panneau au changement de jeu de données (ex. changement d'année).
watch(() => props.countryMap, () => { selectedIso.value = null; });

// Pastille d'état d'un film : vert ciné-vu · orange streaming-vu · gris à voir.
const dotVariant = (m) => {
    if (m.state !== 'seen') return 'notseen';
    return m.media === 'cinema' ? 'cinema' : 'streaming';
};

// Vignette poster TMDB : uniquement un chemin au format TMDB exact « /<hash>.jpg » (défense
// en profondeur — pas de « .. »/slashs, aucune URL forgée depuis une valeur DB inattendue).
const posterUrl = (path) => /^\/[A-Za-z0-9]+\.(jpg|jpeg|png|webp)$/i.test(path || '') ? `https://image.tmdb.org/t/p/w92${path}` : null;
</script>

<template>
    <section class="stats-worldmap card" aria-label="Carte du monde des films de l'année">
        <div class="head">
            <div class="label">Carte du monde</div>
            <div class="legend" aria-hidden="true">
                <span class="cap">moins</span>
                <span v-for="c in LEGEND" :key="c" class="sw" :style="{ background: c }" />
                <span class="cap">plus</span>
            </div>
        </div>

        <div ref="container" class="map" @mousemove="onMove" @mouseleave="onLeave">
            <p v-if="failed" class="fallback">Carte indisponible.</p>
            <svg v-else viewBox="0 0 960 440" class="atlas" role="group"
                 aria-label="Carte des films par pays de production. Naviguez au clavier entre les pays ayant des films."
                 @mouseover="onOver">
                <path v-for="p in paths" :key="p.id" :d="p.d" class="country" :data-id="p.id"
                      :class="{ '-selected': isSelected(p) }" :style="{ fill: meta[p.id].fill }"
                      :tabindex="meta[p.id].focusable ? 0 : -1"
                      :role="meta[p.id].focusable ? 'button' : null"
                      :aria-hidden="meta[p.id].focusable ? null : 'true'"
                      :aria-pressed="meta[p.id].focusable ? isSelected(p) : null"
                      :aria-label="meta[p.id].aria"
                      @click="onSelect(p)"
                      @focus="onFocusCountry(p)" @blur="onLeave"
                      @keydown.enter="onSelect(p)" @keydown.space.prevent="onSelect(p)" />
            </svg>

            <div v-if="hovered" class="tip" :style="{ left: tipPos.x + 'px', top: tipPos.y + 'px' }">
                <span class="pays">{{ hovered.name }}</span>
                <span v-if="hovered.hasFilm" class="counts">
                    <span class="num -seen">{{ hovered.seen }} vu{{ hovered.seen > 1 ? 's' : '' }}</span>
                    <span class="sep">·</span>
                    <span class="num">{{ hovered.todo }} à voir</span>
                </span>
                <span v-else class="counts"><span class="num -empty">aucun film</span></span>
            </div>
        </div>

        <!-- Panneau détail : films du pays sélectionné -->
        <div v-if="selected" class="panel">
            <div class="phead">
                <span class="pays">{{ selected.name }}</span>
                <span class="counts">{{ selected.seen }} vu{{ selected.seen > 1 ? 's' : '' }} · {{ selected.todo }} à voir</span>
                <button type="button" class="close" @click="selectedIso = null">Fermer</button>
            </div>
            <ul class="films">
                <li v-for="f in selected.movies" :key="f.id" class="film">
                    <NuxtImg v-if="posterUrl(f.poster_path)" :src="posterUrl(f.poster_path)"
                             :alt="f.title ? `Affiche du film ${f.title}` : ''" class="mini" loading="lazy" />
                    <span v-else class="mini -placeholder" />
                    <span class="dot" :class="`-${dotVariant(f)}`" aria-hidden="true" />
                    <span class="ftitle">{{ f.title }}</span>
                </li>
            </ul>
        </div>
    </section>
</template>

<style lang="scss" scoped>
.stats-worldmap {
    background: $color-surface-1;
    border: 1px solid $color-border-2;
    border-radius: 1.6rem;
    padding: 2rem;

    > .head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 1rem;
        margin-bottom: 1.6rem;

        > .label {
            color: $color-text-weak;
            font: $bold 1.1rem/1 $font-body;
            letter-spacing: .12rem;
            text-transform: uppercase;
        }

        > .legend {
            display: flex;
            align-items: center;
            gap: .5rem;

            > .cap {
                color: $color-text-weak;
                font: $medium 1rem/1 $font-mono;
                text-transform: uppercase;
            }

            > .sw {
                width: 1.6rem;
                height: 1rem;
                border-radius: 3px;
            }
        }
    }

    > .map {
        position: relative;

        > .atlas {
            display: block;
            width: 100%;
            height: auto;

            > .country {
                stroke: $color-bg;
                stroke-width: .5;
                stroke-linejoin: round;
                cursor: pointer;
                transition: fill .3s ease, stroke .18s ease;

                &.-selected {
                    stroke: $color-primary;
                    stroke-width: 1.6;
                }

                // Reset global : `outline` supprimé hors classe `.a11y` → indicateur de focus
                // clavier porté par le stroke (rose clair, distinct de la sélection pleine).
                &:focus-visible {
                    stroke: $color-primary-light;
                    stroke-width: 1.6;
                }
            }
        }

        > .fallback {
            padding: 6rem 2rem;
            text-align: center;
            color: $color-text-weak;
            font: $normal 1.4rem/1 $font-body;
        }

        // Bulle de survol — positionnée dans le conteneur, décalée du curseur.
        // Deux lignes : nom du pays, puis compteurs (« vus » en vert · « à voir » atténué).
        > .tip {
            position: absolute;
            z-index: 10;
            transform: translate(1.2rem, 1.2rem);
            pointer-events: none;
            display: flex;
            flex-direction: column;
            gap: .6rem;
            background: rgba($color-surface-1, .92);
            border: 1px solid rgba($color-white, .08);
            border-radius: 1.4rem;
            padding: 1.2rem 1.6rem;
            box-shadow: 0 12px 32px rgba(0, 0, 0, .55);
            -webkit-backdrop-filter: blur(8px);
            backdrop-filter: blur(8px);
            white-space: nowrap;

            > .pays {
                color: $color-text;
                font: $bold 1.5rem/1 $font-body;
            }

            > .counts {
                display: flex;
                align-items: baseline;
                gap: .6rem;

                > .sep { color: $color-text-weak; }

                > .num {
                    color: $color-text-muted;
                    font: $medium 1.4rem/1 $font-body;
                    font-variant-numeric: tabular-nums;

                    &.-seen { color: $color-green; }
                    &.-empty { color: $color-text-muted; }
                }
            }
        }
    }

    > .panel {
        margin-top: 1.6rem;
        padding-top: 1.6rem;
        border-top: 1px solid $color-border-2;
        animation: worldmap-pop .16s ease;

        > .phead {
            display: flex;
            align-items: baseline;
            gap: 1rem;
            margin-bottom: 1.2rem;

            > .pays {
                color: $color-text;
                font: $bold 1.6rem/1 $font-title;
            }

            > .counts {
                color: $color-text-muted;
                font: $medium 1.2rem/1 $font-mono;
                font-variant-numeric: tabular-nums;
            }

            > .close {
                margin-left: auto;
                color: $color-primary-light;
                font: $medium 1.2rem/1 $font-body;
            }
        }

        // Liste des films en 2 colonnes (comme la maquette 1fr 1fr).
        > .films {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: .8rem 2rem;
            max-height: 28rem;
            overflow-y: auto;
            overscroll-behavior: contain;

            > .film {
                display: flex;
                align-items: center;
                gap: 1rem;
                min-width: 0;

                > .mini {
                    width: 2.4rem;
                    height: 3.6rem;
                    flex-shrink: 0;
                    border-radius: .4rem;
                    object-fit: cover;

                    &.-placeholder { background: $color-surface-4; }
                }

                > .dot {
                    width: 1rem;
                    height: 1rem;
                    flex-shrink: 0;
                    border-radius: 3px;

                    &.-cinema { background: $color-green; }
                    &.-streaming { background: $color-yellow; }
                    &.-notseen { background: $color-status-grey; }
                }

                > .ftitle {
                    min-width: 0;
                    color: $color-text-body;
                    font: $medium 1.25rem/1.4 $font-body;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }
            }
        }
    }
}

@keyframes worldmap-pop {
    from { opacity: 0; transform: translateY(-.3rem); }
    to { opacity: 1; transform: translateY(0); }
}

@media (max-width: 560px) {
    .stats-worldmap > .panel > .films { grid-template-columns: 1fr; }
}
</style>
