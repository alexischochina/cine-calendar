<script setup>
// Barre de filtres : regroupement, plage horaire, et le pré-filtre carte UGC.
// Purement présentationnel — tous les filtres sont dérivés côté `useSeances`, en changer ne
// déclenche jamais de requête.
//
// Ni version ni arrondissement : la première se lit sur chaque chip d'horaire, le second sur chaque
// ligne de salle. L'heure — la vraie contrainte quand on cherche une séance — est la seule à mériter
// un filtre.
import { onClickOutside } from '@vueuse/core';

const props = defineProps({
    group: { type: String, default: 'film' },
    timeSlot: { type: String, default: 'all' },
    customRange: { type: Array, default: null },
    ugcOnly: { type: Boolean, default: true },
});

const emit = defineEmits(['update:group', 'update:timeSlot', 'update:customRange', 'update:ugcOnly']);

const GROUPS = [{ value: 'film', label: 'Par film' }, { value: 'cinema', label: 'Par cinéma' }];

// Bornes, créneaux et formatage viennent de `utils/seancesGrouping.js`, la même source que le
// filtrage lui-même. ⚠️ Reliés à des bindings locaux : un auto-import Nuxt utilisé **uniquement**
// dans le template n'est pas résolu par le compilateur de SFC (il le prend pour une propriété
// d'instance et rend `undefined`).
const SLOTS = TIME_SLOTS;
const MIN = RANGE_MIN;
const MAX = RANGE_MAX;
const STEP = RANGE_STEP;
const fmtRange = (range) => rangeLabel(range);
const fmtTime = (minutes) => timeLabel(minutes);

// --- Menu des créneaux ---
const menuOpen = ref(false);
const menuEl = ref(null);

onClickOutside(menuEl, () => { menuOpen.value = false; });

// Libellé du bouton fermé : le créneau nommé, ou la plage elle-même. Afficher « Personnalisé »
// obligerait à rouvrir la popin pour savoir ce qu'on filtre.
const slotLabel = computed(() => props.timeSlot === 'custom'
    ? rangeLabel(props.customRange)
    : (SLOTS.find(s => s.value === props.timeSlot)?.label ?? 'Toutes'));

const pickSlot = (value) => {
    menuOpen.value = false;
    emit('update:timeSlot', value);
};

// --- Popin « Choisir plage… » ---
const dialogOpen = ref(false);
const draft = ref([MIN, MAX]);
const modalEl = ref(null);
const triggerEl = ref(null);
const fromEl = ref(null);

// La popin s'ouvre sur ce qui est filtré à l'instant : depuis « Soir », le slider part déjà de
// 18:00. Repartir des bornes à chaque fois ferait perdre le réglage qu'on venait juste ajuster.
//
// Le focus entre **dans** la popin, sur la première poignée. Sans ça, `aria-modal` mentait : le
// bouton d'où l'on vient est démonté avec le menu, donc le focus retombait sur `<body>` et un
// utilisateur au clavier se retrouvait à tabuler depuis le début de la page — dans une popin dont il
// ne pouvait pas soupçonner l'ouverture.
const openDialog = async () => {
    menuOpen.value = false;
    const current = slotRange(props.timeSlot, props.customRange);
    draft.value = current ? [...current] : [MIN, MAX];
    dialogOpen.value = true;

    await nextTick();
    fromEl.value?.focus();
};

// Et il revient sur le bouton « Heures », qui lui reste monté : rendre le focus à l'élément d'où on
// venait est la seule façon de ne pas perdre sa place en fermant.
const closeDialog = () => {
    dialogOpen.value = false;
    triggerEl.value?.focus();
};

const confirmDialog = () => {
    emit('update:customRange', [...draft.value]);
    emit('update:timeSlot', 'custom');
    closeDialog();
};

