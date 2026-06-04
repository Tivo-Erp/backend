export class ErrorResponseDto {
  statusCode: number;
  code: string;
  message: string;
  details?: Record<string, string[]>;
  timestamp: string;
  path: string;
  correlationId: string;
}
