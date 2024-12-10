<script setup>
const addForm = ref(false)
const movieName = ref("")
const selectedMedia = ref('cinema');
const client = useSupabaseClient();

const onHandleAdd = () => {
    addForm.value = true
}

const addMovie = async () => {
    try {
        const { data, error } = await client
            .from('calendar')
            .insert({
                title: movieName.value,
                media: selectedMedia.value,
                state: 'unseen'
            })
        if (error) throw error;
    } catch (error) {
        console.error("Erreur lors de l'insertion:", error.message);
    }
}

const closeForm = () => {
    addForm.value = false
}

const onMediaSelected = (option) => {
    selectedMedia.value = option;
}
</script>

<template>
    <div class="nav-header flex -align-center">
        <div class="nav-wrapper flex -align-center" v-if="!addForm">
            <button class="btn" @click="onHandleAdd">
                <Svg name="add"/>
            </button>
            <button class="btn flex">
                <Svg name="search"/>
            </button>
        </div>

        <form class="form flex -align-center" v-if="addForm" @submit.prevent>
        <input type="text" name="movie" id="movie" class="text-input input-body" placeholder="Titre du film"
                   v-model="movieName">
            <SelectBtn type="media" :selected="selectedMedia" @option-selected="onMediaSelected"
                       open-direction="bottom"/>
            <button class="btn" type="button" @click="addMovie">
                <Svg name="add"/>
            </button>
        </form>
        <button class="btn" @click="closeForm" v-if="addForm">
            <Svg name="close"/>
        </button>
    </div>
</template>

<style lang="scss" scoped>
.nav-header {
    z-index: 9999999;
    position: fixed;
    bottom: 5rem;
    left: 50%;
    transform: translateX(-50%);
    background-color: $color-grey;
    border-radius: 1rem;
    padding: 1rem;
    gap: .5rem;
}

.form, .nav-wrapper {
    gap: .5rem;
}

.text-input {
    border: none;
    background-color: $color-dark-grey;
    border-radius: .5rem;
    width: 25.6rem;
    padding: .6rem 1rem;
    height: 3.5rem;
    color: $color-white;
}

.btn {
    width: 3.5rem;
    height: 3.5rem;
    border-radius: .5rem;
    display: flex;
    justify-content: center;
    align-items: center;
    transition: background-color .2s linear;

    > svg {
        width: 2rem;
        height: auto;
    }
}

@media (hover: hover) {
    .btn:hover {
        background-color: $color-dark-grey;
    }
}
</style>