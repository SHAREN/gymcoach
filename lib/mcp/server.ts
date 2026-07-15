import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { db } from '@/lib/db';
import { buildCoachPayload } from '@/lib/coach';
import { buildProgramFromGenerated, evaluateProgramDesign } from '@/lib/program-generation';
import { generatedExerciseSchema, generatedProgramSchema } from '@/lib/schemas/program-generation';
import { programInputSchema } from '@/lib/schemas/program';
import { programDesignAnswersSchema, programDesignModeSchema } from '@/lib/schemas/program-design';
import { buildProgramDesignContext } from '@/lib/program-design-context';
import { validateProgramDesign } from '@/lib/program-design-validation';
import {
  GYM_EQUIPMENT_IMAGE_MIME_TYPES,
  getOwnedGymEquipmentImage,
  getOwnedGymInventory,
  listOwnedGyms,
  setOwnedGymEquipmentImage,
  updateOwnedGymFreeWeights,
  upsertOwnedGymEquipment,
  upsertOwnedGymPlatePool,
} from '@/lib/gym-equipment';
import { gymWeightListSchema } from '@/lib/schemas/gym';
import {
  gymEquipmentInputSchema,
  gymPlateInventoryItemSchema,
  gymPlatePoolInputSchema,
  plateCompatibilityKeySchema,
} from '@/lib/schemas/gym-equipment';
import {
  PROGRAM_DESIGN_METHODOLOGY,
  PROGRAM_DESIGN_METHODOLOGY_VERSION,
} from '@/lib/program-design-methodology';
import {
  EquipmentType,
  EquipmentLoadType,
  ExerciseCategory,
  MuscleGroup,
  SetAutoregulationMode,
} from '@/lib/prisma-client';
import type { McpPrincipal } from '@/lib/mcp/auth';

export const GYMCOACH_MCP_INSTRUCTIONS = `GymCoach stores the trainee's profile, gyms, equipment, programs, workout history, sets, RIR, goals and recovery signals.

Use read tools before making recommendations. Ground every recommendation in returned GymCoach data and never invent completed sets, available equipment, records or injuries. Respect the active gym's equipment constraints. Use the trainee's language.

Before creating, extending or revising a program, read gymcoach://methodology/program-design and call get_program_design_context with the intended mode. Ask every required question returned in missingQuestions. Use validate_program_draft before any write. Do not calculate an exact catabolism percentage or CNS fatigue score; use GymCoach recovery and volume-pressure signals.

Before inventorying a gym from narration or photos, read gymcoach://instructions/gym-inventory, call list_gyms and get_gym_inventory, and compare physical equipment separately from exercises. Do not guess a brand, model, selectable weight or exercise link from an unclear photo. Batch the proposed additions and corrections for confirmation before using write tools.

Program-writing tools change saved data. Explain the proposed change before calling a write tool. Newly created programs are inactive so the trainee can review them. Activate a program only when the trainee explicitly asks. Never delete or remove a program exercise without explicit confirmation.`;

export const GYM_INVENTORY_INSTRUCTIONS = `Gym inventory workflow:

1. Call list_gyms and select the requested gym. Call get_gym_inventory before interpreting new observations.
2. Treat physical equipment as separate from exercises. One machine may support several exercise IDs, and several machines may support the same exercise.
3. Compare narrated items and photos against sharedFreeWeights, platePools and equipment. Match by function, manufacturer/model when certain, and distinctive description. Do not rely on name similarity alone.
4. Ask focused questions for unreadable plates, pin stacks, brands, models, quantities or ambiguous machines. Mark uncertainty explicitly instead of inventing values.
5. Present one batched change summary. After explicit confirmation, use update_gym_free_weights for legacy dumbbells/bars, upsert_gym_plate_pool for universal compatible plate inventory, and upsert_gym_equipment for physical machines, stations and accessories.
6. Link known exercise IDs when the item supports them. Linked equipment is the primary availability/load source. Do not copy a machine's displayed stack positions into per-exercise configuration.
7. For each selectorized/cable machine, record its own selectedLoadMultiplier. A displayed stack value multiplied by this number is only a nominal estimate and never proves equivalence to another machine.
8. Use set_gym_equipment_image only for an image the trainee supplied or approved. Prefer an uploaded JPEG/PNG/WebP as base64 for durable storage; an external image must use HTTPS. Never upload an unrelated or uncertain image.
9. Use get_gym_equipment_image when an existing uploaded image must be inspected. Re-read get_gym_inventory after writes and report exactly what changed, what remains uncertain and which items still lack images or exercise links.`;

