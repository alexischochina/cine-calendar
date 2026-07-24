// Exécute `tasks` avec au plus `concurrency` promesses en vol simultanément.
// Chaque task est une fonction () => Promise. Renvoie les résultats dans l'ordre
// des tasks (comme Promise.all), mais sans saturer TMDB (évite le 429).
export const promisePool = async (tasks, concurrency = 8) => {
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
