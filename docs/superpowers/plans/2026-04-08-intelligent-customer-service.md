# 智能客服系统 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an intelligent customer service system with three-layer routing (FAQ → AI → human agent), Socket.IO real-time chat, admin workstation, and buyer app CS page.

**Architecture:** Independent `CustomerServiceModule` with its own data models (8 models, 10 enums). Socket.IO Gateway for real-time buyer↔agent messaging. AI capabilities injected from existing `AiModule` via shared `PrismaService` + direct LLM calls. Admin workstation is a new page group in the existing admin panel.

**Tech Stack:** NestJS + Socket.IO + Prisma + PostgreSQL (backend), React + Ant Design + Socket.IO Client (admin), React Native + Expo Router + Socket.IO Client (buyer app)

**Spec:** `docs/superpowers/specs/2026-04-08-intelligent-customer-service-design.md`

---

## File Structure

### Backend (New Files)
```
backend/src/modules/customer-service/
├── cs.module.ts                     # Module registration
├── cs.gateway.ts                    # Socket.IO Gateway
├── cs.controller.ts                 # Buyer-facing HTTP endpoints
├── cs-admin.controller.ts           # Admin HTTP endpoints (CRUD)
├── cs.service.ts                    # Core: session lifecycle, message handling
├── cs-routing.service.ts            # Three-layer routing engine
├── cs-agent.service.ts              # Agent assignment, status management
├── cs-faq.service.ts                # FAQ keyword/regex matching
├── cs-ticket.service.ts             # Ticket CRUD + AI summary
├── dto/
│   ├── cs-create-session.dto.ts
│   ├── cs-send-message.dto.ts
│   ├── cs-submit-rating.dto.ts
│   └── cs-admin.dto.ts              # All admin CRUD DTOs
└── types/
    └── cs.types.ts                  # Event payloads, routing result types
```

### Backend (Modified Files)
```
backend/prisma/schema.prisma          # Add 8 models + 10 enums
backend/src/app.module.ts             # Register CustomerServiceModule
backend/package.json                  # Add socket.io dependencies
```

### Admin Frontend (New Files)
```
admin/src/api/cs.ts                   # CS API client functions
admin/src/pages/cs/
├── workstation.tsx                   # Real-time chat workstation (3-column)
├── tickets.tsx                       # Ticket management (ProTable)
├── faq.tsx                           # FAQ rule management
├── quick-entries.tsx                 # Quick entry config
├── quick-replies.tsx                 # Agent quick reply management
└── dashboard.tsx                     # Stats dashboard
```

### Admin Frontend (Modified Files)
```
admin/src/App.tsx                     # Add CS route entries
admin/src/layouts/AdminLayout.tsx     # Add CS menu group
admin/src/constants/permissions.ts    # Add CS permissions
```

### Buyer App (New Files)
```
app/cs/index.tsx                      # CS chat page
src/repos/CsRepo.ts                  # CS API repository
src/components/cs/
├── CsMessageBubble.tsx              # Message bubble (USER/AI/AGENT/SYSTEM)
├── CsActionCard.tsx                 # Action confirm/result card
├── CsQuickActions.tsx               # Quick action grid
├── CsHotQuestions.tsx               # Hot questions list
├── CsRatingSheet.tsx                # Rating bottom sheet
└── CsTypingIndicator.tsx            # Typing animation
```

### Buyer App (Modified Files)
```
src/types/index.ts                    # Add CS-related types
app/(tabs)/me.tsx                     # Add "联系客服" entry
app/orders/[id].tsx                   # Add "联系客服" button
```

---

## Task 1: Prisma Schema — Add CS Models and Enums

**Files:**
- Modify: `backend/prisma/schema.prisma:2416` (append before comment block)

- [ ] **Step 1: Add enums to schema.prisma**

Append after line 2415 (`}` closing `SellerAuditLog`), before the comment block:

```prisma
// =============================================
// N 域：智能客服系统
// =============================================

enum CsTicketCategory {
  LOGISTICS
  AFTERSALE
  PAYMENT
  PRODUCT
  ACCOUNT
  OTHER
}

enum CsTicketPriority {
  LOW
  MEDIUM
  HIGH
  URGENT
}

enum CsTicketStatus {
  OPEN
  IN_PROGRESS
  RESOLVED
  CLOSED
}

enum CsSessionStatus {
  AI_HANDLING
  QUEUING
  AGENT_HANDLING
  CLOSED
}

enum CsSessionSource {
  MY_PAGE
  ORDER_DETAIL
  AFTERSALE_DETAIL
}

enum CsMessageSender {
  USER
  AI
  AGENT
  SYSTEM
}

enum CsContentType {
  TEXT
  RICH_CARD
  ACTION_CONFIRM
  ACTION_RESULT
  IMAGE
}

enum CsAgentOnlineStatus {
  ONLINE
  BUSY
  OFFLINE
}

enum CsFaqAnswerType {
  TEXT
  RICH_CARD
}

enum CsQuickEntryType {
  QUICK_ACTION
  HOT_QUESTION
}
```

- [ ] **Step 2: Add CsTicket and CsSession models**

```prisma
model CsTicket {
  id                  String            @id @default(cuid())
  userId              String
  user                User              @relation(fields: [userId], references: [id], onDelete: Restrict)
  category            CsTicketCategory  @default(OTHER)
  priority            CsTicketPriority  @default(MEDIUM)
  status              CsTicketStatus    @default(OPEN)
  summary             String?
  relatedOrderId      String?
  relatedAfterSaleId  String?
  resolvedBy          String?
  resolvedAt          DateTime?
  createdAt           DateTime          @default(now())
  updatedAt           DateTime          @updatedAt
  sessions            CsSession[]

  @@index([userId, status])
  @@index([status, createdAt])
  @@index([relatedOrderId])
}

model CsSession {
  id            String           @id @default(cuid())
  ticketId      String?
  ticket        CsTicket?        @relation(fields: [ticketId], references: [id], onDelete: SetNull)
  userId        String
  user          User             @relation(fields: [userId], references: [id], onDelete: Restrict)
  status        CsSessionStatus  @default(AI_HANDLING)
  source        CsSessionSource
  sourceId      String?
  agentId       String?
  agentJoinedAt DateTime?
  closedAt      DateTime?
  createdAt     DateTime         @default(now())
  messages      CsMessage[]
  rating        CsRating?

  @@index([userId, status])
  @@index([userId, source, sourceId])
  @@index([agentId, status])
  @@index([status, createdAt])
}
```

- [ ] **Step 3: Add CsMessage, CsAgentStatus, CsFaq, CsQuickEntry, CsQuickReply, CsRating models**

```prisma
model CsMessage {
  id          String          @id @default(cuid())
  sessionId   String
  session     CsSession       @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  senderType  CsMessageSender
  senderId    String?
  contentType CsContentType   @default(TEXT)
  content     String
  metadata    Json?
  routeLayer  Int?
  createdAt   DateTime        @default(now())

  @@index([sessionId, createdAt])
}

model CsAgentStatus {
  id              String              @id @default(cuid())
  adminId         String              @unique
  status          CsAgentOnlineStatus @default(OFFLINE)
  currentSessions Int                 @default(0)
  maxSessions     Int                 @default(5)
  lastActiveAt    DateTime            @default(now())
}

model CsFaq {
  id         String          @id @default(cuid())
  keywords   String[]
  pattern    String?
  answer     String
  answerType CsFaqAnswerType @default(TEXT)
  metadata   Json?
  priority   Int             @default(0)
  enabled    Boolean         @default(true)
  sortOrder  Int             @default(0)
  createdAt  DateTime        @default(now())
  updatedAt  DateTime        @updatedAt

  @@index([enabled, priority])
}

model CsQuickEntry {
  id        String           @id @default(cuid())
  type      CsQuickEntryType
  label     String
  action    String?
  message   String?
  icon      String?
  enabled   Boolean          @default(true)
  sortOrder Int              @default(0)
}

model CsQuickReply {
  id        String  @id @default(cuid())
  category  String
  title     String
  content   String
  sortOrder Int     @default(0)
  enabled   Boolean @default(true)
}

model CsRating {
  id        String    @id @default(cuid())
  sessionId String    @unique
  session   CsSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  userId    String
  score     Int
  tags      String[]
  comment   String?
  createdAt DateTime  @default(now())
}
```

- [ ] **Step 4: Add relation fields to User model**

In the `User` model (around line 557), add these relation fields alongside the existing ones:

```prisma
  csTickets    CsTicket[]
  csSessions   CsSession[]
```

- [ ] **Step 5: Validate schema**

Run: `cd backend && npx prisma validate`
Expected: "✔ Your Prisma schema is valid."

- [ ] **Step 6: Generate Prisma client**

Run: `cd backend && npx prisma generate`
Expected: "✔ Generated Prisma Client"

- [ ] **Step 7: Create migration**

Run: `cd backend && npx prisma migrate dev --name add_customer_service_models`
Expected: Migration created and applied successfully.

- [ ] **Step 8: Commit**

```bash
git add backend/prisma/
git commit -m "feat(cs): add customer service schema models and enums"
```

---

## Task 2: Install Socket.IO Dependencies

**Files:**
- Modify: `backend/package.json`

- [ ] **Step 1: Install Socket.IO packages**

Run: `cd backend && npm install @nestjs/websockets @nestjs/platform-socket.io socket.io`

- [ ] **Step 2: Verify installation**

Run: `cd backend && node -e "require('@nestjs/websockets'); require('socket.io'); console.log('OK')"`
Expected: "OK"

- [ ] **Step 3: Commit**

```bash
git add backend/package.json backend/package-lock.json
git commit -m "chore(cs): install socket.io dependencies"
```

---

## Task 3: Backend — Types and DTOs

**Files:**
- Create: `backend/src/modules/customer-service/types/cs.types.ts`
- Create: `backend/src/modules/customer-service/dto/cs-create-session.dto.ts`
- Create: `backend/src/modules/customer-service/dto/cs-send-message.dto.ts`
- Create: `backend/src/modules/customer-service/dto/cs-submit-rating.dto.ts`
- Create: `backend/src/modules/customer-service/dto/cs-admin.dto.ts`

- [ ] **Step 1: Create types file**

