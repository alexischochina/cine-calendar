<script setup>
// Inscription. Le compte naît fermé : la route serveur le crée avec `approved = false`, et Alexis
// l'ouvre à la main dans le dashboard Supabase. On n'ouvre donc **pas** de session ici — pas de
// `signUp` côté client, pas de connexion automatique — et on renvoie sur `/pending`.
//
// `CITIES` vient de l'auto-import de `shared/utils/cities.js` : la même table que celle dont se sert
// le serveur pour choisir la localisation Allociné. Une liste recopiée dans ce fichier aurait pu
// proposer une ville que le serveur ne sait pas traiter.
definePageMeta({ layout: 'auth', pageTransition: { name: 'auth', mode: 'out-in' } });
useHead({ title: 'Créer un compte' });

const router = useRouter();

const email = ref('');
const password = ref('');
const city = ref('paris');
const errorMsg = ref(null);
const loading = ref(false);

const cities = Object.values(CITIES);

async function register() {
    loading.value = true;
    errorMsg.value = null;

    try {
        await $fetch('/api/auth/register', {
            method: 'POST',
            body: { email: email.value, password: password.value, city: city.value },
        });
        await router.push('/pending');
    } catch (error) {
        // `statusMessage` porte le message rédigé par la route ; `message` est le repli quand
        // l'échec est réseau et n'a jamais atteint le serveur.
        errorMsg.value = error?.data?.statusMessage ?? error?.message ?? 'Inscription impossible.';
    } finally {
        loading.value = false;
    }
}
</script>

<template>
    <div class="page-register flex -direction-column">
        <div class="head flex -direction-column">
            <h1 class="title">Prends ta place.</h1>
            <p class="subtitle">Crée ton compte pour commencer ta liste de films.</p>
        </div>

        <AuthTabs />

        <form class="form flex -direction-column" @submit.prevent="register">
            <AuthField label="Email" input-id="email">
                <AuthInput v-model="email" input-id="email" type="email" placeholder="toi@exemple.fr"
                           autocomplete="email" required />
            </AuthField>

            <AuthField label="Mot de passe" input-id="password">
                <AuthInput v-model="password" input-id="password" type="password"
                           placeholder="8 caractères minimum" autocomplete="new-password" show-strength
                           required />
            </AuthField>

            <!-- `fieldset` / `legend` et non un `div` + `label` : c'est ce qui rattache les deux
                 boutons radio à leur question pour un lecteur d'écran. -->
            <fieldset class="cities flex -direction-column">
                <legend class="label">Ta ville</legend>
                <div class="choices">
                    <label v-for="option in cities" :key="option.key" class="choice">
                        <!-- ⚠️ Vrai radio, seulement masqué : c'est lui qui porte le groupe, la
                             navigation aux flèches et l'état coché. La carte est son habillage. -->
                        <input v-model="city" class="radio" type="radio" name="city" :value="option.key" />
                        <span class="row flex -align-center -justify-space-between">
                            <span class="name">{{ option.label }}</span>
                            <span class="dot flex -align-center -justify-center">
                                <span class="core" />
                            </span>
                        </span>
                    </label>
                </div>
            </fieldset>

            <AuthNotice v-if="errorMsg">{{ errorMsg }}</AuthNotice>

            <AuthSubmitBtn class="submit" label="Créer mon compte" loading-label="Création…" :loading="loading" />
        </form>
    </div>
</template>

<style lang="scss" scoped>
.page-register {
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

        > .cities {
            // `min-width: 0` : un `fieldset` porte une largeur intrinsèque qui l'empêche de se
            // réduire sous la taille de son contenu. Sans ça, un libellé long déborderait la colonne.
            min-width: 0;

            > .label {
                // ⚠️ `margin-bottom` et **pas** le `gap` du fieldset : un `<legend>` est extrait du
                // flux par le navigateur pour se poser sur la bordure, donc aucun `gap` ne l'atteint.
                // C'est ce qui collait le libellé aux cartes — mesuré à 0px, quand les autres champs
                // ont .8rem. Un peu plus qu'eux ici : les cartes pèsent visuellement plus lourd
                // qu'un champ (bordure colorée, nom en gras).
                margin-bottom: 1.2rem;
                color: $color-text-muted;
                text-transform: uppercase;
                letter-spacing: .14rem;
                font: $bold 1.05rem/1 $font-mono;
            }

            > .choices {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 1rem;

                > .choice {
                    display: block;
                    padding: 1.6rem;
                    background-color: $color-surface-1;
                    border: 1px solid $color-border-3;
                    border-radius: 12px;
                    cursor: pointer;
                    transition: border-color .15s ease, background-color .15s ease;

                    > .radio {
                        @include srOnly;
                    }

                    > .row > .name {
                        color: $color-text;
                        font: $bold 1.7rem/1 $font-title;
                    }

                    > .row > .dot {
                        flex: none;
                        width: 16px;
                        height: 16px;
                        border: 1.5px solid $color-status-grey;
                        border-radius: 50%;

                        > .core {
                            width: 8px;
                            height: 8px;
                            border-radius: 50%;
                            transition: background-color .15s ease;
                        }
                    }

                    // `:has()` plutôt qu'une classe posée par le script : l'état coché est déjà
                    // dans le DOM, le dupliquer créerait deux sources de vérité.
                    &:has(.radio:checked) {
                        background-color: rgba($color-primary, .07);
                        border-color: $color-primary;

                        > .row > .dot {
                            border-color: $color-primary;

                            > .core {
                                background-color: $color-primary;
                            }
                        }
                    }

                    // Le focus clavier vit sur le radio, qui est invisible : on le remonte sur toute
                    // la carte, sinon la navigation au clavier ne montre rien.
                    &:has(.radio:focus-visible) {
                        outline: 2px solid $color-primary-light;
                        outline-offset: 2px;
                    }

                    @media (hover: hover) {
                        &:hover:not(:has(.radio:checked)) {
                            border-color: $color-status-grey;
                        }
                    }
                }
            }
        }

        > .submit {
            margin-top: .6rem;
        }
    }
}
</style>
