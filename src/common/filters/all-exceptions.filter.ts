import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpStatus,
  HttpException,
  BadRequestException,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { BusinessException } from '../exceptions/business.exception.js';
import { captureException } from '../../infra/observability/sentry.js';

/** Request augmented by the auth layer with the decoded JWT subject. */
interface AuthedRequest extends FastifyRequest {
  user?: { tenantId?: string };
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<AuthedRequest>();

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'SYSTEM_INTERNAL_ERROR';
    let message = 'An unexpected error occurred';
    let details: Record<string, string[]> | undefined;

    if (exception instanceof BusinessException) {
      statusCode = exception.getStatus();
      code = exception.code;
      const res = exception.getResponse() as Record<string, unknown>;
      message = (res.message as string) || exception.message;
      details = exception.details;
    } else if (exception instanceof BadRequestException) {
      statusCode = HttpStatus.BAD_REQUEST;
      code = 'VALIDATION_ERROR';
      const res = exception.getResponse() as Record<string, unknown>;
      message = 'Validation failed';
      details = Array.isArray(res.message)
        ? { validation: res.message as string[] }
        : undefined;
    } else if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      message = exception.message;
    }

    const correlationId =
      request.headers['x-correlation-id'] || request.id || 'unknown';

    // Report server-side (>=500) failures to Sentry with correlation context;
    // expected 4xx (validation, business, auth) are not reported as errors.
    if (statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
      captureException(exception, {
        correlationId: String(correlationId),
        path: request.url,
        tenantId: request.user?.tenantId,
      });
    }

    response.status(statusCode).send({
      statusCode,
      code,
      message,
      details,
      timestamp: new Date().toISOString(),
      path: request.url,
      correlationId,
    });
  }
}
