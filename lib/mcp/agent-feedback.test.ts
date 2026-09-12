import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: {
    mcpAgentFeedback: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

import { db } from '@/lib/db';
import { listMcpAgentFeedback, submitMcpAgentFeedback } from '@/lib/mcp/agent-feedback';

const createFeedback = vi.mocked(db.mcpAgentFeedback.create);
const findFeedback = vi.mocked(db.mcpAgentFeedback.findMany);

describe('MCP agent feedback', () => {
  beforeEach(() => {
    createFeedback.mockReset();
    findFeedback.mockReset();
  });

  it('stores a detailed normalized diagnostic report without a training-data confirmation', async () => {
    createFeedback.mockResolvedValue({
      id: 'feedback-1',
      category: 'DISCOVERY_FRICTION',
      severity: 'HIGH',
      summary: 'Repeated filtered discovery hid the full tool list',
      relatedTools: ['tools/list', 'get_mcp_capability_index'],
      serverVersion: '1.1.0',
      createdAt: new Date('2026-09-12T18:00:00.000Z'),
    } as never);

    const result = await submitMcpAgentFeedback('user-1', '1.1.0', {
      category: 'DISCOVERY_FRICTION',
      severity: 'HIGH',
      summary: '  Repeated filtered discovery hid the full tool list  ',
      details: '  The agent repeatedly filtered discovery by guessed keywords instead of listing all tools.  ',
      relatedTools: [' tools/list ', 'get_mcp_capability_index', 'tools/list'],
      expectedBehavior: '  Enumerate once and pick the exact tool. ',
      actualBehavior: '  Repeated synonym probes. ',
      reproductionSteps: [' request historical repair ', '', ' filter tools by history '],
      attemptedWorkarounds: [' try another keyword ', ' try another keyword '],
      suggestedImprovement: '  Publish an explicit capability index and discovery rule. ',
      clientName: ' ChatGPT ',
      agentName: ' GPT-5.6 Sol ',
    });

    const call = createFeedback.mock.calls[0]?.[0];
    expect(call?.data).toMatchObject({
      userId: 'user-1',
      category: 'DISCOVERY_FRICTION',
      severity: 'HIGH',
      summary: 'Repeated filtered discovery hid the full tool list',
      details: 'The agent repeatedly filtered discovery by guessed keywords instead of listing all tools.',
      relatedTools: ['tools/list', 'get_mcp_capability_index'],
      expectedBehavior: 'Enumerate once and pick the exact tool.',
      actualBehavior: 'Repeated synonym probes.',
      reproductionSteps: ['request historical repair', 'filter tools by history'],
      attemptedWorkarounds: ['try another keyword', 'try another keyword'],
      suggestedImprovement: 'Publish an explicit capability index and discovery rule.',
      clientName: 'ChatGPT',
      agentName: 'GPT-5.6 Sol',
      serverVersion: '1.1.0',
    });
    expect(result).toMatchObject({
      ok: true,
      feedbackId: 'feedback-1',
      category: 'DISCOVERY_FRICTION',
      severity: 'HIGH',
      serverVersion: '1.1.0',
    });
  });

  it('lists accumulated feedback newest first with a bounded limit', async () => {
    findFeedback.mockResolvedValue([
      {
        id: 'feedback-2',
        userId: 'user-1',
        category: 'MISSING_CAPABILITY',
        severity: 'MEDIUM',
        summary: 'Missing bulk repair',
        details: 'Agent had to repair rows one at a time.',
        relatedTools: ['example_tool'],
        expectedBehavior: 'One batch tool.',
        actualBehavior: 'Many calls.',
        reproductionSteps: ['inspect gaps'],
        attemptedWorkarounds: ['manual loop'],
        suggestedImprovement: 'Add a batch tool.',
        clientName: 'ChatGPT',
        agentName: null,
        serverVersion: '1.1.0',
        createdAt: new Date('2026-09-12T18:30:00.000Z'),
      },
    ] as never);

    const result = await listMcpAgentFeedback('user-1', {
      category: 'MISSING_CAPABILITY',
      limit: 999,
    });

    expect(findFeedback).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-1', category: 'MISSING_CAPABILITY' },
        take: 200,
      }),
    );
    expect(result.feedback[0]).toMatchObject({
      feedbackId: 'feedback-2',
      summary: 'Missing bulk repair',
      createdAt: '2026-09-12T18:30:00.000Z',
    });
  });
});
