-- Colonne « date d'ajout à la liste à rattraper » (plan 2608031000 — suite : ordre d'ajout)
-- À exécuter une seule fois dans le SQL editor Supabase.
--
-- Ajoute à la table `calendar` :
--   - catchup_at : horodatage du moment où le film est marqué « à rattraper ». Sert à ordonner
--                  le slider « À rattraper » par ordre d'ajout (le dernier ajouté à droite), sans
--                  aucun tri par note. Posé à `now()` au marquage, remis à null au retrait.
--
-- Nullable. Les lignes déjà `catchup=true` avant cette migration restent à null : elles sont
-- traitées comme « les plus anciennes » (tri de repli par `id`), les nouveaux ajouts horodatés
-- se plaçant après → aucun backfill nécessaire.

alter table calendar
  add column if not exists catchup_at timestamptz;
