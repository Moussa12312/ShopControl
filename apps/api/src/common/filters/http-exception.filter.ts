import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { RequestWithCorrelation } from '../middleware/correlation-id.middleware';

@Catch()
export class GlobalHttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalHttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<RequestWithCorrelation>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_SERVER_ERROR';
    let message = 'Une erreur interne est survenue. Veuillez réessayer.';
    let errors: unknown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (body && typeof body === 'object') {
        const record = body as Record<string, unknown>;
        if (typeof record.code === 'string') {
          code = record.code;
        } else {
          code = HttpStatus[status] || 'HTTP_ERROR';
        }
        if (typeof record.message === 'string') {
          message = record.message;
        } else if (Array.isArray(record.message)) {
          message = String(record.message[0]);
          errors = record.message;
        }
        if (record.errors) {
          errors = record.errors;
        }
      }
    } else if (exception instanceof Error) {
      this.logger.error(`[${request.correlationId}] ${exception.message}`, exception.stack);
    }

    response.status(status).json({
      statusCode: status,
      code,
      message,
      ...(errors ? { errors } : {}),
      correlationId: request.correlationId ?? null,
      timestamp: new Date().toISOString(),
    });
  }
}
