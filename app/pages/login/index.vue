<script setup>
const client = useSupabaseClient();
const router = useRouter();
const email = ref("");
const password = ref("");
const errorMsg = ref(null);

async function signIn() {
    try {
        const { error } = await client.auth.signInWithPassword({
            email: email.value,
            password: password.value,
        });
        if (error) throw error;
        await router.push("/");
    } catch (error) {
        errorMsg.value = error.message;
    }
}
</script>

<template>
    <div class="page-login">
        <div class="wrapper -small -padded">
            <form @submit.prevent="signIn" class="form flex -direction-column -align-center">
                <div class="title-4">Connexion</div>
                <input type="email" v-model="email" placeholder="email" />
                <input type="password" v-model="password" placeholder="mot de passe" />
                <input type="submit" value="Se connecter" />
            </form>

            <p v-if="errorMsg" class="error">{{ errorMsg }}</p>
        </div>
    </div>
</template>

<style lang="scss" scoped>
.form {
    gap: 2rem;
    margin-top: 20rem;
    text-align: center;
}

input {
    max-width: 30rem;
}

.error {
    color: red;
    margin-top: 1rem;
}
</style>
