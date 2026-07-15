'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { EquipmentLoadType, EquipmentType, GymInventoryMode } from '@/lib/prisma-client';
import type {
  GymEquipmentView,
  GymInventoryResponse,
  GymInventoryView,
  GymPlatePoolView,
} from '@/lib/gym-inventory-types';
import { equipmentTypeMessageKeys } from '@/i18n/enum-keys';
import { useExerciseName } from '@/components/shared/use-exercise-name';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';

interface Props {
  gymId: string;
  onModeChanged: (mode: GymInventoryMode) => void;
}

const EQUIPMENT_TYPES: EquipmentType[] = [
  'DUMBBELL',
  'BARBELL',
  'MACHINE',
  'CABLE',
  'BODYWEIGHT',
  'CARDIO',
  'OTHER',
];
const LOAD_TYPES: EquipmentLoadType[] = ['NONE', 'FIXED', 'SELECTORIZED', 'PLATE_LOADED'];

export function GymInventoryManager({ gymId, onModeChanged }: Props) {
  const t = useTranslations('settings.gyms.inventory');
  const exerciseName = useExerciseName();
  const [inventory, setInventory] = useState<GymInventoryView | null>(null);
  const [loading, setLoading] = useState(true);
  const [equipmentDialog, setEquipmentDialog] = useState<GymEquipmentView | 'new' | null>(null);
  const [poolDialog, setPoolDialog] = useState<GymPlatePoolView | 'new' | null>(null);
  const [coverageSearch, setCoverageSearch] = useState('');

  async function loadInventory() {
    setLoading(true);
    try {
      const response = await fetch(`/api/gyms/${gymId}/inventory`);
      if (!response.ok) throw new Error('inventory');
      const data = (await response.json()) as GymInventoryResponse;
      setInventory(data.gym);
    } catch {
      toast.error(t('loadError'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadInventory();
    // loadInventory is intentionally scoped to the selected gym.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gymId]);

  async function setMode(mode: GymInventoryMode) {
    const response = await fetch(`/api/gyms/${gymId}/inventory`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inventoryMode: mode }),
    });
    if (!response.ok) {
      toast.error(t('modeError'));
      return;
    }
    setInventory((current) => (current ? { ...current, inventoryMode: mode } : current));
    onModeChanged(mode);
    toast.success(t(mode === 'EQUIPMENT_FIRST' ? 'equipmentFirstEnabled' : 'legacyEnabled'));
  }

  async function removeEquipment(item: GymEquipmentView) {
    const response = await fetch(`/api/gym-equipment/${item.id}`, { method: 'DELETE' });
    if (!response.ok) {
      toast.error(t('equipment.deleteError'));
      return;
    }
    toast.success(t('equipment.deleted'));
    await loadInventory();
  }

  async function removePool(pool: GymPlatePoolView) {
    const response = await fetch(`/api/gym-plate-pools/${pool.id}`, { method: 'DELETE' });
    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      toast.error(data?.error ?? t('plates.deleteError'));
      return;
    }
    toast.success(t('plates.deleted'));
    await loadInventory();
  }

  const filteredCoverage = useMemo(() => {
    if (!inventory) return [];
    const query = coverageSearch.trim().toLocaleLowerCase();
    if (!query) return inventory.exerciseCoverage;
    return inventory.exerciseCoverage.filter((item) =>
      exerciseName(item.name).toLocaleLowerCase().includes(query),
    );
  }, [coverageSearch, exerciseName, inventory]);

  if (loading && !inventory) {
    return <p className="text-sm text-muted-foreground">{t('loading')}</p>;
  }
  if (!inventory) return null;

  return (
    <div className="space-y-5 border-t pt-5">
      <div
        className={`rounded-md border p-3 ${
          inventory.inventoryMode === 'LEGACY'
            ? 'border-amber-500/40 bg-amber-500/5'
            : 'border-emerald-500/40 bg-emerald-500/5'
        }`}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-xl space-y-1">
            <p className="text-sm font-semibold">
              {t(inventory.inventoryMode === 'LEGACY' ? 'legacyTitle' : 'equipmentFirstTitle')}
            </p>
            <p className="text-xs text-muted-foreground">
              {t(
                inventory.inventoryMode === 'LEGACY'
                  ? 'legacyDescription'
                  : 'equipmentFirstDescription',
              )}
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              void setMode(inventory.inventoryMode === 'LEGACY' ? 'EQUIPMENT_FIRST' : 'LEGACY')
            }
          >
            {t(inventory.inventoryMode === 'LEGACY' ? 'useEquipmentFirst' : 'useLegacy')}
          </Button>
        </div>
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">{t('plates.title')}</h3>
            <p className="text-xs text-muted-foreground">{t('plates.description')}</p>
          </div>
          <Button type="button" size="sm" variant="outline" onClick={() => setPoolDialog('new')}>
            <Plus className="size-4" />
            <span className="ml-2">{t('plates.add')}</span>
          </Button>
        </div>
        {inventory.platePools.length === 0 ? (
          <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
            {t('plates.empty')}
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {inventory.platePools.map((pool) => (
              <Card key={pool.id}>
                <CardHeader className="space-y-1 pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold">{pool.name}</p>
                      <p className="text-xs text-muted-foreground">{pool.compatibilityKey}</p>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={t('plates.edit')}
                        onClick={() => setPoolDialog(pool)}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={t('plates.delete')}
                        onClick={() => void removePool(pool)}
                      >
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-1.5 pt-0">
                  {pool.plates.map((plate) => (
                    <Badge key={plate.id} variant="secondary">
                      {plate.weightKg} kg
                      {plate.quantity == null ? '' : ` x ${plate.quantity}`}
                    </Badge>
                  ))}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3 border-t pt-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">{t('equipment.title')}</h3>
            <p className="text-xs text-muted-foreground">{t('equipment.description')}</p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setEquipmentDialog('new')}
          >
            <Plus className="size-4" />
            <span className="ml-2">{t('equipment.add')}</span>
          </Button>
        </div>
        {inventory.equipment.length === 0 ? (
          <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
            {t('equipment.empty')}
          </p>
        ) : (
          <div className="space-y-2">
            {inventory.equipment.map((item) => (
              <div key={item.id} className="rounded-md border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-semibold">{item.name}</p>
                      <Badge variant="outline">{item.loadType}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t(`equipmentTypes.${equipmentTypeMessageKeys[item.equipmentType]}`)}
                      {item.loadType === 'SELECTORIZED'
                        ? ` · ${t('equipment.multiplierSummary', {
                            multiplier: item.selectedLoadMultiplier,
                          })}`
                        : ''}
                      {item.loadType === 'PLATE_LOADED' && item.platePool
                        ? ` · ${item.platePool.name}`
                        : ''}
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {item.exerciseLinks.map((exercise) => (
                        <Badge key={exercise.id} variant="secondary">
                          {exerciseName(exercise.name)}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t('equipment.edit')}
                      onClick={() => setEquipmentDialog(item)}
                    >
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t('equipment.delete')}
                      onClick={() => void removeEquipment(item)}
                    >
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3 border-t pt-4">
        <div>
          <h3 className="text-sm font-semibold">{t('coverage.title')}</h3>
          <p className="text-xs text-muted-foreground">{t('coverage.description')}</p>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={coverageSearch}
            onChange={(event) => setCoverageSearch(event.target.value)}
            placeholder={t('coverage.search')}
            className="pl-9"
          />
        </div>
        <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
          {filteredCoverage.map((exercise) => (
            <div
              key={exercise.id}
              className="flex items-start justify-between gap-3 rounded-md border p-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{exerciseName(exercise.name)}</p>
                <p className="text-xs text-muted-foreground">
                  {t(`coverage.sources.${exercise.availabilitySource}`)}
                </p>
              </div>
              <Badge variant={exercise.isAvailable ? 'secondary' : 'outline'}>
                {t(exercise.isAvailable ? 'coverage.available' : 'coverage.unavailable')}
              </Badge>
            </div>
          ))}
        </div>
      </section>

      <PlatePoolDialog
        gymId={gymId}
        value={poolDialog}
        onOpenChange={(open) => !open && setPoolDialog(null)}
        onSaved={async () => {
          setPoolDialog(null);
          await loadInventory();
        }}
      />
      <EquipmentDialog
        gymId={gymId}
        inventory={inventory}
        value={equipmentDialog}
        onOpenChange={(open) => !open && setEquipmentDialog(null)}
        onSaved={async () => {
          setEquipmentDialog(null);
          await loadInventory();
        }}
      />
    </div>
  );
}

interface PlateDraftItem {
  key: number;
  weight: string;
  quantity: string;
}

function PlatePoolDialog({
  gymId,
  value,
  onOpenChange,
  onSaved,
}: {
  gymId: string;
  value: GymPlatePoolView | 'new' | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => Promise<void>;
}) {
  const t = useTranslations('settings.gyms.inventory.plates');
  const common = useTranslations('common');
  const [name, setName] = useState('');
  const [compatibilityKey, setCompatibilityKey] = useState('');
  const [plates, setPlates] = useState<PlateDraftItem[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!value) return;
    setName(value === 'new' ? '' : value.name);
    setCompatibilityKey(value === 'new' ? '' : value.compatibilityKey);
    setPlates(
      value === 'new'
        ? [{ key: 1, weight: '20', quantity: '' }]
        : value.plates.map((plate, index) => ({
            key: index + 1,
            weight: String(plate.weightKg),
            quantity: plate.quantity == null ? '' : String(plate.quantity),
          })),
    );
  }, [value]);

  async function save() {
    if (!value || saving) return;
    setSaving(true);
    try {
      const body = {
        name: name.trim(),
        compatibilityKey: compatibilityKey.trim(),
        plates: plates.flatMap((plate) => {
          const weightKg = parseDecimal(plate.weight);
          if (weightKg == null || weightKg <= 0) return [];
          const quantity = plate.quantity.trim() === '' ? null : Number(plate.quantity);
          return [{ weightKg, quantity }];
        }),
      };
      const response = await fetch(
        value === 'new' ? `/api/gyms/${gymId}/plate-pools` : `/api/gym-plate-pools/${value.id}`,
        {
          method: value === 'new' ? 'POST' : 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      if (!response.ok) throw new Error('save');
      toast.success(t('saved'));
      await onSaved();
    } catch {
      toast.error(t('saveError'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={value != null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t(value === 'new' ? 'addTitle' : 'editTitle')}</DialogTitle>
          <DialogDescription>{t('dialogDescription')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="plate-pool-name">{t('name')}</Label>
            <Input
              id="plate-pool-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="plate-compatibility-key">{t('compatibilityKey')}</Label>
            <Input
              id="plate-compatibility-key"
              value={compatibilityKey}
              onChange={(event) => setCompatibilityKey(event.target.value)}
              placeholder="olympic_50mm"
            />
            <p className="text-xs text-muted-foreground">{t('compatibilityHelp')}</p>
          </div>
          <div className="space-y-2">
            <div className="grid grid-cols-[1fr_1fr_2.75rem] gap-2 text-xs text-muted-foreground">
              <span>{t('weight')}</span>
              <span>{t('quantity')}</span>
              <span />
            </div>
            {plates.map((plate) => (
              <div key={plate.key} className="grid grid-cols-[1fr_1fr_2.75rem] gap-2">
                <Input
                  inputMode="decimal"
                  value={plate.weight}
                  aria-label={t('weight')}
                  onChange={(event) =>
                    setPlates((current) =>
                      current.map((item) =>
                        item.key === plate.key ? { ...item, weight: event.target.value } : item,
                      ),
                    )
                  }
                />
                <Input
                  inputMode="numeric"
                  value={plate.quantity}
                  aria-label={t('quantity')}
                  placeholder={t('unknown')}
                  onChange={(event) =>
                    setPlates((current) =>
                      current.map((item) =>
                        item.key === plate.key ? { ...item, quantity: event.target.value } : item,
                      ),
                    )
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t('removePlate')}
                  onClick={() =>
                    setPlates((current) => current.filter((item) => item.key !== plate.key))
                  }
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() =>
                setPlates((current) => [
                  ...current,
                  {
                    key: Math.max(0, ...current.map((item) => item.key)) + 1,
                    weight: '',
                    quantity: '',
                  },
                ])
              }
            >
              <Plus className="size-4" />
              <span className="ml-2">{t('addPlate')}</span>
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {common('actions.cancel')}
          </Button>
          <Button
            type="button"
            onClick={() => void save()}
            disabled={saving || !name.trim() || !compatibilityKey.trim()}
          >
            {saving ? common('actions.saving') : common('actions.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface EquipmentDraft {
  name: string;
  equipmentType: EquipmentType;
  loadType: EquipmentLoadType;
  description: string;
  quantity: string;
  stackMode: 'EXACT' | 'RANGE';
  exactWeights: string;
  rangeMin: string;
  rangeMax: string;
  rangeStep: string;
  multiplier: string;
  baseLoad: string;
  loadingSides: string;
  platePoolId: string;
  exerciseIds: Set<string>;
}

function EquipmentDialog({
  gymId,
  inventory,
  value,
  onOpenChange,
  onSaved,
}: {
  gymId: string;
  inventory: GymInventoryView;
  value: GymEquipmentView | 'new' | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => Promise<void>;
}) {
  const t = useTranslations('settings.gyms.inventory.equipment');
  const exerciseT = useTranslations('exercises');
  const common = useTranslations('common');
  const exerciseName = useExerciseName();
  const [draft, setDraft] = useState<EquipmentDraft>(() => emptyEquipmentDraft());
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!value) return;
    setDraft(value === 'new' ? emptyEquipmentDraft() : draftFromEquipment(value));
    setSearch('');
  }, [value]);

  const filteredExercises = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return inventory.exerciseCoverage;
    return inventory.exerciseCoverage.filter((exercise) =>
      exerciseName(exercise.name).toLocaleLowerCase().includes(query),
    );
  }, [exerciseName, inventory.exerciseCoverage, search]);

  function toggleExercise(id: string, checked: boolean) {
    setDraft((current) => {
      const exerciseIds = new Set(current.exerciseIds);
      if (checked) exerciseIds.add(id);
      else exerciseIds.delete(id);
      return { ...current, exerciseIds };
    });
  }

  async function save() {
    if (!value || saving) return;
    setSaving(true);
    try {
      const weightOptions =
        draft.loadType === 'FIXED' || draft.loadType === 'SELECTORIZED'
          ? draft.stackMode === 'RANGE'
            ? expandLoadRange(draft.rangeMin, draft.rangeMax, draft.rangeStep)
            : parseWeightList(draft.exactWeights)
          : [];
      const body = {
        name: draft.name.trim(),
        equipmentType: draft.equipmentType,
        description: draft.description.trim() || null,
        quantity: Number(draft.quantity),
        loadType: draft.loadType,
        weightOptions,
        selectedLoadMultiplier: parseDecimal(draft.multiplier) ?? 1,
        baseLoadKg: parseDecimal(draft.baseLoad) ?? 0,
        platePoolId: draft.loadType === 'PLATE_LOADED' ? draft.platePoolId || null : null,
        loadingSides: Number(draft.loadingSides),
        exerciseIds: [...draft.exerciseIds],
      };
      const response = await fetch(
        value === 'new' ? `/api/gyms/${gymId}/equipment` : `/api/gym-equipment/${value.id}`,
        {
          method: value === 'new' ? 'POST' : 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      if (!response.ok) throw new Error('save');
      toast.success(t('saved'));
      await onSaved();
    } catch (error) {
      toast.error(error instanceof RangeError ? t('rangeError') : t('saveError'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={value != null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t(value === 'new' ? 'addTitle' : 'editTitle')}</DialogTitle>
          <DialogDescription>{t('dialogDescription')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="equipment-name">{t('name')}</Label>
              <Input
                id="equipment-name"
                value={draft.name}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, name: event.target.value }))
                }
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="equipment-quantity">{t('quantity')}</Label>
              <Input
                id="equipment-quantity"
                type="number"
                min={1}
                max={100}
                value={draft.quantity}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, quantity: event.target.value }))
                }
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>{t('equipmentType')}</Label>
              <Select
                value={draft.equipmentType}
                onValueChange={(equipmentType) =>
                  setDraft((current) => ({
                    ...current,
                    equipmentType: equipmentType as EquipmentType,
                  }))
                }
              >
                <SelectTrigger aria-label={t('equipmentType')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EQUIPMENT_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {exerciseT(`equipmentTypes.${equipmentTypeMessageKeys[type]}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>{t('loadType')}</Label>
              <Select
                value={draft.loadType}
                onValueChange={(loadType) =>
                  setDraft((current) => ({ ...current, loadType: loadType as EquipmentLoadType }))
                }
              >
                <SelectTrigger aria-label={t('loadType')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LOAD_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {t(`loadTypes.${type}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {(draft.loadType === 'SELECTORIZED' || draft.loadType === 'FIXED') && (
            <div className="space-y-3 rounded-md border p-3">
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={draft.stackMode === 'RANGE' ? 'default' : 'outline'}
                  onClick={() => setDraft((current) => ({ ...current, stackMode: 'RANGE' }))}
                >
                  {t('range')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={draft.stackMode === 'EXACT' ? 'default' : 'outline'}
                  onClick={() => setDraft((current) => ({ ...current, stackMode: 'EXACT' }))}
                >
                  {t('exact')}
                </Button>
              </div>
              {draft.stackMode === 'RANGE' ? (
                <div className="grid grid-cols-3 gap-2">
                  {(['rangeMin', 'rangeMax', 'rangeStep'] as const).map((field) => (
                    <div key={field} className="space-y-1">
                      <Label htmlFor={`equipment-${field}`}>{t(field)}</Label>
                      <Input
                        id={`equipment-${field}`}
                        inputMode="decimal"
                        value={draft[field]}
                        onChange={(event) =>
                          setDraft((current) => ({ ...current, [field]: event.target.value }))
                        }
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-1">
                  <Label htmlFor="equipment-exact-weights">{t('displayedLoads')}</Label>
                  <Input
                    id="equipment-exact-weights"
                    value={draft.exactWeights}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, exactWeights: event.target.value }))
                    }
                    placeholder="5, 10, 15, 20"
                  />
                </div>
              )}
              {draft.loadType === 'SELECTORIZED' && (
                <div className="space-y-1">
                  <Label htmlFor="equipment-multiplier">{t('multiplier')}</Label>
                  <Input
                    id="equipment-multiplier"
                    inputMode="decimal"
                    value={draft.multiplier}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, multiplier: event.target.value }))
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    {t('multiplierHelp', { multiplier: parseDecimal(draft.multiplier) ?? 1 })}
                  </p>
                </div>
              )}
            </div>
          )}

          {draft.loadType === 'PLATE_LOADED' && (
            <div className="grid gap-3 rounded-md border p-3 sm:grid-cols-3">
              <div className="space-y-1 sm:col-span-3">
                <Label>{t('platePool')}</Label>
                <Select
                  value={draft.platePoolId}
                  onValueChange={(platePoolId) =>
                    setDraft((current) => ({ ...current, platePoolId }))
                  }
                >
                  <SelectTrigger aria-label={t('platePool')}>
                    <SelectValue placeholder={t('choosePlatePool')} />
                  </SelectTrigger>
                  <SelectContent>
                    {inventory.platePools.map((pool) => (
                      <SelectItem key={pool.id} value={pool.id}>
                        {pool.name} ({pool.compatibilityKey})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="equipment-base-load">{t('baseLoad')}</Label>
                <Input
                  id="equipment-base-load"
                  inputMode="decimal"
                  value={draft.baseLoad}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, baseLoad: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="equipment-loading-sides">{t('loadingSides')}</Label>
                <Input
                  id="equipment-loading-sides"
                  type="number"
                  min={1}
                  max={8}
                  value={draft.loadingSides}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, loadingSides: event.target.value }))
                  }
                />
              </div>
            </div>
          )}

          <div className="space-y-1">
            <Label htmlFor="equipment-description">{t('notes')}</Label>
            <Textarea
              id="equipment-description"
              value={draft.description}
              onChange={(event) =>
                setDraft((current) => ({ ...current, description: event.target.value }))
              }
            />
          </div>

          <div className="space-y-2 border-t pt-4">
            <div>
              <p className="text-sm font-semibold">{t('supportedExercises')}</p>
              <p className="text-xs text-muted-foreground">{t('supportedExercisesHelp')}</p>
            </div>
            <Input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('searchExercises')}
            />
            <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
              {filteredExercises.map((exercise) => (
                <label
                  key={exercise.id}
                  className="flex items-center justify-between gap-3 rounded-md border p-2"
                >
                  <span className="truncate text-sm">{exerciseName(exercise.name)}</span>
                  <Switch
                    checked={draft.exerciseIds.has(exercise.id)}
                    onCheckedChange={(checked) => toggleExercise(exercise.id, checked)}
                  />
                </label>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {common('actions.cancel')}
          </Button>
          <Button
            type="button"
            onClick={() => void save()}
            disabled={
              saving ||
              !draft.name.trim() ||
              (draft.loadType === 'PLATE_LOADED' && !draft.platePoolId)
            }
          >
            {saving ? common('actions.saving') : common('actions.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function emptyEquipmentDraft(): EquipmentDraft {
  return {
    name: '',
    equipmentType: 'MACHINE',
    loadType: 'SELECTORIZED',
    description: '',
    quantity: '1',
    stackMode: 'RANGE',
    exactWeights: '',
    rangeMin: '5',
    rangeMax: '100',
    rangeStep: '5',
    multiplier: '1',
    baseLoad: '0',
    loadingSides: '2',
    platePoolId: '',
    exerciseIds: new Set(),
  };
}

function draftFromEquipment(item: GymEquipmentView): EquipmentDraft {
  return {
    name: item.name,
    equipmentType: item.equipmentType,
    loadType: item.loadType,
    description: item.description ?? '',
    quantity: String(item.quantity),
    stackMode: 'EXACT',
    exactWeights: item.weightOptions.join(', '),
    rangeMin: item.weightOptions.length ? String(item.weightOptions[0]) : '5',
    rangeMax: item.weightOptions.length ? String(item.weightOptions.at(-1)) : '100',
    rangeStep:
      item.weightOptions.length > 1
        ? String(Math.round((item.weightOptions[1]! - item.weightOptions[0]!) * 100) / 100)
        : '5',
    multiplier: String(item.selectedLoadMultiplier),
    baseLoad: String(item.baseLoadKg),
    loadingSides: String(item.loadingSides),
    platePoolId: item.platePoolId ?? '',
    exerciseIds: new Set(item.exerciseLinks.map((exercise) => exercise.id)),
  };
}

export function expandLoadRange(minRaw: string, maxRaw: string, stepRaw: string): number[] {
  const min = parseDecimal(minRaw);
  const max = parseDecimal(maxRaw);
  const step = parseDecimal(stepRaw);
  if (min == null || max == null || step == null || min <= 0 || max < min || step <= 0) {
    throw new RangeError('invalid-range');
  }
  const count = Math.floor((max - min) / step + 0.0001) + 1;
  if (count > 200) throw new RangeError('too-many-loads');
  const values = Array.from({ length: count }, (_, index) => round(min + step * index));
  if (Math.abs((values.at(-1) ?? min) - max) > 0.001) values.push(round(max));
  return [...new Set(values)];
}

function parseWeightList(raw: string): number[] {
  return [
    ...new Set(
      raw
        .split(/[;,]/)
        .map(parseDecimal)
        .filter((value): value is number => value != null && value > 0)
        .map(round),
    ),
  ].sort((left, right) => left - right);
}

function parseDecimal(value: string): number | null {
  const parsed = Number(value.trim().replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
