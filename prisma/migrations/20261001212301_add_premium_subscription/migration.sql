-- Add premium subscription fields to User table
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "premiumPlan" VARCHAR(20) NOT NULL DEFAULT 'free';
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "premiumExpireAt" TIMESTAMP;

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS "idx_premiumPlan" ON "User"("premiumPlan");
CREATE INDEX IF NOT EXISTS "idx_premiumExpireAt" ON "User"("premiumExpireAt");