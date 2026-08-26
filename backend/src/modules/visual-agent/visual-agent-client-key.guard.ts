import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { VisualAgentClientKeyService, VisualAgentClientPrincipal } from './visual-agent-client-key.service';

export const VISUAL_AGENT_CLIENT_REQUEST_KEY = 'visualAgentClient';

@Injectable()
export class VisualAgentClientKeyGuard implements CanActivate {
  constructor(private readonly clientKeys: VisualAgentClientKeyService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest() as {
      headers: Record<string, string | string[] | undefined>;
      [VISUAL_AGENT_CLIENT_REQUEST_KEY]?: VisualAgentClientPrincipal;
    };
    const rawKey = this.extractKey(request.headers);
    request[VISUAL_AGENT_CLIENT_REQUEST_KEY] = await this.clientKeys.authenticate(rawKey);
    return true;
  }

  private extractKey(headers: Record<string, string | string[] | undefined>) {
    const explicit = headers['x-visual-agent-key'];
    if (typeof explicit === 'string' && explicit.trim()) return explicit.trim();
    const authorization = headers.authorization;
    if (typeof authorization === 'string') {
      const match = /^VisualAgent\s+(.+)$/i.exec(authorization.trim());
      if (match?.[1]) return match[1].trim();
    }
    throw new UnauthorizedException('需要 AI Visual Agent API Key');
  }
}
