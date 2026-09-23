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
definePageMeta({ layout: 'auth', pageTransition: { name: 'auth', mode: 'out-in' } });
useHead({ title: 'Compte en attente' });

const router = useRouter();
const client = useSupabaseClient();
const user = useSupabaseUser();
const { profile, cityInfo, isApproved, loadProfile, refreshProfile } = useProfile();
const checking = ref(false);
const stillPending = ref(false);

// La page ne porte pas le middleware `auth` : sans ce chargement, la ville et la date resteraient
// vides.
await loadProfile();

// Sans session, il n'y a rien à attendre : c'est une connexion qu'il faut.
watchEffect(() => {
    if (!user.value) router.replace('/login');
});

// ⚠️ Les trois cellules tolèrent l'absence de donnée, et ce n'est pas de la prudence gratuite :
// profil absent (compte créé dans le dashboard) ou illisible rend `city: null` et `created_at:
// null`. Un tiret, jamais « undefined ».
const shownEmail = computed(() => user.value?.email ?? '—');
const shownCity = computed(() => (profile.value?.city ? cityInfo.value.label : '—'));
const shownDate = computed(() => {
    const raw = profile.value?.created_at;
    if (!raw) return '—';
    const date = new Date(raw);
    return isNaN(date) ? '—' : new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
});

// Le geste après approbation : Alexis bascule le drapeau dans le dashboard, et son père n'a qu'à
// cliquer ici plutôt que de se déconnecter et reconnecter.
async function recheck() {
    checking.value = true;
    stillPending.value = false;
    try {
        await refreshProfile();
        if (isApproved.value) {
            await router.push('/');
            return;
        }
        // Sans ce retour, le bouton semble mort : la page est déjà la bonne, rien ne bouge à
        // l'écran, et l'utilisateur ne sait pas si son clic a été pris en compte.
        stillPending.value = true;
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
    <div class="page-pending flex -direction-column">
        <div class="card">
            <div class="top flex -direction-column">
                <div class="status flex -align-center">
                    <span class="dot" />
                    <span class="label">En attente de validation</span>
                </div>
                <h1 class="title">Ta place est réservée.</h1>
                <p class="text">
                    Ton compte a bien été créé. Il doit être validé avant de pouvoir accéder à
                    l'application.
                </p>
            </div>

            <div class="split" aria-hidden="true">
                <span class="notch -left" />
                <span class="line" />
                <span class="notch -right" />
            </div>

            <div class="infos">
                <div class="info -wide">
                    <span class="key">Compte</span>
                    <span class="value">{{ shownEmail }}</span>
                </div>
                <div class="info">
                    <span class="key">Ville</span>
                    <span class="value">{{ shownCity }}</span>
                </div>
                <div class="info">
                    <span class="key">Demande</span>
                    <span class="value">{{ shownDate }}</span>
                </div>
            </div>
        </div>

        <AuthNotice v-if="stillPending">
            Ton compte n'est pas encore validé. Réessaie dans un moment.
        </AuthNotice>

        <AuthSubmitBtn type="button" label="Ma demande a été validée" loading-label="Vérification…"
                       :loading="checking" @click="recheck" />

        <button type="button" class="logout btn" @click="signOut">Se déconnecter</button>
    </div>
</template>

<style lang="scss" scoped>
// ⚠️ `btn` sur chaque `<button>` porteur de texte : `_btn.scss` met les autres à `font-size: 0`.
.page-pending {
    gap: 2.4rem;

    > .card {
        background-color: $color-surface-1;
        border: 1px solid $color-border-2;
        border-radius: 18px;
        overflow: hidden;

        > .top {
            gap: 1.6rem;
            padding: 2.4rem;

            > .status {
                gap: 1rem;

                > .dot {
                    width: 9px;
                    height: 9px;
                    border-radius: 50%;
                    background-color: $color-yellow;
                    animation: pending-pulse 1.8s ease-in-out infinite;
                }

                > .label {
                    color: $color-yellow;
                    text-transform: uppercase;
                    letter-spacing: .14rem;
                    font: $bold 1.05rem/1 $font-mono;
                }
            }

            > .title {
                color: $color-text;
                text-wrap: pretty;
                letter-spacing: -.1rem;
                font: 800 3.2rem/1.05 $font-title;
            }

            > .text {
                color: $color-text-muted;
                text-wrap: pretty;
                font: $normal 1.5rem/1.55 $font-body;
            }
        }

        > .split {
            position: relative;
            display: flex;
            align-items: center;
            height: 22px;

            > .notch {
                position: absolute;
                width: 22px;
                height: 22px;
                border: 1px solid $color-border-2;
                border-radius: 50%;
                background-color: $color-bg;

                &.-left {
                    left: -12px;
                }

                &.-right {
                    right: -12px;
                }
            }

            > .line {
                flex: 1;
                margin: 0 1.6rem;
                border-top: 2px dashed $color-border-4;
            }
        }

        > .infos {
            display: grid;
            grid-template-columns: 1fr auto;
            gap: 1.6rem 2rem;
            padding: 1.6rem 2.4rem 2.4rem;

            > .info {
                display: flex;
                flex-direction: column;
                gap: .4rem;
                // `min-width: 0` + l'ellipse sur la valeur : une adresse longue déborderait sinon la
                // carte au lieu d'être tronquée.
                min-width: 0;

                &.-wide {
                    grid-column: 1 / -1;
                }

                > .key {
                    // ⚠️ `$color-text-quiet` et non le `#565b66` de la maquette ($color-text-weak,
                    // 2,66:1) : ces libellés sont du texte informatif, et `_variables.scss` réserve
                    // explicitement $color-text-weak au décoratif. 4,51:1, donc AA.
                    color: $color-text-quiet;
                    text-transform: uppercase;
                    letter-spacing: .13rem;
                    font: $bold 1rem/1 $font-mono;
                }

                > .value {
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                    color: $color-text-body;
                    font: $semi-bold 1.5rem/1 $font-body;
                }
            }
        }
    }

    > .logout {
        width: 100%;
        color: $color-text-muted;
        text-align: center;
        transition: color .15s ease;
        font: $medium 1.4rem/1 $font-body;

        @include focusRing();

        @media (hover: hover) {
            &:hover {
                color: $color-text;
            }
        }
    }
}

@keyframes pending-pulse {
    0%, 100% { box-shadow: 0 0 0 0 rgba($color-yellow, .55); }
    50% { box-shadow: 0 0 0 7px rgba($color-yellow, 0); }
}

@media (prefers-reduced-motion: reduce) {
    .page-pending > .card > .top > .status > .dot {
        animation: none;
    }
}
</style>
