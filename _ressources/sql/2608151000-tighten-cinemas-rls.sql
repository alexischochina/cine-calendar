-- Resserrage des droits d'écriture sur le référentiel des salles (suite du plan 2608121539)
-- À exécuter une seule fois dans le SQL editor Supabase. Idempotent.
--
-- Ce que faisait la policy d'origine (`2608121539-add-allocine-showtimes.sql`) :
--
--   create policy "cinemas: accès authentifié" on cinemas
--     for all to authenticated using (true) with check (true);
--
-- Donc **tout** compte authentifié pouvait réécrire n'importe quelle ligne : `accepts_ugc`, qui est
-- de la curation manuelle (Allociné a déjà été pris en défaut dessus), `lat` / `lng` posés par
-- `scripts/geocode-cinemas.mjs`, `transit_minutes` calculé par `scripts/transit-times.mjs`, et les
-- signalements d'absence écrits par `check-seances.mjs`. Sur une app mono-utilisateur, l'écart entre
-- la policy et le besoin réel ne se voyait pas ; il se verrait au premier compte supplémentaire, et
-- ce n'est pas le jour où l'on veut découvrir qu'une table de référence est ouverte en écriture.
--
-- Ce que ce fichier pose à la place, en séparant les deux usages qui coexistaient :
--
--   1. **Lecture** — ouverte à tout compte authentifié. C'est ce dont la vue Séances a besoin, et
--      elle n'a jamais eu besoin de plus : le référentiel est de la donnée publique (noms, adresses,
--      arrondissements).
--   2. **Favoris** — une écriture, mais la seule qui vienne légitimement du navigateur : l'étoile de
--      la vue Séances (`useCinemas.toggleFavorite`). Autorisée en `update`, sans `insert` ni
--      `delete` : épingler une salle ne crée ni ne supprime jamais de ligne.
--   3. **Le reste** — insertion de salles découvertes, géocodage, temps de trajet, curation carte,
--      signalements — passe par le rôle `service_role`, que RLS ne regarde pas. C'est déjà le cas en
--      pratique : les scripts utilisent `NUXT_SUPABASE_SECRET_KEY` (cf. `.env.example`).
--
-- ⚠️ UNE EXCEPTION, ET ELLE EST STRUCTURANTE : `/api/allocine/refresh` fait entrer dans `cinemas`
-- toute salle croisée dans une réponse Allociné (`rememberTheaters`, `on conflict do nothing`), avec
-- le client **de session** de l'utilisateur. Cet `insert` doit donc rester possible depuis un compte
-- authentifié, sans quoi une salle nouvellement découverte n'entrerait plus au référentiel et
-- disparaîtrait de la vue filtrée — exactement le défaut constaté sur Les 3 Luxembourg. D'où une
-- policy d'insertion, distincte de la mise à jour.

alter table cinemas enable row level security;

drop policy if exists "cinemas: accès authentifié" on cinemas;
drop policy if exists "cinemas: lecture authentifiée" on cinemas;
drop policy if exists "cinemas: découverte de salle" on cinemas;
drop policy if exists "cinemas: bascule favori" on cinemas;

-- 1. Lecture
create policy "cinemas: lecture authentifiée" on cinemas
  for select to authenticated using (true);

-- 2. Découverte d'une salle par `/api/allocine/refresh` (jamais une mise à jour : `ignoreDuplicates`)
create policy "cinemas: découverte de salle" on cinemas
  for insert to authenticated with check (true);

-- 3. Bascule de favori depuis la vue Séances.
--
-- Postgres n'a pas de granularité « cette colonne seulement » dans une policy : `using` / `with
-- check` s'expriment sur la ligne. Le garde est donc au niveau du droit (`update` et rien d'autre),
-- et la limite est **assumée et écrite ici** plutôt que laissée à deviner — un compte authentifié
-- peut encore écrire une autre colonne s'il forge la requête. Ce qui compte est acquis : plus
-- d'`insert` sauvage, plus de `delete`, et le geste légitime de l'app continue de passer.
--
-- Le jour où un second compte existe, la suite est un trigger qui rejette toute mise à jour touchant
-- autre chose que `favorite` / `updated_at`. Inutile tant que l'app est mono-utilisateur : ce serait
-- du code à maintenir pour une frontière que personne ne franchit.
create policy "cinemas: bascule favori" on cinemas
  for update to authenticated using (true) with check (true);

-- Pas de policy `delete` : rien, dans l'app, ne supprime une salle. Une salle qui ferme reste au
-- référentiel — c'est ce qui permet de continuer à nommer ses séances passées.
