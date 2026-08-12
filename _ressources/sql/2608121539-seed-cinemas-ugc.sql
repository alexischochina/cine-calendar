-- Salles acceptant la carte UGC Illimité (plan 2608121539 — page « Séances »)
-- À exécuter APRÈS `2608121539-add-allocine-showtimes.sql` et après un premier affichage de la vue
-- Séances (c'est elle qui peuple `cinemas`). Relançable : idempotent, il repose l'état complet.
--
-- ✅ Liste **validée par l'utilisateur le 12/08/2026**, dans cette configuration : 33 salles sur
-- les 48 salles parisiennes relevées.
--
-- Point de départ : le champ `loyaltyCards` d'Allociné, repris uniquement pour ne pas partir d'une
-- page blanche. La liste reste **curée à la main** et ne sera jamais re-scrapée : Allociné porte
-- bien cette donnée mais a déjà été pris en flagrant délit d'erreur dessus (cas rapporté : une
-- salle annoncée comme prenant la carte CIP, contredite par toutes les autres sources).
-- Pour l'amender : déplacer une ligne d'un bloc à l'autre, puis rejouer ce fichier.
--
-- Le `update … in (…)` puis `update … not in (…)` pose l'état des deux côtés : une salle retirée de
-- la liste repasse bien à `false`, elle ne reste pas marquée par inadvertance.

-- Salles où la carte passe -----------------------------------------------------------------------
update cinemas set accepts_ugc = true, updated_at = now() where code in (
  'C0159',          -- UGC Ciné Cité Les Halles (75001)
  'C0065',          -- Le Grand Rex (75002)
  'C0050',          -- MK2 Beaubourg (75003)
  'C0015',          -- Christine Cinéma Club (75006)
  'C0054',          -- L'Arlequin (75006)
  'C0097',          -- MK2 Odéon (Côté St Germain) (75006)
  'C0099',          -- MK2 Parnasse (75006)
  'C0100',          -- Saint-André des Arts (75006)
  'C0102',          -- UGC Danton (75006)
  'C0103',          -- UGC Montparnasse (75006)
  'C0104',          -- UGC Odéon (75006)
  'C0105',          -- UGC Rotonde (75006)
  'C0108',          -- Elysées Lincoln (75008)
  'C0012',          -- Les Cinq Caumartin (75009)
  'C0126',          -- UGC Opéra (75009)
  'C0023',          -- Le Brady (75010)
  'W7510',          -- Le Louxor - Palais du cinéma (75010)
  'C0140',          -- MK2 Bastille (côté Beaumarchais) (75011)
  'C0040',          -- MK2 Bastille (côté Fg St Antoine) (75011)
  'C0144',          -- MK2 Nation (75012)
  'C0026',          -- UGC Ciné Cité Bercy (75012)
  'C0146',          -- UGC Lyon Bastille (75012)
  'C2954',          -- MK2 Bibliothèque (75013)
  'C0150',          -- UGC Gobelins (75013)
  'C0005',          -- L'Entrepôt (75014)
  'C0025',          -- Sept Parnassiens (75014)
  'W7515',          -- Cinéma Chaplin Saint Lambert (75015)
  'C0120',          -- Majestic Passy (75016)
  'C0175',          -- UGC Ciné Cité Maillot (75017)
  'C1621',          -- MK2 Quai de Loire (75019)
  'C0003',          -- MK2 Quai de Seine (75019)
  'W7509',          -- UGC Ciné Cité Paris 19 (75019)
  'C0192'           -- MK2 Gambetta (75020)
);

-- Salles où elle ne passe pas --------------------------------------------------------------------
-- Pour référence, les 15 autres salles parisiennes relevées le 12/08/2026 (essentiellement le
-- circuit Pathé, qui a sa propre carte) — remonter une ligne dans le bloc ci-dessus si besoin :
--   'C0060'  Pathé BNP Paribas (ex Opéra premier) (75002)
--   'C0096'  Le Saint Germain des Prés (75006)
--   'G02BG'  Pathé Palace (75009)
--   'C0024'  Pathé Les Fauvettes (75013)
--   'C0037'  Pathé Alésia - Dolby Cinema (75014)
--   'C0052'  Pathé Montparnos (75014)
--   'C0158'  Pathé Parnasse - Premium (75014)
--   'C0116'  Pathé Aquaboulevard (75015)
--   'W7502'  Pathé Beaugrenelle - Dolby Cinema (75015)
--   'C0161'  Pathé Convention (75015)
--   'P7517'  7 Batignolles (75017)
--   'C0179'  Pathé Wepler (75018)
--   'C0189'  La Géode - IMAX (75019)
--   'W7520'  Pathé La Villette - IMAX (75019)
--   'W7519'  CGR Paris - Lilas (75020)
--
-- Tout ce qui n'est pas dans le bloc « oui » repasse à false, y compris les salles apparues depuis.
update cinemas set accepts_ugc = false, updated_at = now() where code not in (
  'C0159', 'C0065', 'C0050', 'C0015', 'C0054', 'C0097', 'C0099', 'C0100', 'C0102',
  'C0103', 'C0104', 'C0105', 'C0108', 'C0012', 'C0126', 'C0023', 'W7510', 'C0140',
  'C0040', 'C0144', 'C0026', 'C0146', 'C2954', 'C0150', 'C0005', 'C0025', 'W7515',
  'C0120', 'C0175', 'C1621', 'C0003', 'W7509', 'C0192'
);