// Tab tourne en rond dans la popin tant qu'elle est ouverte. Une modale qu'on peut quitter au clavier
// sans la fermer laisse le focus derrière un fond opaque : on ne voit plus où l'on est.
const cycleFocus = (event) => {
    const focusables = modalEl.value?.querySelectorAll('input, button');
    if (!focusables?.length) return;

    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;

    if (event.shiftKey && (active === first || !modalEl.value.contains(active))) {
        event.preventDefault();
        last.focus();
    } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
    }
};

// Les deux poignées ne se croisent pas : la poussée s'arrête à un pas d'écart. Une plage inversée
// (ou vide) ne filtrerait plus rien de compréhensible.
const setFrom = (value) => {
    draft.value = [Math.min(Number(value), draft.value[1] - STEP), draft.value[1]];
};

const setTo = (value) => {
    draft.value = [draft.value[0], Math.max(Number(value), draft.value[0] + STEP)];
};

// Position d'une valeur sur la piste, en fraction (0 → 1). Exposée en variable CSS et non en `%` :
// un `input range` natif ne promène le **centre** de sa poignée que sur `largeur − poignée`, pas sur
// toute la largeur. La piste dessinée et les repères sont donc calés sur le même trajet réduit
// (`calc(1.4rem + (100% - 2.8rem) * ratio)`), sinon aux extrémités le remplissage et les repères se
// décalent d'une demi-poignée par rapport à la poignée qu'ils sont censés suivre.
const ratio = (minutes) => (minutes - MIN) / (MAX - MIN);

// Repères sous la piste, toutes les 4 h — comme la maquette.
const TICKS = [8, 12, 16, 20, 24].map(h => ({ h, label: `${String(h).padStart(2, '0')}:00`, at: ratio(h * 60) }));

// Échap ferme, Tab tourne en rond. Écouté sur la fenêtre : le focus peut être sur un `<input range>`,
// qui ne remonte pas l'événement au conteneur si on l'écoute trop haut dans l'arbre.
const onKeydown = (e) => {
    if (!dialogOpen.value) return;
    if (e.key === 'Escape') closeDialog();
    else if (e.key === 'Tab') cycleFocus(e);
};

// Scroll de l'arrière-plan gelé pendant la popin : sur mobile, un geste qui rate la poignée
// emmenait la page derrière le fond opaque, et on revenait sur une vue déplacée sans l'avoir voulu.
watch(dialogOpen, (open) => {
    document.body.style.overflow = open ? 'hidden' : '';
});

onMounted(() => window.addEventListener('keydown', onKeydown));

onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKeydown);
    // Un démontage popin ouverte (navigation) laisserait le `<body>` bloqué pour toute la visite.
    document.body.style.overflow = '';
});
</script>

