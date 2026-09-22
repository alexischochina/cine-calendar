// Rafraîchissement d'un film pour une date :
// `GET /api/allocine/refresh?id={allocineId}&date=YYYY-MM-DD`
//
// Appelée uniquement pour les films que la lecture groupée a déclarés absents ou périmés, un par appel
// — le client les parallélise, ce qui garde chaque invocation courte.
//
// Le cycle lui-même (relire → décider → rafraîchir → réécrire) vit dans
// `server/utils/refreshShowtimes.js`, partagé avec le préchauffage planifié : cette route n'est plus
// que sa garde, sa validation et son client Supabase.

import { serverSupabaseClient } from '#supabase/server';

export default defineEventHandler(async (event) => {
    // Seule route de la vue Séances *ouverte au navigateur* qui sort sur le réseau : elle ne s'ouvre
    // ni aux anonymes ni aux comptes non approuvés (cf. `server/utils/requireUser.js`).
    //
    // Le profil rend la **ville** au passage : la garde lit déjà cette ligne pour vérifier
    // l'approbation, autant s'en servir plutôt que de repayer une requête.
    const { profile } = await requireUser(event);

    const { id, date, force } = getQuery(event);

    if (!/^\d+$/.test(String(id ?? ''))) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid allocine id' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date ?? ''))) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid date' });
    }

    const client = await serverSupabaseClient(event);

    // Seul `payload` sort d'ici ; `refreshed` ne sert qu'au préchauffage (cf. `refreshShowtimes`).
    //
    // ⚠️ `profile.city` et non un paramètre d'URL : la ville décide de la localisation Allociné **et**
    // de la clé sous laquelle le résultat est gravé. La laisser choisir par l'appelant, c'est lui
    // laisser faire sortir le déploiement sur la ville de son choix, et polluer la partition d'un
    // autre compte.
    const { payload } = await refreshShowtimes(client, Number(id), String(date), cityOf(profile.city), {
        force: String(force ?? '') === '1',
    });

    return payload;
});
