// Copie minimale de `app/utils/promisePool.js` pour le contexte serveur : les deux moitiés du
// projet ont leurs propres auto-imports (Nuxt scanne `app/utils/`, Nitro `server/utils/`), et
// importer à travers la frontière ferait entrer du code app dans le bundle Nitro.
//
// Ici la concurrence sert à borner le volume *sortant* vers Allociné, pas à éviter un 429.
export const promisePool = async (tasks, concurrency = 4) => {
    const results = new Array(tasks.length);
    let cursor = 0;

    const worker = async () => {
        while (cursor < tasks.length) {
            const index = cursor++;
            results[index] = await tasks[index]();
        }
    };

    const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, worker);
    await Promise.all(workers);
    return results;
};
