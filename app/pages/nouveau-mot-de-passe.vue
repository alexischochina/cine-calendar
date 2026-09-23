<script setup>
// ⚠️ Pas de middleware `auth` : on arrive ici avec une session de récupération toute fraîche, et
// surtout parfois **sans** session du tout (lien périmé, déjà utilisé, ou ouvert dans un autre
// navigateur). C'est cette page qui le dit, pas une redirection muette.
definePageMeta({ layout: 'auth', pageTransition: { name: 'auth', mode: 'out-in' } });
useHead({ title: 'Nouveau mot de passe' });

const client = useSupabaseClient();
const route = useRoute();
const router = useRouter();

// `checking` → `ready` (formulaire) ou `invalid` (lien inutilisable).
const state = ref('checking');
const password = ref('');
const confirmation = ref('');
const errorMsg = ref(null);
const loading = ref(false);

// ⚠️ Miroir du `MIN_PASSWORD` de `server/api/auth/register.post.js`. Les deux doivent bouger
// ensemble : ici c'est Supabase qui refuserait, avec un message en anglais.
const MIN_PASSWORD = 8;

onMounted(async () => {
    // Supabase renvoie ses refus dans la query **ou** dans le fragment selon le flux.
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    if (route.query.error_description || fragment.get('error_description')) {
        state.value = 'invalid';
        return;
    }

    // ⚠️ Le client `@supabase/ssr` détecte et consomme le `code` de l'URL tout seul au démarrage.
    // On tente quand même l'échange — il arrive qu'on soit plus rapide que lui — puis on retombe
    // sur `getSession`, qui attend la fin de cette initialisation et tranche pour de bon.
    if (route.query.code) {
        await client.auth.exchangeCodeForSession(String(route.query.code)).catch(() => null);
    }

    const { data } = await client.auth.getSession();
    state.value = data.session ? 'ready' : 'invalid';

    // Déjà consommé, mais il n'a plus rien à faire dans la barre d'adresse ni dans l'historique.
    if (route.query.code) await router.replace({ query: {} });
});

async function submit() {
    if (password.value.length < MIN_PASSWORD) {
        errorMsg.value = `Le mot de passe doit faire au moins ${MIN_PASSWORD} caractères.`;
        return;
    }
    if (password.value !== confirmation.value) {
        errorMsg.value = 'Les deux mots de passe ne sont pas identiques.';
        return;
    }

    loading.value = true;
    errorMsg.value = null;

    const { error } = await client.auth.updateUser({ password: password.value });

    if (error) {
        errorMsg.value = 'Impossible d\'enregistrer ce mot de passe. Le lien a peut-être expiré.';
        loading.value = false;
        return;
    }

    // `/` et non `/pending` : c'est au middleware `auth` de trancher, le dupliquer ici ferait deux
    // règles à tenir d'accord.
    await router.push('/');
}
</script>

<template>
    <div class="page-newpassword flex -direction-column">
        <NuxtLink class="back flex -align-center" to="/login">
            <Svg name="arrow-left" class="ico" />
            Retour à la connexion
        </NuxtLink>

        <p v-if="state === 'checking'" class="checking">Vérification du lien…</p>

        <div v-else-if="state === 'invalid'" class="dead flex -direction-column">
            <div class="head flex -direction-column">
                <h1 class="title">Lien expiré ou déjà utilisé</h1>
                <p class="subtitle">
                    Les liens de réinitialisation ne servent qu'une fois, et seulement dans le
                    navigateur qui les a demandés. Refais une demande pour en recevoir un nouveau.
                </p>
            </div>

            <AuthSubmitBtn label="Demander un nouveau lien" :icon="null" to="/mot-de-passe-oublie" />
        </div>

        <div v-else class="ask flex -direction-column">
            <div class="head flex -direction-column">
                <h1 class="title">Nouveau mot de passe</h1>
                <p class="subtitle">Choisis-en un nouveau, et tu repars avec ta liste.</p>
            </div>

            <form class="form flex -direction-column" @submit.prevent="submit">
                <AuthField label="Nouveau mot de passe" input-id="password">
                    <AuthInput v-model="password" input-id="password" type="password"
                               placeholder="8 caractères minimum" autocomplete="new-password"
                               show-strength required />
                </AuthField>

                <AuthField label="Confirmation" input-id="confirmation">
                    <AuthInput v-model="confirmation" input-id="confirmation" type="password"
                               placeholder="Le même, pour être sûr" autocomplete="new-password"
                               required />
                </AuthField>

                <AuthNotice v-if="errorMsg">{{ errorMsg }}</AuthNotice>

                <AuthSubmitBtn class="submit" label="Enregistrer" loading-label="Enregistrement…"
                               :loading="loading" :icon="null" />
            </form>
        </div>
    </div>
</template>

<style lang="scss" scoped>
.page-newpassword {
    gap: 3rem;
    align-items: flex-start;

    > .back {
        gap: .8rem;
        color: $color-text-muted;
        transition: color .15s ease;
        font: $semi-bold 1.4rem/1 $font-body;

        @include focusRing();

        > .ico {
            width: 1.6rem;
            height: auto;
        }

        @media (hover: hover) {
            &:hover {
                color: $color-text;
            }
        }
    }

    > .checking {
        color: $color-text-muted;
        font: $normal 1.5rem/1.5 $font-body;
    }

    // Comme sur l'écran de demande : sans largeur explicite, `align-items: flex-start` rétrécirait
    // ces blocs à la largeur de leur texte.
    > .ask,
    > .dead {
        width: 100%;
        gap: 3rem;

        > .head {
            gap: .8rem;

            > .title {
                color: $color-text;
                text-wrap: pretty;
                letter-spacing: -.12rem;
                font: 800 3.8rem/1 $font-title;

                @media #{$tablet-portrait} {
                    font-size: 3.2rem;
                }
            }

            > .subtitle {
                color: $color-text-muted;
                text-wrap: pretty;
                font: $normal 1.5rem/1.5 $font-body;
            }
        }
    }

    > .ask > .form {
        gap: 1.6rem;

        > .submit {
            margin-top: .6rem;
        }
    }
}
</style>
