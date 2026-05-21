-- Coopérative CHG — les vendeurs peuvent voir et annuler LEURS propres ventes
--
-- 1) RLS : un vendeur ne lit que ses transactions ; un admin lit tout.
-- 2) cancel_transaction : un admin annule tout ; un vendeur annule ses propres ventes.

-- =========================================================
-- 1) RLS lecture (idempotent — re-applique la restriction)
-- =========================================================

drop policy if exists transactions_read on public.transactions;
create policy transactions_read on public.transactions
  for select using (public.is_admin() or seller_id = auth.uid());

drop policy if exists tx_items_read on public.transaction_items;
create policy tx_items_read on public.transaction_items
  for select using (
    public.is_admin()
    or exists (
      select 1 from public.transactions t
      where t.id = transaction_id and t.seller_id = auth.uid()
    )
  );

-- =========================================================
-- 2) Annulation : propriétaire de la vente OU admin
-- =========================================================

create or replace function public.cancel_transaction(tx_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item    record;
  v_restore int;
  v_seller  uuid;
begin
  if not public.is_active_user() then
    raise exception 'Compte désactivé' using errcode = '28000';
  end if;

  select seller_id into v_seller from public.transactions where id = tx_id;
  if v_seller is null then
    raise exception 'Transaction introuvable' using errcode = '22023';
  end if;

  -- Un admin peut tout annuler ; un vendeur seulement ses propres ventes.
  if not public.is_admin() and v_seller <> auth.uid() then
    raise exception 'Vous ne pouvez annuler que vos propres ventes' using errcode = '42501';
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