```typescript
// backend/src/modules/customer-service/types/cs.types.ts

import { CsContentType, CsMessageSender, CsSessionSource, CsTicketCategory } from '@prisma/client';

/** Socket.IO event: client sends message */
export interface CsSendPayload {
  sessionId: string;
  content: string;
  contentType?: CsContentType;
  metadata?: Record<string, unknown>;
}

/** Socket.IO event: server pushes message */
export interface CsMessagePayload {
  id: string;
  sessionId: string;
  senderType: CsMessageSender;
  senderId?: string;
  contentType: CsContentType;
  content: string;
  metadata?: Record<string, unknown>;
  routeLayer?: number;
  createdAt: string;
}

/** Socket.IO event: agent joined */
export interface CsAgentJoinedPayload {
  sessionId: string;
  agentName: string;
}

/** Socket.IO event: new ticket in lobby */
export interface CsNewTicketPayload {
  sessionId: string;
  userId: string;
  userNickname: string;
  category: CsTicketCategory;
  summary?: string;
  waitingSince: string;
}

/** Socket.IO event: typing indicator */
export interface CsTypingPayload {
  sessionId: string;
  senderType: CsMessageSender;
}

/** Routing result from CsRoutingService */
export interface CsRouteResult {
  layer: 1 | 2 | 3;
  reply?: string;
  contentType?: CsContentType;
  metadata?: Record<string, unknown>;
  shouldTransferToAgent: boolean;
  aiIntent?: string;
  aiConfidence?: number;
}

/** Context passed to AI for customer service */
export interface CsAiContext {
  source: CsSessionSource;
  orderId?: string;
  afterSaleId?: string;
  orderInfo?: Record<string, unknown>;
  afterSaleInfo?: Record<string, unknown>;
  conversationHistory: { role: 'user' | 'assistant'; content: string }[];
}
```

- [ ] **Step 2: Create session DTO**

```typescript
// backend/src/modules/customer-service/dto/cs-create-session.dto.ts

import { IsEnum, IsOptional, IsString } from 'class-validator';
import { CsSessionSource } from '@prisma/client';

export class CreateCsSessionDto {
  @IsEnum(CsSessionSource)
  source: CsSessionSource;

  @IsOptional()
  @IsString()
  sourceId?: string;
}
```

- [ ] **Step 3: Create message DTO**

```typescript
// backend/src/modules/customer-service/dto/cs-send-message.dto.ts

import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { CsContentType } from '@prisma/client';

export class SendCsMessageDto {
  @IsString()
  @IsNotEmpty()
  sessionId: string;

  @IsString()
  @IsNotEmpty()
  content: string;

  @IsOptional()
  @IsEnum(CsContentType)
  contentType?: CsContentType;
}
```

- [ ] **Step 4: Create rating DTO**

```typescript
// backend/src/modules/customer-service/dto/cs-submit-rating.dto.ts

import { IsArray, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class SubmitCsRatingDto {
  @IsInt()
  @Min(1)
  @Max(5)
  score: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsString()
  comment?: string;
}
```

- [ ] **Step 5: Create admin DTOs**

```typescript
// backend/src/modules/customer-service/dto/cs-admin.dto.ts

import { IsArray, IsBoolean, IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';
import { CsFaqAnswerType, CsQuickEntryType, CsTicketPriority, CsTicketStatus } from '@prisma/client';

// --- FAQ ---

export class CreateCsFaqDto {
  @IsArray()
  @IsString({ each: true })
  keywords: string[];

  @IsOptional()
  @IsString()
  pattern?: string;

  @IsString()
  @IsNotEmpty()
  answer: string;

  @IsOptional()
  @IsEnum(CsFaqAnswerType)
  answerType?: CsFaqAnswerType;

  @IsOptional()
  metadata?: Record<string, unknown>;

  @IsOptional()
  @IsInt()
  priority?: number;
}

export class UpdateCsFaqDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  keywords?: string[];

  @IsOptional()
  @IsString()
  pattern?: string;

  @IsOptional()
  @IsString()
  answer?: string;

  @IsOptional()
  @IsEnum(CsFaqAnswerType)
  answerType?: CsFaqAnswerType;

  @IsOptional()
  metadata?: Record<string, unknown>;

  @IsOptional()
  @IsInt()
  priority?: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

export class TestCsFaqDto {
  @IsString()
  @IsNotEmpty()
  message: string;
}

// --- Quick Entry ---

export class CreateCsQuickEntryDto {
  @IsEnum(CsQuickEntryType)
  type: CsQuickEntryType;

  @IsString()
  @IsNotEmpty()
  label: string;

  @IsOptional()
  @IsString()
  action?: string;

  @IsOptional()
  @IsString()
  message?: string;

  @IsOptional()
  @IsString()
  icon?: string;
}

export class UpdateCsQuickEntryDto {
  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsString()
  action?: string;

  @IsOptional()
  @IsString()
  message?: string;

  @IsOptional()
  @IsString()
  icon?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

export class BatchSortDto {
  @IsArray()
  items: { id: string; sortOrder: number }[];
}

// --- Quick Reply ---

export class CreateCsQuickReplyDto {
  @IsString()
  @IsNotEmpty()
  category: string;

  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsNotEmpty()
  content: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

export class UpdateCsQuickReplyDto {
  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

// --- Ticket ---

export class UpdateCsTicketDto {
  @IsOptional()
  @IsEnum(CsTicketStatus)
  status?: CsTicketStatus;

  @IsOptional()
  @IsEnum(CsTicketPriority)
  priority?: CsTicketPriority;
}
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/customer-service/
git commit -m "feat(cs): add types and DTOs for customer service module"
```

---

## Task 4: Backend — FAQ Matching Service

**Files:**
- Create: `backend/src/modules/customer-service/cs-faq.service.ts`

- [ ] **Step 1: Implement FAQ service**

```typescript
// backend/src/modules/customer-service/cs-faq.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { CsFaqAnswerType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface FaqMatchResult {
  faqId: string;
  answer: string;
  answerType: CsFaqAnswerType;
  metadata: Record<string, unknown> | null;
  priority: number;
}

@Injectable()
export class CsFaqService {
  private readonly logger = new Logger(CsFaqService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * 匹配 FAQ 规则：先关键词匹配，再正则匹配，返回最高优先级结果
   */
  async match(message: string): Promise<FaqMatchResult | null> {
    const faqs = await this.prisma.csFaq.findMany({
      where: { enabled: true },
      orderBy: { priority: 'desc' },
    });

    const normalized = message.toLowerCase().trim();

    for (const faq of faqs) {
      // 关键词匹配：任一关键词命中即算匹配
      const keywordMatch = faq.keywords.some((kw) =>
        normalized.includes(kw.toLowerCase()),
      );
      if (keywordMatch) {
        return {
          faqId: faq.id,
          answer: faq.answer,
          answerType: faq.answerType,
          metadata: faq.metadata as Record<string, unknown> | null,
          priority: faq.priority,
        };
      }

      // 正则匹配
      if (faq.pattern) {
        try {
          const regex = new RegExp(faq.pattern, 'i');
          if (regex.test(normalized)) {
            return {
              faqId: faq.id,
              answer: faq.answer,
              answerType: faq.answerType,
              metadata: faq.metadata as Record<string, unknown> | null,
              priority: faq.priority,
            };
          }
        } catch {
          this.logger.warn(`FAQ ${faq.id} 正则无效: ${faq.pattern}`);
        }
      }
    }

    return null;
  }

  // --- Admin CRUD ---

  async findAll() {
    return this.prisma.csFaq.findMany({ orderBy: [{ priority: 'desc' }, { sortOrder: 'asc' }] });
  }

  async create(data: { keywords: string[]; pattern?: string; answer: string; answerType?: CsFaqAnswerType; metadata?: any; priority?: number }) {
    return this.prisma.csFaq.create({ data: { ...data, answerType: data.answerType ?? 'TEXT' } });
  }

  async update(id: string, data: Record<string, unknown>) {
    return this.prisma.csFaq.update({ where: { id }, data });
  }

  async delete(id: string) {
    return this.prisma.csFaq.delete({ where: { id } });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/modules/customer-service/cs-faq.service.ts
git commit -m "feat(cs): implement FAQ keyword/regex matching service"
```

---

## Task 5: Backend — Agent Assignment Service

**Files:**
- Create: `backend/src/modules/customer-service/cs-agent.service.ts`

- [ ] **Step 1: Implement agent service**

```typescript
// backend/src/modules/customer-service/cs-agent.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { CsAgentOnlineStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class CsAgentService {
  private readonly logger = new Logger(CsAgentService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * 分配坐席：从 ONLINE 且未满的坐席中选 currentSessions 最少的
   * 返回 adminId，无可用坐席返回 null
   */
  async assignAgent(): Promise<string | null> {
    const agent = await this.prisma.csAgentStatus.findFirst({
      where: {
        status: 'ONLINE',
        currentSessions: { lt: this.prisma.csAgentStatus.fields ? 5 : 5 },
      },
      orderBy: { currentSessions: 'asc' },
    });

    // 使用原始查询确保 currentSessions < maxSessions 条件
    const result = await this.prisma.$queryRaw<{ adminId: string }[]>`
      SELECT "adminId" FROM "CsAgentStatus"
      WHERE status = 'ONLINE' AND "currentSessions" < "maxSessions"
      ORDER BY "currentSessions" ASC
      LIMIT 1
    `;

    if (result.length === 0) return null;

    const adminId = result[0].adminId;

    // 原子递增 currentSessions
    await this.prisma.csAgentStatus.update({
      where: { adminId },
      data: { currentSessions: { increment: 1 }, lastActiveAt: new Date() },
    });

    return adminId;
  }

  /** 坐席结束会话时递减 currentSessions */
  async releaseAgent(adminId: string) {
    await this.prisma.csAgentStatus.updateMany({
      where: { adminId, currentSessions: { gt: 0 } },
      data: { currentSessions: { decrement: 1 }, lastActiveAt: new Date() },
    });
  }

  /** 更新坐席在线状态 */
  async updateStatus(adminId: string, status: CsAgentOnlineStatus) {
    return this.prisma.csAgentStatus.upsert({
      where: { adminId },
      create: { adminId, status, lastActiveAt: new Date() },
      update: { status, lastActiveAt: new Date() },
    });
  }

  /** 坐席断线：标记离线 */
  async handleDisconnect(adminId: string) {
    await this.prisma.csAgentStatus.updateMany({
      where: { adminId },
      data: { status: 'OFFLINE', lastActiveAt: new Date() },
    });
  }

  /** 获取排队会话数 */
  async getQueueCount(): Promise<number> {
    return this.prisma.csSession.count({ where: { status: 'QUEUING' } });
  }

  /** 获取所有坐席状态 */
  async getAllAgentStatus() {
    return this.prisma.csAgentStatus.findMany({ orderBy: { lastActiveAt: 'desc' } });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/modules/customer-service/cs-agent.service.ts
git commit -m "feat(cs): implement agent assignment and status service"
```

