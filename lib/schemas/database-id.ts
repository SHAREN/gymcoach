import { z } from 'zod';

// Database IDs are opaque at API boundaries. New rows normally use CUIDs, but
// imported and restored GymCoach data may legitimately contain UUIDs or other
// legacy string IDs. Ownership checks, not the ID's textual shape, provide the
// authorization boundary.
export const databaseIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .describe('Opaque GymCoach ID returned by a GymCoach read tool.');
