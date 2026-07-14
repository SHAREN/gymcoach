'use client';

import { useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import {
  CalendarDays,
  CheckCircle2,
  Clock3,
  Loader2,
  Pause,
  RotateCcw,
  Wrench,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

const RESET_DELAY_SECONDS = 3;

interface Props {
  workoutName: string;
  startedAt: Date;
  statusLabel?: string | null;
  onComplete: () => void;
  onPause: () => void;
  onReset: () => Promise<boolean>;
}

function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':');
}

export function SessionControlsDialog({
  workoutName,
  startedAt,
  statusLabel,
  onComplete,
  onPause,
  onReset,
}: Props) {
  const t = useTranslations('session.controls');
  const format = useFormatter();
  const [open, setOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetPending, setResetPending] = useState(false);
  const [resetSecondsRemaining, setResetSecondsRemaining] = useState(RESET_DELAY_SECONDS);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [open]);

  useEffect(() => {
    if (!resetOpen) {
      setResetSecondsRemaining(RESET_DELAY_SECONDS);
      return;
    }

    setResetSecondsRemaining(RESET_DELAY_SECONDS);
    const interval = window.setInterval(() => {
      setResetSecondsRemaining((seconds) => {
        if (seconds <= 1) {
          window.clearInterval(interval);
          return 0;
        }
        return seconds - 1;
      });
    }, 1000);
    return () => window.clearInterval(interval);
  }, [resetOpen]);

  async function handleReset() {
    if (resetSecondsRemaining > 0 || resetPending) return;
    setResetPending(true);
    const reset = await onReset();
    if (!reset) setResetPending(false);
  }

  const started = new Date(startedAt);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className="h-auto min-h-tap gap-2 px-2 py-1 text-base font-semibold text-primary hover:bg-primary/10 hover:text-primary"
          aria-label={t('open', { name: workoutName })}
        >
          <span className="max-w-[15rem] truncate">{workoutName}</span>
          <Wrench className="size-5" aria-hidden />
        </Button>
      </DialogTrigger>

      <DialogContent className="bottom-0 left-0 top-auto max-h-[92dvh] w-full max-w-none translate-x-0 translate-y-0 gap-5 overflow-y-auto rounded-t-2xl border-x-0 border-b-0 p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border [&>button]:hidden">
        <div className="flex items-center justify-start">
          <DialogClose asChild>
            <Button type="button" variant="ghost" className="-ml-3 text-primary">
              {t('cancel')}
            </Button>
          </DialogClose>
        </div>

        <div className="space-y-2">
          <DialogTitle className="text-3xl font-bold tracking-tight">{workoutName}</DialogTitle>
          <DialogDescription className="sr-only">{t('description')}</DialogDescription>
          {statusLabel && (
            <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
              {statusLabel}
            </p>
          )}
        </div>

        <div className="space-y-1 rounded-2xl bg-muted/60 p-3">
          <div className="flex min-h-16 items-center gap-3 rounded-xl px-2">
            <CalendarDays className="size-6 text-muted-foreground" aria-hidden />
            <span className="font-semibold">{t('start')}</span>
            <span className="ml-auto text-right tabular-nums text-muted-foreground">
              {format.dateTime(started, {
                day: '2-digit',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          </div>
          <div className="flex min-h-16 items-center gap-3 rounded-xl px-2">
            <Clock3 className="size-6 text-muted-foreground" aria-hidden />
            <span className="font-semibold">{t('duration')}</span>
            <span className="ml-auto tabular-nums text-muted-foreground">
              {formatDuration(now - started.getTime())}
            </span>
          </div>
        </div>

        <div className="space-y-1 rounded-2xl bg-muted/60 p-3">
          <Button
            type="button"
            variant="ghost"
            className="min-h-16 w-full justify-start gap-4 px-3 text-base font-semibold text-primary hover:bg-primary/10 hover:text-primary"
            onClick={() => {
              setOpen(false);
              onComplete();
            }}
          >
            <CheckCircle2 className="size-6" aria-hidden />
            {t('complete')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="min-h-16 w-full justify-start gap-4 px-3 text-base font-semibold"
            onClick={() => {
              setOpen(false);
              onPause();
            }}
          >
            <Pause className="size-6 text-muted-foreground" aria-hidden />
            {t('pause')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="min-h-16 w-full justify-start gap-4 px-3 text-base font-semibold text-rose-600 hover:bg-rose-500/10 hover:text-rose-600"
            onClick={() => setResetOpen(true)}
          >
            <RotateCcw className="size-6" aria-hidden />
            {t('reset')}
          </Button>
        </div>

        <AlertDialog
          open={resetOpen}
          onOpenChange={(nextOpen) => {
            if (!resetPending) setResetOpen(nextOpen);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('resetTitle')}</AlertDialogTitle>
              <AlertDialogDescription>{t('resetDescription')}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={resetPending}>{t('cancel')}</AlertDialogCancel>
              <AlertDialogAction
                onClick={(event) => {
                  event.preventDefault();
                  void handleReset();
                }}
                disabled={resetPending || resetSecondsRemaining > 0}
                className="bg-rose-600 text-white hover:bg-rose-700"
              >
                {resetPending ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                    <span className="ml-2">{t('resetting')}</span>
                  </>
                ) : resetSecondsRemaining > 0 ? (
                  t('resetWait', { seconds: resetSecondsRemaining })
                ) : (
                  t('resetConfirm')
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}
