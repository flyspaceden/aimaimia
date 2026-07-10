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
import { CsMaskingService } from './cs-masking.service';
import { CsCleanupService } from './cs-cleanup.service';
import { CsPresenceService } from './cs-presence.service';
import { NotificationModule } from '../notification/notification.module';
import { CsOutreachService } from './cs-outreach.service';
import { CsSocketAuthService } from './cs-socket-auth.service';

@Module({
  imports: [JwtModule, ConfigModule, NotificationModule],
  controllers: [CsController, CsAdminController],
  providers: [
    CsGateway,
    CsService,
    CsRoutingService,
    CsAgentService,
    CsFaqService,
    CsTicketService,
    CsMaskingService,
    CsCleanupService,
    CsPresenceService,
    CsOutreachService,
    CsSocketAuthService,
  ],
})
export class CustomerServiceModule {}
