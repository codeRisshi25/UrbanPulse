-- This is an empty migration.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Add UUID defaults to all ID columns
ALTER TABLE "User" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "Driver" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "Rider" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "Trip" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();