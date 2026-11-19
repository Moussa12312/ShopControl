import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { ZodError, ZodSchema } from 'zod';

@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown): T {
    try {
      return this.schema.parse(value);
    } catch (err) {
      if (err instanceof ZodError) {
        const fieldErrors = err.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        }));
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: fieldErrors[0]?.message || 'Les données envoyées sont invalides.',
          errors: fieldErrors,
        });
      }
      throw err;
    }
  }
}
