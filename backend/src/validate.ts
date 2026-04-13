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
    // Warn when Zod strips fields — a mismatch here means the caller sent a
    // field the schema doesn't know about (e.g. renamed field not updated in frontend).
    const stripped = Object.keys(req.body as object).filter(
      (k) => !(k in (result.data as object)),
    );
    if (stripped.length > 0) {
      console.warn(`[validateBody] ${req.path} — stripped unknown fields: ${stripped.join(', ')}`);
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
