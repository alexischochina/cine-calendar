// La bande de sept jours de la vue Séances : quel jour est affiché, et comment elle se recale quand
// la visite traverse minuit.
//
// Extrait de `useSeances` pour la même raison que `useShowtimes` avant lui : c'est une
// responsabilité entière — un calendrier — qui ne partage rien avec le filtrage des séances ni avec
// le référentiel des salles. Les clés `useState` sont conservées à l'identique (`seancesDay`,
// `seancesToday`), c'est le même état qu'avant l'extraction.

const DAYS_AHEAD = SEANCES_HORIZON_DAYS;
const DAY_NAMES = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
const MSHORT = ['JAN', 'FÉV', 'MAR', 'AVR', 'MAI', 'JUN', 'JUL', 'AOÛ', 'SEP', 'OCT', 'NOV', 'DÉC'];

const pad = (n) => String(n).padStart(2, '0');

export function useSeanceDays() {
    const dayIndex = useState('seancesDay', () => 0);

    // Jour de référence de la bande. **Réactif**, et c'est tout l'enjeu : `new Date()` n'est pas une
    // dépendance réactive, donc `days` se figeait au montage et une visite ouverte à travers minuit
    // continuait d'appeler « Auj. » la veille.
    const today = useState('seancesToday', () => isoDay(0));

    const days = computed(() => {
        // Midi et non minuit : ajouter des jours à partir de midi traverse les changements d'heure
        // sans jamais retomber sur la veille.
        const [y, m, d] = today.value.split('-').map(Number);
        const base = new Date(y, m - 1, d, 12, 0, 0, 0);

        return Array.from({ length: DAYS_AHEAD }, (_, i) => {
            const day = new Date(base);
            day.setDate(base.getDate() + i);
            return {
                index: i,
                date: `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`,
                dow: i === 0 ? 'Auj.' : DAY_NAMES[day.getDay()],
                dd: pad(day.getDate()),
                month: MSHORT[day.getMonth()],
                today: i === 0,
            };
        });
    });

    const selectedDay = computed(() => days.value[dayIndex.value] ?? days.value[0]);

    // La date a-t-elle changé depuis que la page est ouverte ? Si oui, on repart d'une semaine juste :
    // nouvelle bande, retour sur « aujourd'hui ». Renvoie `true` quand ça a bougé — l'appelant en
    // profite pour purger son cache des journées désormais révolues et recharger.
    //
    // Le rechargement n'est **pas** fait ici : ce composable tient un calendrier, il ne sait rien des
    // séances. Le rendre responsable du `load()` le rendrait indissociable de `useSeances`, et
    // l'extraction n'aurait servi à rien.
    const rollToToday = () => {
        const now = isoDay(0);
        if (now === today.value) return false;

        today.value = now;
        dayIndex.value = 0;
        return true;
    };

    return { days, dayIndex, selectedDay, today, rollToToday };
}
