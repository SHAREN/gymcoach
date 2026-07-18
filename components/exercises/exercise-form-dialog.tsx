'use client';

import { type RefObject, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Star } from 'lucide-react';
import type { Exercise } from '@/lib/prisma-client';
import type { ExerciseEquipmentChoice } from '@/lib/gym-inventory-types';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  exerciseCategoryValues,
  equipmentTypeValues,
  exerciseInputSchema,
  muscleGroupValues,
  type ExerciseInput,
} from '@/lib/schemas/exercise';
import {
  equipmentTypeMessageKeys,
  exerciseCategoryMessageKeys,
  muscleGroupMessageKeys,
} from '@/i18n/enum-keys';
import { resolveEquipmentType } from '@/lib/gym-loads';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  exercise?: Exercise;
  equipmentChoices?: ExerciseEquipmentChoice[];
  activeGymId?: string | null;
  focusSection?: 'details' | 'equipment';
  returnFocusRef?: RefObject<HTMLElement | null>;
}

const DEFAULT_VALUES: ExerciseInput = {
  name: '',
  muscleGroup: 'CHEST',
  category: 'COMPOUND',
  defaultRestSec: 90,
  notes: '',
  usesBodyweight: false,
  equipmentType: 'OTHER',
};

export function ExerciseFormDialog({
  open,
  onOpenChange,
  mode,
  exercise,
  equipmentChoices = [],
  activeGymId = null,
  focusSection,
  returnFocusRef,
}: Props) {
  const t = useTranslations('exercises');
  const common = useTranslations('common');
  const router = useRouter();
  const form = useForm<ExerciseInput>({
    resolver: zodResolver(exerciseInputSchema),
    defaultValues: DEFAULT_VALUES,
  });
  const [equipmentIds, setEquipmentIds] = useState<Set<string>>(new Set());
  const [preferredEquipmentByGym, setPreferredEquipmentByGym] = useState<
    Record<string, string | null>
  >({});
  const equipmentTypeTriggerRef = useRef<HTMLButtonElement>(null);
  const watchedName = form.watch('name');
  const watchedEquipmentType = form.watch('equipmentType');
  const resolvedEquipmentType = resolveEquipmentType(watchedEquipmentType, watchedName);

  useEffect(() => {
    if (open) {
      if (mode === 'edit' && exercise) {
        form.reset({
          name: exercise.name,
          muscleGroup: exercise.muscleGroup,
          category: exercise.category,
          defaultRestSec: exercise.defaultRestSec,
          notes: exercise.notes ?? '',
          usesBodyweight: exercise.usesBodyweight,
          equipmentType: exercise.equipmentType,
        });
        setEquipmentIds(
          new Set(
            equipmentChoices
              .filter((item) => item.exerciseIds.includes(exercise.id))
              .map((item) => item.id),
          ),
        );
        setPreferredEquipmentByGym(
          Object.fromEntries(
            equipmentChoices.flatMap((item) =>
              item.preferredExerciseIds?.includes(exercise.id)
                ? [[item.gymId, item.id] as const]
                : [],
            ),
          ),
        );
      } else {
        form.reset(DEFAULT_VALUES);
        setEquipmentIds(new Set());
        setPreferredEquipmentByGym({});
      }
    }
  }, [open, mode, exercise, equipmentChoices, form]);

  const groupedEquipment = useMemo(() => {
    const groups = new Map<
      string,
      { gymId: string; gymName: string; items: ExerciseEquipmentChoice[] }
    >();
    for (const item of equipmentChoices) {
      const group = groups.get(item.gymId) ?? {
        gymId: item.gymId,
        gymName: item.gymName,
        items: [],
      };
      group.items.push(item);
      groups.set(item.gymId, group);
    }
    return [...groups.values()].sort(
      (left, right) =>
        Number(right.gymId === activeGymId) - Number(left.gymId === activeGymId) ||
        left.gymName.localeCompare(right.gymName),
    );
  }, [activeGymId, equipmentChoices]);

  function toggleEquipment(item: ExerciseEquipmentChoice, checked: boolean) {
    setEquipmentIds((current) => {
      const next = new Set(current);
      if (checked) next.add(item.id);
      else next.delete(item.id);
      setPreferredEquipmentByGym((preferences) => {
        if (checked && !preferences[item.gymId] && item.equipmentType === resolvedEquipmentType) {
          return { ...preferences, [item.gymId]: item.id };
        }
        if (!checked && preferences[item.gymId] === item.id) {
          const replacement = equipmentChoices.find(
            (choice) =>
              choice.gymId === item.gymId &&
              choice.id !== item.id &&
              choice.equipmentType === resolvedEquipmentType &&
              next.has(choice.id),
          );
          return { ...preferences, [item.gymId]: replacement?.id ?? null };
        }
        return preferences;
      });
      return next;
    });
  }

  async function onSubmit(values: ExerciseInput) {
    const resolvedValuesType = resolveEquipmentType(values.equipmentType, values.name);
    const url = mode === 'edit' && exercise ? `/api/exercises/${exercise.id}` : '/api/exercises';
    const method = mode === 'edit' ? 'PUT' : 'POST';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...values, notes: values.notes || null }),
    });
    if (!res.ok) {
      toast.error(t('saveError'));
      return;
    }
    const saved = (await res.json()) as Exercise;
    const equipmentResponse = await fetch(`/api/exercises/${saved.id}/equipment`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        gyms: groupedEquipment.map((group) => {
          const selectedIds = group.items
            .filter(
              (item) =>
                equipmentIds.has(item.id) &&
                (resolvedValuesType === 'BARBELL' || item.systemBarbellFamily == null),
            )
            .map((item) => item.id);
          const preferredId = preferredEquipmentByGym[group.gymId] ?? null;
          const preferredItem = group.items.find((item) => item.id === preferredId);
          return {
            gymId: group.gymId,
            equipmentIds: selectedIds,
            preferredEquipmentId:
              preferredItem &&
              selectedIds.includes(preferredItem.id) &&
              preferredItem.equipmentType === resolvedValuesType
                ? preferredItem.id
                : null,
          };
        }),
      }),
    });
    if (!equipmentResponse.ok) {
      toast.error(t('equipmentSaveError'));
      return;
    }
    toast.success(mode === 'edit' ? t('updated') : t('created'));
    onOpenChange(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] max-w-md overflow-y-auto"
        onOpenAutoFocus={(event) => {
          if (focusSection === 'details') {
            event.preventDefault();
            form.setFocus('name');
          } else if (focusSection === 'equipment') {
            event.preventDefault();
            equipmentTypeTriggerRef.current?.focus();
          }
        }}
        onCloseAutoFocus={(event) => {
          if (!returnFocusRef?.current) return;
          event.preventDefault();
          returnFocusRef.current.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{mode === 'edit' ? t('editTitle') : t('addTitle')}</DialogTitle>
          <DialogDescription>{t('formDescription')}</DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="name">{common('fields.name')}</Label>
            <Input id="name" {...form.register('name')} />
            {form.formState.errors.name && (
              <p className="text-sm text-destructive">{form.formState.errors.name.message}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="muscleGroup">{t('muscleGroup')}</Label>
              <Select
                value={form.watch('muscleGroup')}
                onValueChange={(v) =>
                  form.setValue('muscleGroup', v as ExerciseInput['muscleGroup'])
                }
              >
                <SelectTrigger id="muscleGroup">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {muscleGroupValues.map((g) => (
                    <SelectItem key={g} value={g}>
                      {t(`muscleGroups.${muscleGroupMessageKeys[g]}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="category">{t('category')}</Label>
              <Select
                value={form.watch('category')}
                onValueChange={(v) => form.setValue('category', v as ExerciseInput['category'])}
              >
                <SelectTrigger id="category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {exerciseCategoryValues.map((c) => (
                    <SelectItem key={c} value={c}>
                      {t(`categories.${exerciseCategoryMessageKeys[c]}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="equipmentType">{t('equipmentType')}</Label>
            <Select
              value={watchedEquipmentType}
              onValueChange={(v) => {
                const nextType = v as ExerciseInput['equipmentType'];
                form.setValue('equipmentType', nextType);
                if (resolveEquipmentType(nextType, form.getValues('name')) !== 'BARBELL') {
                  setEquipmentIds((current) => {
                    const next = new Set(current);
                    for (const item of equipmentChoices) {
                      if (item.systemBarbellFamily != null) next.delete(item.id);
                    }
                    return next;
                  });
                }
              }}
            >
              <SelectTrigger id="equipmentType" ref={equipmentTypeTriggerRef}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {equipmentTypeValues.map((type) => (
                  <SelectItem key={type} value={type}>
                    {t(`equipmentTypes.${equipmentTypeMessageKeys[type]}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {equipmentChoices.length > 0 && (
            <div className="space-y-2 rounded-md border p-3">
              <div>
                <p className="text-sm font-medium">{t('physicalEquipment')}</p>
                <p className="text-xs text-muted-foreground">{t('physicalEquipmentDescription')}</p>
                <p className="mt-1 text-xs font-medium text-foreground">
                  {t('equipmentConfirmationHint')}
                </p>
              </div>
              <div className="max-h-48 space-y-3 overflow-y-auto pr-1">
                {groupedEquipment.map((group) => (
                  <div key={group.gymId} className="space-y-1">
                    <p className="text-xs font-semibold text-muted-foreground">
                      {group.gymName}
                      {group.gymId === activeGymId ? ` · ${t('activeGym')}` : ''}
                    </p>
                    {group.items.map((item) => (
                      <EquipmentChoiceRow
                        key={item.id}
                        item={item}
                        linked={equipmentIds.has(item.id)}
                        preferred={
                          preferredEquipmentByGym[item.gymId] === item.id &&
                          item.equipmentType === resolvedEquipmentType
                        }
                        compatible={item.equipmentType === resolvedEquipmentType}
                        onPreferred={() => {
                          if (item.equipmentType !== resolvedEquipmentType) {
                            form.setValue('equipmentType', item.equipmentType, {
                              shouldDirty: true,
                            });
                          }
                          setEquipmentIds((current) => {
                            const next = new Set(current);
                            if (item.equipmentType !== 'BARBELL') {
                              for (const choice of equipmentChoices) {
                                if (choice.systemBarbellFamily != null) next.delete(choice.id);
                              }
                            }
                            if (item.systemBarbellFamily != null) {
                              for (const choice of equipmentChoices) {
                                if (
                                  choice.gymId === item.gymId &&
                                  choice.systemBarbellFamily != null
                                ) {
                                  next.add(choice.id);
                                }
                              }
                            }
                            next.add(item.id);
                            return next;
                          });
                          setPreferredEquipmentByGym((current) => ({
                            ...current,
                            [item.gymId]: item.id,
                          }));
                        }}
                        onLinkedChange={(checked) => toggleEquipment(item, checked)}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="defaultRestSec">{t('defaultRest')}</Label>
            <Input
              id="defaultRestSec"
              type="number"
              inputMode="numeric"
              min={15}
              max={600}
              {...form.register('defaultRestSec')}
            />
            {form.formState.errors.defaultRestSec && (
              <p className="text-sm text-destructive">
                {form.formState.errors.defaultRestSec.message}
              </p>
            )}
          </div>

          <label className="flex cursor-pointer items-start justify-between gap-3 rounded-md border border-border/40 p-3">
            <div className="min-w-0 space-y-0.5">
              <p className="text-sm font-medium">{t('bodyweight')}</p>
              <p className="text-xs text-muted-foreground">{t('bodyweightDescription')}</p>
            </div>
            <Switch
              aria-label={t('bodyweight')}
              checked={form.watch('usesBodyweight')}
              onCheckedChange={(v) => form.setValue('usesBodyweight', v)}
            />
          </label>

          <div className="space-y-2">
            <Label htmlFor="notes">{t('notes')}</Label>
            <Textarea id="notes" rows={3} {...form.register('notes')} />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={form.formState.isSubmitting}
            >
              {common('actions.cancel')}
            </Button>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting
                ? common('actions.saving')
                : mode === 'edit'
                  ? common('actions.save')
                  : common('actions.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EquipmentChoiceRow({
  item,
  linked,
  preferred,
  compatible,
  onPreferred,
  onLinkedChange,
}: {
  item: ExerciseEquipmentChoice;
  linked: boolean;
  preferred: boolean;
  compatible: boolean;
  onPreferred: () => void;
  onLinkedChange: (checked: boolean) => void;
}) {
  const t = useTranslations('exercises');
  const typeLabel = t(`equipmentTypes.${equipmentTypeMessageKeys[item.equipmentType]}`);

  return (
    <div className="flex items-center justify-between gap-3 rounded-md bg-muted/30 p-2">
      <div className="min-w-0">
        <p className="truncate text-sm">{item.name}</p>
        <p className="text-xs text-muted-foreground">
          {typeLabel}
          {!compatible ? ` · ${t('differentEquipmentType')}` : ''}
          {item.systemBarbellFamily != null ? ` · ${t('managedByBarbellProfile')}` : ''}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={
            compatible
              ? t('makePreferred', { equipment: item.name })
              : t('makePreferredAndChangeType', {
                  equipment: item.name,
                  type: typeLabel,
                })
          }
          aria-pressed={preferred}
          disabled={!linked && item.systemBarbellFamily == null}
          onClick={onPreferred}
        >
          <Star className={`size-4 ${preferred ? 'fill-amber-400 text-amber-500' : ''}`} />
        </Button>
        <Switch
          aria-label={item.name}
          checked={linked}
          disabled={item.systemBarbellFamily != null}
          onCheckedChange={onLinkedChange}
        />
      </div>
    </div>
  );
}
