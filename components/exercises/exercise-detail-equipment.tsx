'use client';

import Link from 'next/link';
import { createContext, type ReactNode, useContext, useMemo, useRef, useState } from 'react';
import { Dumbbell, Pencil, Star } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { Exercise } from '@/lib/prisma-client';
import type { ExerciseEquipmentChoice } from '@/lib/gym-inventory-types';
import { equipmentTypeMessageKeys } from '@/i18n/enum-keys';
import { ExerciseFormDialog } from '@/components/exercises/exercise-form-dialog';
import { Badge, badgeVariants } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface ProviderProps {
  children: ReactNode;
  exercise: Exercise;
  gyms: Array<{ id: string; name: string }>;
  activeGymId: string | null;
  equipmentChoices: ExerciseEquipmentChoice[];
}

interface EquipmentEditorContextValue extends Omit<ProviderProps, 'children'> {
  activeGym: { id: string; name: string } | null;
  orderedEquipment: ExerciseEquipmentChoice[];
  preferred: ExerciseEquipmentChoice | null;
  selected: ExerciseEquipmentChoice | null;
  openEditor: (focusSection: 'details' | 'equipment') => void;
}

const EquipmentEditorContext = createContext<EquipmentEditorContextValue | null>(null);

export function ExerciseDetailEquipmentProvider({
  children,
  exercise,
  gyms,
  activeGymId,
  equipmentChoices,
}: ProviderProps) {
  const [editOpen, setEditOpen] = useState(false);
  const [focusSection, setFocusSection] = useState<'details' | 'equipment'>('details');
  const editorTriggerRef = useRef<HTMLElement | null>(null);
  const activeGym = gyms.find((gym) => gym.id === activeGymId) ?? null;
  const activeEquipment = activeGym
    ? equipmentChoices.filter(
        (item) => item.gymId === activeGym.id && item.exerciseIds.includes(exercise.id),
      )
    : [];
  const preferred =
    activeEquipment.find((item) => item.preferredExerciseIds?.includes(exercise.id)) ?? null;
  const orderedEquipment = preferred
    ? [preferred, ...activeEquipment.filter((item) => item.id !== preferred.id)]
    : activeEquipment;
  const selected = preferred ?? (activeEquipment.length === 1 ? activeEquipment[0]! : null);
  const value: EquipmentEditorContextValue = {
    exercise,
    gyms,
    activeGymId,
    equipmentChoices,
    activeGym,
    orderedEquipment,
    preferred,
    selected,
    openEditor: (nextFocusSection) => {
      editorTriggerRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setFocusSection(nextFocusSection);
      setEditOpen(true);
    },
  };

  return (
    <EquipmentEditorContext.Provider value={value}>
      {children}
      <ExerciseFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        mode="edit"
        exercise={exercise}
        activeGymId={activeGymId}
        equipmentChoices={equipmentChoices}
        focusSection={focusSection}
        returnFocusRef={editorTriggerRef}
      />
    </EquipmentEditorContext.Provider>
  );
}

export function ExerciseDetailEditTrigger() {
  const detailT = useTranslations('exercises.detail');
  const { openEditor } = useEquipmentEditor();

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="min-h-tap"
      onClick={() => openEditor('details')}
    >
      <Pencil className="size-4" />
      <span className="ml-2">{detailT('edit')}</span>
    </Button>
  );
}

export function ExerciseEquipmentEditTrigger({
  kind,
  equipmentTypeLabel,
}: {
  kind: 'badge' | 'information';
  equipmentTypeLabel: string;
}) {
  const detailT = useTranslations('exercises.detail');
  const locale = useLocale();
  const { activeGym, selected, openEditor } = useEquipmentEditor();
  const numberFormat = useMemo(
    () => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }),
    [locale],
  );
  const selectedSummary = selected
    ? equipmentSummary(selected, detailT, numberFormat)
    : activeGym
      ? detailT('noPreferredEquipment')
      : detailT('noActiveGymShort');
  const ariaLabel = detailT('editEquipmentAria', {
    type: equipmentTypeLabel,
    equipment: selected?.name ?? selectedSummary,
  });

  if (kind === 'badge') {
    return (
      <button
        type="button"
        data-testid="exercise-equipment-badge-trigger"
        className={cn(
          badgeVariants({ variant: 'outline' }),
          'h-auto min-h-tap max-w-full flex-wrap justify-start gap-1.5 whitespace-normal px-3 py-2 text-left hover:bg-muted/60',
        )}
        aria-label={ariaLabel}
        onClick={() => openEditor('equipment')}
      >
        <span>{equipmentTypeLabel}</span>
        <span aria-hidden="true" className="text-muted-foreground">
          ·
        </span>
        <span className="font-normal text-muted-foreground">{selectedSummary}</span>
        <Pencil aria-hidden="true" className="size-3.5 shrink-0" />
      </button>
    );
  }

  return (
    <button
      type="button"
      data-testid="exercise-equipment-information-trigger"
      className="flex min-h-tap w-full flex-col items-start justify-center rounded-md border border-transparent px-2 py-2 text-left transition-colors hover:border-border hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      aria-label={ariaLabel}
      onClick={() => openEditor('equipment')}
    >
      <span className="text-xs text-muted-foreground">{detailT('broadEquipmentType')}</span>
      <span className="font-medium">{equipmentTypeLabel}</span>
      <span className="mt-1 text-xs text-muted-foreground">{detailT('selectedEquipment')}</span>
      <span className="font-medium">{selectedSummary}</span>
    </button>
  );
}

