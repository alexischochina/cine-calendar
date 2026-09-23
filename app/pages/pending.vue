<script setup>
// Où l'on atterrit avec un compte qui existe mais n'est pas encore ouvert.
//
// Cette page ne porte **pas** le middleware `auth` : c'est lui qui y envoie, l'y soumettre ferait
// une boucle de redirection.
//
// Elle couvre trois situations que l'utilisateur ne peut pas distinguer, et qu'on ne cherche pas à
// lui expliquer : compte fraîchement créé en attente d'approbation, profil absent (compte créé
// directement dans le dashboard, hors du parcours d'inscription), et lecture du profil en échec.
// Dans les trois cas la conduite à tenir est la même — attendre, puis réessayer.
definePageMeta({ layout: false });
useHead({ title: 'Compte en attente' });

const router = useRouter();
const client = useSupabaseClient();
const user = useSupabaseUser();
const { isApproved, refreshProfile } = useProfile();
const checking = ref(false);

// Sans session, il n'y a rien à attendre : c'est une connexion qu'il faut.
watchEffect(() => {
    if (!user.value) router.replace('/login');
});

// Relit le profil. C'est le geste après approbation : Alexis bascule le drapeau dans le dashboard,
// et son père n'a qu'à cliquer ici — pas besoin de se déconnecter et reconnecter, ce que l'absence
// de bouton de déconnexion rendrait d'ailleurs pénible.
async function recheck() {
    checking.value = true;
    try {
        await refreshProfile();
        if (isApproved.value) await router.push('/');
    } finally {
        checking.value = false;
    }
}

// Seule sortie de secours de l'application, et elle est ici plutôt que dans la navigation : un
// compte non approuvé ne voit jamais la navigation. Sans ce bouton, se tromper de compte à
// l'inscription enfermerait sur cette page — le cookie dure un an (`nuxt.config.ts`).
async function signOut() {
    await client.auth.signOut();
    await router.push('/login');
}
</script>

<template>
    <div class="page-pending flex -align-center -justify-center">
        <div class="card">
            <h1 class="logo title-2">Ciné<span class="accent">genda</span></h1>

            <div class="message flex -direction-column">
                <p class="title title-5">Compte en attente de validation</p>
                <p class="text body">
                    Ton compte a bien été créé. Il doit être validé avant de pouvoir accéder à
                    l'application — tu seras prévenu une fois que c'est fait.
                </p>
            </div>

            <div class="actions flex -direction-column">
                <button type="button" class="btn submit-btn input-body" :disabled="checking" @click="recheck">
                    {{ checking ? 'Vérification…' : 'J\'ai été validé' }}
                </button>
                <button type="button" class="btn alt-link small-body" @click="signOut">Se déconnecter</button>
            </div>
        </div>
    </div>
</template>

<style lang="scss" scoped>
// ⚠️ `btn` sur chaque `<button>` porteur de texte : `_btn.scss` met les autres à `font-size: 0`.
// ⚠️ Aucune propriété typographique ici : `title-2`, `title-5`, `body`, `input-body` et `small-body`
// sont posées en markup. Aucune classe utilitaire n'est utilisée comme sélecteur.
.page-pending {
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

.message {
    gap: .8rem;
    text-align: center;

    > .title {
        color: $color-text;
    }

    > .text {
        color: $color-text-muted;
    }
}

.actions {
    gap: 1.6rem;
}

.submit-btn {
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
