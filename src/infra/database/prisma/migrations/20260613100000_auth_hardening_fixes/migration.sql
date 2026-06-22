-- Auth hardening: refresh tokens are now stored as SHA-256 hex hashes.
-- 1) Rename column token -> tokenHash (unique index is carried over by the rename).
ALTER TABLE "refresh_tokens" RENAME COLUMN "token" TO "tokenHash";

-- Keep the Prisma-conventional unique index name in sync with the new field name.
ALTER INDEX IF EXISTS "refresh_tokens_token_key" RENAME TO "refresh_tokens_tokenHash_key";

-- 2) One-time hardening: existing rows hold plaintext tokens that can never match
-- hashed lookups again, so revoke every still-active row (forces re-login).
UPDATE "refresh_tokens" SET "revokedAt" = now() WHERE "revokedAt" IS NULL;

-- 3) Shrink the column to the SHA-256 hex length.
ALTER TABLE "refresh_tokens" ALTER COLUMN "tokenHash" TYPE VARCHAR(64);
