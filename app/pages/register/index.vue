<script setup>
// Inscription. Le compte naît fermé : la route serveur le crée avec `approved = false`, et Alexis
// l'ouvre à la main dans le dashboard Supabase. On n'ouvre donc **pas** de session ici — pas de
// `signUp` côté client, pas de connexion automatique — et on renvoie sur `/pending`.
//
// `CITIES` vient de l'auto-import de `shared/utils/cities.js` : la même table que celle dont se sert
// le serveur pour choisir la localisation Allociné. Une liste recopiée dans ce fichier aurait pu
// proposer une ville que le serveur ne sait pas traiter.
definePageMeta({ layout: false });
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
    <div class="page-register flex -align-center -justify-center">
        <div class="card">
            <h1 class="logo title-2">Ciné<span class="accent">genda</span></h1>

            <form class="form flex -direction-column" @submit.prevent="register">
                <div class="field flex -direction-column">
                    <label class="label small-body" for="email">Email</label>
                    <input id="email" v-model="email" class="text-input input-body" type="email"
                           placeholder="toi@exemple.fr" autocomplete="email" required />
                </div>

                <div class="field flex -direction-column">
                    <label class="label small-body" for="password">Mot de passe</label>
                    <input id="password" v-model="password" class="text-input input-body" type="password"
                           placeholder="8 caractères minimum" autocomplete="new-password" required />
                </div>

                <!-- `fieldset` / `legend` et non un `div` + `label` : c'est ce qui rattache les deux
                     boutons radio à leur question pour un lecteur d'écran. -->
                <fieldset class="field cities flex -direction-column">
                    <legend class="label small-body">Ville</legend>
                    <div class="choices flex">
                        <label v-for="option in cities" :key="option.key" class="choice input-body">
                            <input v-model="city" class="radio" type="radio" name="city" :value="option.key" />
                            <span class="name">{{ option.label }}</span>
                        </label>
                    </div>
                </fieldset>

                <p v-if="errorMsg" class="error small-body">{{ errorMsg }}</p>

                <button type="submit" class="btn submit-btn input-body" :disabled="loading">
                    {{ loading ? 'Création…' : 'Créer mon compte' }}
                </button>

                <NuxtLink class="alt-link small-body" to="/login">J'ai déjà un compte</NuxtLink>
            </form>
        </div>
    </div>
</template>

<style lang="scss" scoped>
// ⚠️ **`btn` sur chaque `<button>` porteur de texte, et ce n'est pas décoratif.**
// `components/_btn.scss` fait `button { @extend .ico-btn }`, et `.ico-btn:not(.btn)` pose
// `font-size: 0` — le projet suppose qu'un bouton est une icône tant qu'on ne dit pas l'inverse.
// Sans `btn`, le libellé est bien dans le DOM mais rendu à 0 px : invisible, et indétectable par un
// test qui lit `textContent`. C'est exactement ce qui est arrivé ici.
//
// ⚠️ Et `.ico-btn:not(.btn)` (0,2,0) l'emporte sur `.input-body` (0,1,0) : la classe utilitaire de
// typo ne rattrape pas l'oubli. Seul `btn` le fait.
// ⚠️ Aucune propriété typographique ici : `title-2`, `input-body` et `small-body` sont posées en
// markup et apportent la typo. Et aucune classe utilitaire (`.flex`, `.title-2`, `.input-body`…)
// n'est utilisée comme sélecteur — on cible toujours la classe dédiée de l'élément.
.page-register {
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
    border: none;
    padding: 0;
    // `min-width: 0` : un `fieldset` porte une largeur intrinsèque qui l'empêche de se réduire sous
    // la taille de son contenu. Sans ça, un libellé long déborderait la carte.
    min-width: 0;
}

.label {
    color: $color-text-muted;
    text-transform: uppercase;
    letter-spacing: .08em;
    padding: 0;
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

.choices {
    gap: .8rem;
}

.choice {
    flex: 1;
    display: flex;
    align-items: center;
    gap: .8rem;
    background-color: $color-surface-4;
    border: 1px solid $color-border-4;
    border-radius: .8rem;
    padding: 1rem 1.6rem;
    color: $color-text-body;
    cursor: pointer;
    transition: border-color .15s ease, background-color .15s ease;

    // `:has()` plutôt qu'une classe posée par le script : l'état coché est déjà dans le DOM, le
    // dupliquer dans un `ref` créerait deux sources de vérité pour la même information.
    &:has(.radio:checked) {
        border-color: $color-primary;
        background-color: $color-hover;
    }

    // Le focus clavier vit sur le `input`, qui est visuellement discret : on le remonte sur toute
    // l'étiquette, sinon la navigation au clavier ne montre rien.
    &:has(.radio:focus-visible) {
        border-color: $color-primary-light;
    }
}

.radio {
    accent-color: $color-primary;
    // `flex-shrink` : sans lui, un libellé long écrase le bouton radio au lieu de passer à la ligne.
    flex-shrink: 0;
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
