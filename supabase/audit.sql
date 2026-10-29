-- Sicherheits-Übersicht der Datenbank in EINER Abfrage (der SQL Editor zeigt nur das Ergebnis der letzten
-- Anweisung). Ändert nichts. Ergebnis über "Export -> Download CSV" speichern, z. B. als supabase/audit.csv.
select kind, name, detail from (
  -- Ist Row Level Security an?
  select '1 rls' as kind, c.relname::text as name, c.relrowsecurity::text as detail
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
  union all
  -- Alle Regeln
  select '2 policy', tablename || '.' || policyname,
         permissive || ' ' || cmd || ' to ' || array_to_string(roles, ',') ||
         ' USING ' || coalesce(qual, '-') || ' CHECK ' || coalesce(with_check, '-')
  from pg_policies where schemaname = 'public'
  union all
  -- Tabellenrechte der API-Rollen
  select '3 grant', table_name || ' ' || grantee, string_agg(privilege_type, ',' order by privilege_type)
  from information_schema.role_table_grants
  where table_schema = 'public' and grantee in ('anon', 'authenticated')
  group by table_name, grantee
  union all
  -- Wer darf welche Funktion aufrufen?
  select '4 func', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
         'definer=' || p.prosecdef || ' anon=' || has_function_privilege('anon', p.oid, 'execute') ||
         ' auth=' || has_function_privilege('authenticated', p.oid, 'execute') ||
         ' search_path=' || coalesce(array_to_string(p.proconfig, ','), '-')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
  union all
  -- Trigger auf public-Tabellen und auth.users
  select '5 trigger', t.tgrelid::regclass::text || '.' || t.tgname, pg_get_triggerdef(t.oid)
  from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
  where not t.tgisinternal and (n.nspname = 'public' or c.oid = 'auth.users'::regclass)
  union all
  -- Quelltext aller eigenen Funktionen (Admin, Schutz-Trigger, Konto löschen …)
  select '6 def', p.proname, pg_get_functiondef(p.oid)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f'
) x
order by kind, name;
