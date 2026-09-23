<script setup>
// ⚠️ La flèche n'est pas systématique dans la maquette : « Se connecter », « Créer mon compte » et
// « Ma demande a été validée » la portent, « Envoyer le lien » et « Retour à la connexion » non.
// D'où `icon`, mis à `null` pour s'en passer — ne pas uniformiser.
//
// `to` rend un lien : ce qui navigue doit s'ouvrir dans un nouvel onglet et se copier.
const props = defineProps({
    label: { type: String, required: true },
    loadingLabel: { type: String, default: '' },
    loading: { type: Boolean, default: false },
    icon: { type: String, default: 'arrow-right' },
    type: { type: String, default: 'submit' },
    to: { type: String, default: null },
});

const NuxtLink = resolveComponent('NuxtLink');
const tag = computed(() => (props.to ? NuxtLink : 'button'));
</script>

<template>
    <!-- ⚠️ `btn` obligatoire sur un bouton porteur de texte : `_btn.scss` met les autres à
         `font-size: 0`. -->
    <component :is="tag" :to="to ?? undefined" :type="to ? undefined : type"
               :disabled="to ? undefined : loading"
               class="auth-submit btn flex -align-center -justify-center">
        <span class="label">{{ loading && loadingLabel ? loadingLabel : label }}</span>
        <Svg v-if="icon" :name="icon" class="ico" />
    </component>
</template>

<style lang="scss" scoped>
.auth-submit {
    // ⚠️ `display: flex` explicite, alors que `.flex` est déjà posé en markup : `main.scss` importe
    // `components/_btn` **après** `components/_flex`, donc à spécificité égale le `display: block`
    // de `.btn` gagne. Invisible sur un `<button>`, que le navigateur centre nativement — mais la
    // variante lien affichait son libellé collé en haut à gauche.
    display: flex;
    // `_btn.scss` pose aussi `width: max-content` sur `.btn` — le bouton des maquettes occupe toute
    // la largeur du formulaire.
    width: 100%;
    height: 5.4rem;
    background-color: $color-primary;
    border-radius: 12px;
    color: $color-white;
    transition: background-color .15s ease, opacity .15s ease, transform .1s ease;
    font: $bold 1.6rem/1 $font-body;

    @include focusRing($color-white);

    // L'écart entre le libellé et la flèche vient de `.label + .ico` de `_btn.scss` : ne pas y
    // ajouter de `gap`, les deux se cumuleraient.
    > .ico {
        width: 1.8rem;
        height: auto;
    }

    &:disabled {
        opacity: .6;
        cursor: not-allowed;
    }

    &:active:not(:disabled) {
        transform: scale(.99);
    }

    @media (hover: hover) {
        &:hover:not(:disabled) {
            background-color: $color-primary-light;
        }
    }
}
</style>
