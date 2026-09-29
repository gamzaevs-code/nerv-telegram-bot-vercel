-- CreateTable AdminLog
CREATE TABLE "AdminLog" (
    "id" SERIAL NOT NULL,
    "adminId" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "targetId" INTEGER,
    "targetType" TEXT,
    "reason" TEXT,
    "details" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable SystemLog
CREATE TABLE "SystemLog" (
    "id" SERIAL NOT NULL,
    "level" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "context" TEXT,
    "stackTrace" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SystemLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable ContentFilter
CREATE TABLE "ContentFilter" (
    "id" SERIAL NOT NULL,
    "word" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'warning',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentFilter_pkey" PRIMARY KEY ("id")
);

-- CreateTable UserReport
CREATE TABLE "UserReport" (
    "id" SERIAL NOT NULL,
    "reporterId" INTEGER NOT NULL,
    "reportedId" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "decision" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "UserReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable UserMute
CREATE TABLE "UserMute" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "reason" TEXT,
    "muteUntil" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserMute_pkey" PRIMARY KEY ("id")
);

-- CreateTable DailyStats
CREATE TABLE "DailyStats" (
    "id" SERIAL NOT NULL,
    "date" DATE NOT NULL,
    "totalUsers" INTEGER NOT NULL DEFAULT 0,
    "activeUsers" INTEGER NOT NULL DEFAULT 0,
    "newUsers" INTEGER NOT NULL DEFAULT 0,
    "tasksCreated" INTEGER NOT NULL DEFAULT 0,
    "tasksCompleted" INTEGER NOT NULL DEFAULT 0,
    "totalRevenue" INTEGER NOT NULL DEFAULT 0,
    "messagesCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyStats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdminLog_adminId_idx" ON "AdminLog"("adminId");

-- CreateIndex
CREATE INDEX "AdminLog_action_idx" ON "AdminLog"("action");

-- CreateIndex
CREATE INDEX "AdminLog_createdAt_idx" ON "AdminLog"("createdAt");

-- CreateIndex
CREATE INDEX "SystemLog_level_idx" ON "SystemLog"("level");

-- CreateIndex
CREATE INDEX "SystemLog_createdAt_idx" ON "SystemLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ContentFilter_word_key" ON "ContentFilter"("word");

-- CreateIndex
CREATE INDEX "UserReport_reporterId_idx" ON "UserReport"("reporterId");

-- CreateIndex
CREATE INDEX "UserReport_reportedId_idx" ON "UserReport"("reportedId");

-- CreateIndex
CREATE INDEX "UserReport_status_idx" ON "UserReport"("status");

-- CreateIndex
CREATE INDEX "UserReport_createdAt_idx" ON "UserReport"("createdAt");

-- CreateIndex
CREATE INDEX "UserMute_userId_idx" ON "UserMute"("userId");

-- CreateIndex
CREATE INDEX "UserMute_muteUntil_idx" ON "UserMute"("muteUntil");

-- CreateIndex
CREATE UNIQUE INDEX "DailyStats_date_key" ON "DailyStats"("date");

-- CreateIndex
CREATE INDEX "DailyStats_date_idx" ON "DailyStats"("date");

-- AddForeignKey
ALTER TABLE "AdminLog" ADD CONSTRAINT "AdminLog_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserReport" ADD CONSTRAINT "UserReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserReport" ADD CONSTRAINT "UserReport_reportedId_fkey" FOREIGN KEY ("reportedId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserMute" ADD CONSTRAINT "UserMute_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
