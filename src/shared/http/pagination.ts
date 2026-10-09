import { z } from 'zod';

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1).describe('Page number (1-based)'),
  pageSize: z.coerce.number().int().min(1).max(100).default(20).describe('Items per page (max 100)'),
});

export const pagedSchema = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    data: z.array(item),
    pagination: z.object({
      page: z.number().int(),
      pageSize: z.number().int(),
      total: z.number().int(),
      totalPages: z.number().int(),
    }),
  });

export interface Page<T> {
  data: T[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

export function toPage<T>(data: T[], total: number, page: number, pageSize: number): Page<T> {
  return { data, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
}
