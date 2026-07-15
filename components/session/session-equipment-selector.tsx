'use client';

import { useTranslations } from 'next-intl';
import type { ResolvedEquipmentLoadProfile } from '@/lib/gym-loads';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export function SessionEquipmentSelector({
  options,
  selectedId,
  onChange,
}: {
  options: ResolvedEquipmentLoadProfile[];
  selectedId: string | null;
  onChange: (equipmentId: string) => void;
}) {
  const t = useTranslations('session.equipment');
  if (options.length === 0) return null;
  const selected = options.find((item) => item.equipmentId === selectedId) ?? null;

  return (
    <section className="space-y-2 rounded-md border border-border bg-muted/20 p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <Label htmlFor="session-equipment">{t('label')}</Label>
          <p className="text-xs text-muted-foreground">{t('description')}</p>
        </div>
        {selected && (
          <Badge variant="secondary">
            {t('loadCount', { count: selected.attainableLoads.length })}
          </Badge>
        )}
      </div>
      <Select value={selectedId ?? undefined} onValueChange={onChange}>
        <SelectTrigger id="session-equipment" aria-label={t('label')}>
          <SelectValue placeholder={t('choose')} />
        </SelectTrigger>
        <SelectContent>
          {options.map((item) => (
            <SelectItem key={item.equipmentId} value={item.equipmentId}>
              {item.equipmentName}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {selected?.loadType === 'SELECTORIZED' && (
        <p className="text-xs text-muted-foreground">
          {t('selectorized', { multiplier: selected.selectedLoadMultiplier })}
        </p>
      )}
      {selected?.loadType === 'PLATE_LOADED' && (
        <p className="text-xs text-muted-foreground">
          {t('plateLoaded', { pool: selected.platePoolName ?? t('unknownPool') })}
        </p>
      )}
      {!selected && options.length > 1 && (
        <p className="text-xs text-amber-700 dark:text-amber-400">{t('selectionRequired')}</p>
      )}
    </section>
  );
}
