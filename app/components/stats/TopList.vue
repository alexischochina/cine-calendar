<script setup>
// Bloc « Top genres » ou « Top pays » : liste classée en barres, chaque ligne est un
// accordéon qui déplie les films concernés (jusqu'à 5 visibles, reste en scroll).
// Un seul panneau ouvert à la fois, piloté par le parent (openId) — partagé entre les
// deux listes pour n'en avoir qu'un d'ouvert tous blocs confondus.
const props = defineProps({
    label: { type: String, required: true },
    kind: { type: String, required: true },      // 'genre' | 'country' — namespace de l'id
    items: { type: Array, default: () => [] },     // [{ label, count, movies }]
    color: { type: String, required: true },       // couleur barre + filet du panneau
    emptyText: { type: String, default: '' },
    openId: { type: [String, null], default: null },
});

const emit = defineEmits(['toggle']);

const max = computed(() => Math.max(1, ...props.items.map(i => i.count)));
const pct = (n) => Math.round((n / max.value) * 100);

const statId = (label) => `${props.kind}:${label}`;
const isOpen = (label) => props.openId === statId(label);
// Id DOM sûr (labels avec espaces/apostrophes : « Corée du Sud ») pour relier
// bouton (aria-controls) et panneau déplié (id).
const panelId = (label) => `stat-${props.kind}-${label.replace(/[^\w-]+/g, '-')}`;

// Vignette poster depuis le CDN TMDB : uniquement pour un chemin TMDB valide (« /abc.jpg »),
// sinon placeholder (pas d'URL forgée à partir d'une valeur DB inattendue).
const posterUrl = (path) => /^\/[\w./-]+$/.test(path || '') ? `https://image.tmdb.org/t/p/w92${path}` : null;
</script>

<template>
    <section class="card -top">
        <div class="label">{{ label }}</div>
        <ul v-if="items.length" class="ranks">
            <li v-for="it in items" :key="it.label" class="rank" :class="{ '-open': isOpen(it.label) }">
                <button type="button" class="row" :aria-expanded="isOpen(it.label)"
                        :aria-controls="panelId(it.label)" @click="emit('toggle', statId(it.label))">
                    <span class="name">{{ it.label }}</span>
                    <span class="bar"><span class="fill" :style="{ width: pct(it.count) + '%', background: color }" /></span>
                    <span class="val">{{ it.count }}</span>
                    <span class="chevron" aria-hidden="true"><Svg name="chevron" /></span>
                </button>
                <ul v-if="isOpen(it.label)" :id="panelId(it.label)" class="films" :style="{ borderColor: color }">
                    <li v-for="f in it.movies" :key="f.id" class="film">
                        <NuxtImg v-if="posterUrl(f.poster_path)" :src="posterUrl(f.poster_path)"
                                 :alt="f.title ? `Affiche du film ${f.title}` : ''" class="mini" loading="lazy" />
                        <span v-else class="mini -placeholder" />
                        <span class="ftitle">{{ f.title }}</span>
                    </li>
                </ul>
            </li>
        </ul>
        <div v-else class="none">{{ emptyText }}</div>
    </section>
</template>

<style lang="scss" scoped>
.card {
    grid-column: span 2;
    background: $color-surface-1;
    border: 1px solid $color-border-2;
    border-radius: 1.6rem;
    padding: 2rem;
}

.label {
    color: $color-text-weak;
    font: $bold 1.1rem/1 $font-body;
    letter-spacing: .12rem;
    text-transform: uppercase;
    margin-bottom: 1.2rem;
}

.ranks {
    display: flex;
    flex-direction: column;
    gap: 1rem;

    // En-tête cliquable de la ligne : label · barre · compteur · chevron.
    > .rank > .row {
        display: grid;
        grid-template-columns: 9rem 1fr auto 1.4rem;
        align-items: center;
        gap: 1rem;
        width: 100%;
        padding: .4rem .6rem;
        margin: -.4rem -.6rem;
        background: none;
        border: 0;
        border-radius: .9rem;
        cursor: pointer;
        text-align: left;
        transition: background .18s ease;

        > .name {
            color: $color-text-dim;
            font: $medium 1.3rem/1.4 $font-body; // /1.4 : ne pas rogner les jambages (g, y, j)
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        > .bar {
            height: 1.2rem;
            background: $color-surface-4;
            border-radius: .6rem;
            overflow: hidden;

            > .fill {
                display: block;
                height: 100%;
                border-radius: .6rem;
                transition: width .3s ease;
            }
        }

        > .val {
            color: $color-text-muted;
            font: $bold 1.2rem/1 $font-mono;
            font-variant-numeric: tabular-nums;
            text-align: right;
        }

        // chevron d'accordéon : pointe à droite fermé, vers le bas ouvert.
        > .chevron {
            display: grid;
            place-items: center;
            color: $color-text-weak;
            transform: rotate(-90deg);
            transition: transform .18s ease;

            > :deep(svg) { width: 1.3rem; height: 1.3rem; display: block; }
        }
    }

    // État ouvert : ligne surlignée, label et compteur renforcés, chevron redressé.
    > .rank.-open > .row {
        background: rgba(255, 255, 255, .04);

        > .name { color: $color-text; font-weight: $bold; }
        > .val { color: $color-text-body; }
        > .chevron { transform: rotate(0deg); }
    }

    // Panneau déplié : liste des films, filet gauche coloré (couleur passée en prop).
    > .rank > .films {
        display: flex;
        flex-direction: column;
        gap: .7rem;
        margin: .8rem 0 .6rem;
        padding-left: 1.2rem;
        border-left: 2px solid;
        animation: stat-pop .16s ease;

        // ~5 films visibles (5 × 3.6rem + 4 × gap .7rem), le reste en scroll.
        max-height: 20.8rem;
        overflow-y: auto;
        overscroll-behavior: contain;

        > .film {
            display: flex;
            align-items: center;
            gap: 1rem;

            > .mini {
                width: 2.4rem;
                height: 3.6rem;
                flex-shrink: 0;
                border-radius: .4rem;
                object-fit: cover;

                &.-placeholder { background: $color-surface-4; }
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

@keyframes stat-pop {
    from { opacity: 0; transform: translateY(-.3rem); }
    to { opacity: 1; transform: translateY(0); }
}

.none {
    color: $color-text-weak;
    font: $normal 1.3rem/1 $font-body;
}

@media (max-width: 999px) {
    .ranks > .rank > .row { grid-template-columns: 7rem 1fr auto 1.4rem; }
}

@media (max-width: 560px) {
    .card { grid-column: span 1; }
}
</style>
