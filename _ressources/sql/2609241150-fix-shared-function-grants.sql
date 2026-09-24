-- Fermer `shared_list_owner_ids()` à `anon` (correctif de 2609231743)
-- À exécuter une seule fois dans le SQL editor Supabase, APRÈS `2609231743`. Idempotent.
--
-- ⚠️⚠️ **`revoke … from anon` ne retire rien.** `create function` accorde `execute` à **`public`** par
-- défaut, et `anon` est membre de `public` : révoquer le droit du rôle sans révoquer celui du groupe
-- laisse la fonction ouverte. C'est ce que faisait `2609231743`, sans erreur et sans effet — un appel
-- RPC avec la seule clé anon rendait les UUID des comptes qui partagent (mesuré le 24/09/2026).
--
-- **Portée de la fuite :** des UUID de comptes, rien d'autre. Pas de nom, pas d'adresse, aucune
-- donnée — `profiles` restait fermée à `anon`, et toutes les policies exigent `is_approved()`. Ce qui
-- justifie ce correctif n'est pas la gravité, c'est qu'un commentaire affirmait une restriction
-- inexistante.
--
-- ⚠️ `is_approved()` (`2609231006`) porte le même grant implicite et **on n'y touche pas** : elle ne
-- rend qu'un booléen sur l'appelant, son `grant … to anon` y est explicite et raisonné.

-- 1. Le droit ------------------------------------------------------------------------------------
--
-- `from public` d'abord : c'est lui qui portait le droit. `from anon` ensuite, no-op aujourd'hui mais
-- qui survivrait à un `grant … to anon` posé par mégarde.

revoke execute on function public.shared_list_owner_ids() from public;
revoke execute on function public.shared_list_owner_ids() from anon;
grant  execute on function public.shared_list_owner_ids() to authenticated;

-- 2. Contrôle ------------------------------------------------------------------------------------
--
-- ⚠️ `has_function_privilege` teste le droit **effectif**, héritage de `public` compris — la seule
-- question qui compte, et celle que le fichier précédent ne posait pas.

do $$
begin
  if has_function_privilege('anon', 'public.shared_list_owner_ids()', 'EXECUTE') then
    raise exception 'shared_list_owner_ids() est encore exécutable par anon (droit hérité de public ?).';
  end if;

  if not has_function_privilege('authenticated', 'public.shared_list_owner_ids()', 'EXECUTE') then
    raise exception 'shared_list_owner_ids() n''est plus exécutable par authenticated — les listes partagées ne se liront plus.';
  end if;

  raise notice 'shared_list_owner_ids() : exécutable par authenticated, fermée à anon.';
end $$;

-- 3. Après ---------------------------------------------------------------------------------------
--
-- ⚠️ À rejouer si `2609231743` l'est : son `create or replace function` réinitialise l'ACL et rouvre
-- le droit à `public`.
--
-- Contrôle depuis un terminal, sans session (doit rendre une erreur de permission) :
--
--   curl -s -X POST "$SUPABASE_URL/rest/v1/rpc/shared_list_owner_ids" \
--        -H "apikey: $SUPABASE_KEY" -H "Authorization: Bearer $SUPABASE_KEY" \
--        -H "Content-Type: application/json" -d '{}'
