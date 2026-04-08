import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { AdminAuthGuard } from '../admin/common/guards/admin-auth.guard';
import { PermissionGuard } from '../admin/common/guards/permission.guard';
import { RequirePermission } from '../admin/common/decorators/require-permission';
import { AuditLogInterceptor } from '../admin/common/interceptors/audit-log.interceptor';
import { AuditLog } from '../admin/common/decorators/audit-action';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
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
import { PrismaService } from '../../prisma/prisma.service';

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
    private prisma: PrismaService,
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
  getFaqs() { return this.faqService.findAll(); }

  @Post('faq')
  @RequirePermission('cs:manage')
  @AuditLog({ action: 'CREATE', module: 'cs-faq', targetType: 'CsFaq' })
  createFaq(@Body() dto: CreateCsFaqDto) { return this.faqService.create(dto); }

  @Patch('faq/:id')
  @RequirePermission('cs:manage')
  @AuditLog({ action: 'UPDATE', module: 'cs-faq', targetType: 'CsFaq' })
  updateFaq(@Param('id') id: string, @Body() dto: UpdateCsFaqDto) { return this.faqService.update(id, dto as any); }

  @Delete('faq/:id')
  @RequirePermission('cs:manage')
  @AuditLog({ action: 'DELETE', module: 'cs-faq', targetType: 'CsFaq' })
  deleteFaq(@Param('id') id: string) { return this.faqService.delete(id); }

  @Post('faq/test')
  @RequirePermission('cs:read')
  testFaq(@Body() dto: TestCsFaqDto) { return this.faqService.match(dto.message); }

  // --- Quick Entries ---
  @Get('quick-entries')
  @RequirePermission('cs:read')
  getQuickEntries() { return this.prisma.csQuickEntry.findMany({ where: { enabled: true }, orderBy: { sortOrder: 'asc' } }); }

  @Post('quick-entries')
  @RequirePermission('cs:manage')
  createQuickEntry(@Body() dto: CreateCsQuickEntryDto) { return this.prisma.csQuickEntry.create({ data: dto }); }

  @Patch('quick-entries/:id')
  @RequirePermission('cs:manage')
  updateQuickEntry(@Param('id') id: string, @Body() dto: UpdateCsQuickEntryDto) { return this.prisma.csQuickEntry.update({ where: { id }, data: dto }); }

  @Delete('quick-entries/:id')
  @RequirePermission('cs:manage')
  deleteQuickEntry(@Param('id') id: string) { return this.prisma.csQuickEntry.delete({ where: { id } }); }

  @Patch('quick-entries/sort')
  @RequirePermission('cs:manage')
  sortQuickEntries(@Body() dto: BatchSortDto) {
    return Promise.all(dto.items.map((item) => this.prisma.csQuickEntry.update({ where: { id: item.id }, data: { sortOrder: item.sortOrder } })));
  }

  // --- Quick Replies ---
  @Get('quick-replies')
  @RequirePermission('cs:read')
  getQuickReplies() { return this.prisma.csQuickReply.findMany({ where: { enabled: true }, orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }] }); }

  @Post('quick-replies')
  @RequirePermission('cs:manage')
  createQuickReply(@Body() dto: CreateCsQuickReplyDto) { return this.prisma.csQuickReply.create({ data: dto }); }

  @Patch('quick-replies/:id')
  @RequirePermission('cs:manage')
  updateQuickReply(@Param('id') id: string, @Body() dto: UpdateCsQuickReplyDto) { return this.prisma.csQuickReply.update({ where: { id }, data: dto }); }

  @Delete('quick-replies/:id')
  @RequirePermission('cs:manage')
  deleteQuickReply(@Param('id') id: string) { return this.prisma.csQuickReply.delete({ where: { id } }); }

  // --- Stats ---
  @Get('stats')
  @RequirePermission('cs:read')
  getStats() { return this.csService.getStats(); }

  // --- Agent Status ---
  @Get('agent-status')
  @RequirePermission('cs:read')
  getAgentStatus() { return this.agentService.getAllAgentStatus(); }
}
