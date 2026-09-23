<script setup>
// Un seul composant pour l'e-mail et le mot de passe : l'habillage est identique partout, et le
// sortir ici est la seule façon de ne pas le recopier dans les cinq pages.
const props = defineProps({
    modelValue: { type: String, default: '' },
    inputId: { type: String, required: true },
    type: { type: String, default: 'text' },
    placeholder: { type: String, default: '' },
    autocomplete: { type: String, default: 'off' },
    required: { type: Boolean, default: false },
    invalid: { type: Boolean, default: false },
    showStrength: { type: Boolean, default: false },
});

const emit = defineEmits(['update:modelValue']);

const isPassword = computed(() => props.type === 'password');
const visible = ref(false);

// ⚠️ `:type` dynamique et non deux `<input>` alternés : basculer d'élément ferait perdre le focus
// et la position du curseur à chaque clic sur l'œil.
const resolvedType = computed(() => (isPassword.value && visible.value ? 'text' : props.type));

// ⚠️ Purement indicatif. La seule règle qui refuse vraiment un mot de passe est le minimum de 8
// caractères de `server/api/auth/register.post.js` — ne pas déplacer de validation ici.
const strength = computed(() => {
    const value = props.modelValue ?? '';
    return [
        value.length >= 8,
        /[A-Z]/.test(value),
        /\d/.test(value),
        /[^A-Za-z0-9]/.test(value),
    ].filter(Boolean).length;
});
</script>

<template>
    <span class="auth-input flex -direction-column">
        <span class="box flex">
            <input :id="inputId" class="field" :class="{ '-invalid': invalid, '-withaction': isPassword }"
                   :type="resolvedType" :value="modelValue" :placeholder="placeholder"
                   :autocomplete="autocomplete" :required="required"
                   :aria-invalid="invalid || undefined"
                   @input="emit('update:modelValue', $event.target.value)" />

            <button v-if="isPassword" type="button" class="eye" :class="{ '-on': visible }"
                    :aria-label="visible ? 'Masquer le mot de passe' : 'Afficher le mot de passe'"
                    :aria-pressed="visible" @click="visible = !visible">
                <Svg name="eye" />
            </button>
        </span>

        <!-- `aria-hidden` : la jauge n'annonce rien qu'un lecteur d'écran ne puisse déduire du
             placeholder et du message d'erreur, et la lire à chaque frappe serait insupportable. -->
        <span v-if="showStrength" class="meter" :class="`-s${strength}`" aria-hidden="true">
            <span v-for="n in 4" :key="n" class="seg" :class="{ '-on': n <= strength }" />
        </span>
    </span>
</template>

<style lang="scss" scoped>
.auth-input {
    gap: .8rem;

    > .box {
        position: relative;

        > .field {
            // `min-width: 0` : sans lui, la largeur intrinsèque d'un `input` l'empêche de se réduire
            // dans un conteneur flex étroit.
            min-width: 0;
            flex: 1;
            height: 5.2rem;
            padding: 0 1.6rem;
            background-color: $color-surface-1;
            border: 1px solid $color-border-3;
            border-radius: 12px;
            color: $color-text;
            transition: border-color .15s ease, box-shadow .15s ease;
            font: $medium 1.6rem/1.1 $font-body;

            &.-withaction {
                padding-right: 5.2rem;
            }

            &.-invalid {
                border-color: $color-primary;
            }

            // ⚠️ `$color-text-quiet` (4,51:1) et non le `#565b66` de la maquette
            // ($color-text-weak, 2,66:1) : `_variables.scss` réserve ce dernier au décoratif, et un
            // placeholder reste du texte — le seul visible tant que le champ est vide.
            &::placeholder {
                color: $color-text-quiet;
            }

            // Le halo tient lieu d'anneau de focus, au clavier comme à la souris.
            &:focus {
                border-color: $color-primary;
                box-shadow: 0 0 0 3px rgba($color-primary, .18);
            }
        }

        > .eye {
            position: absolute;
            // ⚠️ `.4rem` non arrondi : c'est l'encart du bouton dans le champ, pas du spacing.
            top: .4rem;
            right: .4rem;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 4.4rem;
            height: 4.4rem;
            border-radius: 9px;
            color: $color-text-weak;
            transition: background-color .15s ease, color .15s ease;

            @include focusRing();

            &.-on {
                color: $color-primary-light;
            }

            svg {
                width: 2rem;
                height: auto;
            }

            @media (hover: hover) {
                &:hover {
                    background-color: $color-hover;
                }
            }
        }
    }

    > .meter {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: .4rem;

        > .seg {
            height: 3px;
            border-radius: 2px;
            background-color: $color-border-4;
            transition: background-color .2s ease;
        }

        &.-s1 > .seg.-on { background-color: $color-primary; }
        &.-s2 > .seg.-on { background-color: $color-yellow; }
        &.-s3 > .seg.-on { background-color: $color-green-light; }
        &.-s4 > .seg.-on { background-color: $color-green; }
    }
}
</style>