export function ExerciseDetailEquipment() {
  const detailT = useTranslations('exercises.detail');
  const { activeGym, orderedEquipment, preferred, openEditor } = useEquipmentEditor();

  return (
    <section className="space-y-3 border-t border-border pt-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Dumbbell className="size-4" />
          {detailT('activeGymEquipment')}
        </h2>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-tap"
          onClick={() => openEditor('equipment')}
        >
          <Pencil className="size-4" />
          <span className="ml-2">{detailT('editEquipment')}</span>
        </Button>
      </div>

      {!activeGym ? (
        <EmptyState message={detailT('noActiveGym')} action={detailT('openGymSettings')} />
      ) : orderedEquipment.length === 0 ? (
        <EmptyState
          message={detailT('noEquipment', { gym: activeGym.name })}
          action={detailT('openGymSettings')}
        />
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            {activeGym.name} · {detailT('compatibleEquipment')}
          </p>
          {orderedEquipment.map((item) => (
            <EquipmentCard
              key={item.id}
              item={item}
              preferred={item.id === preferred?.id}
              onEdit={() => openEditor('equipment')}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function EquipmentCard({
  item,
  preferred,
  onEdit,
}: {
  item: ExerciseEquipmentChoice;
  preferred: boolean;
  onEdit: () => void;
}) {
  const t = useTranslations('exercises');
  const detailT = useTranslations('exercises.detail');
  const locale = useLocale();
  const numberFormat = useMemo(
    () => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }),
    [locale],
  );
  const weights = item.weightOptions?.map((weight) => numberFormat.format(weight)).join(', ');

  return (
    <button
      type="button"
      className="min-h-tap w-full rounded-md border p-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      aria-label={detailT('editConcreteEquipmentAria', { equipment: item.name })}
      onClick={onEdit}
    >
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-medium">{item.name}</p>
        <Badge variant="outline">
          {t(`equipmentTypes.${equipmentTypeMessageKeys[item.equipmentType]}`)}
        </Badge>
        {item.systemBarbellFamily && (
          <Badge variant="secondary">
            {detailT(`barbellFamilies.${item.systemBarbellFamily}`)}
          </Badge>
        )}
        {preferred && (
          <Badge className="gap-1">
            <Star className="size-3 fill-current" />
            {t('preferred')}
          </Badge>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {item.loadType && item.loadType !== 'NONE' && (
          <span>{detailT(`loadTypes.${item.loadType}`)}</span>
        )}
        {item.loadType === 'PLATE_LOADED' && (
          <>
            <span>
              {detailT('baseLoad', { weight: numberFormat.format(item.baseLoadKg ?? 0) })}
            </span>
            <span>{detailT('loadingSides', { count: item.loadingSides ?? 2 })}</span>
            {item.platePoolName && (
              <span>{detailT('platePool', { name: item.platePoolName })}</span>
            )}
          </>
        )}
        {item.loadType === 'FIXED' && weights && (
          <span>{detailT('availableWeights', { weights })}</span>
        )}
        {item.loadType === 'SELECTORIZED' && (
          <>
            {weights && <span>{detailT('displayedLoads', { weights })}</span>}
            <span>
              {detailT('selectorizedMultiplier', {
                multiplier: numberFormat.format(item.selectedLoadMultiplier ?? 1),
              })}
            </span>
          </>
        )}
      </div>
    </button>
  );
}

function equipmentSummary(
  item: ExerciseEquipmentChoice,
  detailT: ReturnType<typeof useTranslations<'exercises.detail'>>,
  numberFormat: Intl.NumberFormat,
) {
  const parts = [item.name];
  if (item.loadType === 'PLATE_LOADED') {
    parts.push(detailT('baseLoadShort', { weight: numberFormat.format(item.baseLoadKg ?? 0) }));
  } else if (
    (item.loadType === 'FIXED' || item.loadType === 'SELECTORIZED') &&
    item.weightOptions?.length
  ) {
    parts.push(
      detailT('weightsShort', {
        weights: item.weightOptions.map((weight) => numberFormat.format(weight)).join(', '),
      }),
    );
  }
  if (item.systemBarbellFamily) {
    parts.push(detailT(`barbellFamilies.${item.systemBarbellFamily}`));
  }
  return parts.join(' · ');
}

function useEquipmentEditor() {
  const value = useContext(EquipmentEditorContext);
  if (!value) {
    throw new Error('Exercise equipment controls must be inside ExerciseDetailEquipmentProvider.');
  }
  return value;
}

function EmptyState({ message, action }: { message: string; action: string }) {
  return (
    <div className="rounded-md border border-dashed p-3">
      <p className="text-sm text-muted-foreground">{message}</p>
      <Button asChild variant="link" className="mt-1 h-auto p-0">
        <Link href="/settings">{action}</Link>
      </Button>
    </div>
  );
}
