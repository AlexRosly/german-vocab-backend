CREATE TABLE "google_auth_challenges" (
    "nonceHash" VARCHAR(64) NOT NULL,
    "purpose" VARCHAR(8) NOT NULL,
    "userId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "google_auth_challenges_pkey" PRIMARY KEY ("nonceHash"),
    CONSTRAINT "google_auth_challenges_purpose_check" CHECK (
      ("purpose" = 'login' AND "userId" IS NULL) OR ("purpose" = 'link' AND "userId" IS NOT NULL)
    )
);
CREATE INDEX "google_auth_challenges_expiresAt_idx" ON "google_auth_challenges"("expiresAt");
ALTER TABLE "google_auth_challenges" ADD CONSTRAINT "google_auth_challenges_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
