import type { ZodType } from 'zod';
import type { Request, Response, NextFunction } from 'express';

/** Express middleware that validates req.body against a Zod schema. */
export function validateBody<T extends ZodType>(schema: T) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({
        success: false,
        errorMessage: result.error.issues.map((i) => i.message).join('; '),
      });
      return;
    }
    req.body = result.data;
    next();
  };
}

/** Express middleware that validates req.query against a Zod schema. */
export function validateQuery<T extends ZodType>(schema: T) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      res.status(400).json({
        success: false,
        errorMessage: result.error.issues.map((i) => i.message).join('; '),
      });
      return;
    }
    next();
  };
}
