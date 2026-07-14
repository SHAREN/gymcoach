import { z } from 'zod';

const operationId = z.string().regex(/^op_[a-f0-9]{32}$/);
const clientEntityId = z.string().regex(/^mob_[a-z_]+_[a-f0-9]{32}$/);

export const mobileCreateMetadataSchema = z
  .object({
    operationId: operationId.optional(),
    clientEntityId: clientEntityId.optional(),
  })
  .refine(
    (value) =>
      (value.operationId === undefined && value.clientEntityId === undefined) ||
      (value.operationId !== undefined && value.clientEntityId !== undefined),
    'Idempotency-Key and X-Client-Entity-Id must be provided together.',
  );

export type MobileCreateMetadata = z.infer<typeof mobileCreateMetadataSchema>;
