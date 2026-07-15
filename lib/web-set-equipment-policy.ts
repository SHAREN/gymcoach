import { ApiError } from '@/lib/api';
import type { Prisma } from '@/lib/prisma-client';

type WebSetEquipmentPolicyReader = Pick<Prisma.TransactionClient, 'gym'>;

// The normal web set routes must not create or explicitly clear a null
// equipment snapshot when the frozen session gym is equipment-first and the
// exercise has at least one linked physical machine. Historical legacy/null
// rows remain editable when the request does not explicitly clear equipment.
export async function assertWebSetEquipmentMayBeNull(
  client: WebSetEquipmentPolicyReader,
  input: {
    userId: string;
    sessionGymId: string | null;
    exerciseId: string;
  },
): Promise<void> {
  if (!input.sessionGymId) return;

  const equipmentFirstLink = await client.gym.findFirst({
    where: {
      id: input.sessionGymId,
      userId: input.userId,
      inventoryMode: 'EQUIPMENT_FIRST',
      equipment: {
        some: {
          exerciseLinks: { some: { exerciseId: input.exerciseId } },
        },
      },
    },
    select: { id: true },
  });
  if (equipmentFirstLink) {
    throw new ApiError(400, 'Select linked equipment before saving this set.');
  }
}
