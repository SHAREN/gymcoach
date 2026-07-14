import { z } from 'zod';

const monthKey = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

export const mobileHistoryQuerySchema = z.object({
  month: monthKey,
  programId: z.string().min(1).optional(),
});

export type MobileHistoryQuery = z.infer<typeof mobileHistoryQuerySchema>;
