import { db } from '@/lib/db';
import { requireSession } from '@/lib/auth';
import { ExercisesView } from '@/components/exercises/exercises-view';

export default async function ExercisesPage() {
  const session = await requireSession();
  const [exercises, equipment] = await Promise.all([
    db.exercise.findMany({
      where: { userId: session.userId },
      orderBy: [{ muscleGroup: 'asc' }, { name: 'asc' }],
    }),
    db.gymEquipment.findMany({
      where: { gym: { userId: session.userId } },
      orderBy: [{ gym: { name: 'asc' } }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        gymId: true,
        equipmentType: true,
        gym: { select: { name: true } },
        exerciseLinks: { select: { exerciseId: true } },
      },
    }),
  ]);

  return (
    <main className="flex-1 px-4 py-6">
      <ExercisesView
        exercises={exercises}
        equipmentChoices={equipment.map((item) => ({
          id: item.id,
          name: item.name,
          gymId: item.gymId,
          gymName: item.gym.name,
          equipmentType: item.equipmentType,
          exerciseIds: item.exerciseLinks.map((link) => link.exerciseId),
        }))}
      />
    </main>
  );
}
