BEGIN;
ALTER TABLE "google_auth_challenges"
  DROP CONSTRAINT "google_auth_challenges_purpose_check";
ALTER TABLE "google_auth_challenges"
  ADD CONSTRAINT "google_auth_challenges_purpose_check" CHECK (
    ("purpose" IN ('login', 'restore') AND "userId" IS NULL) OR
    ("purpose" IN ('link', 'archive') AND "userId" IS NOT NULL)
  );
COMMIT;
