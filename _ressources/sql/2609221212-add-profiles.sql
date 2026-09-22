-- Profils utilisateur : la ville, et l'approbation du compte (plan 2609221212)
-- À exécuter une seule fois dans le SQL editor Supabase. Idempotent.
--
-- Première des quatre migrations qui ouvrent l'application à un second compte. Elle pose la notion
-- qui manquait complètement : un utilisateur a des propriétés. Jusqu'ici `auth.users` suffisait,
-- parce qu'il n'y avait qu'une réponse possible à « quelle ville ? » et à « ce compte a-t-il le
-- droit d'être là ? ».
--
-- Deux colonnes, deux rôles bien distincts :
--
--   - `city`     : le périmètre des séances. Lue par le serveur pour choisir la localisation
--                  Allociné et la clé du cache, par l'app pour masquer ce qui n'a pas de sens
--                  ailleurs qu'à Paris (carte UGC, temps de trajet). Contrainte fermée sur les deux
--                  villes connues de `shared/utils/cities.js` — une ville inconnue ferait sortir le
--                  serveur sur une localisation Allociné inexistante, autant l'arrêter ici.
--
--   - `approved` : la serrure. L'inscription est publique (`/register`), l'usage ne l'est pas. Un
--                  compte naît fermé et n'est ouvert qu'à la main, dans ce dashboard.
--
-- ⚠️ AUCUNE POLICY D'ÉCRITURE, ET C'EST LE CŒUR DU FICHIER. Une policy d'`update` même restreinte à
-- sa propre ligne (`user_id = auth.uid()`) laisserait n'importe quel compte passer son propre
-- `approved` à `true` : Postgres n'a pas de granularité « cette colonne seulement » dans une policy,
-- c'est déjà ce que constatait `2608151000-tighten-cinemas-rls.sql`. La serrure serait alors du
-- décor. La ligne est créée par `/api/auth/register` en service-role (que RLS ne regarde pas), et
-- modifiée par Alexis ici. Rien d'autre n'y touche.
--
-- ⚠️ Le même raisonnement vaut pour `city` : un compte ne change pas sa ville depuis le navigateur.
-- C'est hors périmètre du plan, et l'absence de policy d'écriture le garantit plutôt que de le
-- laisser à une convention.

-- 1. La table ------------------------------------------------------------------------------------
--
-- `user_id` en clé primaire et non une colonne `id` séparée : un utilisateur a exactement un profil,
-- une clé étrangère qui est aussi la clé primaire le dit mieux qu'une contrainte d'unicité.
--
-- `on delete cascade` : un compte supprimé dans le dashboard emporte son profil. Sans ça, une ligne
-- orpheline subsisterait et `approved` deviendrait illisible (approuvé, mais pour qui ?).

create table if not exists profiles (
  user_id    uuid primary key references auth.users on delete cascade,
  city       text        not null check (city in ('paris', 'troyes')),
  approved   boolean     not null default false,
  created_at timestamptz not null default now()
);

-- 2. RLS -----------------------------------------------------------------------------------------
--
-- Lecture de sa seule ligne. C'est tout ce dont l'app a besoin (`useProfile`), et c'est aussi tout
-- ce qu'on veut donner : la liste des comptes n'est l'affaire de personne côté navigateur.
--
-- ⚠️ Pas de policy `select` ouverte à `authenticated` sur toute la table, même « juste pour voir » :
-- elle permettrait d'énumérer les comptes existants depuis n'importe quelle session.

alter table profiles enable row level security;

drop policy if exists "profiles: lecture de son profil" on profiles;
create policy "profiles: lecture de son profil" on profiles
  for select to authenticated using (user_id = auth.uid());

-- 3. Le profil d'Alexis --------------------------------------------------------------------------
--
-- ⚠️ Par sous-requête sur l'e-mail, jamais un UUID recopié à la main : un identifiant collé de
-- travers ne lèverait pas d'erreur ici — il passerait la contrainte de clé étrangère s'il existe, ou
-- échouerait bruyamment s'il n'existe pas, mais dans le premier cas on aurait silencieusement donné
-- Paris et l'approbation au mauvais compte.
--
-- `on conflict do nothing` : rejouer ce fichier ne doit pas réécrire un profil déjà ajusté.

insert into profiles (user_id, city, approved)
select id, 'paris', true
from auth.users
where email = 'alexchoc521@gmail.com'
on conflict (user_id) do nothing;

-- Garde-fou : si la ligne n'est pas là, l'e-mail ne correspond à aucun compte et tout le reste du
-- chantier (backfill de `calendar`, favoris) viserait dans le vide. Mieux vaut l'apprendre
-- maintenant, à la première migration, qu'au moment où `calendar.user_id` passe en `not null`.
do $$
begin
  if not exists (select 1 from profiles where approved) then
    raise exception 'Aucun profil approuvé : l''e-mail alexchoc521@gmail.com ne correspond à aucun compte auth.users. Corrige-le avant de jouer les migrations suivantes.';
  end if;
end $$;
