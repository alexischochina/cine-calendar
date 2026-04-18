<script setup>
definePageMeta({ layout: false });

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
    <div class="page-login">
        <div class="card">
            <h1 class="logo">Ciné<span>Cal</span></h1>
            <form @submit.prevent="signIn" class="form">
                <div class="field">
                    <label for="email">Email</label>
                    <input id="email" type="email" v-model="email" placeholder="you@example.com" autocomplete="email" />
                </div>
                <div class="field">
                    <label for="password">Mot de passe</label>
                    <input id="password" type="password" v-model="password" placeholder="••••••••" autocomplete="current-password" />
                </div>
                <p v-if="errorMsg" class="error">{{ errorMsg }}</p>
                <button type="submit" class="submit-btn" :disabled="loading">
                    {{ loading ? 'Connexion…' : 'Se connecter' }}
                </button>
            </form>
        </div>
    </div>
</template>

<style lang="scss" scoped>
.page-login {
    min-height: 100dvh;
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: $color-xdark-grey;
    padding: 2rem;
}

.card {
    background-color: $color-dark-grey;
    border-radius: 1.2rem;
    padding: 4rem 3.5rem;
    width: 100%;
    max-width: 38rem;
    display: flex;
    flex-direction: column;
    gap: 3rem;
}

.logo {
    font-family: $font-do-hyeon;
    font-size: 3.2rem;
    color: $color-white;
    text-align: center;
    letter-spacing: 0.05em;

    span {
        color: #ec008b;
    }
}

.form {
    display: flex;
    flex-direction: column;
    gap: 1.6rem;
}

.field {
    display: flex;
    flex-direction: column;
    gap: .6rem;

    label {
        font-size: 1.2rem;
        color: rgba($color-white, .5);
        text-transform: uppercase;
        letter-spacing: .08em;
    }

    input {
        background-color: $color-xdark-grey;
        border: 1px solid rgba($color-white, .08);
        border-radius: .6rem;
        padding: 1.1rem 1.4rem;
        color: $color-white;
        font-size: 1.5rem;
        width: 100%;
        transition: border-color .15s ease;

        &::placeholder {
            color: rgba($color-white, .25);
        }

        &:focus {
            outline: none;
            border-color: #ec008b;
        }
    }
}

.error {
    font-size: 1.3rem;
    color: #ff6b6b;
    background-color: rgba(#ff6b6b, .1);
    border-radius: .5rem;
    padding: .8rem 1.2rem;
}

.submit-btn {
    margin-top: .4rem;
    background-color: #ec008b;
    color: $color-white;
    font-family: $font-futura;
    font-size: 1.4rem;
    font-weight: $semi-bold;
    letter-spacing: .06em;
    padding: 1.2rem;
    border-radius: .6rem;
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
</style>