<template>
    <div class="seances-filters">
        <div class="seg">
            <button v-for="option in GROUPS" :key="option.value" type="button" class="opt"
                    :class="{ '-on': group === option.value }" :aria-pressed="group === option.value"
                    @click="emit('update:group', option.value)">{{ option.label }}</button>
        </div>

        <div ref="menuEl" class="hours">
            <!-- Pas d'`aria-haspopup` : la valeur `true` équivaut par spec à « menu », alors que le
                 panneau n'a volontairement pas les rôles `menu`/`menuitem` (cf. plus bas). Annoncer
                 un menu qui n'en est pas un vaut moins que ne rien annoncer. -->
            <button ref="triggerEl" type="button" class="trigger" :class="{ '-on': timeSlot !== 'all' }"
                    :aria-expanded="menuOpen" @click="menuOpen = !menuOpen">
                <span class="lbl">Heures : <strong>{{ slotLabel }}</strong></span>
                <span class="chev" :class="{ '-up': menuOpen }" aria-hidden="true"><Svg name="chevron" /></span>
            </button>

            <!-- Boutons nus, sans `role="menu"` : le rôle ARIA promettrait une navigation aux
                 flèches qu'on n'implémente pas. Des boutons sont focusables et parcourus au Tab. -->
            <div v-if="menuOpen" class="menu">
                <button v-for="option in SLOTS" :key="option.value" type="button"
                        class="item" :class="{ '-on': timeSlot === option.value }"
                        :aria-pressed="timeSlot === option.value" @click="pickSlot(option.value)">
                    <span class="name">{{ option.label }}</span>
                    <span v-if="option.hint" class="hint">{{ option.hint }}</span>
                </button>

                <button type="button" class="item -custom" aria-haspopup="dialog"
                        :class="{ '-on': timeSlot === 'custom' }" @click="openDialog">
                    <span class="name">Choisir plage…</span>
                    <span v-if="timeSlot === 'custom'" class="hint">{{ fmtRange(customRange) }}</span>
                </button>
            </div>
        </div>

        <!-- Le libellé annonce l'état courant sans ambiguïté : sans ça, « 0 séance » à cause du
             pré-filtre se lit comme un bug plutôt que comme un filtre. -->
        <button type="button" class="card" :class="{ '-on': ugcOnly }" :aria-pressed="ugcOnly"
                @click="emit('update:ugcOnly', !ugcOnly)">
            <span class="dot" aria-hidden="true" />
            {{ ugcOnly ? 'Carte UGC uniquement' : 'Tout Paris' }}
        </button>

        <!-- Popin de plage libre. Le clic sur le fond annule : rien n'est appliqué avant « OK »,
             donc en sortir ne peut pas laisser un filtre à moitié posé. -->
        <div v-if="dialogOpen" class="overlay" @click="closeDialog">
            <div ref="modalEl" class="modal" role="dialog" aria-modal="true"
                 aria-labelledby="seances-range-title" @click.stop>
                <p id="seances-range-title" class="mtitle">Sélectionnez une plage horaire</p>

                <div class="slider">
                    <span class="track" aria-hidden="true" />
                    <span class="fill" aria-hidden="true"
                          :style="{ '--from': ratio(draft[0]), '--to': ratio(draft[1]) }" />

                    <!-- Deux `input range` superposés sur la même piste : les poignées seules
                         reçoivent le pointeur (cf. `pointer-events` dans le style), sinon celui du
                         dessus intercepterait tous les clics de l'autre. -->
                    <input ref="fromEl" class="thumb" type="range" :min="MIN" :max="MAX" :step="STEP"
                           :value="draft[0]" aria-label="Début de la plage"
                           :aria-valuetext="fmtTime(draft[0])" @input="setFrom($event.target.value)" />
                    <input class="thumb" type="range" :min="MIN" :max="MAX" :step="STEP"
                           :value="draft[1]" aria-label="Fin de la plage"
                           :aria-valuetext="fmtTime(draft[1])" @input="setTo($event.target.value)" />
                </div>

                <div class="ticks" aria-hidden="true">
                    <span v-for="tick in TICKS" :key="tick.h" class="tick" :style="{ '--at': tick.at }">
                        <span class="bar" />
                        <span class="txt">{{ tick.label }}</span>
                    </span>
                </div>

                <p class="value">{{ fmtRange(draft) }}</p>

                <div class="actions">
                    <button type="button" class="btn" @click="closeDialog">Annuler</button>
                    <button type="button" class="btn -primary" @click="confirmDialog">OK</button>
                </div>
            </div>
        </div>
    </div>
</template>

<style lang="scss" scoped>
// Le « pill » de la barre de filtres, porté à l'identique par le bouton « Heures » et par le toggle
// carte. Écrit une fois : dupliqué, le premier ajustement de padding ou de rayon n'en aurait touché
// qu'un des deux et la barre aurait perdu son alignement.
@mixin pill {
    display: inline-flex;
    align-items: center;
    padding: .8rem 1.2rem;
    background: $color-surface-1;
    border: 1px solid $color-border-2;
    border-radius: 1rem;
    color: $color-text-muted;
    font: $semi-bold 1.2rem/1 $font-body;
    cursor: pointer;
    transition: border-color .18s ease, color .18s ease;
}

