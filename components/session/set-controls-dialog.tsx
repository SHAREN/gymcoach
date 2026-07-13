'use client';

import { Loader2, Minus, Plus, RotateCcw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';

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
}: Props) {
  const t = useTranslations('session.editableSets.setControls');

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
