const useWindowSize = () => {
    const width = ref(0)
    const height = ref(0)
    const handleResize = () => {
        width.value = window.innerWidth
        height.value = window.innerHeight
    }

    onMounted(() => {
        window.addEventListener("resize", handleResize);
        handleResize()
    })

    onBeforeUnmount(() => {
        window.removeEventListener("resize", handleResize);
    })


    return {
        width,
        height
    };
}

export default useWindowSize;
