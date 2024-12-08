import useWindowSize from "~/composables/useWindowSize";

const useWindowBreakpoints = () => {
    const isMobile = ref(false)
    const isTabletPortrait = ref(false)
    const isTablet = ref(false)


    const {width} = useWindowSize()
    const handleResize = () => {
        isMobile.value = width.value <= 767
        isTabletPortrait.value = width.value <= 960
        isTablet.value = width.value <= 1024
    }

    onMounted(() => {
        window.addEventListener("resize", handleResize);
        handleResize()
    })

    onBeforeUnmount(() => {
        window.removeEventListener("resize", handleResize);
    })


    return {
        isMobile,
        isTabletPortrait,
        isTablet
    };
}

export default useWindowBreakpoints
