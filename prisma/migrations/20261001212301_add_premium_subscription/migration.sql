-- Add premium subscription fields to User table
ALTER TABLE "User" ADD COLUMN "premiumPlan" VARCHAR(20) NOT NULL DEFAULT 'free';
ALTER TABLE "User" ADD COLUMN "premiumExpireAt" TIMESTAMP;

-- Add indexes for performance
CREATE INDEX "idx_premiumPlan" ON "User"("premiumPlan");
CREATE INDEX "idx_premiumExpireAt" ON "User"("premiumExpireAt");