interface ServerOptions {
  principal: McpPrincipal;
  baseUrl: string;
}

const explicitConfirmation = z
  .literal(true)
  .describe('Set to true only after the trainee explicitly confirmed this saved-data change.');

const gymIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .describe('Opaque GymCoach gym ID returned by list_gyms.');

const httpsImageUrl = z
  .string()
  .trim()
  .url()
  .max(2048)
  .refine((value) => value.startsWith('https://'), 'Equipment image URL must use HTTPS.');

function result(data: Record<string, unknown>) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
  };
}

function requireWrite(principal: McpPrincipal) {
  if (!principal.canWrite) {
    throw new Error(
      'This GymCoach MCP token is read-only. Create a write-enabled token in Settings.',
    );
  }
}

async function getOwnedProgram(userId: string, programId?: string) {
  const program = programId
    ? await db.program.findFirst({ where: { id: programId, userId }, select: { id: true } })
    : await db.program.findFirst({ where: { userId, isActive: true }, select: { id: true } });
  if (!program) throw new Error(programId ? 'Program not found.' : 'No active program.');
  return program.id;
}

export function createGymCoachMcpServer({ principal, baseUrl }: ServerOptions): McpServer {
  const server = new McpServer(
    {
      name: 'GymCoach',
      version: '1.0.0',
      websiteUrl: baseUrl,
    },
    { instructions: GYMCOACH_MCP_INSTRUCTIONS },
  );

  server.registerResource(
    'gymcoach-agent-instructions',
    'gymcoach://instructions/agent',
    {
      title: 'GymCoach agent instructions',
      description: 'Rules for safely analysing and editing the trainee training data.',
      mimeType: 'text/plain',
    },
    async () => ({
      contents: [
        {
          uri: 'gymcoach://instructions/agent',
          mimeType: 'text/plain',
          text: GYMCOACH_MCP_INSTRUCTIONS,
        },
      ],
    }),
  );

  server.registerResource(
    'gymcoach-gym-inventory-instructions',
    'gymcoach://instructions/gym-inventory',
    {
      title: 'GymCoach gym-inventory instructions',
      description: 'Workflow for inventorying a gym from narration and photos.',
      mimeType: 'text/plain',
    },
    async () => ({
      contents: [
        {
          uri: 'gymcoach://instructions/gym-inventory',
          mimeType: 'text/plain',
          text: GYM_INVENTORY_INSTRUCTIONS,
        },
      ],
    }),
  );

  server.registerResource(
    'gymcoach-program-design-methodology',
    'gymcoach://methodology/program-design',
    {
      title: 'GymCoach program-design methodology',
      description:
        'Normative evidence, safety and deterministic rules for creating or extending programs.',
      mimeType: 'text/plain',
    },
    async () => ({
      contents: [
        {
          uri: 'gymcoach://methodology/program-design',
          mimeType: 'text/plain',
          text: PROGRAM_DESIGN_METHODOLOGY,
        },
      ],
    }),
  );

  server.registerPrompt(
    'build-training-program',
    {
      title: 'Build a GymCoach training program',
      description: 'Analyse the trainee context and prepare a structured program for GymCoach.',
      argsSchema: { goal: z.string().trim().min(5).max(2000) },
    },
    async ({ goal }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Goal: ${goal}\n\nRead gymcoach://methodology/program-design. Call get_program_design_context with mode NEW_PROGRAM and list_exercises. Ask every required missing question. Design a realistic draft from the returned metrics, call validate_program_draft, explain the draft and warnings, ask for confirmation, then call create_program with the same goal and answers.`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    'extend-training-program',
    {
      title: 'Build the next GymCoach mesocycle',
      description:
        'Analyse the active program and completed training, then create a reviewable next phase.',
      argsSchema: { goal: z.string().trim().min(5).max(2000) },
    },
    async ({ goal }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Next-phase goal: ${goal}\n\nRead gymcoach://methodology/program-design. Call get_program_design_context with mode NEXT_MESOCYCLE, then get_program for the source program. Ask every required missing question. Preserve what is progressing, use the calculated recovery and volume metrics, validate the draft, explain every change, ask for confirmation, then call create_program_revision.`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    'inventory-gym',
    {
      title: 'Inventory a GymCoach gym',
      description: 'Compare narrated or photographed equipment with saved gym inventory.',
      argsSchema: {
        gymId: gymIdSchema.optional(),
        observations: z.string().trim().max(5000).optional(),
      },
    },
    async ({ gymId, observations }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Inventory this gym${gymId ? ` (${gymId})` : ''}. Observations: ${observations ?? 'Use the narration and attached photos in this conversation.'}\n\nRead gymcoach://instructions/gym-inventory. Call list_gyms, get_gym_inventory and list_exercises. Compare the observations against saved physical equipment and free weights, ask about ambiguous details, then show one batched change plan. After confirmation, update the inventory and attach approved images. Re-read the inventory and report the final result.`,
          },
        },
      ],
    }),
  );

  server.registerTool(
    'list_gyms',
    {
      title: 'List gyms',
      description:
        'Lists saved gyms, identifies the active gym and reports physical-equipment/config counts.',
      annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true },
    },
    async () => result(await listOwnedGyms(principal.userId)),
  );

  server.registerTool(
    'get_gym_inventory',
    {
      title: 'Get complete gym inventory',
      description:
        'Returns shared dumbbells, plates and bars, every saved physical equipment item with descriptions/images/exercise links, plus full exercise availability coverage. Omit gymId to read the active gym.',
      inputSchema: {
        gymId: gymIdSchema.optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true },
    },
    async ({ gymId }) => result(await getOwnedGymInventory(principal.userId, baseUrl, gymId)),
  );

  server.registerTool(
    'get_gym_equipment_image',
    {
      title: 'Get a gym-equipment image',
      description:
        'Returns a saved uploaded equipment image as MCP image content, or the approved external HTTPS image URL. Use this when visual comparison is needed.',
      inputSchema: {
        equipmentId: z.string().cuid(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true },
    },
    async ({ equipmentId }) => {
      const saved = await getOwnedGymEquipmentImage(principal.userId, equipmentId);
      if (saved.image.kind === 'uploaded') {
        const metadata = {
          equipment: saved.equipment,
          image: {
            kind: saved.image.kind,
            mimeType: saved.image.mimeType,
            updatedAt: saved.image.updatedAt,
          },
        };
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify(metadata, null, 2) },
            { type: 'image' as const, data: saved.image.data, mimeType: saved.image.mimeType },
          ],
          structuredContent: metadata,
        };
      }
      return result(saved);
    },
  );

  server.registerTool(
    'update_gym_free_weights',
    {
      title: 'Update gym free-weight inventory',
      description:
        'Updates legacy shared dumbbell, plate or bar lists in kg. Use upsert_gym_plate_pool for new compatible plate inventory with quantities.',
      inputSchema: {
        confirmed: explicitConfirmation,
        gymId: gymIdSchema.optional(),
        dumbbellWeights: gymWeightListSchema.optional(),
        plateWeights: gymWeightListSchema.optional(),
        barWeights: gymWeightListSchema.optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ gymId, confirmed: _confirmed, ...patch }) => {
      requireWrite(principal);
      const gym = await updateOwnedGymFreeWeights(principal.userId, gymId, patch);
      return result({ ok: true, gym });
    },
  );

  server.registerTool(
    'upsert_gym_plate_pool',
    {
      title: 'Add or update a universal gym plate pool',
      description:
        'Creates or replaces one gym-wide compatible plate pool. Quantity is null when the denomination is known but its physical count is not.',
      inputSchema: {
        confirmed: explicitConfirmation,
        gymId: gymIdSchema.optional(),
        poolId: z.string().trim().min(8).max(200).optional(),
        name: z.string().trim().min(1).max(120),
        compatibilityKey: plateCompatibilityKeySchema,
        plates: z.array(gymPlateInventoryItemSchema).max(200),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ gymId, confirmed: _confirmed, ...input }) => {
      requireWrite(principal);
      const parsed = gymPlatePoolInputSchema.parse(input);
      const pool = await upsertOwnedGymPlatePool(principal.userId, gymId, parsed);
      return result({ ok: true, pool });
    },
  );

  server.registerTool(
    'upsert_gym_equipment',
    {
      title: 'Add or update physical gym equipment',
      description:
        'Creates or updates a physical equipment instance. Exercise links determine availability; the load profile determines attainable displayed loads.',
      inputSchema: {
        confirmed: explicitConfirmation,
        gymId: gymIdSchema.optional(),
        equipmentId: z.string().cuid().optional(),
        name: z.string().trim().min(1).max(120),
        equipmentType: z.nativeEnum(EquipmentType),
        description: z.string().trim().max(4000).nullable().optional(),
        manufacturer: z.string().trim().max(120).nullable().optional(),
        modelName: z.string().trim().max(120).nullable().optional(),
        quantity: z.number().int().min(1).max(100).optional(),
        loadType: z.nativeEnum(EquipmentLoadType).optional(),
        weightOptions: gymWeightListSchema.optional(),
        selectedLoadMultiplier: z.number().positive().max(20).optional(),
        baseLoadKg: z.number().min(0).max(5000).optional(),
        platePoolId: z.string().trim().min(8).max(200).nullable().optional(),
        loadingSides: z.number().int().min(1).max(8).optional(),
        exerciseIds: z.array(z.string().cuid()).max(100).optional(),
        markExercisesAvailable: z.boolean().optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ gymId, confirmed: _confirmed, ...input }) => {
      requireWrite(principal);
      const parsed = gymEquipmentInputSchema.parse(input);
      const saved = await upsertOwnedGymEquipment(principal.userId, gymId, parsed);
      return result({ ok: true, ...saved });
    },
  );

  server.registerTool(
    'set_gym_equipment_image',
    {
      title: 'Set a gym-equipment image',
      description:
        'Sets or clears a physical equipment image after confirmation. Use one of: an approved HTTPS URL, or JPEG/PNG/WebP base64 (raw or data URL) for durable database storage.',
      inputSchema: {
        confirmed: explicitConfirmation,
        equipmentId: z.string().cuid(),
        clear: z.literal(true).optional(),
        imageUrl: httpsImageUrl.optional(),
        imageBase64: z.string().max(7_100_000).optional(),
        mimeType: z.enum(GYM_EQUIPMENT_IMAGE_MIME_TYPES).optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ equipmentId, confirmed: _confirmed, ...input }) => {
      requireWrite(principal);
      const equipment = await setOwnedGymEquipmentImage(principal.userId, equipmentId, input);
      const image = equipment.imageMimeType
        ? {
            kind: 'uploaded',
            url: new URL(
              `/api/gym-equipment/${equipment.id}/image?v=${equipment.updatedAt.getTime()}`,
              baseUrl,
            ).toString(),
            mimeType: equipment.imageMimeType,
          }
        : equipment.imageUrl
          ? { kind: 'external', url: equipment.imageUrl, mimeType: null }
          : null;
      return result({ ok: true, equipment: { ...equipment, image } });
    },
  );

  server.registerTool(
    'get_training_context',
    {
      title: 'Get training context',
      description:
        'Returns the trainee profile, recent training, active program, records, goals, fatigue, readiness, conditioning and active gym equipment.',
      annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true },
    },
    async () => {
      const [coach, user] = await Promise.all([
        buildCoachPayload(principal.userId),
        db.user.findUnique({
          where: { id: principal.userId },
          select: {
            email: true,
            unit: true,
            activeGym: {
              include: {
                equipment: {
                  orderBy: { name: 'asc' },
                  select: {
                    id: true,
                    name: true,
                    equipmentType: true,
                    description: true,
                    manufacturer: true,
                    modelName: true,
                    quantity: true,
                    loadType: true,
                    weightOptions: true,
                    selectedLoadMultiplier: true,
                    baseLoadKg: true,
                    platePoolId: true,
                    loadingSides: true,
                    platePool: {
                      include: { plates: { orderBy: { weightKg: 'asc' } } },
                    },
                    imageUrl: true,
                    imageMimeType: true,
                    exerciseLinks: {
                      include: {
                        exercise: {
                          select: { id: true, name: true, equipmentType: true },
                        },
                      },
                    },
                  },
                },
                exerciseConfigs: {
                  orderBy: { exercise: { name: 'asc' } },
                  include: {
                    exercise: {
                      select: { id: true, name: true, equipmentType: true },
                    },
                  },
                },
                platePools: {
                  orderBy: { name: 'asc' },
                  include: { plates: { orderBy: { weightKg: 'asc' } } },
                },
              },
            },
          },
        }),
      ]);
      return result({
        instructionsVersion: 3,
        unit: user?.unit ?? 'KG',
        activeGym: user?.activeGym ?? null,
        coach,
      });
    },
  );

  server.registerTool(
    'get_program_design_context',
    {
      title: 'Get program-design context',
      description:
        'Returns the shared methodology version, required questions, full source program, gym inventory, calculated performance, volume, recovery, adherence and return-to-training metrics used by the internal LLM.',
      inputSchema: {
        goal: z.string().trim().min(5).max(2000),
        mode: programDesignModeSchema.default('NEW_PROGRAM'),
        sourceProgramId: z.string().cuid().optional(),
        answers: programDesignAnswersSchema.optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true },
    },
    async ({ goal, mode, sourceProgramId, answers }) => {
      const context = await buildProgramDesignContext({
        userId: principal.userId,
        goal,
        mode,
        sourceProgramId,
        answers,
      });
      return result({ context });
    },
  );

  server.registerTool(
    'validate_program_draft',
    {
      title: 'Validate program draft',
      description:
        'Checks a draft against the same recovery, gym, volume, duration and safety rules used by the internal LLM flow.',
      inputSchema: {
        goal: z.string().trim().min(5).max(2000),
        mode: programDesignModeSchema.default('NEW_PROGRAM'),
        sourceProgramId: z.string().cuid().optional(),
        answers: programDesignAnswersSchema.optional(),
        program: generatedProgramSchema,
      },
      annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true },
    },
    async ({ goal, mode, sourceProgramId, answers, program }) => {
      const context = await buildProgramDesignContext({
        userId: principal.userId,
        goal,
        mode,
        sourceProgramId,
        answers,
      });
      return result({
        methodologyVersion: PROGRAM_DESIGN_METHODOLOGY_VERSION,
        missingQuestions: context.missingQuestions,
        validation: validateProgramDesign(program, context),
      });
    },
  );

  server.registerTool(
    'list_exercises',
    {
      title: 'List exercise catalog',
      description: 'Lists the trainee exercise catalog with stable IDs and equipment categories.',
      inputSchema: {
        search: z.string().trim().max(120).optional(),
        limit: z.number().int().min(1).max(500).default(200),
      },
      annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true },
    },
    async ({ search, limit }) => {
      const exercises = await db.exercise.findMany({
        where: {
          userId: principal.userId,
          ...(search ? { name: { contains: search, mode: 'insensitive' as const } } : {}),
        },
        orderBy: { name: 'asc' },
        take: limit,
        select: {
          id: true,
          name: true,
          muscleGroup: true,
          category: true,
          equipmentType: true,
          usesBodyweight: true,
          defaultRestSec: true,
          notes: true,
        },
      });
      return result({ exercises });
    },
  );

  server.registerTool(
    'list_programs',
    {
      title: 'List training programs',
      description: 'Lists saved programs and their workout counts.',
      annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true },
    },
    async () => {
      const programs = await db.program.findMany({
        where: { userId: principal.userId },
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          name: true,
          phase: true,
          description: true,
          isActive: true,
          updatedAt: true,
          _count: { select: { workouts: true, sessions: true } },
        },
      });
      return result({ programs });
    },
  );

  server.registerTool(
    'get_program',
    {
      title: 'Get a training program',
      description: 'Returns a complete program with workout, exercise and autoregulation IDs.',
      inputSchema: {
        programId: z.string().cuid().optional().describe('Omit to read the active program.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true },
    },
    async ({ programId }) => {
      const id = await getOwnedProgram(principal.userId, programId);
      const program = await db.program.findUnique({
        where: { id },
        include: {
          workouts: {
            orderBy: { order: 'asc' },
            include: {
              exercises: {
                orderBy: { order: 'asc' },
                include: { exercise: true },
              },
            },
          },
        },
      });
      return result({ program });
    },
  );

  server.registerTool(
    'create_program',
    {
      title: 'Create training program',
      description:
        'Creates a complete inactive GymCoach program after rebuilding design context and validating the final draft.',
      inputSchema: {
        confirmed: explicitConfirmation,
        goal: z.string().trim().min(5).max(2000),
        answers: programDesignAnswersSchema,
        program: generatedProgramSchema,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ goal, answers, program }) => {
      requireWrite(principal);
      const { context, validation } = await evaluateProgramDesign(
        principal.userId,
        { goal, mode: 'NEW_PROGRAM', answers },
        program,
      );
      assertProgramDesignReady(context.missingQuestions, validation);
      const id = await buildProgramFromGenerated(principal.userId, program, {
        methodologyVersion: PROGRAM_DESIGN_METHODOLOGY_VERSION,
      });
      return result({
        ok: true,
        programId: id,
        active: false,
        methodologyVersion: PROGRAM_DESIGN_METHODOLOGY_VERSION,
        validation,
      });
    },
  );

  server.registerTool(
    'create_program_revision',
    {
      title: 'Create next program mesocycle',
      description:
        'Creates an inactive next-phase program linked to its source program. Validate and obtain user confirmation before calling.',
      inputSchema: {
        confirmed: explicitConfirmation,
        goal: z.string().trim().min(5).max(2000),
        sourceProgramId: z.string().cuid(),
        answers: programDesignAnswersSchema,
        program: generatedProgramSchema,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ goal, sourceProgramId, answers, program }) => {
      requireWrite(principal);
      await getOwnedProgram(principal.userId, sourceProgramId);
      const { context, validation } = await evaluateProgramDesign(
        principal.userId,
        { goal, mode: 'NEXT_MESOCYCLE', sourceProgramId, answers },
        program,
      );
      assertProgramDesignReady(context.missingQuestions, validation);
      const id = await buildProgramFromGenerated(principal.userId, program, {
        sourceProgramId: context.sourceProgramId,
        methodologyVersion: PROGRAM_DESIGN_METHODOLOGY_VERSION,
      });
      return result({
        ok: true,
        programId: id,
        sourceProgramId,
        active: false,
        methodologyVersion: PROGRAM_DESIGN_METHODOLOGY_VERSION,
        validation,
      });
    },
  );

  server.registerTool(
    'update_program_metadata',
    {
      title: 'Update program details',
      description: 'Updates a program name, phase and description after user confirmation.',
      inputSchema: {
        confirmed: explicitConfirmation,
        programId: z.string().cuid(),
        values: programInputSchema,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ programId, values }) => {
      requireWrite(principal);
      await getOwnedProgram(principal.userId, programId);
      const program = await db.program.update({
        where: { id: programId },
        data: {
          name: values.name,
          phase: values.phase,
          description: values.description ?? null,
        },
      });
      return result({ ok: true, program });
    },
  );

  server.registerTool(
    'add_program_exercise',
    {
      title: 'Add program exercise',
      description: 'Adds an exercise to an existing workout after user confirmation.',
      inputSchema: {
        confirmed: explicitConfirmation,
        workoutId: z.string().cuid(),
        exercise: generatedExerciseSchema,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ workoutId, exercise: input }) => {
      requireWrite(principal);
      const workout = await db.workout.findFirst({
        where: { id: workoutId, program: { userId: principal.userId } },
        select: { id: true },
      });
      if (!workout) throw new Error('Workout not found.');

      const created = await db.$transaction(async (tx) => {
        const exercise = await tx.exercise.upsert({
          where: { userId_name: { userId: principal.userId, name: input.name } },
          update: {},
          create: {
            userId: principal.userId,
            name: input.name,
            muscleGroup: input.muscleGroup,
            category: input.category,
            equipmentType: input.equipmentType ?? 'OTHER',
            defaultRestSec: input.restSec,
          },
        });
        const last = await tx.programExercise.findFirst({
          where: { workoutId },
          orderBy: { order: 'desc' },
          select: { order: true },
        });
        return tx.programExercise.create({
          data: {
            workoutId,
            exerciseId: exercise.id,
            order: (last?.order ?? 0) + 1,
            targetSets: input.targetSets,
            targetDropSets: input.targetDropSets ?? 0,
            targetRepsMin: input.targetRepsMin,
            targetRepsMax: input.targetRepsMax,
            targetRIR: input.targetRIR,
            restSec: input.restSec,
            autoregulationMode: input.autoregulationMode ?? 'PRESERVE_RIR',
            fatigueRate: input.fatigueRate ?? null,
            loadAdjustmentPct: input.loadAdjustmentPct ?? null,
            supersetGroup: input.supersetGroup ?? null,
            tempo: input.tempo ?? null,
            notes: input.notes ?? null,
          },
          include: { exercise: true },
        });
      });
      return result({ ok: true, programExercise: created });
    },
  );

  server.registerTool(
    'update_program_exercise',
    {
      title: 'Update program exercise',
      description:
        'Changes targets and autoregulation for an existing program exercise after user confirmation.',
      inputSchema: {
        programExerciseId: z.string().cuid(),
        confirmed: explicitConfirmation,
        targetSets: z.number().int().min(1).max(20).optional(),
        targetDropSets: z.number().int().min(0).max(10).optional(),
        targetRepsMin: z.number().int().min(1).max(50).optional(),
        targetRepsMax: z.number().int().min(1).max(50).optional(),
        targetRIR: z.number().int().min(0).max(5).optional(),
        restSec: z.number().int().min(15).max(600).optional(),
        autoregulationMode: z.nativeEnum(SetAutoregulationMode).optional(),
        fatigueRate: z.number().min(0.25).max(2).nullable().optional(),
        loadAdjustmentPct: z.number().min(1).max(5).nullable().optional(),
        supersetGroup: z.number().int().min(1).max(9).nullable().optional(),
        tempo: z.string().trim().max(20).nullable().optional(),
        notes: z.string().trim().max(2000).nullable().optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ programExerciseId, confirmed: _confirmed, ...patch }) => {
      requireWrite(principal);
      const current = await db.programExercise.findFirst({
        where: { id: programExerciseId, workout: { program: { userId: principal.userId } } },
      });
      if (!current) throw new Error('Program exercise not found.');

      const min = patch.targetRepsMin ?? current.targetRepsMin;
      const max = patch.targetRepsMax ?? current.targetRepsMax;
      if (max < min)
        throw new Error('targetRepsMax must be greater than or equal to targetRepsMin.');

      const updated = await db.programExercise.update({
        where: { id: programExerciseId },
        data: patch,
        include: { exercise: true },
      });
      return result({ ok: true, programExercise: updated });
    },
  );

  server.registerTool(
    'remove_program_exercise',
    {
      title: 'Remove program exercise',
      description: 'Removes one exercise from a program. Requires explicit user confirmation.',
      inputSchema: { confirmed: explicitConfirmation, programExerciseId: z.string().cuid() },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ programExerciseId }) => {
      requireWrite(principal);
      const current = await db.programExercise.findFirst({
        where: { id: programExerciseId, workout: { program: { userId: principal.userId } } },
        include: { exercise: { select: { name: true } } },
      });
      if (!current) throw new Error('Program exercise not found.');
      await db.programExercise.delete({ where: { id: programExerciseId } });
      return result({ ok: true, removedExercise: current.exercise.name });
    },
  );

  server.registerTool(
    'activate_program',
    {
      title: 'Activate training program',
      description: 'Makes a saved program active. Call only after explicit user confirmation.',
      inputSchema: { confirmed: explicitConfirmation, programId: z.string().cuid() },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ programId }) => {
      requireWrite(principal);
      await getOwnedProgram(principal.userId, programId);
      await db.$transaction([
        db.program.updateMany({
          where: { userId: principal.userId, isActive: true, id: { not: programId } },
          data: { isActive: false },
        }),
        db.program.update({ where: { id: programId }, data: { isActive: true } }),
      ]);
      return result({ ok: true, programId, active: true });
    },
  );

  return server;
}

// Exported for schema documentation and future OAuth scopes.
export const MCP_ENUMS = {
  equipmentTypes: Object.values(EquipmentType),
  equipmentLoadTypes: Object.values(EquipmentLoadType),
  exerciseCategories: Object.values(ExerciseCategory),
  muscleGroups: Object.values(MuscleGroup),
};

function assertProgramDesignReady(
  missingQuestions: Array<{ prompt: string }>,
  validation: ReturnType<typeof validateProgramDesign>,
) {
  if (missingQuestions.length > 0) {
    throw new Error(
      `Answer every required program-design question first: ${missingQuestions
        .map((question) => question.prompt)
        .join(' ')}`,
    );
  }
  const errors = validation.issues.filter((issue) => issue.severity === 'error');
  if (errors.length > 0) {
    throw new Error(`Program validation failed: ${errors.map((issue) => issue.message).join(' ')}`);
  }
}
