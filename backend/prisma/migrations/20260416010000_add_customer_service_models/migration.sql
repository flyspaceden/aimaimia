-- 智能客服系统：8 个模型 + 10 个枚举
-- schema.prisma 中已定义但此前从未生成 migration

-- CreateEnum
CREATE TYPE "CsTicketCategory" AS ENUM ('LOGISTICS', 'AFTERSALE', 'PAYMENT', 'PRODUCT', 'ACCOUNT', 'OTHER');
CREATE TYPE "CsTicketPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');
CREATE TYPE "CsTicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');
CREATE TYPE "CsSessionStatus" AS ENUM ('AI_HANDLING', 'QUEUING', 'AGENT_HANDLING', 'CLOSED');
CREATE TYPE "CsSessionSource" AS ENUM ('MY_PAGE', 'ORDER_DETAIL', 'AFTERSALE_DETAIL');
CREATE TYPE "CsMessageSender" AS ENUM ('USER', 'AI', 'AGENT', 'SYSTEM');
CREATE TYPE "CsContentType" AS ENUM ('TEXT', 'RICH_CARD', 'ACTION_CONFIRM', 'ACTION_RESULT', 'IMAGE');
CREATE TYPE "CsAgentOnlineStatus" AS ENUM ('ONLINE', 'BUSY', 'OFFLINE');
CREATE TYPE "CsFaqAnswerType" AS ENUM ('TEXT', 'RICH_CARD');
CREATE TYPE "CsQuickEntryType" AS ENUM ('QUICK_ACTION', 'HOT_QUESTION');

-- CreateTable: CsTicket
CREATE TABLE "CsTicket" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" "CsTicketCategory" NOT NULL DEFAULT 'OTHER',
    "priority" "CsTicketPriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "CsTicketStatus" NOT NULL DEFAULT 'OPEN',
    "summary" TEXT,
    "relatedOrderId" TEXT,
    "relatedAfterSaleId" TEXT,
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CsTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable: CsSession
CREATE TABLE "CsSession" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT,
    "userId" TEXT NOT NULL,
    "status" "CsSessionStatus" NOT NULL DEFAULT 'AI_HANDLING',
    "source" "CsSessionSource" NOT NULL,
    "sourceId" TEXT,
    "agentId" TEXT,
    "agentJoinedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CsSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable: CsMessage
CREATE TABLE "CsMessage" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "senderType" "CsMessageSender" NOT NULL,
    "senderId" TEXT,
    "contentType" "CsContentType" NOT NULL DEFAULT 'TEXT',
    "content" TEXT NOT NULL,
    "metadata" JSONB,
    "routeLayer" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CsMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable: CsAgentStatus
CREATE TABLE "CsAgentStatus" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "status" "CsAgentOnlineStatus" NOT NULL DEFAULT 'OFFLINE',
    "currentSessions" INTEGER NOT NULL DEFAULT 0,
    "maxSessions" INTEGER NOT NULL DEFAULT 5,
    "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CsAgentStatus_pkey" PRIMARY KEY ("id")
);

-- CreateTable: CsFaq
CREATE TABLE "CsFaq" (
    "id" TEXT NOT NULL,
    "keywords" TEXT[],
    "pattern" TEXT,
    "answer" TEXT NOT NULL,
    "answerType" "CsFaqAnswerType" NOT NULL DEFAULT 'TEXT',
    "metadata" JSONB,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CsFaq_pkey" PRIMARY KEY ("id")
);

-- CreateTable: CsQuickEntry
CREATE TABLE "CsQuickEntry" (
    "id" TEXT NOT NULL,
    "type" "CsQuickEntryType" NOT NULL,
    "label" TEXT NOT NULL,
    "action" TEXT,
    "message" TEXT,
    "icon" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "CsQuickEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable: CsQuickReply
CREATE TABLE "CsQuickReply" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "CsQuickReply_pkey" PRIMARY KEY ("id")
);

-- CreateTable: CsRating
CREATE TABLE "CsRating" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "tags" TEXT[],
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CsRating_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CsTicket_userId_status_idx" ON "CsTicket"("userId", "status");
CREATE INDEX "CsTicket_status_createdAt_idx" ON "CsTicket"("status", "createdAt");
CREATE INDEX "CsTicket_relatedOrderId_idx" ON "CsTicket"("relatedOrderId");

CREATE INDEX "CsSession_userId_status_idx" ON "CsSession"("userId", "status");
CREATE INDEX "CsSession_userId_source_sourceId_idx" ON "CsSession"("userId", "source", "sourceId");
CREATE INDEX "CsSession_agentId_status_idx" ON "CsSession"("agentId", "status");
CREATE INDEX "CsSession_status_createdAt_idx" ON "CsSession"("status", "createdAt");

CREATE INDEX "CsMessage_sessionId_createdAt_idx" ON "CsMessage"("sessionId", "createdAt");

CREATE UNIQUE INDEX "CsAgentStatus_adminId_key" ON "CsAgentStatus"("adminId");

CREATE INDEX "CsFaq_enabled_priority_idx" ON "CsFaq"("enabled", "priority");

CREATE UNIQUE INDEX "CsRating_sessionId_key" ON "CsRating"("sessionId");

-- AddForeignKey
ALTER TABLE "CsTicket" ADD CONSTRAINT "CsTicket_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CsSession" ADD CONSTRAINT "CsSession_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "CsTicket"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CsSession" ADD CONSTRAINT "CsSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CsMessage" ADD CONSTRAINT "CsMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CsSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CsRating" ADD CONSTRAINT "CsRating_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CsSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
