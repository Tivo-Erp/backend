import { HttpException, HttpStatus } from '@nestjs/common';

export class BusinessException extends HttpException {
  constructor(
    public readonly code: string,
    message: string,
    statusCode: HttpStatus = HttpStatus.BAD_REQUEST,
    public readonly details?: Record<string, string[]>,
  ) {
    super({ code, message, details }, statusCode);
  }
}
