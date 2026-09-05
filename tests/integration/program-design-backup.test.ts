import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { getCurrentUserId } from '@/lib/auth';
import { GET as getBackup, POST as postBackup } from '@/app/api/backup/route';

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

describe('program revision backup', () => {
  it('round-trips lineage by array position without reusing source database ids', async () => {
    const sourceUser = await db.user.create({
      data: { email: 'program-backup-source@test.dev', passwordHash: 'x' },
    });
    const source = await db.program.create({
      data: { userId: sourceUser.id, name: 'Current block', phase: 'base', isActive: true },
    });
    await db.program.create({
      data: {
        userId: sourceUser.id,
        name: 'Next block',
        phase: 'accumulation',
        isActive: false,
        parentProgramId: source.id,
        methodologyVersion: '2026-09-05.external-mcp-v1',
      },
    });
    actAs(sourceUser.id);

    const exportResponse = await getBackup();
    expect(exportResponse.status).toBe(200);
    const dump = await exportResponse.json();
    expect(dump.version).toBe(7);
    expect(dump.programs[0]).toMatchObject({
      name: 'Current block',
      parentProgramIndex: null,
      methodologyVersion: null,
    });
    expect(dump.programs[1]).toMatchObject({
      name: 'Next block',
      parentProgramIndex: 0,
      methodologyVersion: '2026-09-05.external-mcp-v1',
    });

    const target = await db.user.create({
      data: { email: 'program-backup-target@test.dev', passwordHash: 'x' },
    });
    actAs(target.id);
    const restoreResponse = await postBackup(restoreRequest(dump));
    expect(restoreResponse.status).toBe(200);

    const restoredRevision = await db.program.findFirstOrThrow({
      where: { userId: target.id, name: 'Next block' },
      include: { parentProgram: true },
    });
    expect(restoredRevision.parentProgram?.name).toBe('Current block');
    expect(restoredRevision.parentProgramId).not.toBe(source.id);
    expect(restoredRevision.methodologyVersion).toBe('2026-09-05.external-mcp-v1');
  });
});
