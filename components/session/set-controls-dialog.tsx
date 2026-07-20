'use client';

import { useEffect, useState } from 'react';
import { Loader2, Minus, Plus, RefreshCw, RotateCcw, Trash2 } from 'lucide-react';
import type { PendingSetStatus } from '@/lib/indexeddb';
import { useTranslations } from 'next-intl';
import type { ResolvedEquipmentLoadProfile } from '@/lib/gym-loads';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface Props {
  open: boolean;
  totalSets: number;
  minSets: number;
  maxSets: number;
  busy: boolean;
  canUndo: boolean;
  onOpenChange: (open: boolean) => void;
  onDecrease: () => void;
  onIncrease: () => void;
  onUndo: () => void;
  equipment?: {
    setNumber: number;
    equipmentId: string | null;
    equipmentName: string | null;
    options: ResolvedEquipmentLoadProfile[];
    canClear: boolean;
    onReplace: (equipmentId: string) => void;
    onClear: () => void;
  } | null;
  sync?: {
    setNumber: number;
    status: PendingSetStatus;
    error: string | null;
    attempts: number;
    canRetry: boolean;
    canDelete: boolean;
    onRetry: () => void;
    onDelete: () => void;
  } | null;
}

export function SetControlsDialog({
  open,
  totalSets,
  minSets,
  maxSets,
  busy,
  canUndo,
  onOpenChange,
  onDecrease,
  onIncrease,
  onUndo,
  equipment = null,
  sync = null,
}: Props) {
  const t = useTranslations('session.editableSets.setControls');
  const [replacementId, setReplacementId] = useState('');

  useEffect(() => {
    if (!open || !equipment) return;
    const currentAvailable = equipment.options.some(
      (item) => item.equipmentId === equipment.equipmentId,
    );
    setReplacementId(
      currentAvailable ? (equipment.equipmentId ?? '') : (equipment.options[0]?.equipmentId ?? ''),
    );
  }, [equipment, open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="set-controls-dialog"
        aria-busy={busy}
        className="bottom-0 left-0 top-auto w-full max-w-none translate-x-0 translate-y-0 gap-4 rounded-t-lg border-x-0 border-b-0 p-5 pb-[calc(env(safe-area-inset-bottom)+1rem)] sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:max-w-sm sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg sm:border"
      >
        <DialogTitle className="pr-8 text-center text-base">{t('title')}</DialogTitle>
        <DialogDescription className="sr-only">{t('description')}</DialogDescription>

        <div className="flex min-h-20 items-center justify-center gap-6">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onDecrease}
            disabled={busy || totalSets <= minSets}
            aria-label={t('decrease')}
            className="size-12 rounded-full border-2 border-primary text-primary hover:bg-primary/10 hover:text-primary"
          >
            <Minus className="size-7" />
          </Button>

          <span
            data-testid="set-count-value"
            className="min-w-16 text-center text-5xl font-semibold tabular-nums text-primary"
          >
            {totalSets}
          </span>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onIncrease}
            disabled={busy || totalSets >= maxSets}
            aria-label={t('increase')}
            className="size-12 rounded-full border-2 border-primary text-primary hover:bg-primary/10 hover:text-primary"
          >
            <Plus className="size-7" />
          </Button>
        </div>

        {equipment && (
          <div className="space-y-3 rounded-md border p-3">
            <div>
              <p className="text-sm font-semibold">
                {t('equipmentTitle', { number: equipment.setNumber })}
              </p>
              <p className="text-xs text-muted-foreground">
                {equipment.equipmentName ?? t('equipmentNone')}
              </p>
              <p className="text-xs text-muted-foreground">{t('equipmentDescription')}</p>
            </div>
            {equipment.options.length > 0 && (
              <>
                <Select value={replacementId} onValueChange={setReplacementId}>
                  <SelectTrigger aria-label={t('equipmentSelect')}>
                    <SelectValue placeholder={t('equipmentSelect')} />
                  </SelectTrigger>
                  <SelectContent>
                    {equipment.options.map((item) => (
                      <SelectItem key={item.equipmentId} value={item.equipmentId}>
                        {item.equipmentName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => replacementId && equipment.onReplace(replacementId)}
                  disabled={
                    busy || !replacementId || replacementId === (equipment.equipmentId ?? '')
                  }
                  className="w-full"
                >
                  {t('equipmentReplace')}
                </Button>
              </>
            )}
            {equipment.equipmentId && equipment.canClear && (
              <Button
                type="button"
                variant="ghost"
                onClick={equipment.onClear}
                disabled={busy}
                className="w-full text-destructive"
              >
                {t('equipmentClear')}
              </Button>
            )}
          </div>
        )}

        {sync && (
          <div data-testid="set-sync-recovery" className="space-y-3 rounded-md border p-3">
            <div>
              <p className="text-sm font-semibold">{t('syncTitle', { number: sync.setNumber })}</p>
              <p
                className={`text-xs ${sync.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'}`}
              >
                {t(`syncStatus.${sync.status}`)}
                {sync.attempts > 0 ? ` · ${t('syncAttempts', { count: sync.attempts })}` : ''}
              </p>
              {sync.error && (
                <p className="mt-1 break-words text-xs text-destructive">{sync.error}</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={sync.onRetry}
                disabled={busy || !sync.canRetry}
              >
                {busy ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <RefreshCw className="size-4" />
                )}
                {t('syncRetry')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={sync.onDelete}
                disabled={busy || !sync.canDelete}
                className="text-destructive hover:text-destructive"
              >
                <Trash2 className="size-4" />
                {t('deleteSet')}
              </Button>
            </div>
          </div>
        )}

        {canUndo && (
          <Button
            type="button"
            variant="secondary"
            onClick={onUndo}
            disabled={busy}
            className="h-14 w-full text-base text-primary"
          >
            {busy ? <Loader2 className="size-5 animate-spin" /> : <RotateCcw className="size-5" />}
            <span>{t('undoLast')}</span>
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