---

## Task 6: Backend — Ticket Service

**Files:**
- Create: `backend/src/modules/customer-service/cs-ticket.service.ts`

- [ ] **Step 1: Implement ticket service**

```typescript
// backend/src/modules/customer-service/cs-ticket.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { CsTicketCategory, CsTicketPriority, CsTicketStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class CsTicketService {
  private readonly logger = new Logger(CsTicketService.name);

  private readonly QWEN_API_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
  private readonly SUMMARY_MODEL = process.env.AI_CS_SUMMARY_MODEL || 'qwen-flash';

  constructor(private prisma: PrismaService) {}

  /** 为转人工的会话创建工单 */
  async createTicket(sessionId: string, category: CsTicketCategory = 'OTHER'): Promise<string> {
    const session = await this.prisma.csSession.findUniqueOrThrow({
      where: { id: sessionId },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });

    // 根据来源决定优先级
    let priority: CsTicketPriority = 'MEDIUM';
    if (category === 'PAYMENT') priority = 'HIGH';

    // 尝试生成 AI 摘要
    let summary: string | undefined;
    try {
      summary = await this.generateSummary(session.messages.map((m) => ({
        role: m.senderType === 'USER' ? 'user' : 'assistant',
        content: m.content,
      })));
    } catch (e) {
      this.logger.warn('AI 摘要生成失败，跳过', e);
    }

    const ticket = await this.prisma.csTicket.create({
      data: {
        userId: session.userId,
        category,
        priority,
        summary,
        relatedOrderId: session.source === 'ORDER_DETAIL' ? session.sourceId : undefined,
        relatedAfterSaleId: session.source === 'AFTERSALE_DETAIL' ? session.sourceId : undefined,
      },
    });

    // 将会话关联到工单
    await this.prisma.csSession.update({
      where: { id: sessionId },
      data: { ticketId: ticket.id },
    });

    return ticket.id;
  }

  /** 调用 LLM 生成对话摘要 */
  private async generateSummary(messages: { role: string; content: string }[]): Promise<string> {
    const apiKey = process.env.DASHSCOPE_API_KEY;
    if (!apiKey) throw new Error('DASHSCOPE_API_KEY not set');

    const conversationText = messages.map((m) => `${m.role}: ${m.content}`).join('\n');

    const response = await fetch(this.QWEN_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: this.SUMMARY_MODEL,
        messages: [
          {
            role: 'system',
            content: '你是客服系统的摘要助手。请用一句话总结以下客服对话的核心问题，不超过100字。',
          },
          { role: 'user', content: conversationText },
        ],
        max_tokens: 200,
      }),
    });

    const data = await response.json();
    return data.choices?.[0]?.message?.content?.trim() || '（无法生成摘要）';
  }

  // --- Admin CRUD ---

  async findAll(params: {
    page?: number;
    pageSize?: number;
    status?: CsTicketStatus;
    category?: CsTicketCategory;
    priority?: CsTicketPriority;
  }) {
    const { page = 1, pageSize = 20, status, category, priority } = params;
    const where: any = {};
    if (status) where.status = status;
    if (category) where.category = category;
    if (priority) where.priority = priority;

    const [items, total] = await Promise.all([
      this.prisma.csTicket.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          user: { include: { profile: { select: { nickname: true, avatarUrl: true } } } },
          sessions: { select: { id: true, status: true, createdAt: true } },
        },
      }),
      this.prisma.csTicket.count({ where }),
    ]);

    return { items, total };
  }

  async update(id: string, data: { status?: CsTicketStatus; priority?: CsTicketPriority }, adminId?: string) {
    const updateData: any = { ...data };
    if (data.status === 'RESOLVED') {
      updateData.resolvedBy = adminId;
      updateData.resolvedAt = new Date();
    }
    return this.prisma.csTicket.update({ where: { id }, data: updateData });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/modules/customer-service/cs-ticket.service.ts
git commit -m "feat(cs): implement ticket service with AI summary generation"
```

---

## Task 7: Backend — Routing Service + Core CS Service

**Files:**
- Create: `backend/src/modules/customer-service/cs-routing.service.ts`
- Create: `backend/src/modules/customer-service/cs.service.ts`

- [ ] **Step 1: Implement routing service**

```typescript
// backend/src/modules/customer-service/cs-routing.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CsFaqService } from './cs-faq.service';
import { CsRouteResult, CsAiContext } from './types/cs.types';

const TRANSFER_KEYWORDS = ['转人工', '找客服', '找人工', '人工客服', '真人客服'];
const EMOTION_KEYWORDS = ['投诉', '骗子', '欺诈', '举报', '报警', '工商', '消协', '12315'];

@Injectable()
export class CsRoutingService {
  private readonly logger = new Logger(CsRoutingService.name);

  private readonly QWEN_API_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
  private readonly CS_INTENT_MODEL = process.env.AI_CS_INTENT_MODEL || 'qwen-flash';
  private readonly CONFIDENCE_THRESHOLD = 0.6;

  constructor(
    private prisma: PrismaService,
    private faqService: CsFaqService,
  ) {}

  /**
   * 三层路由：FAQ → AI → 转人工判断
   */
  async route(message: string, context: CsAiContext, consecutiveFailures: number): Promise<CsRouteResult> {
    // 检查是否主动要求转人工
    const normalized = message.toLowerCase();
    if (TRANSFER_KEYWORDS.some((kw) => normalized.includes(kw))) {
      return { layer: 3, shouldTransferToAgent: true };
    }

    // 检查情绪激动/投诉升级
    if (EMOTION_KEYWORDS.some((kw) => normalized.includes(kw))) {
      return {
        layer: 3,
        reply: '非常抱歉给您带来不好的体验，正在为您转接人工客服...',
        contentType: 'TEXT',
        shouldTransferToAgent: true,
      };
    }

    // 第一层：FAQ 关键词匹配
    const faqResult = await this.faqService.match(message);
    if (faqResult) {
      return {
        layer: 1,
        reply: faqResult.answer,
        contentType: faqResult.answerType === 'RICH_CARD' ? 'RICH_CARD' : 'TEXT',
        metadata: faqResult.metadata ?? undefined,
        shouldTransferToAgent: false,
      };
    }

    // 第二层：AI 意图理解
    try {
      const aiResult = await this.classifyIntent(message, context);
      if (aiResult) {
        return {
          layer: 2,
          reply: aiResult.reply,
          contentType: aiResult.contentType ?? 'TEXT',
          metadata: aiResult.metadata,
          shouldTransferToAgent: false,
          aiIntent: aiResult.intent,
          aiConfidence: aiResult.confidence,
        };
      }
    } catch (e) {
      this.logger.warn('AI 意图分类失败', e);
    }

    // AI 连续失败 2 次，自动转人工
    if (consecutiveFailures + 1 >= 2) {
      return {
        layer: 3,
        reply: '抱歉我暂时无法理解您的问题，正在为您转接人工客服...',
        contentType: 'TEXT',
        shouldTransferToAgent: true,
      };
    }

    // AI 单次失败，返回兜底回复
    return {
      layer: 2,
      reply: '抱歉我没太理解您的意思，能再描述一下您的问题吗？或者您可以说"转人工"由客服人员为您处理。',
      contentType: 'TEXT',
      shouldTransferToAgent: false,
    };
  }

  private async classifyIntent(message: string, context: CsAiContext): Promise<{
    intent: string;
    confidence: number;
    reply: string;
    contentType?: string;
    metadata?: Record<string, unknown>;
  } | null> {
    const apiKey = process.env.DASHSCOPE_API_KEY;
    if (!apiKey) return null;

    const contextInfo = context.orderId
      ? `用户来自订单详情页，订单ID: ${context.orderId}。${context.orderInfo ? `订单信息: ${JSON.stringify(context.orderInfo)}` : ''}`
      : context.afterSaleId
        ? `用户来自售后详情页，售后单ID: ${context.afterSaleId}。${context.afterSaleInfo ? `售后信息: ${JSON.stringify(context.afterSaleInfo)}` : ''}`
        : '用户来自个人中心。';

    const historyText = context.conversationHistory
      .slice(-6)
      .map((m) => `${m.role === 'user' ? '用户' : '客服'}: ${m.content}`)
      .join('\n');

    const response = await fetch(this.QWEN_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: this.CS_INTENT_MODEL,
        messages: [
          {
            role: 'system',
            content: `你是爱买买电商平台的智能客服，帮助买家解决购物问题。

## 上下文
${contextInfo}

## 对话历史
${historyText || '（无）'}

## 你能处理的问题类型
- query_logistics: 查询物流/快递状态
- query_aftersale: 查询退换货/退款进度
- apply_aftersale: 用户想申请退货退款（引导用户操作，不直接执行）
- cancel_order: 用户想取消订单（提醒确认，不直接执行）
- query_coupon: 查询优惠券/余额
- general_qa: 平台规则、运费政策、VIP权益等常见问答

## 回复要求
用 JSON 格式回复:
{"intent":"意图名","confidence":0.0-1.0,"reply":"自然语言回复"}

如果无法判断意图，返回 {"intent":"unknown","confidence":0.0,"reply":""}`,
          },
          { role: 'user', content: message },
        ],
        max_tokens: 500,
        temperature: 0.3,
      }),
    });

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content?.trim();
    if (!raw) return null;

    try {
      // 提取 JSON（可能被包裹在 markdown code block 中）
      const jsonStr = raw.replace(/```json?\s*/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(jsonStr);

      if (parsed.intent === 'unknown' || parsed.confidence < this.CONFIDENCE_THRESHOLD) {
        return null;
      }

      // 对需要确认的操作，添加操作按钮
      let metadata: Record<string, unknown> | undefined;
      if (parsed.intent === 'apply_aftersale' || parsed.intent === 'cancel_order') {
        metadata = {
          actionType: parsed.intent,
          requiresConfirm: true,
          orderId: context.orderId,
        };
      }

      return {
        intent: parsed.intent,
        confidence: parsed.confidence,
        reply: parsed.reply,
        contentType: metadata ? 'ACTION_CONFIRM' : 'TEXT',
        metadata,
      };
    } catch {
      this.logger.warn('AI 意图解析 JSON 失败', raw);
      return null;
    }
  }
}
```

- [ ] **Step 2: Implement core CS service**

```typescript
// backend/src/modules/customer-service/cs.service.ts

