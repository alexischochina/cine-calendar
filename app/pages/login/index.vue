<script setup>
definePageMeta({ layout: 'auth', pageTransition: { name: 'auth', mode: 'out-in' } });
useHead({ title: 'Connexion' });

const client = useSupabaseClient();
const router = useRouter();
const email = ref('');
const password = ref('');
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
        await router.push('/');
    } catch (error) {
        // ⚠️ Message rédigé ici, jamais celui de Supabase : il exposerait un détail
        // d'infrastructure. Et un seul libellé pour les deux échecs d'identifiants — en distinguer
        // rouvrirait l'oracle fermé par `25e9a24`.
        console.error('[auth] Connexion échouée —', error?.message);
        errorMsg.value = error?.status === 400
            ? 'Email ou mot de passe incorrect.'
            : 'Connexion impossible pour le moment. Réessaie dans un instant.';
    } finally {
        loading.value = false;
    }
}
</script>

<template>
    <div class="page-login flex -direction-column">
        <div class="head flex -direction-column">
            <h1 class="title">Bon retour.</h1>
            <p class="subtitle">Connecte-toi pour retrouver ta liste et les séances du jour.</p>
        </div>

        <AuthTabs />

        <form class="form flex -direction-column" @submit.prevent="signIn">
            <AuthField label="Email" input-id="email">
                <AuthInput v-model="email" input-id="email" type="email"
                           placeholder="toi@exemple.fr" autocomplete="email" required />
            </AuthField>

            <AuthField label="Mot de passe" input-id="password">
                <template #action>
                    <NuxtLink class="forgot" to="/mot-de-passe-oublie">Oublié ?</NuxtLink>
                </template>
                <AuthInput v-model="password" input-id="password" type="password" placeholder="••••••••"
                           autocomplete="current-password" required />
            </AuthField>

            <AuthNotice v-if="errorMsg">{{ errorMsg }}</AuthNotice>

            <AuthSubmitBtn class="submit" label="Se connecter" loading-label="Connexion…" :loading="loading" />
        </form>
    </div>
</template>

<style lang="scss" scoped>
.page-login {
    gap: 3rem;

    > .head {
        gap: .8rem;

        > .title {
            color: $color-text;
            letter-spacing: -.12rem;
            font: 800 3.8rem/1 $font-title;

            @media #{$tablet-portrait} {
                font-size: 3.2rem;
            }
        }

        > .subtitle {
            color: $color-text-muted;
            font: $normal 1.5rem/1.5 $font-body;
        }
    }

    > .form {
        gap: 1.6rem;

        .forgot {
            color: $color-primary-light;
            transition: color .15s ease;
            font: $medium 1.3rem/1 $font-body;

            @include focusRing();

            @media (hover: hover) {
                &:hover {
                    color: $color-primary-lighter;
                }
            }
        }

        > .submit {
            margin-top: .6rem;
        }
    }
}
</style>
