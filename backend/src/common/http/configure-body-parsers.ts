import { NestExpressApplication } from '@nestjs/platform-express';

/**
 * Configure request body limits without replacing Nest's raw-body-aware parsers.
 *
 * WeChat Pay APIv3 signs the exact HTTP request body. Calling express.json()
 * directly after creating the Nest app with `rawBody: true` consumes the stream
 * before Nest's parser can populate `req.rawBody`, causing every payment/refund
 * notification to fail closed with HTTP 401.
 */
export function configureBodyParsers(
  app: NestExpressApplication,
  bodyLimit: string,
): void {
  app.useBodyParser('json', { limit: bodyLimit });
  app.useBodyParser('urlencoded', { extended: true, limit: bodyLimit });
}
