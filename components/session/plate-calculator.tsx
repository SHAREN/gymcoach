'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Calculator } from 'lucide-react';
import type { WeightUnit } from '@/lib/prisma-client';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { computeBestPlateLoad, computeEquipmentPlateLoad } from '@/lib/plates';
import type { GymLoadConstraints } from '@/lib/gym-loads';
import { plateConfigForUnit } from '@/lib/preferences';
import { roundWeight, toDisplayWeight, unitLabel } from '@/lib/units';

interface Props {
  // The current target load, stored in kg (the app's storage unit).
  weightKg: number;
  unit: WeightUnit;
  barWeightsKg?: number[];
  plateWeightsKg?: number[];
  loadConstraints?: GymLoadConstraints | null;
}

// In-workout plate-loading calculator (issue #39). Reads the user's per-unit
// bar weight + plate inventory from preferences and shows the plates to load
// per side for the current target weight. Display-only; never mutates the set.
export function PlateCalculator({
  weightKg,
  unit,
  barWeightsKg,
  plateWeightsKg,
  loadConstraints = null,
}: Props) {
  const t = useTranslations('session.calculator');
  const [open, setOpen] = useState(false);

  // Compute lazily when the dialog opens so localStorage is only read on the
  // client (and only when the user actually wants the calculator).
  const result = useMemo(() => {
    if (!open) return null;
    const fallback = plateConfigForUnit(unit);
    const selectedEquipment = loadConstraints?.equipmentId
      ? loadConstraints.equipmentOptions?.find(
          (item) => item.equipmentId === loadConstraints.equipmentId,
        )
      : null;
    const target = roundWeight(toDisplayWeight(weightKg, unit), 2);
    if (selectedEquipment?.loadType === 'PLATE_LOADED') {
      const equipmentResult = computeEquipmentPlateLoad(
        target,
        roundWeight(toDisplayWeight(selectedEquipment.baseLoadKg, unit), 2),
        (selectedEquipment.plates ?? []).map((plate) => ({
          plate: roundWeight(toDisplayWeight(plate.weightKg, unit), 2),
          quantity: plate.quantity,
        })),
        selectedEquipment.loadingSides,
      );
      return { target, ...equipmentResult };
    }
    const bars = barWeightsKg?.length
      ? barWeightsKg.map((weight) => roundWeight(toDisplayWeight(weight, unit), 2))
      : [fallback.barWeight];
    const plates = plateWeightsKg?.length
      ? plateWeightsKg.map((weight) => roundWeight(toDisplayWeight(weight, unit), 2))
      : fallback.plates;
    const result = computeBestPlateLoad(target, bars, plates, fallback.barWeight);
    return { target, ...result };
  }, [barWeightsKg, loadConstraints, open, plateWeightsKg, weightKg, unit]);

  const label = unitLabel(unit);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-xs text-muted-foreground"
          aria-label={t('openPlates')}
        >
          <Calculator className="size-4" />
          {t('plates')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('plates')}</DialogTitle>
          <DialogDescription>
            {t('plateDescription', {
              target: result ? `${result.target} ${label}` : t('currentWeight'),
              bar: result ? `${result.barWeight} ${label}` : '',
            })}
          </DialogDescription>
        </DialogHeader>

        {result && (
          <div className="space-y-4">
            {result.perSide.length > 0 ? (
              <div className="flex flex-wrap gap-2" aria-label={t('platesPerSide')}>
                {result.perSide.map((g) => (
                  <Badge key={g.plate} variant="secondary" className="text-base font-semibold">
                    {g.count} x {g.plate} {label}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t('barOnly')}</p>
            )}

            <p className="text-sm text-muted-foreground">
              {t('achieved', {
                weight: `${result.achievedWeight} ${label}`,
                bar: `${result.barWeight} ${label}`,
              })}
            </p>

            {!result.exact && result.remainder > 0 && (
              <p className="text-sm text-amber-600 dark:text-amber-500">
                {t('remainder', { remainder: `${result.remainder} ${label}` })}
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
