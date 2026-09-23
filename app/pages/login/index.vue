<script setup>
definePageMeta({ layout: false });
useHead({ title: 'Connexion' });

const client = useSupabaseClient();
const router = useRouter();
const email = ref("");
const password = ref("");
const errorMsg = ref(null);
const loading = ref(false);

async function signIn() {
    loading.value = true;
    errorMsg.value = null;
    try {
        const { error } = await client.auth.signInWithPassword({
            email: email.value,
            password: password.value,
        });
        if (error) throw error;
        await router.push("/");
    } catch (error) {
        errorMsg.value = error.message;
    } finally {
        loading.value = false;
    }
}
</script>

<template>
    <div class="page-login flex -align-center -justify-center">
        <div class="card">
            <h1 class="logo title-2">Ciné<span class="accent">genda</span></h1>

            <form class="form flex -direction-column" @submit.prevent="signIn">
                <div class="field flex -direction-column">
                    <label class="label small-body" for="email">Email</label>
                    <input id="email" v-model="email" class="text-input input-body" type="email"
                           placeholder="toi@exemple.fr" autocomplete="email" />
                </div>

                <div class="field flex -direction-column">
                    <label class="label small-body" for="password">Mot de passe</label>
                    <input id="password" v-model="password" class="text-input input-body" type="password"
                           placeholder="••••••••" autocomplete="current-password" />
                </div>

                <!-- ⚠️ `role="alert"` : le message apparaît **après** la soumission, donc hors du flux de
                     lecture. Sans lui, un lecteur d'écran ne l'annonce jamais et l'utilisateur attend
                     une réponse qui est déjà à l'écran. -->
                <p v-if="errorMsg" class="error small-body" role="alert">{{ errorMsg }}</p>

                <button type="submit" class="btn submit-btn input-body" :disabled="loading">
                    {{ loading ? 'Connexion…' : 'Se connecter' }}
                </button>

                <NuxtLink class="alt-link small-body" to="/register">Créer un compte</NuxtLink>
            </form>
        </div>
    </div>
</template>

<style lang="scss" scoped>
// ⚠️ `btn` sur chaque `<button>` porteur de texte : `_btn.scss` met les autres à `font-size: 0`.
// Cette page était la seule du dépôt hors design system : `$font-do-hyeon` et `$font-futura` n'y
// servaient qu'ici (leurs deux uniques occurrences sur 132 références de fonte), les tailles étaient
// codées en dur là où le reste du dépôt pose `class="text-input input-body"`, et le logo affichait
// encore « CinéCal » alors que l'application s'appelle « Cinégenda » depuis `b50030e`.
//
// ⚠️ Aucune propriété typographique ici : `title-2`, `input-body` et `small-body` sont posées en
// markup. Et aucune classe utilitaire n'est utilisée comme sélecteur.
.page-login {
    min-height: 100dvh;
    background-color: $color-bg;
    padding: 2rem;
}

.card {
    background-color: $color-surface-2;
    border: 1px solid $color-border-3;
    border-radius: 1.6rem;
    padding: 4rem 3.2rem;
    width: 100%;
    max-width: 40rem;
    display: flex;
    flex-direction: column;
    gap: 3rem;
}

.logo {
    color: $color-text;
    text-align: center;

    > .accent {
        color: $color-primary;
    }
}

.form {
    gap: 1.6rem;
}

.field {
    gap: .8rem;
}

.label {
    color: $color-text-muted;
    text-transform: uppercase;
    letter-spacing: .08em;
}

.text-input {
    background-color: $color-surface-4;
    border: 1px solid $color-border-4;
    border-radius: .8rem;
    padding: 1rem 1.6rem;
    color: $color-text-body;
    width: 100%;
    transition: border-color .15s ease;

    &::placeholder {
        color: $color-text-weak;
    }

    &:focus {
        outline: none;
        border-color: $color-primary;
    }
}

.error {
    color: $color-primary-lighter;
    background-color: $color-danger-bg;
    border-radius: .8rem;
    padding: .8rem 1.6rem;
}

.submit-btn {
    margin-top: .8rem;
    background-color: $color-primary;
    color: $color-white;
    padding: 1.6rem;
    border-radius: .8rem;
    width: 100%;
    transition: opacity .15s ease;

    &:disabled {
        opacity: .6;
        cursor: not-allowed;
    }

    @media (hover: hover) {
        &:hover:not(:disabled) {
            opacity: .85;
        }
    }
}

.alt-link {
    color: $color-text-muted;
    text-align: center;
    transition: color .15s ease;

    @media (hover: hover) {
        &:hover {
            color: $color-primary-light;
        }
    }
}
</style>
