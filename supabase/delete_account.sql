-- RGPD right to erasure (applied in prod 2026-10-05): a signed-in user deletes their own account;
-- trades, connected_accounts and goals go with it (FK on delete cascade). Called from Account > DELETE ACCOUNT.
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not signed in'; end if;
  delete from auth.users where id = uid;
end;
$$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
