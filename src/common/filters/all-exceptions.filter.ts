import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpStatus,
  HttpException,
  BadRequestException,
} from '@nestjs/common';
import { BusinessException } from '../exceptions/business.exception.js';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

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

    response.status(statusCode).send({
      statusCode,
      code,
      message,
      details,
      timestamp: new Date().toISOString(),
      path: request.url,
      correlationId:
        request.headers['x-correlation-id'] || request.id || 'unknown',
    });
  }
}
