'use client';

import { RotateCcw } from 'lucide-react';
import { useId } from 'react';
import { useTranslations } from 'next-intl';
import type { EquipmentType, MuscleGroup } from '@/lib/prisma-client';
import { equipmentTypeMessageKeys, muscleGroupMessageKeys } from '@/i18n/enum-keys';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const ALL_FILTERS = 'all';
const muscleGroups = Object.keys(muscleGroupMessageKeys) as MuscleGroup[];
const equipmentTypes = Object.keys(equipmentTypeMessageKeys) as EquipmentType[];

interface ExerciseFiltersProps {
  muscleGroup: MuscleGroup | null;
  equipmentType: EquipmentType | null;
  onMuscleGroupChange: (value: MuscleGroup | null) => void;
  onEquipmentTypeChange: (value: EquipmentType | null) => void;
  onReset: () => void;
}

export function ExerciseFilters({
  muscleGroup,
  equipmentType,
  onMuscleGroupChange,
  onEquipmentTypeChange,
  onReset,
}: ExerciseFiltersProps) {
  const t = useTranslations('exercises');
  const id = useId();
  const hasActiveFilter = muscleGroup !== null || equipmentType !== null;

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <div className="min-w-0 space-y-1.5">
        <Label htmlFor={`${id}-muscle`}>{t('muscleFilter')}</Label>
        <Select
          value={muscleGroup ?? ALL_FILTERS}
          onValueChange={(value) =>
            onMuscleGroupChange(value === ALL_FILTERS ? null : (value as MuscleGroup))
          }
        >
          <SelectTrigger
            id={`${id}-muscle`}
            aria-label={t('muscleFilter')}
            className="min-h-tap w-full"
          >
            <SelectValue>
              {muscleGroup
                ? t(`muscleGroups.${muscleGroupMessageKeys[muscleGroup]}`)
                : t('allMuscles')}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_FILTERS}>{t('allMuscles')}</SelectItem>
            {muscleGroups.map((group) => (
              <SelectItem key={group} value={group}>
                {t(`muscleGroups.${muscleGroupMessageKeys[group]}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="min-w-0 space-y-1.5">
        <Label htmlFor={`${id}-equipment`}>{t('equipmentFilter')}</Label>
        <Select
          value={equipmentType ?? ALL_FILTERS}
          onValueChange={(value) =>
            onEquipmentTypeChange(value === ALL_FILTERS ? null : (value as EquipmentType))
          }
        >
          <SelectTrigger
            id={`${id}-equipment`}
            aria-label={t('equipmentFilter')}
            className="min-h-tap w-full"
          >
            <SelectValue>
              {equipmentType
                ? t(`equipmentTypes.${equipmentTypeMessageKeys[equipmentType]}`)
                : t('allEquipment')}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_FILTERS}>{t('allEquipment')}</SelectItem>
            {equipmentTypes.map((type) => (
              <SelectItem key={type} value={type}>
                {t(`equipmentTypes.${equipmentTypeMessageKeys[type]}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {hasActiveFilter && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="min-h-tap w-full sm:col-span-2"
          onClick={onReset}
        >
          <RotateCcw className="mr-2 size-4" />
          {t('resetFilters')}
        </Button>
      )}
    </div>
  );
}
