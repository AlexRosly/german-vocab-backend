BEGIN;
-- Archive is reversible; existing users remain active.
ALTER TABLE "users" ADD COLUMN "archivedAt" TIMESTAMP(3);

-- Append-only shared-card history. No backfill and no changes to existing rows.
CREATE TABLE "word_audit_events" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "wordId" TEXT NOT NULL, "wordGerman" TEXT NOT NULL,
  "entity" TEXT NOT NULL, "action" TEXT NOT NULL,
  "before" JSONB, "after" JSONB,
  "actorId" TEXT, "actorRole" TEXT, "transactionId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "word_audit_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "word_audit_events_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "word_audit_events_createdAt_id_idx" ON "word_audit_events"("createdAt" DESC,"id" DESC);
CREATE INDEX "word_audit_events_wordId_createdAt_idx" ON "word_audit_events"("wordId","createdAt" DESC);

CREATE FUNCTION public.wortkarten_audit_word_change() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $wk_audit$
DECLARE
  previous JSONB; following JSONB; material JSONB;
  ids TEXT[]; current_id TEXT; spelling TEXT; actor_id TEXT; actor_role TEXT;
BEGIN
  IF TG_OP <> 'INSERT' THEN previous := to_jsonb(OLD) - ARRAY['createdAt','updatedAt','createdByUserId','revision']; END IF;
  IF TG_OP <> 'DELETE' THEN following := to_jsonb(NEW) - ARRAY['createdAt','updatedAt','createdByUserId','revision']; END IF;
  IF previous IS NOT DISTINCT FROM following THEN RETURN NULL; END IF;
  material := COALESCE(following, previous);
  IF TG_TABLE_NAME = 'words' THEN ids := ARRAY[material->>'id'];
  ELSIF TG_TABLE_NAME = 'word_relations' THEN ids := ARRAY[material->>'leftWordId',material->>'rightWordId'];
  ELSIF TG_TABLE_NAME = 'word_collocations' THEN ids := ARRAY[material->>'nounWordId',material->>'verbWordId'];
  ELSIF TG_TABLE_NAME = 'word_example_translations' THEN
    SELECT ARRAY[e."wordId"] INTO ids FROM public.word_examples e WHERE e.id=material->>'exampleId';
  ELSIF TG_TABLE_NAME = 'word_collocation_translations' THEN
    SELECT ARRAY[c."nounWordId",c."verbWordId"] INTO ids FROM public.word_collocations c WHERE c.id=material->>'collocationId';
  ELSE ids := ARRAY[material->>'wordId']; END IF;
  actor_id := NULLIF(current_setting('wortkarten.actor_id', true),'');
  actor_role := NULLIF(current_setting('wortkarten.actor_role', true),'');
  IF actor_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.users u WHERE u.id=actor_id) THEN actor_id := NULL; END IF;
  IF actor_role NOT IN ('ADMIN','USER') THEN actor_role := NULL; END IF;
  FOR current_id IN SELECT DISTINCT v FROM unnest(ids) AS v WHERE v IS NOT NULL LOOP
    IF TG_TABLE_NAME = 'words' THEN spelling := material->>'german';
    ELSE SELECT w.german INTO spelling FROM public.words w WHERE w.id=current_id; END IF;
    IF spelling IS NOT NULL THEN
      INSERT INTO public.word_audit_events("wordId","wordGerman",entity,action,"before","after","actorId","actorRole","transactionId")
      VALUES(current_id,spelling,TG_TABLE_NAME,TG_OP,previous,following,actor_id,actor_role,txid_current()::text);
    END IF;
  END LOOP;
  RETURN NULL;
END;
$wk_audit$;

CREATE TRIGGER wk_audit_words AFTER INSERT OR UPDATE OR DELETE ON public.words FOR EACH ROW EXECUTE FUNCTION public.wortkarten_audit_word_change();
CREATE TRIGGER wk_audit_word_translations AFTER INSERT OR UPDATE OR DELETE ON public.word_translations FOR EACH ROW EXECUTE FUNCTION public.wortkarten_audit_word_change();
CREATE TRIGGER wk_audit_word_examples AFTER INSERT OR UPDATE OR DELETE ON public.word_examples FOR EACH ROW EXECUTE FUNCTION public.wortkarten_audit_word_change();
CREATE TRIGGER wk_audit_word_example_translations AFTER INSERT OR UPDATE OR DELETE ON public.word_example_translations FOR EACH ROW EXECUTE FUNCTION public.wortkarten_audit_word_change();
CREATE TRIGGER wk_audit_word_relations AFTER INSERT OR UPDATE OR DELETE ON public.word_relations FOR EACH ROW EXECUTE FUNCTION public.wortkarten_audit_word_change();
CREATE TRIGGER wk_audit_word_source_books AFTER INSERT OR UPDATE OR DELETE ON public.word_source_books FOR EACH ROW EXECUTE FUNCTION public.wortkarten_audit_word_change();
CREATE TRIGGER wk_audit_word_verb_forms AFTER INSERT OR UPDATE OR DELETE ON public.word_verb_forms FOR EACH ROW EXECUTE FUNCTION public.wortkarten_audit_word_change();
CREATE TRIGGER wk_audit_word_collocations AFTER INSERT OR UPDATE OR DELETE ON public.word_collocations FOR EACH ROW EXECUTE FUNCTION public.wortkarten_audit_word_change();
CREATE TRIGGER wk_audit_word_collocation_translations AFTER INSERT OR UPDATE OR DELETE ON public.word_collocation_translations FOR EACH ROW EXECUTE FUNCTION public.wortkarten_audit_word_change();

COMMIT;
