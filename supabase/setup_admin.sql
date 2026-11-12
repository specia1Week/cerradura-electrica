-- Última modificación: 2026-11-10
-- Crea el perfil ADMIN del panel para un usuario ya existente en Authentication.
--
-- Antes de ejecutarlo:
--   1. Crear el usuario en Supabase > Authentication > Users.
--   2. Reemplazar admin@universidad.edu por el email real.
--   3. Ejecutar este archivo completo en el SQL Editor.

do $$
declare
  v_user_id uuid;
begin
  select id
    into v_user_id
  from auth.users
  where lower(email) = lower('bw.ticona@e.usfa.edu.bo')
  limit 1;

  if v_user_id is null then
    raise exception 'No existe un usuario en Authentication con el email ingresado. Cree el usuario primero.';
  end if;

  insert into public.profiles (id, rol)
  values (v_user_id, 'ADMIN'::public.profile_rol)
  on conflict (id) do update set rol = excluded.rol;
end
$$;
