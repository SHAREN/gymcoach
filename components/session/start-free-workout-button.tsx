'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

export function StartFreeWorkoutButton({ gymId }: { gymId?: string | null }) {
  const t = useTranslations('session');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleStart() {
    startTransition(async () => {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ freeform: true, gymId }),
      });
      if (!res.ok) {
        toast.error(t('startError'));
        return;
      }
      const session = (await res.json()) as { id: string };
      router.push('/session/' + session.id);
      router.refresh();
    });
  }

  return (
    <Button onClick={handleStart} disabled={isPending} variant="outline" className="min-h-tap w-full">
      <Plus className="size-5" />
      <span className="ml-2">{isPending ? t('starting') : t('freeform.start')}</span>
    </Button>
  );
}
