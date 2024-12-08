const useLoadSvg = (name) => {
    const modules = import.meta.glob("~/assets/svg/**/*.svg", {
        import: "default",
        eager: true,
    });

    return computed(() => {
        const svgFile = modules[`/assets/svg/${name.value ?? ''}.svg`] ?? null;
        if (!svgFile) {
            console.error(`Couldn't find SVG with name ${name.value}`);
        }
        return svgFile;
    });
};

export default useLoadSvg;
