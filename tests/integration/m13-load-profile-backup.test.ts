import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { getCurrentUserId } from '@/lib/auth';
import { GET as getBackup, POST as postBackup } from '@/app/api/backup/route';
import { seedExerciseCatalog } from '@/lib/exercise-catalog';

vi.mock('@/lib/auth', () => ({ getCurrentUserId: vi.fn() }));
const mockUserId = vi.mocked(getCurrentUserId);

function actAs(userId: string) {
  mockUserId.mockResolvedValue(userId);
}

function restoreRequest(payload: unknown): Request {
  return new Request('http://test.local/api/backup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ payload, confirmReplace: true }),
  });
}

beforeEach(() => mockUserId.mockReset());

describe('M13 load-profile backup trust boundary', () => {
  it('rederives catalog trust from the full fingerprint instead of trusting imported REVIEWED metadata', async () => {
    const source = await db.user.create({
      data: { email: 'm13-backup-source@test.dev', passwordHash: 'x' },
    });
    await seedExerciseCatalog(db, source.id);
    actAs(source.id);

    const exportResponse = await getBackup();
    expect(exportResponse.status).toBe(200);
    const dump = await exportResponse.json();
    const bench = dump.exercises.find(
      (exercise: { name: string }) => exercise.name === 'Barbell bench press',
    );
    expect(bench).toMatchObject({
      catalogOrigin: 'SYSTEM_DEFAULT_V1',
      loadProfile: { classification: 'REVIEWED' },
    });

    // Keep the exported REVIEWED metadata but break the immutable fingerprint.
    // Restore must fail closed and discard the imported trust claim.
    bench.notes = 'User-edited technique note';

    const target = await db.user.create({
      data: { email: 'm13-backup-target@test.dev', passwordHash: 'x' },
    });
    actAs(target.id);
    const restoreResponse = await postBackup(restoreRequest(dump));
    expect(restoreResponse.status).toBe(200);

    const restored = await db.exercise.findFirstOrThrow({
      where: { userId: target.id, name: 'Barbell bench press' },
    });
    expect(restored.catalogOrigin).toBeNull();
    expect(restored.loadProfile).toMatchObject({
      classification: 'UNCLASSIFIED',
      provenance: 'UNCLASSIFIED',
    });
  });
});
