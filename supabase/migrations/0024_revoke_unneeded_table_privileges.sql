-- Least privilege: the website's public / signed-in roles only ever READ through
-- row-level-security. TRUNCATE (not covered by RLS), REFERENCES and TRIGGER are
-- never needed by them, so remove those grants. No behaviour change.
revoke truncate, references, trigger on all tables in schema public from anon, authenticated;
alter default privileges in schema public revoke truncate, references, trigger on tables from anon, authenticated;
