import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError, parseJsonBody, requireApiUserId } from '@/lib/api';
import { generatedProgramSchema } from '@/lib/schemas/program-generation';
import { defaultIntraSetConfig } from '@/lib/intra-set-autoregulation';
import {
  classificationMetadataAfterServerUpdate,
  deriveServerExerciseClassification,
} from '@/lib/exercise-classification';
import { SYSTEM_EXERCISE_CATALOG_ORIGIN } from '@/lib/exercise-catalog';

export async function POST(req: Request) {
  try {
    const userId = await requireApiUserId();
    const data = await parseJsonBody(req, generatedProgramSchema);

    const program = await db.$transaction(async (tx) => {
      await tx.program.updateMany({
        where: { userId, isActive: true },
        data: { isActive: false },
      });

      const createdProgram = await tx.program.create({
        data: {
          userId,
          name: data.name,
          description: data.description ?? null,
          phase: data.phase,
          isActive: true,
        },
      });

      for (const [workoutIndex, workout] of data.workouts.entries()) {
        const createdWorkout = await tx.workout.create({
          data: {
            programId: createdProgram.id,
            name: workout.name,
            dayOfWeek: workout.dayOfWeek ?? null,
            order: workoutIndex + 1,
          },
        });

        for (const [exerciseIndex, exercise] of workout.exercises.entries()) {
          const existingExercise = await tx.exercise.findUnique({
            where: { userId_name: { userId, name: exercise.name } },
          });
          // A template describes the program prescription, not permission to
          // overwrite a user's edited exercise catalog. User-owned/custom
          // exercises are therefore reused exactly as they are.
          //
          // The one exception is an untouched system-catalog exercise. Those
          // rows are still owned by the server catalog, so a newer template may
          // correct stale system metadata/classification. A client edit clears
          // catalogOrigin elsewhere, which moves the exercise back into the
          // protected user-owned path above.
          const templateIdentity = {
            name: exercise.name,
            muscleGroup: exercise.muscleGroup,
            category: exercise.category,
            defaultRestSec: exercise.restSec,
            notes: exercise.notes ?? null,
            usesBodyweight: existingExercise?.usesBodyweight ?? false,
            equipmentType: exercise.equipmentType ?? existingExercise?.equipmentType ?? 'OTHER',
          };

          let createdExercise;
          if (!existingExercise) {
            createdExercise = await tx.exercise.create({
              data: {
                userId,
                ...templateIdentity,
                ...deriveServerExerciseClassification(templateIdentity),
              },
            });
          } else if (existingExercise.catalogOrigin === SYSTEM_EXERCISE_CATALOG_ORIGIN) {
            createdExercise = await tx.exercise.update({
              where: { id: existingExercise.id },
              data: {
                muscleGroup: templateIdentity.muscleGroup,
                category: templateIdentity.category,
                defaultRestSec: templateIdentity.defaultRestSec,
                notes: templateIdentity.notes,
                equipmentType: templateIdentity.equipmentType,
                ...classificationMetadataAfterServerUpdate(existingExercise, templateIdentity),
              },
            });
          } else {
            createdExercise = existingExercise;
          }

          await tx.programExercise.create({
            data: {
              workoutId: createdWorkout.id,
              exerciseId: createdExercise.id,
              order: exerciseIndex + 1,
              targetSets: exercise.targetSets,
              targetRepsMin: exercise.targetRepsMin,
              targetRepsMax: exercise.targetRepsMax,
              targetRIR: exercise.targetRIR,
              restSec: exercise.restSec,
              autoregulationMode: exercise.autoregulationMode ?? 'PRESERVE_RIR',
              fatigueRate:
                exercise.fatigueRate ?? defaultIntraSetConfig(createdExercise).fatigueRate,
              loadAdjustmentPct:
                exercise.loadAdjustmentPct ??
                defaultIntraSetConfig(createdExercise).loadAdjustmentPct,
              tempo: exercise.tempo ?? null,
              notes: exercise.notes ?? null,
              supersetGroup: exercise.supersetGroup ?? null,
            },
          });
        }
      }

      return createdProgram;
    });

    return NextResponse.json(program, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
