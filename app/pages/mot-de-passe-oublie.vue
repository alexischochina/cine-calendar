<script setup>
// ⚠️ Pas de middleware `auth` : on arrive ici précisément sans pouvoir se connecter.
//
// ⚠️ **Cet écran ne dit jamais si l'adresse a un compte, et la réponse de Supabase n'est même pas
// lue.** C'est la seule forme sûre : `POST /auth/v1/recover` rend 200 pour une adresse inconnue —
// c'est sa protection anti-énumération — et ne rend 429 qu'**après** avoir résolu l'utilisateur,
// quand la fréquence d'envoi par compte (60 s) est dépassée. Un 429 ne peut donc désigner qu'une
// adresse **qui existe** : y brancher un message distinct, même honnête, rouvrait l'oracle que
// `25e9a24` et `server/api/auth/register.post.js` ont fermé — et deux soumissions de la même
// adresse suffisaient à le lire.
//
// D'où la règle, sans exception : **aucune branche d'affichage pilotée par le retour de
// `resetPasswordForEmail`**. Ce qu'on montre ne dépend que de ce que le visiteur vient de faire.
definePageMeta({ layout: 'auth', pageTransition: { name: 'auth', mode: 'out-in' } });
useHead({ title: 'Mot de passe oublié' });

const client = useSupabaseClient();
const { public: { siteUrl } } = useRuntimeConfig();
const { origin } = useRequestURL();

const email = ref('');
const sent = ref(false);
const errorMsg = ref(null);
const loading = ref(false);

// Supabase n'envoie qu'un message par minute et par compte. Plutôt que de lire son refus — qui
// trahirait l'existence du compte — on empêche de le provoquer : délai décompté **localement**,
// identique pour une adresse connue ou inconnue.
const RESEND_DELAY = 60;
const cooldown = ref(0);
let ticker = null;

function startCooldown() {
    cooldown.value = RESEND_DELAY;
    clearInterval(ticker);
    ticker = setInterval(() => {
        cooldown.value -= 1;
        if (cooldown.value <= 0) clearInterval(ticker);
    }, 1000);
}

onUnmounted(() => clearInterval(ticker));

// Volontairement grossière, comme côté serveur : seul l'envoi vérifie vraiment une adresse.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function submit() {
    if (!EMAIL.test(email.value.trim())) {
        errorMsg.value = 'Cet email ne semble pas valide.';
        return;
    }

    loading.value = true;
    errorMsg.value = null;

    // ⚠️ En production, cette URL doit figurer dans les *Redirect URLs* du dashboard Supabase,
    // sinon le lien retombe sur le *Site URL* par défaut.
    const redirectTo = `${siteUrl || origin}/nouveau-mot-de-passe`;

    // ⚠️ Retour volontairement ignoré — ni `error`, ni `status`, ni durée d'attente. Voir l'en-tête :
    // c'est ce qui rend la réponse identique au bit près pour toute adresse.
    // `.catch()` pour la même raison : une panne réseau ne doit pas produire un écran différent.
    await client.auth.resetPasswordForEmail(email.value.trim(), { redirectTo }).catch(() => null);

    startCooldown();
    sent.value = true;
    loading.value = false;
}
</script>

<template>
    <div class="page-forgot flex -direction-column">
        <NuxtLink class="back flex -align-center" to="/login">
            <Svg name="arrow-left" class="ico" />
            Retour à la connexion
        </NuxtLink>

        <div v-if="!sent" class="ask flex -direction-column">
            <div class="head flex -direction-column">
                <h1 class="title">Mot de passe oublié</h1>
                <p class="subtitle">Indique ton email, on t'envoie un lien pour en choisir un nouveau.</p>
            </div>

            <form class="form flex -direction-column" @submit.prevent="submit">
                <AuthField label="Email" input-id="email">
                    <AuthInput v-model="email" input-id="email" type="email" placeholder="toi@exemple.fr"
                               autocomplete="email" :invalid="!!errorMsg" required />
                </AuthField>

                <AuthNotice v-if="errorMsg">{{ errorMsg }}</AuthNotice>

                <AuthSubmitBtn class="submit" label="Envoyer le lien" loading-label="Envoi…"
                               :loading="loading" :icon="null" />
            </form>
        </div>

        <div v-else class="done flex -direction-column">
            <span class="seal flex -align-center -justify-center">
                <Svg name="check" class="ico" />
            </span>

            <div class="head flex -direction-column">
                <h1 class="title">Lien envoyé.</h1>
                <p class="text">
                    Si un compte existe pour <span class="mail">{{ email }}</span>, tu vas recevoir un
                    email avec un lien de réinitialisation. Pense à regarder dans tes spams.
                </p>
            </div>

            <AuthSubmitBtn label="Retour à la connexion" :icon="null" to="/login" />

            <button type="button" class="again btn" :disabled="cooldown > 0" @click="sent = false">
                {{ cooldown > 0 ? `Renvoyer le lien dans ${cooldown} s` : 'Renvoyer le lien' }}
            </button>
        </div>
    </div>
</template>

<style lang="scss" scoped>
// ⚠️ `btn` sur chaque `<button>` porteur de texte : `_btn.scss` met les autres à `font-size: 0`.
.page-forgot {
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

    // ⚠️ Sans largeur explicite, l'`align-items: flex-start` du parent — posé pour le lien de
    // retour — rétrécirait ces blocs à la largeur de leur texte.
    > .ask,
    > .done {
        width: 100%;
        gap: 3rem;
    }

    > .ask > .head,
    > .done > .head {
        gap: .8rem;
    }

    > .ask {
        > .head > .title {
            color: $color-text;
            letter-spacing: -.12rem;
            font: 800 3.8rem/1 $font-title;

            @media #{$tablet-portrait} {
                font-size: 3.2rem;
            }
        }

        > .head > .subtitle {
            color: $color-text-muted;
            font: $normal 1.5rem/1.5 $font-body;
        }

        > .form {
            gap: 1.6rem;

            > .submit {
                margin-top: .6rem;
            }
        }
    }

    > .done {
        gap: 2.4rem;

        > .seal {
            width: 5.2rem;
            height: 5.2rem;
            border-radius: 14px;
            background-color: rgba($color-green, .12);
            color: $color-green;

            > .ico {
                width: 2.4rem;
                height: auto;
            }
        }

        > .head > .title {
            color: $color-text;
            letter-spacing: -.1rem;
            font: 800 3.4rem/1.05 $font-title;
        }

        > .head > .text {
            color: $color-text-muted;
            text-wrap: pretty;
            font: $normal 1.5rem/1.55 $font-body;

            > .mail {
                color: $color-text;
                font-weight: $semi-bold;
            }
        }

        > .again {
            width: 100%;
            color: $color-text-muted;
            text-align: center;
            transition: color .15s ease;
            font: $medium 1.4rem/1 $font-body;

            @include focusRing();

            &:disabled {
                opacity: .6;
                cursor: not-allowed;
            }

            @media (hover: hover) {
                &:hover {
                    color: $color-text;
                }
            }
        }
    }
}
</style>
