import { db } from '@/lib/db';

export const MCP_FEEDBACK_CATEGORIES = [
  'TOOL_ERROR',
  'DISCOVERY_FRICTION',
  'MISSING_CAPABILITY',
  'CONFUSING_SCHEMA',
  'AMBIGUOUS_RESULT',
  'WORKFLOW_FRICTION',
  'PERFORMANCE',
  'OTHER',
] as const;

export const MCP_FEEDBACK_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'BLOCKING'] as const;

export type McpFeedbackCategory = (typeof MCP_FEEDBACK_CATEGORIES)[number];
export type McpFeedbackSeverity = (typeof MCP_FEEDBACK_SEVERITIES)[number];

export interface SubmitMcpAgentFeedbackInput {
  category: McpFeedbackCategory;
  severity: McpFeedbackSeverity;
  summary: string;
  details: string;
  relatedTools?: string[];
  expectedBehavior?: string | null;
  actualBehavior?: string | null;
  reproductionSteps?: string[];
  attemptedWorkarounds?: string[];
  suggestedImprovement?: string | null;
  clientName?: string | null;
  agentName?: string | null;
}

export async function submitMcpAgentFeedback(
  userId: string,
  serverVersion: string,
  input: SubmitMcpAgentFeedbackInput,
) {
  const row = await db.mcpAgentFeedback.create({
    data: {
      userId,
      category: input.category,
      severity: input.severity,
      summary: input.summary.trim(),
      details: input.details.trim(),
      relatedTools: dedupe(input.relatedTools ?? []),
      expectedBehavior: trimNullable(input.expectedBehavior),
      actualBehavior: trimNullable(input.actualBehavior),
      reproductionSteps: compact(input.reproductionSteps ?? []),
      attemptedWorkarounds: compact(input.attemptedWorkarounds ?? []),
      suggestedImprovement: trimNullable(input.suggestedImprovement),
      clientName: trimNullable(input.clientName),
      agentName: trimNullable(input.agentName),
      serverVersion,
    },
    select: {
      id: true,
      category: true,
      severity: true,
      summary: true,
      relatedTools: true,
      serverVersion: true,
      createdAt: true,
    },
  });
  return {
    ok: true as const,
    feedbackId: row.id,
    category: row.category,
    severity: row.severity,
    summary: row.summary,
    relatedTools: row.relatedTools,
    serverVersion: row.serverVersion,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listMcpAgentFeedback(
  userId: string,
  input: { category?: McpFeedbackCategory; limit?: number },
) {
  const limit = Math.max(1, Math.min(input.limit ?? 50, 200));
  const rows = await db.mcpAgentFeedback.findMany({
    where: {
      userId,
      ...(input.category ? { category: input.category } : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit,
  });
  return {
    returned: rows.length,
    feedback: rows.map((row) => ({
      feedbackId: row.id,
      category: row.category,
      severity: row.severity,
      summary: row.summary,
      details: row.details,
      relatedTools: row.relatedTools,
      expectedBehavior: row.expectedBehavior,
      actualBehavior: row.actualBehavior,
      reproductionSteps: row.reproductionSteps,
      attemptedWorkarounds: row.attemptedWorkarounds,
      suggestedImprovement: row.suggestedImprovement,
      clientName: row.clientName,
      agentName: row.agentName,
      serverVersion: row.serverVersion,
      createdAt: row.createdAt.toISOString(),
    })),
  };
}

function compact(values: string[]): string[] {
  return values.map((value) => value.trim()).filter(Boolean);
}

function dedupe(values: string[]): string[] {
  return [...new Set(compact(values))];
}

function trimNullable(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
