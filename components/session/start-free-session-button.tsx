'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

export function StartFreeSessionButton({ className }: { className?: string }) {
  const t = useTranslations('session.free');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleStart() {
    startTransition(async () => {
      const response = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!response.ok) {
        toast.error(t('startError'));
        return;
      }
      const session = (await response.json()) as { id: string };
      router.push('/session/' + session.id);
      router.refresh();
    });
  }

  return (
    <Button
      type="button"
      variant="outline"
      className={className}
      onClick={handleStart}
      disabled={isPending}
    >
      <Plus className="size-5" />
      <span className="ml-2">{isPending ? t('starting') : t('start')}</span>
    </Button>
  );
}
