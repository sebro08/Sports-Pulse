import type { z } from 'zod';

export interface RejectedRecord {
  index: number;
  issues: string[];
}

/** Valida registro a registro: un registro malo se rechaza, no tumba toda la ingestion. */
export function parseRecords<S extends z.ZodTypeAny>(
  schema: S,
  items: unknown[],
): { valid: z.infer<S>[]; rejected: RejectedRecord[] } {
  const valid: z.infer<S>[] = [];
  const rejected: RejectedRecord[] = [];
  items.forEach((item, index) => {
    const result = schema.safeParse(item);
    if (result.success) {
      valid.push(result.data);
    } else {
      rejected.push({
        index,
        issues: result.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`),
      });
    }
  });
  return { valid, rejected };
}
