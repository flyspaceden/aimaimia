import { BadRequestException, Body, Controller, Get, Headers, Param, Post, Query, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Public } from '../../common/decorators/public.decorator';
import { UPLOAD_MAX_FILE_SIZE } from '../upload/upload.constants';
import { VisualAgentClientKeyGuard, VISUAL_AGENT_CLIENT_REQUEST_KEY } from './visual-agent-client-key.guard';
import { VisualAgentClientPrincipal } from './visual-agent-client-key.service';
import { ConfirmVisualAgentTaskDto, CreateVisualAgentAdoptIntentDto, CreateVisualAgentPlanDto, IssueVisualAgentQuoteDto } from './visual-agent-public.dto';
import { VisualAgentPublicService } from './visual-agent-public.service';

type VisualRequest = { [VISUAL_AGENT_CLIENT_REQUEST_KEY]?: VisualAgentClientPrincipal };

@Public()
@UseGuards(VisualAgentClientKeyGuard)
@Controller('visual-agent/v1')
export class VisualAgentPublicController {
  constructor(private readonly visual: VisualAgentPublicService) {}

  @Post('assets')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: UPLOAD_MAX_FILE_SIZE } }))
  createAsset(
    @Req() request: VisualRequest,
    @Headers('x-visual-agent-evidence-signature') signature: string,
    @Body('evidence') evidenceJson: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('请选择视觉源图片');
    return this.visual.createAsset({ principal: this.principal(request), evidenceJson, signature, file });
  }

  @Get('assets/:assetId')
  getAsset(@Req() request: VisualRequest, @Param('assetId') assetId: string) {
    return this.visual.getAsset(this.principal(request), assetId);
  }

  @Post('visual-plans')
  createPlan(@Req() request: VisualRequest, @Body() dto: CreateVisualAgentPlanDto) {
    return this.visual.createPlan({ principal: this.principal(request), ...dto });
  }

  @Post('quotes')
  issueQuote(@Req() request: VisualRequest, @Body() dto: IssueVisualAgentQuoteDto) {
    return this.visual.issueQuote({ principal: this.principal(request), ...dto });
  }

  @Post('tasks/:quoteId/confirm')
  confirmTask(@Req() request: VisualRequest, @Param('quoteId') quoteId: string, @Body() dto: ConfirmVisualAgentTaskDto) {
    return this.visual.confirmTask({ principal: this.principal(request), quoteId, quoteHash: dto.quoteHash });
  }

  @Post('tasks/:quoteId/poll')
  pollTask(@Req() request: VisualRequest, @Param('quoteId') quoteId: string) {
    return this.visual.pollTask({ principal: this.principal(request), quoteId });
  }

  @Get('tasks/:quoteId')
  getTask(@Req() request: VisualRequest, @Param('quoteId') quoteId: string) {
    return this.visual.getTask(this.principal(request), quoteId);
  }

  @Post('tasks/:quoteId/adopt-intents')
  adoptIntent(@Req() request: VisualRequest, @Param('quoteId') quoteId: string, @Body() dto: CreateVisualAgentAdoptIntentDto) {
    return this.visual.recordAdoptIntent({ principal: this.principal(request), quoteId, ...dto });
  }

  @Get('credits')
  getCredits(
    @Req() request: VisualRequest,
    @Query('billingOwnerType') billingOwnerType: string,
    @Query('billingOwnerId') billingOwnerId: string,
  ) {
    if (!billingOwnerType || !billingOwnerId) throw new BadRequestException('需要 billingOwnerType 和 billingOwnerId');
    return this.visual.getCredits(this.principal(request), billingOwnerType, billingOwnerId);
  }

  private principal(request: VisualRequest) {
    if (!request[VISUAL_AGENT_CLIENT_REQUEST_KEY]) throw new BadRequestException('AI Visual Agent Client scope 缺失');
    return request[VISUAL_AGENT_CLIENT_REQUEST_KEY]!;
  }
}
