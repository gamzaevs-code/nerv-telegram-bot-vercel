-- Add TaskChatPublic table for public task discussions
CREATE TABLE "TaskChatPublic" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "taskId" INTEGER NOT NULL,
    "fromUserId" INTEGER NOT NULL,
    "message" TEXT NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskChatPublic_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE,
    CONSTRAINT "TaskChatPublic_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User" ("id") ON DELETE CASCADE
);

-- Create indexes for better query performance
CREATE INDEX "TaskChatPublic_taskId_idx" ON "TaskChatPublic"("taskId");
CREATE INDEX "TaskChatPublic_fromUserId_idx" ON "TaskChatPublic"("fromUserId");
CREATE INDEX "TaskChatPublic_createdAt_idx" ON "TaskChatPublic"("createdAt");
