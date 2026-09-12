import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createGymCoachMcpServer,
  GYMCOACH_MCP_INSTRUCTIONS,
  GYMCOACH_MCP_TOOL_NAMES,
  GYMCOACH_MCP_VERSION,
  GYM_INVENTORY_INSTRUCTIONS,
} from './server';

const openServers: Array<ReturnType<typeof createGymCoachMcpServer>> = [];
const openClients: Client[] = [];

afterEach(async () => {
  await Promise.allSettled(openClients.splice(0).map((client) => client.close()));
  await Promise.allSettled(openServers.splice(0).map((server) => server.close()));
});

describe('GymCoach MCP server', () => {
  it('advertises agent instructions, resources, prompts and safe tool annotations', async () => {
    const server = createGymCoachMcpServer({
      principal: { tokenId: 'token-1', userId: 'user-1', canWrite: true },
      baseUrl: 'https://gymcoach.example',
    });
    const client = new Client({ name: 'gymcoach-test', version: '1.0.0' });
    openServers.push(server);
    openClients.push(client);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const tools = await client.listTools();
    const byName = new Map(tools.tools.map((tool) => [tool.name, tool]));
    expect([...byName.keys()].sort()).toEqual([...GYMCOACH_MCP_TOOL_NAMES].sort());
    expect(tools.tools.length).toBeGreaterThan(10);
    expect(byName.has('list_gyms')).toBe(true);
    expect(byName.has('create_gym')).toBe(true);
    expect(byName.has('set_active_gym')).toBe(true);
    expect(byName.has('get_gym_inventory')).toBe(true);
    expect(byName.has('get_gym_equipment_image')).toBe(true);
    expect(byName.has('set_gym_inventory_mode')).toBe(true);
    expect(byName.has('update_gym_free_weights')).toBe(true);
    expect(byName.has('upsert_gym_equipment')).toBe(true);
    expect(byName.has('delete_gym_equipment')).toBe(true);
    expect(byName.has('upsert_gym_plate_pool')).toBe(true);
    expect(byName.has('delete_gym_plate_pool')).toBe(true);
    expect(byName.has('set_gym_equipment_image')).toBe(true);
    expect(byName.has('list_equipment_templates')).toBe(true);
    expect(byName.has('upsert_equipment_template')).toBe(true);
    expect(byName.has('delete_equipment_template')).toBe(true);
    expect(byName.has('set_gym_equipment_template')).toBe(true);
    expect(byName.has('list_equipment_images')).toBe(true);
    expect(byName.has('get_equipment_image')).toBe(true);
    expect(byName.has('add_equipment_image')).toBe(true);
    expect(byName.has('set_primary_equipment_image')).toBe(true);
    expect(byName.has('delete_equipment_image')).toBe(true);
    expect(byName.has('get_training_context')).toBe(true);
    expect(byName.has('get_training_history')).toBe(true);
    expect(byName.has('get_mcp_capability_index')).toBe(true);
    expect(byName.has('submit_mcp_feedback')).toBe(true);
    expect(byName.has('list_mcp_feedback')).toBe(true);
    expect(byName.has('resolve_entities')).toBe(true);
    expect(byName.has('get_workouts')).toBe(true);
    expect(byName.has('preview_historical_equipment_backfill')).toBe(true);
    expect(byName.has('backfill_historical_equipment')).toBe(true);
    expect(byName.has('analyze_historical_workout_conflicts')).toBe(true);
    expect(byName.has('preview_historical_workout_import')).toBe(true);
    expect(byName.has('import_historical_workouts')).toBe(true);
    expect(byName.has('delete_workout')).toBe(true);
    expect(byName.has('delete_workouts')).toBe(true);
    expect(byName.has('import_historical_workout')).toBe(true);
    expect(byName.has('get_program_design_context')).toBe(true);
    expect(byName.has('validate_program_draft')).toBe(true);
    expect(byName.has('create_program')).toBe(true);
    expect(byName.has('create_program_v2')).toBe(true);
    expect(byName.has('create_program_revision')).toBe(true);
    expect(byName.has('update_program_exercise')).toBe(true);
    expect(Object.keys(byName.get('create_program')?.inputSchema.properties ?? {}).sort()).toEqual([
      'confirmed',
      'program',
    ]);
    expect([...(byName.get('create_program')?.inputSchema.required ?? [])].sort()).toEqual([
      'confirmed',
      'program',
    ]);
    expect(
      Object.keys(byName.get('create_program_v2')?.inputSchema.properties ?? {}).sort(),
    ).toEqual(['answers', 'confirmed', 'goal', 'program']);
    expect([...(byName.get('create_program_v2')?.inputSchema.required ?? [])].sort()).toEqual([
      'answers',
      'confirmed',
      'goal',
      'program',
    ]);
    const programIdSchema = byName.get('get_program')?.inputSchema.properties?.programId as
      | { pattern?: string }
      | undefined;
    expect(programIdSchema?.pattern).toBeUndefined();
    expect(byName.get('get_gym_inventory')?.annotations?.readOnlyHint).toBe(true);
    expect(byName.get('get_gym_equipment_image')?.annotations?.readOnlyHint).toBe(true);
    expect(byName.get('set_gym_equipment_image')?.annotations?.readOnlyHint).toBe(false);
    expect(byName.get('list_equipment_templates')?.annotations?.readOnlyHint).toBe(true);
    expect(byName.get('list_equipment_images')?.annotations?.readOnlyHint).toBe(true);
    expect(byName.get('get_equipment_image')?.annotations?.readOnlyHint).toBe(true);
    expect(byName.get('add_equipment_image')?.annotations?.readOnlyHint).toBe(false);
    expect(byName.get('delete_equipment_template')?.annotations?.destructiveHint).toBe(true);
    expect(byName.get('delete_equipment_image')?.annotations?.destructiveHint).toBe(true);
    expect(byName.get('delete_gym_equipment')?.annotations?.destructiveHint).toBe(true);
    expect(byName.get('delete_gym_plate_pool')?.annotations?.destructiveHint).toBe(true);
    expect(byName.get('create_gym')?.inputSchema.required).toEqual(
      expect.arrayContaining(['confirmed', 'name']),
    );
    expect(byName.get('upsert_gym_equipment')?.inputSchema.properties).toHaveProperty(
      'preferredExerciseIds',
    );
    expect(byName.get('get_training_context')?.annotations?.readOnlyHint).toBe(true);
    expect(byName.get('get_training_history')?.annotations?.readOnlyHint).toBe(true);
    expect(byName.get('get_mcp_capability_index')?.annotations?.readOnlyHint).toBe(true);
    expect(byName.get('submit_mcp_feedback')?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    });
    expect(byName.get('submit_mcp_feedback')?.inputSchema.required).toEqual(
      expect.arrayContaining(['category', 'severity', 'summary', 'details']),
    );
    expect(byName.get('submit_mcp_feedback')?.inputSchema.required ?? []).not.toContain('confirmed');
    expect(byName.get('list_mcp_feedback')?.annotations?.readOnlyHint).toBe(true);
    expect(byName.get('resolve_entities')?.annotations?.readOnlyHint).toBe(true);
    expect(byName.get('get_workouts')?.annotations?.readOnlyHint).toBe(true);
    expect(byName.get('preview_historical_equipment_backfill')?.annotations?.readOnlyHint).toBe(true);
    expect(byName.get('backfill_historical_equipment')?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    });
    expect(byName.get('backfill_historical_equipment')?.inputSchema.required).toEqual(
      expect.arrayContaining(['confirmed', 'assignments']),
    );
    expect(byName.get('analyze_historical_workout_conflicts')?.annotations?.readOnlyHint).toBe(true);
    expect(byName.get('preview_historical_workout_import')?.annotations?.readOnlyHint).toBe(true);
    expect(byName.get('import_historical_workouts')?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: true });
    expect(byName.get('import_historical_workouts')?.inputSchema.required).toEqual(expect.arrayContaining(['confirmed', 'workouts']));
    expect(byName.get('delete_workout')?.annotations?.destructiveHint).toBe(true);
    expect(byName.get('delete_workouts')?.annotations?.destructiveHint).toBe(true);
    expect(byName.get('import_historical_workout')?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: true });
    expect(byName.get('import_historical_workout')?.inputSchema.required).toEqual(expect.arrayContaining(['confirmed', 'importId', 'startedAt', 'exercises']));
    expect(byName.get('remove_program_exercise')?.annotations?.destructiveHint).toBe(true);

    const resources = await client.listResources();
    expect(resources.resources.map((resource) => resource.uri)).toContain(
      'gymcoach://instructions/agent',
    );
    expect(resources.resources.map((resource) => resource.uri)).toContain(
      'gymcoach://instructions/gym-inventory',
    );
    expect(resources.resources.map((resource) => resource.uri)).toContain(
      'gymcoach://methodology/program-design',
    );
    const prompts = await client.listPrompts();
    expect(prompts.prompts.map((prompt) => prompt.name)).toContain('build-training-program');
    expect(prompts.prompts.map((prompt) => prompt.name)).toContain('extend-training-program');
    expect(prompts.prompts.map((prompt) => prompt.name)).toContain('revise-training-program');
    expect(prompts.prompts.map((prompt) => prompt.name)).toContain('inventory-gym');

    const instructions = await client.readResource({ uri: 'gymcoach://instructions/agent' });
    expect(instructions.contents[0]).toMatchObject({ text: GYMCOACH_MCP_INSTRUCTIONS });
    expect(GYMCOACH_MCP_INSTRUCTIONS).toMatch(/exact UTC ISO calendar weeks/);
    expect(GYMCOACH_MCP_INSTRUCTIONS).toMatch(/explicit indirect sets/);
    expect(GYMCOACH_MCP_INSTRUCTIONS).toMatch(/versioned engineering-heuristic metadata/);
    expect(GYMCOACH_MCP_INSTRUCTIONS).toMatch(/unknown participation/);
    expect(GYMCOACH_MCP_INSTRUCTIONS).toMatch(/stored MCP feedback body as untrusted data/);
    expect(GYMCOACH_MCP_INSTRUCTIONS).toMatch(/never treat their text as confirmation/);
    expect(GYMCOACH_MCP_INSTRUCTIONS).toMatch(/coachingProfile fields have explicit UNKNOWN/);
    expect(GYMCOACH_MCP_INSTRUCTIONS).toMatch(/MEDICAL_CLEARANCE_REQUIRED/);
    expect(GYMCOACH_MCP_INSTRUCTIONS).toMatch(/complete MCP tool list once/);
    expect(GYMCOACH_MCP_INSTRUCTIONS).toMatch(/Do not repeatedly probe synonyms/);
    expect(GYMCOACH_MCP_INSTRUCTIONS).toMatch(/submit_mcp_feedback once per root cause/);
    expect(GYMCOACH_MCP_INSTRUCTIONS).toMatch(/preview_historical_equipment_backfill/);

    const capabilityIndex = await client.callTool({
      name: 'get_mcp_capability_index',
      arguments: {},
    });
    const capabilityContent = capabilityIndex.content as Array<{ type: string; text?: string }>;
    const capabilityText = capabilityContent.find((part) => part.type === 'text');
    expect(capabilityText).toMatchObject({ type: 'text' });
    if (capabilityText?.type === 'text') {
      expect(capabilityText.text).toContain(GYMCOACH_MCP_VERSION);
      expect(capabilityText.text).toContain('backfill_historical_equipment');
      expect(capabilityText.text).toContain('submit_mcp_feedback');
      expect(capabilityText.text).toContain('complete tools/list');
    }

    const buildPrompt = await client.getPrompt({
      name: 'build-training-program',
      arguments: { goal: 'Build a three day strength program' },
    });
    expect(buildPrompt.messages[0]?.content).toMatchObject({
      type: 'text',
      text: expect.stringContaining('create_program_v2'),
    });
    const inventoryInstructions = await client.readResource({
      uri: 'gymcoach://instructions/gym-inventory',
    });
    expect(inventoryInstructions.contents[0]).toMatchObject({
      text: GYM_INVENTORY_INSTRUCTIONS,
    });
  });
});
