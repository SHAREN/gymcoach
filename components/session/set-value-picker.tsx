'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Check, Delete } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { WeightUnit } from '@/lib/prisma-client';
import type { GymLoadConstraints } from '@/lib/gym-loads';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { computeBestPlateLoad, type PlateLoad } from '@/lib/plates';
import { plateConfigForUnit } from '@/lib/preferences';
import { roundWeight, toDisplayWeight } from '@/lib/units';

interface Props {
  open: boolean;
  kind: 'weight' | 'reps';
  value: number;
  options: number[];
  unit: WeightUnit;
  loadConstraints?: GymLoadConstraints | null;
  onClose: () => void;
  onChoose: (value: number) => void;
}

export function SetValuePicker({
  open,
  kind,
  value,
  options,
  unit,
  loadConstraints = null,
  onClose,
  onChoose,
}: Props) {
  const t = useTranslations('session.editableSets');
  const locale = useLocale();
  const [manualValue, setManualValue] = useState(String(value));
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setManualValue(String(value));
    const timer = window.setTimeout(() => {
      listRef.current
        ?.querySelector<HTMLElement>('[data-picker-selected="true"]')
        ?.scrollIntoView?.({ block: 'center' });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [open, value]);

  const numericValue = parsePickerNumber(manualValue);
  const plateLoad = useMemo(() => {
    if (
      kind !== 'weight' ||
      loadConstraints?.equipmentType !== 'BARBELL' ||
      !Number.isFinite(numericValue) ||
      numericValue <= 0
    ) {
      return null;
    }
    const fallback = plateConfigForUnit(unit);
    const bars = loadConstraints.barWeights?.length
      ? loadConstraints.barWeights.map((weight) => roundWeight(toDisplayWeight(weight, unit), 2))
      : [fallback.barWeight];
    const plates = loadConstraints.plateWeights?.length
      ? loadConstraints.plateWeights.map((weight) => roundWeight(toDisplayWeight(weight, unit), 2))
      : fallback.plates;
    return computeBestPlateLoad(numericValue, bars, plates, fallback.barWeight);
  }, [kind, loadConstraints, numericValue, unit]);

  function appendKey(key: string) {
    setManualValue((current) => {
      if (key === 'backspace') return current.slice(0, -1);
      if (key === 'decimal') {
        if (kind === 'reps' || current.includes('.')) return current;
        return current === '' ? '0.' : `${current}.`;
      }
      if (current.length >= 7) return current;
      if (current === '0') return key;
      return `${current}${key}`;
    });
  }

  function confirmManual() {
    if (!Number.isFinite(numericValue) || numericValue < 0) return;
    onChoose(kind === 'reps' ? Math.max(1, Math.round(numericValue)) : numericValue);
  }

  const decimalLabel = locale.toLowerCase().startsWith('ru') ? ',' : '.';
  const displayManual = manualValue.replace('.', decimalLabel) || '0';
  const selectedValue = Number.isFinite(numericValue) ? numericValue : value;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="left-0 top-0 flex h-[100dvh] max-h-none w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 p-0 shadow-none sm:left-1/2 sm:top-1/2 sm:h-[90dvh] sm:max-h-[52rem] sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-md sm:border [&>button]:hidden">
        <header className="grid shrink-0 grid-cols-[5rem_1fr_5rem] items-center px-3 pb-2 pt-[calc(env(safe-area-inset-top)+0.75rem)]">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            className="justify-start px-1 text-primary"
          >
            {t('cancel')}
          </Button>
          <DialogTitle className="text-center text-base">
            {kind === 'weight' ? t('chooseWeight', { unit }) : t('chooseReps')}
          </DialogTitle>
          <DialogDescription className="sr-only">{t('pickerDescription')}</DialogDescription>
          <span />
        </header>

        <div
          ref={listRef}
          data-testid="set-value-options"
          className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-3"
        >
          {options.map((option) => {
            const selected = nearlyEqual(option, selectedValue);
            return (
              <button
                key={option}
                type="button"
                data-picker-selected={selected ? 'true' : undefined}
                onClick={() => setManualValue(String(option))}
                className={`mx-auto flex h-[4.75rem] w-full max-w-[15.5rem] items-center justify-center rounded-md border text-2xl font-semibold tabular-nums transition-colors ${
                  selected
                    ? 'border-primary bg-primary/15 text-foreground'
                    : 'border-border bg-muted/50 text-foreground hover:bg-muted'
                }`}
              >
                {formatPickerNumber(option, locale)}{' '}
                {kind === 'weight' ? unit.toLowerCase() : t('repsShort')}
              </button>
            );
          })}
        </div>

        <div className="shrink-0 border-t border-border bg-background px-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3 shadow-[0_-8px_24px_rgba(0,0,0,0.18)]">
          <div className="grid min-h-[5rem] grid-cols-[minmax(0,1fr)_minmax(7rem,1.1fr)_4.25rem] items-center gap-2">
            {kind === 'weight' && plateLoad ? (
              <BarbellSideDiagram load={plateLoad} unit={unit} />
            ) : (
              <div aria-hidden />
            )}

            <div
              role="textbox"
              aria-readonly="true"
              aria-label={kind === 'weight' ? t('manualWeight') : t('manualReps')}
              className="flex h-16 min-w-0 items-center justify-center overflow-hidden rounded-md border border-input bg-muted/30 px-2 text-center text-3xl font-semibold tabular-nums"
            >
              <span className="truncate">{displayManual}</span>
            </div>

            <Button
              type="button"
              onClick={confirmManual}
              disabled={!Number.isFinite(numericValue) || numericValue < 0}
              className="size-16"
              aria-label={t('applyValue')}
            >
              <Check className="size-8" />
            </Button>
          </div>

          <div
            data-testid="set-value-keypad"
            className="mt-3 grid grid-cols-3 gap-2"
            aria-label={t('keypad')}
          >
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((digit) => (
              <KeypadButton key={digit} onClick={() => appendKey(String(digit))}>
                {digit}
              </KeypadButton>
            ))}
            <KeypadButton onClick={() => appendKey('decimal')} disabled={kind === 'reps'}>
              {decimalLabel}
            </KeypadButton>
            <KeypadButton onClick={() => appendKey('0')}>0</KeypadButton>
            <KeypadButton onClick={() => appendKey('backspace')} label={t('backspace')}>
              <Delete className="size-7" />
            </KeypadButton>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function KeypadButton({
  children,
  disabled = false,
  label,
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  label?: string;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="secondary"
      disabled={disabled}
      onClick={onClick}
      aria-label={label}
      className="h-16 text-3xl font-semibold tabular-nums"
    >
      {children}
    </Button>
  );
}

function BarbellSideDiagram({ load, unit }: { load: PlateLoad; unit: WeightUnit }) {
  const t = useTranslations('session.editableSets');
  const locale = useLocale();
  const plates = load.perSide.flatMap((group) =>
    Array.from({ length: group.count }, (_, index) => ({
      weight: group.plate,
      key: `${group.plate}-${index}`,
    })),
  );
  const maxPlate = Math.max(...plates.map((plate) => plate.weight), 1);

  return (
    <div className="relative min-w-0 overflow-hidden" data-testid="barbell-side-diagram">
      <div
        data-testid="barbell-shaft"
        className="absolute inset-x-1 top-5 h-2 rounded-full bg-zinc-500"
      />
      <div
        data-testid="barbell-layout"
        className="grid min-w-0 grid-cols-[minmax(2.25rem,1.45fr)_max-content_minmax(1rem,0.85fr)]"
      >
        <span aria-hidden />
        <div className="relative z-10 min-w-0" aria-label={t('platesPerSide')}>
          <div data-testid="barbell-plates" className="flex h-12 items-center gap-0.5">
            {plates.map((plate) => {
              const ratio = plate.weight / maxPlate;
              return (
                <div
                  key={plate.key}
                  className="flex w-4 shrink-0 items-center justify-center rounded-sm border border-zinc-300 bg-zinc-700 text-[0.55rem] font-bold text-white"
                  style={{ height: `${Math.round(22 + ratio * 24)}px` }}
                  title={`${plate.weight} ${unit.toLowerCase()}`}
                >
                  <span className="-rotate-90 whitespace-nowrap">{plate.weight}</span>
                </div>
              );
            })}
          </div>
          <div
            data-testid="barbell-weight-label"
            className="truncate text-center text-[0.625rem] text-muted-foreground"
          >
            {t('barWeight', {
              weight: formatPickerNumber(load.barWeight, locale),
              unit: unit.toLowerCase(),
            })}
          </div>
          {!load.exact && (
            <p className="truncate text-center text-[0.625rem] text-amber-600">
              {t('plateRemainder', {
                weight: formatPickerNumber(load.achievedWeight, locale),
                unit: unit.toLowerCase(),
              })}
            </p>
          )}
        </div>
        <span aria-hidden />
      </div>
    </div>
  );
}

function parsePickerNumber(value: string): number {
  if (value === '' || value === '.') return Number.NaN;
  return Number(value.replace(',', '.'));
}

function formatPickerNumber(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);
}

function nearlyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) < 0.001;
}
