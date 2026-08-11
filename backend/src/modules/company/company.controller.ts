import { Controller, Get, HttpException, Param, Query, Req, Res } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Response } from 'express';
import { pipeline } from 'stream/promises';
import { CompanyService } from './company.service';
import { Public } from '../../common/decorators/public.decorator';

function buildInlineContentDisposition(filename: string): string {
  const safeName = filename.replace(/[\r\n"\\]/g, '_') || 'inspection-report';
  const fallbackName = safeName.replace(/[^\x20-\x7E]/g, '_') || 'inspection-report';
  const encoded = encodeURIComponent(safeName).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `inline; filename="${fallbackName}"; filename*=UTF-8''${encoded}`;
}

function sendPreviewError(res: Response, status: number): void {
  const message = status === 404 ? '该检测报告不存在、已失效或暂不支持预览。' : '报告预览暂时不可用，请稍后重试。';
  res.status(status);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
  res.send(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>报告预览</title><style>body{margin:0;padding:48px 24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#183326;background:#f7faf7}main{max-width:32rem;margin:auto;background:#fff;padding:24px;border-radius:16px;box-shadow:0 4px 18px rgba(0,0,0,.08)}h1{font-size:20px;margin:0 0 12px}p{line-height:1.65;margin:0}</style><main><h1>暂无法预览报告</h1><p>${message}</p></main></html>`);
}

@Controller('companies')
export class CompanyController {
  constructor(
    private companyService: CompanyService,
    private jwtService: JwtService,
  ) {}

  @Public()
  @Get()
  list(
    @Query('tagId') tagId?: string,
    @Query('keyword') keyword?: string,
  ) {
    return this.companyService.list(tagId || undefined, keyword || undefined);
  }

  /** 公开接口：获取标签类别与标签选项 */
  @Public()
  @Get('tag-categories')
  listTagCategories(@Query('scope') scope?: string) {
    return this.companyService.listTagCategories(scope);
  }

  /** 公开接口：获取发现页企业筛选配置 */
  @Public()
  @Get('discovery-filters')
  getDiscoveryFilters() {
    return this.companyService.getDiscoveryFilters();
  }

  /** 已验证检测报告的受控内联预览（必须置于 :id 路由之前）。 */
  @Public()
  @Get('inspection-reports/:reportId/preview')
  async previewInspectionReport(
    @Param('reportId') reportId: string,
    @Res() res: Response,
  ): Promise<void> {
    try {
      const file = await this.companyService.getInspectionReportPreview(reportId);
      res.setHeader('Content-Type', file.mimeType);
      res.setHeader('Content-Disposition', buildInlineContentDisposition(file.title || file.basename));
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');

      if ('filePath' in file) {
        res.sendFile(file.filePath);
        return;
      }

      try {
        await pipeline(file.stream, res);
      } catch (error) {
        if (!res.headersSent) {
          sendPreviewError(res, 500);
          return;
        }
        res.destroy(error as Error);
      }
    } catch (error) {
      if (res.headersSent) {
        res.destroy(error as Error);
        return;
      }
      const status = error instanceof HttpException ? error.getStatus() : 500;
      sendPreviewError(res, status);
    }
  }

  @Public()
  @Get(':id')
  getById(@Param('id') id: string, @Req() req: any) {
    // 尝试从 token 中提取 userId（可选，不强制认证）
    let userId: string | undefined;
    try {
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.slice(7);
        const decoded = this.jwtService.verify(token, { secret: process.env.JWT_SECRET });
        userId = decoded.sub;
      }
    } catch {
      // token 无效或缺失，忽略
    }
    return this.companyService.getById(id, userId);
  }

  @Public()
  @Get(':id/products')
  listProducts(
    @Param('id') companyId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('category') category?: string,
  ) {
    return this.companyService.listCompanyProducts(companyId, {
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
      category: category || undefined,
    });
  }

  @Public()
  @Get(':id/events')
  listEvents(@Param('id') companyId: string) {
    return this.companyService.listActivities(companyId);
  }
}
