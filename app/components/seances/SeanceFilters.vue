<script setup>
// Barre de filtres : regroupement, version, arrondissement, et le pré-filtre carte UGC.
// Purement présentationnel — tous les filtres sont dérivés côté `useSeances`, en changer ne
// déclenche jamais de requête.
defineProps({
    group: { type: String, default: 'film' },
    version: { type: String, default: 'all' },
    arrondissement: { type: [String, Number], default: 'all' },
    ugcOnly: { type: Boolean, default: true },
    arrondissements: { type: Array, default: () => [] },
});

const emit = defineEmits(['update:group', 'update:version', 'update:arrondissement', 'update:ugcOnly']);

const GROUPS = [{ value: 'film', label: 'Par film' }, { value: 'cinema', label: 'Par cinéma' }];
const VERSIONS = [{ value: 'all', label: 'Toutes' }, { value: 'VO', label: 'VO' }, { value: 'VF', label: 'VF' }];
</script>

<template>
    <div class="seances-filters">
        <div class="seg">
            <button v-for="option in GROUPS" :key="option.value" type="button" class="opt"
                    :class="{ '-on': group === option.value }" :aria-pressed="group === option.value"
                    @click="emit('update:group', option.value)">{{ option.label }}</button>
        </div>

        <div class="seg">
            <button v-for="option in VERSIONS" :key="option.value" type="button" class="opt"
                    :class="{ '-on': version === option.value }" :aria-pressed="version === option.value"
                    @click="emit('update:version', option.value)">{{ option.label }}</button>
        </div>

        <select class="arr" :value="arrondissement" aria-label="Arrondissement"
                @change="emit('update:arrondissement', $event.target.value)">
            <option value="all">Tout Paris</option>
            <option v-for="n in arrondissements" :key="n" :value="n">
                {{ arrondissementLabel(n) }} arrondissement
            </option>
        </select>

        <!-- Le libellé annonce l'état courant sans ambiguïté : sans ça, « 0 séance » à cause du
             pré-filtre se lit comme un bug plutôt que comme un filtre. -->
        <button type="button" class="card" :class="{ '-on': ugcOnly }" :aria-pressed="ugcOnly"
                @click="emit('update:ugcOnly', !ugcOnly)">
            <span class="dot" aria-hidden="true" />
            {{ ugcOnly ? 'Carte UGC uniquement' : 'Tout Paris' }}
        </button>
    </div>
</template>

<style lang="scss" scoped>
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

    > .arr {
        background: $color-surface-1;
        border: 1px solid $color-border-2;
        border-radius: 1rem;
        padding: .8rem 1.2rem;
        color: $color-text-dim;
        font: $semi-bold 1.2rem/1 $font-body;
        cursor: pointer;
    }

    > .card {
        display: inline-flex;
        align-items: center;
        gap: .7rem;
        padding: .8rem 1.2rem;
        background: $color-surface-1;
        border: 1px solid $color-border-2;
        border-radius: 1rem;
        color: $color-text-muted;
        font: $semi-bold 1.2rem/1 $font-body;
        cursor: pointer;
        transition: border-color .18s ease, color .18s ease;

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
</style>
