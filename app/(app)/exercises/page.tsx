import { db } from '@/lib/db';
import { requireSession } from '@/lib/auth';
import { ExercisesView } from '@/components/exercises/exercises-view';
import { getFinishedExerciseTrainingDates } from '@/lib/exercise-usage';

export default async function ExercisesPage() {
  const session = await requireSession();
  const [exercises, gyms, user, trainingDatesByExercise, equipment] = await Promise.all([
    db.exercise.findMany({
      where: { userId: session.userId },
      orderBy: [{ muscleGroup: 'asc' }, { name: 'asc' }],
    }),
    db.gym.findMany({
      where: { userId: session.userId },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        exerciseConfigs: {
          select: { exerciseId: true, isAvailable: true },
        },
      },
    }),
    db.user.findUnique({
      where: { id: session.userId },
      select: { activeGymId: true },
    }),
    getFinishedExerciseTrainingDates(session.userId),
    db.gymEquipment.findMany({
      where: { gym: { userId: session.userId } },
      orderBy: [{ gym: { name: 'asc' } }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        gymId: true,
        equipmentType: true,
        loadType: true,
        baseLoadKg: true,
        loadingSides: true,
        preferredForConfigs: { select: { exerciseId: true } },
        platePool: {
          select: {
            name: true,
            plates: {
              orderBy: { weightKg: 'asc' },
              select: { id: true, weightKg: true, quantity: true },
            },
          },
        },
        gym: { select: { name: true } },
        exerciseLinks: { select: { exerciseId: true } },
      },
    }),
  ]);
  return (
    <main className="flex-1 px-4 py-6">
      <ExercisesView
        exercises={exercises}
        gyms={gyms}
        activeGymId={user?.activeGymId ?? null}
        trainingDatesByExercise={trainingDatesByExercise}
        equipmentChoices={equipment.map((item) => ({
          id: item.id,
          name: item.name,
          gymId: item.gymId,
          gymName: item.gym.name,
          equipmentType: item.equipmentType,
          exerciseIds: item.exerciseLinks.map((link) => link.exerciseId),
          preferredExerciseIds: item.preferredForConfigs.map((config) => config.exerciseId),
          loadType: item.loadType,
          baseLoadKg: item.baseLoadKg,
          loadingSides: item.loadingSides,
          platePoolName: item.platePool?.name ?? null,
          plates: item.platePool?.plates ?? [],
        }))}
      />
    </main>
  );
}
