-- Coopérative CHG — annulation d'une transaction
--
-- Restaure le stock de chaque article vendu puis supprime la transaction
-- (les transaction_items cascadent). Réservé aux admins.
-- Le stock est restauré selon le snapshot du moment de la vente :
--   * unit_portion_grams null → +qty (pièces)
--   * unit_portion_grams = N  → +N*qty (grammes)

create or replace function public.cancel_transaction(tx_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item    record;
  v_restore int;
begin
  if not public.is_admin() then
    raise exception 'Réservé aux admins' using errcode = '42501';
  end if;

  if not exists (select 1 from public.transactions where id = tx_id) then
    raise exception 'Transaction introuvable' using errcode = '22023';
  end if;

  -- Restaure le stock pour chaque ligne (si le produit existe encore)
  for v_item in
    select ti.product_id, ti.qty, ti.unit_portion_grams
    from public.transaction_items ti
    where ti.transaction_id = tx_id
  loop
    if v_item.product_id is not null then
      v_restore := case
        when v_item.unit_portion_grams is null then v_item.qty
        else v_item.unit_portion_grams * v_item.qty
      end;
      update public.products
        set stock = stock + v_restore
        where id = v_item.product_id;
    end if;
  end loop;

  -- Supprime la transaction (les transaction_items cascadent)
  delete from public.transactions where id = tx_id;
end;
$$;

revoke all on function public.cancel_transaction(uuid) from public;
grant execute on function public.cancel_transaction(uuid) to authenticated;
