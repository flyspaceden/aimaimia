import { Injectable } from '@nestjs/common';
import { VisualAgentClientKeyService, VisualAgentClientPrincipal } from './visual-agent-client-key.service';
import { ReserveVisualAgentInvocationInput, VisualAgentInvocationService } from './visual-agent-invocation.service';

/**
 * Internal bridge for a reviewed domain adapter. It is intentionally not a
 * controller: an external Client Key cannot submit a source hash, plan hash,
 * provider or task directly. The adapter owns source acquisition, fact policy,
 * object-version checks and verifier selection before it asks Core to reserve.
 */
@Injectable()
export class VisualAgentTrustedAdapterService {
  constructor(
    private readonly clientKeys: VisualAgentClientKeyService,
    private readonly invocations: VisualAgentInvocationService,
  ) {}

  reserveFromTrustedAdapter(input: {
    principal: VisualAgentClientPrincipal;
    adapterType: string;
    externalObjectId: string;
    actorId: string;
    provider: string;
    model: string;
    visualMode: string;
    sourceHash: string;
    visualPlanHash: string;
    idempotencyKey: string;
    expiresAt: Date;
  }) {
    this.clientKeys.assertAdapterAccess(input.principal, input.adapterType);
    const reservation: ReserveVisualAgentInvocationInput = {
      tenantId: input.principal.tenantId,
      ownerClientId: input.principal.clientId,
      adapterNamespace: input.principal.adapterNamespace,
      externalObjectId: input.externalObjectId,
      actorId: input.actorId,
      provider: input.provider,
      model: input.model,
      visualMode: input.visualMode,
      sourceHash: input.sourceHash,
      visualPlanHash: input.visualPlanHash,
      idempotencyKey: input.idempotencyKey,
      expiresAt: input.expiresAt,
    };
    return this.invocations.reserve(reservation);
  }
}