import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { CsSessionStatus, CsMessageSender, CsContentType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CsRoutingService } from './cs-routing.service';
import { CsAgentService } from './cs-agent.service';
import { CsTicketService } from './cs-ticket.service';
import { CsRouteResult, CsAiContext } from './types/cs.types';

@Injectable()
export class CsService {
  private readonly logger = new Logger(CsService.name);

  /** 追踪每个会话的 AI 连续失败次数 */
  private consecutiveFailures = new Map<string, number>();

  constructor(
    private prisma: PrismaService,
    private routingService: CsRoutingService,
    private agentService: CsAgentService,
    private ticketService: CsTicketService,
  ) {}

  /** 创建客服会话 */
  async createSession(userId: string, source: string, sourceId?: string) {
    // 检查是否已有活跃会话（同一来源）
    const existing = await this.prisma.csSession.findFirst({
      where: {
        userId,
        source: source as any,
        sourceId: sourceId ?? null,
        status: { in: ['AI_HANDLING', 'QUEUING', 'AGENT_HANDLING'] },
      },
      include: { messages: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });

    if (existing) {
      return { sessionId: existing.id, isExisting: true };
    }

    const session = await this.prisma.csSession.create({
      data: { userId, source: source as any, sourceId },
    });

    return { sessionId: session.id, isExisting: false };
  }

  /** 获取用户活跃会话 */
  async getActiveSession(userId: string, source: string, sourceId?: string) {
    return this.prisma.csSession.findFirst({
      where: {
        userId,
        source: source as any,
        sourceId: sourceId ?? undefined,
        status: { in: ['AI_HANDLING', 'QUEUING', 'AGENT_HANDLING'] },
      },
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
        ticket: true,
      },
    });
  }

  /** 处理用户消息：保存 + 路由 + 返回回复 */
  async handleUserMessage(sessionId: string, userId: string, content: string, contentType: CsContentType = 'TEXT') {
    const session = await this.prisma.csSession.findUnique({
      where: { id: sessionId },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });

    if (!session) throw new NotFoundException('会话不存在');
    if (session.userId !== userId) throw new NotFoundException('会话不存在');
    if (session.status === 'CLOSED') throw new BadRequestException('会话已关闭');

    // 保存用户消息
    const userMsg = await this.prisma.csMessage.create({
      data: { sessionId, senderType: 'USER', senderId: userId, contentType, content },
    });

    // 如果已转人工，不走路由，直接返回（消息通过 Socket.IO 推送给坐席）
    if (session.status === 'AGENT_HANDLING') {
      return { userMessage: userMsg, aiReply: null, transferred: false };
    }

    // 构建 AI 上下文
    const context = await this.buildAiContext(session);

    // 路由
    const failures = this.consecutiveFailures.get(sessionId) ?? 0;
    const routeResult = await this.routingService.route(content, context, failures);

    // 更新连续失败计数
    if (routeResult.layer === 2 && !routeResult.aiIntent) {
      this.consecutiveFailures.set(sessionId, failures + 1);
    } else {
      this.consecutiveFailures.delete(sessionId);
    }

    // 保存 AI/系统回复
    let aiReply = null;
    if (routeResult.reply) {
      aiReply = await this.prisma.csMessage.create({
        data: {
          sessionId,
          senderType: 'AI',
          contentType: (routeResult.contentType as CsContentType) ?? 'TEXT',
          content: routeResult.reply,
          metadata: routeResult.metadata ?? undefined,
          routeLayer: routeResult.layer,
        },
      });
    }

    // 需要转人工
    let transferred = false;
    if (routeResult.shouldTransferToAgent) {
      transferred = await this.transferToAgent(sessionId);
    }

    return { userMessage: userMsg, aiReply, transferred, routeResult };
  }

  /** 转人工 */
  async transferToAgent(sessionId: string): Promise<boolean> {
    // 创建工单
    await this.ticketService.createTicket(sessionId);

    // 尝试分配坐席
    const adminId = await this.agentService.assignAgent();

    if (adminId) {
      await this.prisma.csSession.update({
        where: { id: sessionId },
        data: { status: 'AGENT_HANDLING', agentId: adminId, agentJoinedAt: new Date() },
      });
      return true;
    }

    // 无可用坐席，排队
    await this.prisma.csSession.update({
      where: { id: sessionId },
      data: { status: 'QUEUING' },
    });
    return false;
  }

  /** 坐席接入排队中的会话 */
  async agentAcceptSession(sessionId: string, adminId: string) {
    const session = await this.prisma.csSession.findUnique({ where: { id: sessionId } });
    if (!session || session.status !== 'QUEUING') {
      throw new BadRequestException('会话不在排队状态');
    }

    await this.prisma.csSession.update({
      where: { id: sessionId },
      data: { status: 'AGENT_HANDLING', agentId: adminId, agentJoinedAt: new Date() },
    });

    // 更新坐席状态
    await this.agentService.updateStatus(adminId, 'ONLINE');
  }

  /** 坐席发送消息 */
  async handleAgentMessage(sessionId: string, adminId: string, content: string, contentType: CsContentType = 'TEXT', metadata?: any) {
    const session = await this.prisma.csSession.findUnique({ where: { id: sessionId } });
    if (!session || session.status !== 'AGENT_HANDLING' || session.agentId !== adminId) {
      throw new BadRequestException('无权在此会话发送消息');
    }

    return this.prisma.csMessage.create({
      data: { sessionId, senderType: 'AGENT', senderId: adminId, contentType, content, metadata, routeLayer: 3 },
    });
  }

  /** 关闭会话 */
  async closeSession(sessionId: string) {
    const session = await this.prisma.csSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('会话不存在');

    // 释放坐席名额
    if (session.agentId) {
      await this.agentService.releaseAgent(session.agentId);
    }

    await this.prisma.csSession.update({
      where: { id: sessionId },
      data: { status: 'CLOSED', closedAt: new Date() },
    });

    // 如果有关联工单，标记已解决
    if (session.ticketId) {
      await this.prisma.csTicket.update({
        where: { id: session.ticketId },
        data: { status: 'RESOLVED', resolvedBy: session.agentId, resolvedAt: new Date() },
      });
    }

    this.consecutiveFailures.delete(sessionId);
  }

  /** 提交满意度评价 */
  async submitRating(sessionId: string, userId: string, score: number, tags: string[], comment?: string) {
    const session = await this.prisma.csSession.findUnique({ where: { id: sessionId } });
    if (!session || session.userId !== userId) throw new NotFoundException('会话不存在');

    return this.prisma.csRating.create({
      data: { sessionId, userId, score, tags, comment },
    });
  }