// `focusRing` : mixin partagé de `assets/styles/_a11y.scss`, injecté partout.

.seances-filters {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 1rem;

    > .seg {
        display: flex;
        gap: .2rem;
        background: $color-surface-1;
        border: 1px solid $color-border-2;
        border-radius: 1rem;
        padding: .3rem;

        > .opt {
            @include focusRing;
            padding: .8rem 1.2rem;
            border-radius: .8rem;
            color: $color-text-muted;
            font: $semi-bold 1.2rem/1 $font-body;
            cursor: pointer;
            transition: background-color .18s ease, color .18s ease;

            &.-on {
                background: $color-primary;
                color: $color-white;
            }
        }
    }

    > .card {
        @include pill;
        @include focusRing;
        gap: .7rem;

        > .dot {
            width: .9rem;
            height: .9rem;
            border-radius: 50%;
            background: $color-status-grey;
            transition: background-color .18s ease;
        }

        &.-on {
            border-color: $color-primary;
            color: $color-text;

            > .dot { background: $color-primary; }
        }
    }
}

// ---- Menu des créneaux ----
.hours {
    position: relative;

    > .trigger {
        @include pill;
        @include focusRing;
        gap: .8rem;

        > .lbl > strong { color: $color-text; font-weight: $semi-bold; }

        // Le chevron de l'app pointe vers le bas au repos : fermé il ne tourne pas, ouvert il se
        // retourne.
        > .chev {
            display: grid;
            place-items: center;
            transition: transform .18s ease;

            > :deep(svg) { width: 1.4rem; height: 1.4rem; }

            &.-up { transform: rotate(180deg); }
        }

        &.-on { border-color: $color-primary; color: $color-text; }
    }

    > .menu {
        position: absolute;
        top: calc(100% + .6rem);
        left: 0;
        z-index: 30;
        min-width: 20rem;
        padding: .6rem;
        background: $color-surface-2;
        border: 1px solid $color-border-5;
        border-radius: 1.2rem;
        box-shadow: 0 18px 40px rgba(0, 0, 0, .5);

        > .item {
            @include focusRing;
            display: flex;
            align-items: baseline;
            justify-content: space-between;
            gap: 1.2rem;
            width: 100%;
            padding: .8rem 1rem;
            border-radius: .8rem;
            text-align: left;
            cursor: pointer;
            transition: background-color .15s ease;

            > .name { color: $color-text-body; font: $semi-bold 1.25rem/1.2 $font-body; }
            > .hint { color: $color-text-quiet; font: $normal 1.1rem/1.2 $font-body; }

            &.-custom {
                margin-top: .4rem;
                padding-top: 1.1rem;
                border-top: 1px solid $color-border-2;
                border-radius: 0 0 .8rem .8rem;
            }

            &.-on > .name { color: $color-primary-light; }

            @media (hover: hover) {
                &:hover { background: $color-hover; }
            }
        }
    }
}

// ---- Popin de plage ----
// Au-dessus de la nav flottante (`z-index: 999` dans `nav/Header.vue`) : centrée verticalement, la
// popin passerait sinon **sous** la barre du bas, qui recouvrirait « Annuler » et « OK ».
.overlay {
    position: fixed;
    inset: 0;
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2rem;
    background: rgba(0, 0, 0, .6);
}

