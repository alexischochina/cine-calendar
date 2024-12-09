<script setup>
const client = useSupabaseClient();
const email = ref("");
const password = ref("");
const errorMsg = ref(null);
const successMsg = ref(null);

async function signUp() {
    try {
        const { data, error } = await client.auth.signUp({
            email: email.value,
            password: password.value,
        });
        if (error) throw error;
        successMsg.value = "Check your email to confirm your account";
        console.log("Signup successful");
    } catch (error) {
        errorMsg.value = error.message;
        console.log(error.message);
    }
}
</script>

<template>
    <div class="page-login">
        <div class="wrapper -small -padded">
            <form @submit.prevent="signUp" class="form flex -direction-column -align-center">
                <div class="title-4">Inscription</div>
                <input type="email" v-model="email" placeholder="email" />
                <input type="password" v-model="password" placeholder="mot de passe" />
                <input type="submit" value="S'inscrire" />
            </form>
            <p v-if="errorMsg" class="error">{{ errorMsg }}</p>
            <p v-if="successMsg" class="success">{{ successMsg }}</p>
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
</style>