  /** 获取会话消息列表 */
  async getSessionMessages(sessionId: string, userId: string) {
    const session = await this.prisma.csSession.findUnique({ where: { id: sessionId } });
    if (!session || session.userId !== userId) throw new NotFoundException('会话不存在');

    return this.prisma.csMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** 获取快捷入口配置（买家端） */
  async getQuickEntries() {
    return this.prisma.csQuickEntry.findMany({
      where: { enabled: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  /** 获取统计数据 */
  async getStats() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [totalSessions, aiResolved, agentHandled, avgRating, queueCount] = await Promise.all([
      this.prisma.csSession.count({ where: { createdAt: { gte: today } } }),
      this.prisma.csSession.count({ where: { createdAt: { gte: today }, status: 'CLOSED', agentId: null } }),
      this.prisma.csSession.count({ where: { createdAt: { gte: today }, agentId: { not: null } } }),
      this.prisma.csRating.aggregate({ where: { createdAt: { gte: today } }, _avg: { score: true } }),
      this.prisma.csSession.count({ where: { status: 'QUEUING' } }),
    ]);

    const aiResolveRate = totalSessions > 0 ? Math.round((aiResolved / totalSessions) * 100) : 0;

    return {
      totalSessions,
      aiResolveRate,
      agentHandled,
      avgRating: avgRating._avg.score ?? 0,
      queueCount,
    };
  }

  // --- Admin query ---

  async getAdminSessionList(params: { status?: string; page?: number; pageSize?: number }) {
    const { status, page = 1, pageSize = 50 } = params;
    const where: any = {};
    if (status) where.status = status;

    return this.prisma.csSession.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        user: { include: { profile: { select: { nickname: true, avatarUrl: true } } } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        ticket: { select: { id: true, category: true, priority: true } },
      },
    });
  }

  async getAdminSessionDetail(sessionId: string) {
    return this.prisma.csSession.findUniqueOrThrow({
      where: { id: sessionId },
      include: {
        user: {
          include: {
            profile: true,
            orders: { orderBy: { createdAt: 'desc' }, take: 5, select: { id: true, status: true, goodsAmount: true, createdAt: true } },
          },
        },
        messages: { orderBy: { createdAt: 'asc' } },
        ticket: true,
        rating: true,
      },
    });
  }

  private async buildAiContext(session: any): Promise<CsAiContext> {
    const context: CsAiContext = {
      source: session.source,
      conversationHistory: session.messages.map((m: any) => ({
        role: m.senderType === 'USER' ? 'user' as const : 'assistant' as const,
        content: m.content,
      })),
    };

    // 注入订单信息
    if (session.source === 'ORDER_DETAIL' && session.sourceId) {
      context.orderId = session.sourceId;
      try {
        const order = await this.prisma.order.findUnique({
          where: { id: session.sourceId },
          select: { id: true, status: true, goodsAmount: true, shippingFee: true, createdAt: true, items: { select: { productTitle: true, quantity: true, price: true } } },
        });
        if (order) context.orderInfo = order as any;
      } catch { /* non-critical */ }
    }

    // 注入售后信息
    if (session.source === 'AFTERSALE_DETAIL' && session.sourceId) {
      context.afterSaleId = session.sourceId;
      try {
        const afterSale = await this.prisma.afterSaleRequest.findUnique({
          where: { id: session.sourceId },
          select: { id: true, status: true, afterSaleType: true, reason: true, refundAmount: true },
        });
        if (afterSale) context.afterSaleInfo = afterSale as any;
      } catch { /* non-critical */ }
    }

    return context;
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/customer-service/cs-routing.service.ts backend/src/modules/customer-service/cs.service.ts
git commit -m "feat(cs): implement routing engine and core CS service"
```

---

## Task 8: Backend — Socket.IO Gateway

**Files:**
- Create: `backend/src/modules/customer-service/cs.gateway.ts`

- [ ] **Step 1: Implement gateway**

```typescript
// backend/src/modules/customer-service/cs.gateway.ts

import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { CsService } from './cs.service';
import { CsAgentService } from './cs-agent.service';
import { CsSendPayload, CsTypingPayload } from './types/cs.types';

interface AuthenticatedSocket extends Socket {
  data: {
    userId?: string;
    adminId?: string;
    isAgent: boolean;
  };
}

@WebSocketGateway({
  namespace: '/cs',
  cors: { origin: '*' },
})
export class CsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(CsGateway.name);

  /** 坐席断线定时器：30秒内未重连则标记离线 */
  private agentDisconnectTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private csService: CsService,
    private agentService: CsAgentService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  async handleConnection(client: AuthenticatedSocket) {
    try {
      const token = client.handshake.auth?.token;
      if (!token) {
        client.disconnect();
        return;
      }

      // 尝试验证买家 JWT
      try {
        const payload = this.jwtService.verify(token, {
          secret: this.configService.get('JWT_SECRET'),
        });
        client.data = { userId: payload.sub, isAgent: false };
        client.join(`user:${payload.sub}`);
        this.logger.log(`买家已连接: ${payload.sub}`);
        return;
      } catch { /* not a buyer token */ }

      // 尝试验证管理员 JWT
      try {
        const payload = this.jwtService.verify(token, {
          secret: this.configService.get('ADMIN_JWT_SECRET'),
        });
        client.data = { adminId: payload.sub, isAgent: true };
        client.join(`agent:${payload.sub}`);
        client.join('agent:lobby');
        this.logger.log(`坐席已连接: ${payload.sub}`);

        // 清除断线定时器
        const timer = this.agentDisconnectTimers.get(payload.sub);
        if (timer) {
          clearTimeout(timer);
          this.agentDisconnectTimers.delete(payload.sub);
        }

        // 更新坐席在线状态
        await this.agentService.updateStatus(payload.sub, 'ONLINE');
        return;
      } catch { /* not an admin token */ }

      client.disconnect();
    } catch (e) {
      this.logger.warn('连接认证失败', e);
      client.disconnect();
    }
  }

  async handleDisconnect(client: AuthenticatedSocket) {
    if (client.data?.isAgent && client.data.adminId) {
      const adminId = client.data.adminId;
      this.logger.log(`坐席断线: ${adminId}，30秒后标记离线`);

      // 30秒宽限期
      const timer = setTimeout(async () => {
        await this.agentService.handleDisconnect(adminId);
        this.agentDisconnectTimers.delete(adminId);
        this.logger.log(`坐席已标记离线: ${adminId}`);
      }, 30_000);

      this.agentDisconnectTimers.set(adminId, timer);
    }
  }

  /** 用户/坐席发送消息 */
  @SubscribeMessage('cs:send')
  async handleSend(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() data: CsSendPayload) {
    const { sessionId, content, contentType } = data;

    if (client.data.isAgent && client.data.adminId) {
      // 坐席发消息
      const msg = await this.csService.handleAgentMessage(sessionId, client.data.adminId, content, contentType as any);
      this.server.to(`session:${sessionId}`).emit('cs:message', msg);
    } else if (client.data.userId) {
      // 买家发消息
      client.join(`session:${sessionId}`);
      const result = await this.csService.handleUserMessage(sessionId, client.data.userId, content, contentType as any);

      // 推送用户消息到会话房间（坐席可见）
      this.server.to(`session:${sessionId}`).emit('cs:message', result.userMessage);

      // 推送 AI 回复
      if (result.aiReply) {
        this.server.to(`session:${sessionId}`).emit('cs:message', result.aiReply);
      }

      // 转人工通知
      if (result.transferred) {
        // 已分配坐席
        const session = await this.csService.getAdminSessionDetail(sessionId);
        if (session.agentId) {
          this.server.to(`agent:${session.agentId}`).socketsJoin(`session:${sessionId}`);
          this.server.to(`session:${sessionId}`).emit('cs:agent_joined', {
            sessionId,
            agentName: '客服', // TODO: 从管理员信息获取昵称
          });
        }
      } else if (result.routeResult?.shouldTransferToAgent) {
        // 排队中，广播到坐席大厅
        this.server.to('agent:lobby').emit('cs:new_ticket', {
          sessionId,
          userId: client.data.userId,
          category: 'OTHER',
          waitingSince: new Date().toISOString(),
        });
        // 系统消息
        this.server.to(`session:${sessionId}`).emit('cs:message', {
          senderType: 'SYSTEM',
          content: '正在为您转接人工客服，请稍候...',
          contentType: 'TEXT',
          createdAt: new Date().toISOString(),
        });
      }
    }
  }

  /** 坐席领取会话 */
  @SubscribeMessage('cs:accept_ticket')
  async handleAcceptTicket(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() data: { sessionId: string }) {
    if (!client.data.isAgent || !client.data.adminId) return;

    await this.csService.agentAcceptSession(data.sessionId, client.data.adminId);
    client.join(`session:${data.sessionId}`);

    this.server.to(`session:${data.sessionId}`).emit('cs:agent_joined', {
      sessionId: data.sessionId,
      agentName: '客服',
    });

    // 更新排队数
    const queueCount = await this.agentService.getQueueCount();
    this.server.to('agent:lobby').emit('cs:queue_update', { queueCount });
  }

  /** 关闭会话 */
  @SubscribeMessage('cs:close_session')
  async handleCloseSession(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() data: { sessionId: string }) {
    if (!client.data.isAgent) return;

    await this.csService.closeSession(data.sessionId);

    this.server.to(`session:${data.sessionId}`).emit('cs:session_closed', { sessionId: data.sessionId });
  }

  /** 正在输入 */
  @SubscribeMessage('cs:typing')
  handleTyping(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() data: CsTypingPayload) {
    const senderType = client.data.isAgent ? 'AGENT' : 'USER';
    client.to(`session:${data.sessionId}`).emit('cs:typing', { sessionId: data.sessionId, senderType });
  }

  /** 坐席更新在线状态 */
  @SubscribeMessage('cs:agent_status')
  async handleAgentStatus(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() data: { status: string }) {
    if (!client.data.isAgent || !client.data.adminId) return;
    await this.agentService.updateStatus(client.data.adminId, data.status as any);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/modules/customer-service/cs.gateway.ts
git commit -m "feat(cs): implement Socket.IO gateway with auth and room management"
```

---

## Task 9: Backend — HTTP Controllers + Module Registration

**Files:**
- Create: `backend/src/modules/customer-service/cs.controller.ts`
- Create: `backend/src/modules/customer-service/cs-admin.controller.ts`
- Create: `backend/src/modules/customer-service/cs.module.ts`
- Modify: `backend/src/app.module.ts`

- [ ] **Step 1: Buyer-facing controller**

```typescript
// backend/src/modules/customer-service/cs.controller.ts

import { Controller, Post, Get, Param, Body, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CsService } from './cs.service';
import { CreateCsSessionDto } from './dto/cs-create-session.dto';
import { SubmitCsRatingDto } from './dto/cs-submit-rating.dto';

@Controller('cs')
export class CsController {
  constructor(private csService: CsService) {}

  @Post('sessions')
  createSession(@CurrentUser('sub') userId: string, @Body() dto: CreateCsSessionDto) {
    return this.csService.createSession(userId, dto.source, dto.sourceId);
  }

  @Get('sessions/active')
  getActiveSession(
    @CurrentUser('sub') userId: string,
    @Query('source') source: string,
    @Query('sourceId') sourceId?: string,
  ) {
    return this.csService.getActiveSession(userId, source, sourceId);
  }

  @Get('sessions/:id/messages')
  getMessages(@CurrentUser('sub') userId: string, @Param('id') sessionId: string) {
    return this.csService.getSessionMessages(sessionId, userId);
  }

  @Post('sessions/:id/rating')
  submitRating(
    @CurrentUser('sub') userId: string,
    @Param('id') sessionId: string,
    @Body() dto: SubmitCsRatingDto,
  ) {
    return this.csService.submitRating(sessionId, userId, dto.score, dto.tags ?? [], dto.comment);
  }

  @Get('quick-entries')
  getQuickEntries() {
    return this.csService.getQuickEntries();
  }
}
```

- [ ] **Step 2: Admin controller**

```typescript
// backend/src/modules/customer-service/cs-admin.controller.ts

import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import { AdminAuthGuard } from '../admin/common/guards/admin-auth.guard';
import { PermissionGuard } from '../admin/common/guards/permission.guard';
import { RequirePermission } from '../admin/common/decorators/require-permission.decorator';
import { AuditLogInterceptor } from '../admin/common/interceptors/audit-log.interceptor';
import { AuditLog } from '../admin/common/decorators/audit-log.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CsService } from './cs.service';
import { CsFaqService } from './cs-faq.service';
import { CsTicketService } from './cs-ticket.service';
import { CsAgentService } from './cs-agent.service';
import {
  CreateCsFaqDto, UpdateCsFaqDto, TestCsFaqDto,
  CreateCsQuickEntryDto, UpdateCsQuickEntryDto, BatchSortDto,
  CreateCsQuickReplyDto, UpdateCsQuickReplyDto,
  UpdateCsTicketDto,
} from './dto/cs-admin.dto';

@Public()
@UseGuards(AdminAuthGuard, PermissionGuard)
@UseInterceptors(AuditLogInterceptor)
@Controller('admin/cs')
export class CsAdminController {
  constructor(
    private csService: CsService,
    private faqService: CsFaqService,
    private ticketService: CsTicketService,
    private agentService: CsAgentService,
  ) {}

  // --- Sessions ---

  @Get('sessions')
  @RequirePermission('cs:read')
  getSessions(@Query('status') status?: string, @Query('page') page?: string) {
    return this.csService.getAdminSessionList({ status, page: page ? +page : 1 });
  }

  @Get('sessions/:id')
  @RequirePermission('cs:read')
  getSessionDetail(@Param('id') id: string) {
    return this.csService.getAdminSessionDetail(id);
  }

  // --- Tickets ---

  @Get('tickets')
  @RequirePermission('cs:read')
  getTickets(
    @Query('status') status?: string,
    @Query('category') category?: string,
    @Query('priority') priority?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.ticketService.findAll({
      status: status as any, category: category as any, priority: priority as any,
      page: page ? +page : 1, pageSize: pageSize ? +pageSize : 20,
    });
  }

  @Patch('tickets/:id')
  @RequirePermission('cs:manage')
  @AuditLog({ action: 'UPDATE', module: 'cs-tickets', targetType: 'CsTicket' })
  updateTicket(@Param('id') id: string, @Body() dto: UpdateCsTicketDto, @CurrentUser('sub') adminId: string) {
    return this.ticketService.update(id, dto, adminId);
  }

  // --- FAQ ---

  @Get('faq')
  @RequirePermission('cs:read')
  getFaqs() {
    return this.faqService.findAll();
  }

  @Post('faq')
  @RequirePermission('cs:manage')
  @AuditLog({ action: 'CREATE', module: 'cs-faq', targetType: 'CsFaq' })
  createFaq(@Body() dto: CreateCsFaqDto) {
    return this.faqService.create(dto);
  }

  @Patch('faq/:id')
  @RequirePermission('cs:manage')
  @AuditLog({ action: 'UPDATE', module: 'cs-faq', targetType: 'CsFaq' })
  updateFaq(@Param('id') id: string, @Body() dto: UpdateCsFaqDto) {
    return this.faqService.update(id, dto);
  }

  @Delete('faq/:id')
  @RequirePermission('cs:manage')
  @AuditLog({ action: 'DELETE', module: 'cs-faq', targetType: 'CsFaq' })
  deleteFaq(@Param('id') id: string) {
    return this.faqService.delete(id);
  }

  @Post('faq/test')
  @RequirePermission('cs:read')
  testFaq(@Body() dto: TestCsFaqDto) {
    return this.faqService.match(dto.message);
  }

  // --- Quick Entries ---

  @Get('quick-entries')
  @RequirePermission('cs:read')
  getQuickEntries() {
    return this.csService.getQuickEntries();
  }

  @Post('quick-entries')
  @RequirePermission('cs:manage')
  createQuickEntry(@Body() dto: CreateCsQuickEntryDto) {
    const { prisma } = this.csService as any;
    // 直接通过 service 或 prisma 创建
    return (this.csService as any).prisma.csQuickEntry.create({ data: dto });
  }

  @Patch('quick-entries/:id')
  @RequirePermission('cs:manage')
  updateQuickEntry(@Param('id') id: string, @Body() dto: UpdateCsQuickEntryDto) {
    return (this.csService as any).prisma.csQuickEntry.update({ where: { id }, data: dto });
  }

  @Delete('quick-entries/:id')
  @RequirePermission('cs:manage')
  deleteQuickEntry(@Param('id') id: string) {
    return (this.csService as any).prisma.csQuickEntry.delete({ where: { id } });
  }

  @Patch('quick-entries/sort')
  @RequirePermission('cs:manage')
  sortQuickEntries(@Body() dto: BatchSortDto) {
    return Promise.all(
      dto.items.map((item) =>
        (this.csService as any).prisma.csQuickEntry.update({ where: { id: item.id }, data: { sortOrder: item.sortOrder } }),
      ),
    );
  }

  // --- Quick Replies ---

  @Get('quick-replies')
  @RequirePermission('cs:read')
  getQuickReplies() {
    return (this.csService as any).prisma.csQuickReply.findMany({ where: { enabled: true }, orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }] });
  }

  @Post('quick-replies')
  @RequirePermission('cs:manage')
  createQuickReply(@Body() dto: CreateCsQuickReplyDto) {
    return (this.csService as any).prisma.csQuickReply.create({ data: dto });
  }

  @Patch('quick-replies/:id')
  @RequirePermission('cs:manage')
  updateQuickReply(@Param('id') id: string, @Body() dto: UpdateCsQuickReplyDto) {
    return (this.csService as any).prisma.csQuickReply.update({ where: { id }, data: dto });
  }

  @Delete('quick-replies/:id')
  @RequirePermission('cs:manage')
  deleteQuickReply(@Param('id') id: string) {
    return (this.csService as any).prisma.csQuickReply.delete({ where: { id } });
  }

  // --- Stats ---

  @Get('stats')
  @RequirePermission('cs:read')
  getStats() {
    return this.csService.getStats();
  }

  // --- Agent Status ---

  @Get('agent-status')
  @RequirePermission('cs:read')
  getAgentStatus() {
    return this.agentService.getAllAgentStatus();
  }
}
```

- [ ] **Step 3: Module registration**

```typescript
// backend/src/modules/customer-service/cs.module.ts

import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule } from '@nestjs/config';
import { CsController } from './cs.controller';
import { CsAdminController } from './cs-admin.controller';
import { CsGateway } from './cs.gateway';
import { CsService } from './cs.service';
import { CsRoutingService } from './cs-routing.service';
import { CsAgentService } from './cs-agent.service';
import { CsFaqService } from './cs-faq.service';
import { CsTicketService } from './cs-ticket.service';

@Module({
  imports: [JwtModule, ConfigModule],
  controllers: [CsController, CsAdminController],
  providers: [
    CsGateway,
    CsService,
    CsRoutingService,
    CsAgentService,
    CsFaqService,
    CsTicketService,
  ],
})
export class CustomerServiceModule {}
```

- [ ] **Step 4: Register module in app.module.ts**

In `backend/src/app.module.ts`, add the import and register the module:

```typescript
import { CustomerServiceModule } from './modules/customer-service/cs.module';
```

Add `CustomerServiceModule` to the `imports` array alongside other feature modules.

- [ ] **Step 5: TypeScript compile check**

Run: `cd backend && npx tsc --noEmit`
Expected: No errors (or only pre-existing unrelated warnings).

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/customer-service/ backend/src/app.module.ts
git commit -m "feat(cs): add HTTP controllers, Socket.IO gateway, and module registration"
```

---

## Task 10: Backend — Seed Data

**Files:**
- Modify: `backend/prisma/seed.ts` (or create a separate seed script)

- [ ] **Step 1: Add CS seed data**

Add to the existing seed script (or create `backend/prisma/seed-cs.ts`):

```typescript
// Append to seed function or create standalone script

async function seedCustomerService(prisma: PrismaService) {
  // FAQ 规则
  const faqs = [
    { keywords: ['退款', '到账', '多久退款'], pattern: '退款.*到账|多久.*退', answer: '退款将在审核通过后1-3个工作日内原路退回到您的支付账户。', priority: 10 },
    { keywords: ['退货', '退换货', '怎么退'], pattern: '怎么.*退|退货.*流程', answer: '您可以在订单详情页点击"申请退货"，选择退货原因并上传商品照片，我们会在24小时内审核。', priority: 10 },
    { keywords: ['运费', '包邮', '邮费'], answer: '单笔订单满49元包邮（偏远地区除外），不满49元收取8元运费。', priority: 5 },
    { keywords: ['VIP', '会员', '权益'], answer: '爱买买VIP会员享受专属折扣、优先客服、免运费等权益。在"我的"页面可以查看详细权益说明。', priority: 5 },
    { keywords: ['发票', '开票'], answer: '您可以在"我的-发票管理"中申请电子发票，支持增值税普通发票和专用发票。', priority: 3 },
    { keywords: ['优惠券', '红包', '怎么用'], answer: '优惠券可以在结算页面选择使用，系统会自动匹配可用的优惠券。您也可以在"优惠券中心"领取新优惠券。', priority: 3 },
  ];

  for (const faq of faqs) {
    await prisma.csFaq.create({ data: faq });
  }

  // 快捷入口
  const quickEntries = [
    { type: 'QUICK_ACTION' as const, label: '查物流', action: 'query_logistics', icon: 'truck', sortOrder: 1 },
    { type: 'QUICK_ACTION' as const, label: '退换货', action: 'apply_aftersale', icon: 'refresh', sortOrder: 2 },
    { type: 'QUICK_ACTION' as const, label: '改地址', action: 'modify_address', icon: 'map-pin', sortOrder: 3 },
    { type: 'QUICK_ACTION' as const, label: '查退款', action: 'query_aftersale', icon: 'dollar-sign', sortOrder: 4 },
    { type: 'HOT_QUESTION' as const, label: '我的快递到哪了？', message: '我的快递到哪了？', sortOrder: 1 },
    { type: 'HOT_QUESTION' as const, label: '怎么申请退货退款？', message: '怎么申请退货退款？', sortOrder: 2 },
    { type: 'HOT_QUESTION' as const, label: '退款多久到账？', message: '退款多久到账？', sortOrder: 3 },
    { type: 'HOT_QUESTION' as const, label: '怎么修改收货地址？', message: '怎么修改收货地址？', sortOrder: 4 },
    { type: 'HOT_QUESTION' as const, label: 'VIP会员有什么权益？', message: 'VIP会员有什么权益？', sortOrder: 5 },
    { type: 'HOT_QUESTION' as const, label: '优惠券怎么用？', message: '优惠券怎么用？', sortOrder: 6 },
  ];

  for (const entry of quickEntries) {
    await prisma.csQuickEntry.create({ data: entry });
  }

  // 坐席快捷回复
  const quickReplies = [
    { category: '通用', title: '问候', content: '您好，很高兴为您服务！请问有什么可以帮您的？', sortOrder: 1 },
    { category: '通用', title: '感谢耐心', content: '感谢您的耐心等待，我正在为您处理。', sortOrder: 2 },
    { category: '通用', title: '结束', content: '感谢您的咨询，如有其他问题随时联系我们。祝您购物愉快！', sortOrder: 3 },
    { category: '物流', title: '查询中', content: '我正在帮您查询物流信息，请稍等。', sortOrder: 1 },
    { category: '物流', title: '已发货', content: '您的订单已发货，预计2-3天送达，您可以在订单详情页查看物流轨迹。', sortOrder: 2 },
    { category: '退款', title: '已受理', content: '您的退货退款申请已受理，我们会在24小时内完成审核。', sortOrder: 1 },
    { category: '退款', title: '退款进度', content: '退款将在审核通过后1-3个工作日内原路退回到您的支付账户。', sortOrder: 2 },
    { category: '退款', title: '需要照片', content: '为了加快审核，麻烦您拍几张商品照片发给我，谢谢。', sortOrder: 3 },
  ];

  for (const reply of quickReplies) {
    await prisma.csQuickReply.create({ data: reply });
  }

  console.log('✅ 客服系统种子数据已创建');
}
```

- [ ] **Step 2: Run seed**

Run: `cd backend && npx prisma db seed`
Expected: Seed completed successfully.

- [ ] **Step 3: Commit**

```bash
git add backend/prisma/
git commit -m "feat(cs): add customer service seed data (FAQ, quick entries, quick replies)"
```

---

## Task 11: Admin Frontend — API Client + Permissions + Routing

**Files:**
- Create: `admin/src/api/cs.ts`
- Modify: `admin/src/constants/permissions.ts`
- Modify: `admin/src/layouts/AdminLayout.tsx`
- Modify: `admin/src/App.tsx`

- [ ] **Step 1: Create CS API client**

```typescript
// admin/src/api/cs.ts

import client from './client';

// --- Types ---

export interface CsSession {
  id: string;
  ticketId: string | null;
  userId: string;
  status: 'AI_HANDLING' | 'QUEUING' | 'AGENT_HANDLING' | 'CLOSED';
  source: string;
  sourceId: string | null;
  agentId: string | null;
  agentJoinedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  user: { id: string; profile: { nickname: string | null; avatarUrl: string | null } | null };
  messages: CsMessage[];
  ticket: { id: string; category: string; priority: string } | null;
}

export interface CsMessage {
  id: string;
  sessionId: string;
  senderType: 'USER' | 'AI' | 'AGENT' | 'SYSTEM';
  senderId: string | null;
  contentType: 'TEXT' | 'RICH_CARD' | 'ACTION_CONFIRM' | 'ACTION_RESULT' | 'IMAGE';
  content: string;
  metadata: Record<string, unknown> | null;
  routeLayer: number | null;
  createdAt: string;
}

export interface CsTicket {
  id: string;
  userId: string;
  category: string;
  priority: string;
  status: string;
  summary: string | null;
  relatedOrderId: string | null;
  resolvedBy: string | null;
  createdAt: string;
  user: { id: string; profile: { nickname: string | null } | null };
  sessions: { id: string; status: string; createdAt: string }[];
}

export interface CsFaq {
  id: string;
  keywords: string[];
  pattern: string | null;
  answer: string;
  answerType: 'TEXT' | 'RICH_CARD';
  metadata: Record<string, unknown> | null;
  priority: number;
  enabled: boolean;
  sortOrder: number;
}

export interface CsQuickEntry {
  id: string;
  type: 'QUICK_ACTION' | 'HOT_QUESTION';
  label: string;
  action: string | null;
  message: string | null;
  icon: string | null;
  enabled: boolean;
  sortOrder: number;
}

export interface CsQuickReply {
  id: string;
  category: string;
  title: string;
  content: string;
  sortOrder: number;
  enabled: boolean;
}

export interface CsStats {
  totalSessions: number;
  aiResolveRate: number;
  agentHandled: number;
  avgRating: number;
  queueCount: number;
}

// --- API Functions ---

// Sessions
export const getCsSessions = (params?: { status?: string; page?: number }): Promise<CsSession[]> =>
  client.get('/admin/cs/sessions', { params });

export const getCsSessionDetail = (id: string): Promise<CsSession> =>
  client.get(`/admin/cs/sessions/${id}`);

// Tickets
export const getCsTickets = (params?: Record<string, string | number>): Promise<{ items: CsTicket[]; total: number }> =>
  client.get('/admin/cs/tickets', { params });

export const updateCsTicket = (id: string, data: Record<string, string>): Promise<CsTicket> =>
  client.patch(`/admin/cs/tickets/${id}`, data);

// FAQ
export const getCsFaqs = (): Promise<CsFaq[]> =>
  client.get('/admin/cs/faq');

export const createCsFaq = (data: Partial<CsFaq>): Promise<CsFaq> =>
  client.post('/admin/cs/faq', data);

export const updateCsFaq = (id: string, data: Partial<CsFaq>): Promise<CsFaq> =>
  client.patch(`/admin/cs/faq/${id}`, data);

export const deleteCsFaq = (id: string): Promise<void> =>
  client.delete(`/admin/cs/faq/${id}`);

export const testCsFaq = (message: string): Promise<{ answer: string } | null> =>
  client.post('/admin/cs/faq/test', { message });

// Quick Entries
export const getCsQuickEntries = (): Promise<CsQuickEntry[]> =>
  client.get('/admin/cs/quick-entries');

export const createCsQuickEntry = (data: Partial<CsQuickEntry>): Promise<CsQuickEntry> =>
  client.post('/admin/cs/quick-entries', data);

export const updateCsQuickEntry = (id: string, data: Partial<CsQuickEntry>): Promise<CsQuickEntry> =>
  client.patch(`/admin/cs/quick-entries/${id}`, data);

export const deleteCsQuickEntry = (id: string): Promise<void> =>
  client.delete(`/admin/cs/quick-entries/${id}`);

export const sortCsQuickEntries = (items: { id: string; sortOrder: number }[]): Promise<void> =>
  client.patch('/admin/cs/quick-entries/sort', { items });

// Quick Replies
export const getCsQuickReplies = (): Promise<CsQuickReply[]> =>
  client.get('/admin/cs/quick-replies');

export const createCsQuickReply = (data: Partial<CsQuickReply>): Promise<CsQuickReply> =>
  client.post('/admin/cs/quick-replies', data);

export const updateCsQuickReply = (id: string, data: Partial<CsQuickReply>): Promise<CsQuickReply> =>
  client.patch(`/admin/cs/quick-replies/${id}`, data);

export const deleteCsQuickReply = (id: string): Promise<void> =>
  client.delete(`/admin/cs/quick-replies/${id}`);

// Stats
export const getCsStats = (): Promise<CsStats> =>
  client.get('/admin/cs/stats');

// Agent Status
export const getCsAgentStatus = (): Promise<any[]> =>
  client.get('/admin/cs/agent-status');
```

- [ ] **Step 2: Add CS permissions**

In `admin/src/constants/permissions.ts`, add before the closing `} as const;`:

```typescript
  // 客服中心
  CS_READ: 'cs:read',
  CS_MANAGE: 'cs:manage',
```

- [ ] **Step 3: Add CS menu group to AdminLayout.tsx**

In `admin/src/layouts/AdminLayout.tsx`, add a new menu group in the `menuRoutes` array. Import `CustomerServiceOutlined` (or use `MessageOutlined`) from `@ant-design/icons`. Add this group after the "运营活动" group and before "系统管理":

```typescript
    {
      path: '/cs',
      name: '客服中心',
      icon: <MessageOutlined />,
      permission: PERMISSIONS.CS_READ,
      routes: [
        { path: '/cs/workstation', name: '对话工作台' },
        { path: '/cs/tickets', name: '工单管理' },
        { path: '/cs/faq', name: 'FAQ 管理' },
        { path: '/cs/quick-entries', name: '快捷入口配置' },
        { path: '/cs/quick-replies', name: '坐席快捷回复' },
        { path: '/cs/dashboard', name: '数据看板' },
      ],
    },
```

Add `MessageOutlined` to the icon imports at the top of the file.

- [ ] **Step 4: Add CS routes to App.tsx**

In `admin/src/App.tsx`, add lazy imports at the top:

```typescript
const CsWorkstationPage = lazy(() => import('@/pages/cs/workstation'));
const CsTicketsPage = lazy(() => import('@/pages/cs/tickets'));
const CsFaqPage = lazy(() => import('@/pages/cs/faq'));
const CsQuickEntriesPage = lazy(() => import('@/pages/cs/quick-entries'));
const CsQuickRepliesPage = lazy(() => import('@/pages/cs/quick-replies'));
const CsDashboardPage = lazy(() => import('@/pages/cs/dashboard'));
```

Add routes inside the authenticated `<Route>` block:

```typescript
            <Route path="cs/workstation" element={<CsWorkstationPage />} />
            <Route path="cs/tickets" element={<CsTicketsPage />} />
            <Route path="cs/faq" element={<CsFaqPage />} />
            <Route path="cs/quick-entries" element={<CsQuickEntriesPage />} />
            <Route path="cs/quick-replies" element={<CsQuickRepliesPage />} />
            <Route path="cs/dashboard" element={<CsDashboardPage />} />
```

- [ ] **Step 5: Commit**

```bash
git add admin/src/api/cs.ts admin/src/constants/permissions.ts admin/src/layouts/AdminLayout.tsx admin/src/App.tsx
git commit -m "feat(cs): add admin API client, permissions, menu, and route config"
```

---

## Task 12: Admin Frontend — CS Pages (Tickets, FAQ, Quick Entries, Quick Replies, Dashboard)

**Files:**
- Create: `admin/src/pages/cs/tickets.tsx`
- Create: `admin/src/pages/cs/faq.tsx`
- Create: `admin/src/pages/cs/quick-entries.tsx`
- Create: `admin/src/pages/cs/quick-replies.tsx`
- Create: `admin/src/pages/cs/dashboard.tsx`

These are standard ProTable CRUD pages following the existing admin patterns (categories, tags, config pages). Each page:
- Uses `useQuery` for data fetching
- Uses `Modal` + `Form` for create/edit
- Uses `message.success` for feedback
- Uses `queryClient.invalidateQueries` for cache refresh

**Implementation note:** These are standard CRUD pages. The implementing agent should follow the patterns in `admin/src/pages/categories/index.tsx` and `admin/src/pages/tags/index.tsx` exactly. Each page is independent and can be built in parallel.

- [ ] **Step 1: Create tickets page** — ProTable with columns: 工单号, 用户, 类别(Tag), 优先级(Tag), 状态(Tab filter), AI摘要, 处理人, 创建时间. Row click → expand to show session messages.

- [ ] **Step 2: Create FAQ page** — ProTable with: 关键词(Tag list), 正则, 回复内容, 类型, 优先级, 启用(Switch). Modal form for create/edit. Test input at top that calls `testCsFaq`.

- [ ] **Step 3: Create quick-entries page** — Two tabs (QUICK_ACTION / HOT_QUESTION). Table with drag-and-drop sorting (follow `discovery-filters.tsx` pattern). Toggle enable/disable.

- [ ] **Step 4: Create quick-replies page** — ProTable grouped by category. Modal form for create/edit with category, title, content fields.

- [ ] **Step 5: Create dashboard page** — Stat cards (today sessions, AI resolve rate, avg response, satisfaction, queue count) + placeholder for charts. Use `useQuery` with `getCsStats`.

- [ ] **Step 6: Verify all pages render**

Run: `cd admin && npm run build`
Expected: Build succeeds with no errors.

- [ ] **Step 7: Commit**

```bash
git add admin/src/pages/cs/
git commit -m "feat(cs): add admin CS management pages (tickets, FAQ, config, dashboard)"
```

---

## Task 13: Admin Frontend — Real-time Workstation Page

**Files:**
- Create: `admin/src/pages/cs/workstation.tsx`

This is the most complex admin page — the three-column real-time chat workstation. It requires Socket.IO client integration.

- [ ] **Step 1: Install socket.io-client in admin**

Run: `cd admin && npm install socket.io-client`

- [ ] **Step 2: Create workstation page**

The workstation page follows the three-column layout from the mockup (`cs-mockup.html`):
- **Left column (300px):** Session list grouped by QUEUING / AGENT_HANDLING / CLOSED. Each item shows user avatar, nickname, category tag, last message preview, wait time. "接入" button for queuing items.
- **Center column (flex):** Chat area with messages. AI phase messages in gray background wrapper. Agent messages in white. Input bar with quick reply selector.
- **Right column (300px):** User info card, related order card, AI summary, ticket info, history tickets.

Socket.IO connection:
```typescript
import { io, Socket } from 'socket.io-client';

const socket = io(`${import.meta.env.VITE_WS_BASE_URL || 'http://localhost:3000'}/cs`, {
  auth: { token: localStorage.getItem('admin_token') },
  autoConnect: false,
});
```

Key event handlers:
- `cs:message` → append to active chat messages
- `cs:new_ticket` → add to queuing list
- `cs:agent_joined` → move session from queuing to active
- `cs:session_closed` → move session to closed
- `cs:typing` → show typing indicator
- `cs:send` → emit when agent types and sends

The implementing agent should reference `cs-mockup.html` in the project root for the exact visual design.

- [ ] **Step 3: Verify workstation renders and connects**

Run: `cd admin && npm run dev`
Open browser, navigate to `/cs/workstation`. Verify page renders without errors (Socket.IO will fail to connect if backend isn't running, but UI should render).

- [ ] **Step 4: Commit**

```bash
git add admin/src/pages/cs/workstation.tsx admin/package.json admin/package-lock.json
git commit -m "feat(cs): implement real-time chat workstation with Socket.IO"
```

---

## Task 14: Buyer App — Types + Repository

**Files:**
- Modify: `src/types/index.ts` (or create `src/types/domain/CustomerService.ts`)
- Create: `src/repos/CsRepo.ts`

- [ ] **Step 1: Add CS types**

```typescript
// Add to src/types/index.ts or create src/types/domain/CustomerService.ts

export interface CsQuickEntry {
  id: string;
  type: 'QUICK_ACTION' | 'HOT_QUESTION';
  label: string;
  action?: string;
  message?: string;
  icon?: string;
}

export interface CsSessionInfo {
  sessionId: string;
  isExisting: boolean;
}

export interface CsMessage {
  id: string;
  sessionId: string;
  senderType: 'USER' | 'AI' | 'AGENT' | 'SYSTEM';
  senderId?: string;
  contentType: 'TEXT' | 'RICH_CARD' | 'ACTION_CONFIRM' | 'ACTION_RESULT' | 'IMAGE';
  content: string;
  metadata?: Record<string, unknown>;
  routeLayer?: number;
  createdAt: string;
}
```

- [ ] **Step 2: Create CS repository**

```typescript
// src/repos/CsRepo.ts

import { CsMessage, CsQuickEntry, CsSessionInfo, Result } from '../types';
import { USE_MOCK } from './http/config';
import { ApiClient } from './http/ApiClient';
import { simulateRequest } from './helpers';

const MOCK_QUICK_ENTRIES: CsQuickEntry[] = [
  { id: '1', type: 'QUICK_ACTION', label: '查物流', action: 'query_logistics', icon: 'truck' },
  { id: '2', type: 'QUICK_ACTION', label: '退换货', action: 'apply_aftersale', icon: 'refresh' },
  { id: '3', type: 'QUICK_ACTION', label: '改地址', action: 'modify_address', icon: 'map-pin' },
  { id: '4', type: 'QUICK_ACTION', label: '查退款', action: 'query_aftersale', icon: 'dollar-sign' },
  { id: '5', type: 'HOT_QUESTION', label: '我的快递到哪了？', message: '我的快递到哪了？' },
  { id: '6', type: 'HOT_QUESTION', label: '怎么申请退货退款？', message: '怎么申请退货退款？' },
  { id: '7', type: 'HOT_QUESTION', label: '退款多久到账？', message: '退款多久到账？' },
  { id: '8', type: 'HOT_QUESTION', label: '怎么修改收货地址？', message: '怎么修改收货地址？' },
  { id: '9', type: 'HOT_QUESTION', label: 'VIP会员有什么权益？', message: 'VIP会员有什么权益？' },
  { id: '10', type: 'HOT_QUESTION', label: '优惠券怎么用？', message: '优惠券怎么用？' },
];

export const CsRepo = {
  /** 获取快捷入口配置 */
  getQuickEntries: async (): Promise<Result<CsQuickEntry[]>> => {
    if (USE_MOCK) return simulateRequest(MOCK_QUICK_ENTRIES, { delay: 200 });
    return ApiClient.get<CsQuickEntry[]>('/cs/quick-entries');
  },

  /** 创建客服会话 */
  createSession: async (source: string, sourceId?: string): Promise<Result<CsSessionInfo>> => {
    if (USE_MOCK) {
      return simulateRequest({ sessionId: `mock-cs-${Date.now()}`, isExisting: false }, { delay: 300 });
    }
    return ApiClient.post<CsSessionInfo>('/cs/sessions', { source, sourceId });
  },

  /** 获取活跃会话 */
  getActiveSession: async (source: string, sourceId?: string): Promise<Result<any>> => {
    if (USE_MOCK) return simulateRequest(null, { delay: 200 });
    const params = new URLSearchParams({ source });
    if (sourceId) params.set('sourceId', sourceId);
    return ApiClient.get<any>(`/cs/sessions/active?${params.toString()}`);
  },

  /** 获取会话消息 */
  getMessages: async (sessionId: string): Promise<Result<CsMessage[]>> => {
    if (USE_MOCK) return simulateRequest([], { delay: 200 });
    return ApiClient.get<CsMessage[]>(`/cs/sessions/${sessionId}/messages`);
  },

  /** 提交评价 */
  submitRating: async (sessionId: string, data: { score: number; tags?: string[]; comment?: string }): Promise<Result<any>> => {
    if (USE_MOCK) return simulateRequest({ id: 'mock-rating' }, { delay: 300 });
    return ApiClient.post<any>(`/cs/sessions/${sessionId}/rating`, data);
  },
};
```

- [ ] **Step 3: Export CsRepo from repos index**

Add `export { CsRepo } from './CsRepo';` to `src/repos/index.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/types/ src/repos/CsRepo.ts src/repos/index.ts
git commit -m "feat(cs): add buyer app CS types and repository"
```

---

## Task 15: Buyer App — CS Chat Page + Components

**Files:**
- Create: `app/cs/index.tsx`
- Create: `src/components/cs/CsMessageBubble.tsx`
- Create: `src/components/cs/CsQuickActions.tsx`
- Create: `src/components/cs/CsHotQuestions.tsx`
- Create: `src/components/cs/CsRatingSheet.tsx`
- Create: `src/components/cs/CsTypingIndicator.tsx`

The CS chat page follows the same patterns as `app/ai/chat.tsx`:
- `useLocalSearchParams` for source/sourceId
- `useAuthStore` for auth check
- `ScrollView` with messages
- `TextInput` for message input
- Socket.IO client for real-time when connected to human agent

- [ ] **Step 1: Create CS component files**

Create all component files following the component patterns in `src/components/ui/AiChatBubble.tsx`. Each component uses `useTheme()` for design tokens.

**CsMessageBubble**: Renders a message bubble. Props: `message: CsMessage`. Different styles for USER (brand color, right-aligned), AI (green avatar, left), AGENT (indigo avatar, left with border), SYSTEM (centered gray label).

**CsQuickActions**: 2×2 grid of action buttons. Props: `entries: CsQuickEntry[]`, `onPress: (entry) => void`. Filters by `type === 'QUICK_ACTION'`.

**CsHotQuestions**: Vertical list of tappable questions. Props: `entries: CsQuickEntry[]`, `onPress: (entry) => void`. Filters by `type === 'HOT_QUESTION'`.

**CsRatingSheet**: Bottom sheet with 1-5 star rating, preset tag chips, optional text input, submit button. Props: `sessionId: string`, `onSubmit: () => void`.

**CsTypingIndicator**: Three animated dots. Uses `react-native-reanimated`.

- [ ] **Step 2: Create CS chat page**

`app/cs/index.tsx` — Main customer service chat page. Structure:
- Route params: `source`, `sourceId`
- On mount: call `CsRepo.createSession` or `CsRepo.getActiveSession`
- Fetch `CsRepo.getQuickEntries` for initial display
- Socket.IO connection for real-time messaging (when agent joins)
- Messages stored in local state
- Show initial welcome + quick actions + hot questions when no messages yet
- After session closes, show `CsRatingSheet`

The implementing agent should reference `cs-mockup.html` mobile preview for the exact visual design, and follow `app/ai/chat.tsx` for the code structure.

- [ ] **Step 3: Install socket.io-client in app**

Run: `npm install socket.io-client`

- [ ] **Step 4: Verify page renders**

Run: `npx expo start` and navigate to `/cs?source=MY_PAGE`
Expected: Page renders with welcome message, quick actions, and hot questions.

- [ ] **Step 5: Commit**

```bash
git add app/cs/ src/components/cs/ package.json package-lock.json
git commit -m "feat(cs): implement buyer app CS chat page with components"
```

---

## Task 16: Buyer App — Add CS Entry Points

**Files:**
- Modify: `app/(tabs)/me.tsx`
- Modify: `app/orders/[id].tsx`

- [ ] **Step 1: Add CS entry to profile page**

In `app/(tabs)/me.tsx`, add a "联系客服" menu item (follow the existing menu item pattern in the page). It should navigate to:

```typescript
router.push('/cs?source=MY_PAGE');
```

Use a headset or message icon from `@expo/vector-icons/MaterialCommunityIcons`.

- [ ] **Step 2: Add CS button to order detail page**

In `app/orders/[id].tsx`, add a "联系客服" button in the action bar area. It should navigate to:

```typescript
router.push(`/cs?source=ORDER_DETAIL&sourceId=${orderId}`);
```

- [ ] **Step 3: Commit**

```bash
git add app/\(tabs\)/me.tsx app/orders/\[id\].tsx
git commit -m "feat(cs): add customer service entry points to profile and order pages"
```

---

## Task 17: Cleanup + Verification

- [ ] **Step 1: Backend TypeScript check**

Run: `cd backend && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 2: Prisma validate**

Run: `cd backend && npx prisma validate`
Expected: Valid.

- [ ] **Step 3: Admin build check**

Run: `cd admin && npm run build`
Expected: Build succeeds.

- [ ] **Step 4: Clean up mockup file**

Delete `cs-mockup.html` from project root (it was a design artifact, not production code). Or move it to `docs/` if you want to keep it as reference.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "chore(cs): cleanup and verification"
```
