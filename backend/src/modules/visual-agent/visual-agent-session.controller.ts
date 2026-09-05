import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { VisualAgentClientKeyGuard, VISUAL_AGENT_CLIENT_REQUEST_KEY } from './visual-agent-client-key.guard';
import { VisualAgentClientPrincipal } from './visual-agent-client-key.service';

@Public()
@UseGuards(VisualAgentClientKeyGuard)
@Controller('visual-agent/v1')
export class VisualAgentSessionController {
  /**
   * A deliberately narrow key-verification endpoint. Generic callers can
   * validate their integration scope, but cannot submit arbitrary URLs,
   * prompts, provider jobs, or paid work outside a trusted domain adapter.
   */
  @Get('session')
  session(@Req() request: { [VISUAL_AGENT_CLIENT_REQUEST_KEY]?: VisualAgentClientPrincipal }) {
    const principal = request[VISUAL_AGENT_CLIENT_REQUEST_KEY];
    return {
      tenantId: principal?.tenantId,
      clientId: principal?.clientId,
      adapterNamespace: principal?.adapterNamespace,
      allowedAdapterTypes: principal?.allowedAdapterTypes ?? [],
      capabilities: {
        keyVerification: true,
        directProviderSubmission: false,
        arbitraryUrlImport: false,
      },
    };
  }
}