.modal {
    width: 42rem;
    max-width: 100%;
    padding: 2.4rem;
    background: $color-surface-1;
    border: 1px solid $color-border-4;
    border-radius: 2rem;
    box-shadow: 0 30px 70px rgba(0, 0, 0, .6);

    > .mtitle {
        margin-bottom: 2.4rem;
        color: $color-text;
        font: 800 1.8rem/1.2 $font-title;
    }

    > .value {
        margin-top: 1.6rem;
        color: $color-primary-light;
        font: $bold 2rem/1 $font-mono;
        text-align: center;
    }

    > .actions {
        display: flex;
        gap: 1rem;
        margin-top: 2.4rem;

        > .btn {
            @include focusRing;
            flex: 1;
            padding: 1rem 1.6rem;
            background: transparent;
            border: 1px solid $color-border-4;
            border-radius: 1.2rem;
            color: $color-text-dim;
            font: $semi-bold 1.3rem/1 $font-body;
            cursor: pointer;
            transition: color .18s ease, border-color .18s ease;

            &.-primary { border-color: $color-primary; color: $color-primary-light; }

            @media (hover: hover) {
                &:hover { color: $color-text; border-color: $color-primary; }
                &.-primary:hover { color: $color-primary-lighter; }
            }
        }
    }
}

// 2,8 rem de poignée (28 px) et 4,4 rem de hauteur d'input : la zone tactile atteint la
// recommandation des 44 px sur l'axe vertical, celui où le doigt rate le plus souvent. `--half` sert
// à caler la piste dessinée sur le trajet réel du centre de la poignée (cf. `ratio` côté script).
.slider {
    --thumb: 2.8rem;
    --half: 1.4rem;

    position: relative;
    height: 4.4rem;

    > .track,
    > .fill {
        position: absolute;
        top: 50%;
        height: .6rem;
        margin-top: -.3rem;
        border-radius: 999px;
    }

    > .track {
        left: var(--half);
        right: var(--half);
        background: $color-surface-4;
    }

    > .fill {
        left: calc(var(--half) + (100% - var(--thumb)) * var(--from));
        right: calc(var(--half) + (100% - var(--thumb)) * (1 - var(--to)));
        background: $color-primary;
    }

    // Piste native masquée : c'est `.track` / `.fill` qui la dessinent, une pour les deux inputs.
    // Sans `pointer-events: none` ici, l'input du dessus couvrirait toute la largeur et la poignée
    // de début deviendrait inatteignable.
    //
    // `border: none` : Firefox dessine une bordure sur la piste native même transparente, visible
    // sous la piste qu'on dessine. `touch-action: none` : sans ça un glissement horizontal parti de
    // la poignée est arbitré comme un scroll de page et la plage ne bouge pas.
    > .thumb {
        position: absolute;
        inset: 0;
        margin: 0;
        -webkit-appearance: none;
        appearance: none;
        background: transparent;
        border: none;
        pointer-events: none;
        touch-action: none;

        &::-webkit-slider-thumb {
            -webkit-appearance: none;
            appearance: none;
            width: var(--thumb);
            height: var(--thumb);
            border-radius: 50%;
            background: $color-white;
            border: 2px solid $color-primary;
            box-shadow: 0 2px 8px rgba(0, 0, 0, .5);
            pointer-events: auto;
            cursor: grab;
        }

        &::-moz-range-thumb {
            width: var(--thumb);
            height: var(--thumb);
            border-radius: 50%;
            background: $color-white;
            border: 2px solid $color-primary;
            pointer-events: auto;
            cursor: grab;
        }

        &:focus-visible {
            &::-webkit-slider-thumb { outline: 2px solid $color-primary-light; outline-offset: 2px; }
            &::-moz-range-thumb { outline: 2px solid $color-primary-light; outline-offset: 2px; }
        }
    }
}

// Même trajet réduit que la piste : un repère « 08:00 » doit tomber sous la poignée quand elle est
// à 08:00, pas une demi-poignée à côté.
.ticks {
    --thumb: 2.8rem;
    --half: 1.4rem;

    position: relative;
    height: 2.4rem;

    > .tick {
        position: absolute;
        top: 0;
        left: calc(var(--half) + (100% - var(--thumb)) * var(--at));
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: .4rem;
        transform: translateX(-50%);

        > .bar {
            width: 1px;
            height: .8rem;
            background: $color-border-4;
        }

        > .txt {
            color: $color-text-quiet;
            font: $semi-bold 1.05rem/1 $font-mono;
            white-space: nowrap;
        }
    }
}
</style>

