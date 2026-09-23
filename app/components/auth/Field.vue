<script setup>
// Libellé relié par `for` / `id` plutôt qu'en enveloppant le contrôle : le slot peut en contenir
// plusieurs, et le bouton œil du mot de passe ne doit pas hériter du libellé.
defineProps({
    label: { type: String, required: true },
    inputId: { type: String, required: true },
});
</script>

<template>
    <div class="auth-field flex -direction-column">
        <span class="head flex -justify-space-between">
            <label class="label" :for="inputId">{{ label }}</label>
            <slot name="action" />
        </span>

        <slot />
    </div>
</template>

<style lang="scss" scoped>
.auth-field {
    gap: .8rem;

    > .head {
        align-items: baseline;

        > .label {
            color: $color-text-muted;
            text-transform: uppercase;
            letter-spacing: .14rem;
            font: $bold 1.05rem/1 $font-mono;
        }
    }
}
</style>
