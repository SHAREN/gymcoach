'use client';

import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { HeartPulse, Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { MuscleGroup } from '@/lib/prisma-client';
import type {
  CoachingFieldState,
  CoachingHealthStatus,
  CoachingLimitation,
  CoachingLimitationsValue,
  CoachingOutsideActivity,
  CoachingProfile,
  CoachingProfilePatch,
  CoachingTrainingLevel,
} from '@/lib/schemas/coaching-profile';
import { muscleGroupMessageKeys } from '@/i18n/enum-keys';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type FieldDraft<T> = { state: CoachingFieldState; value: T | null };
type CoachingDraft = {
  healthStatus: FieldDraft<CoachingHealthStatus>;
  trainingLevel: FieldDraft<CoachingTrainingLevel>;
  availableWeekdays: FieldDraft<number[]>;
  limitations: FieldDraft<CoachingLimitationsValue>;
  maximumSessionDurationMin: FieldDraft<number>;
  priorityMuscles: FieldDraft<MuscleGroup[]>;
  priorityStrengthMovements: FieldDraft<string[]>;
  outsideActivities: FieldDraft<CoachingOutsideActivity[]>;
  likedExercises: FieldDraft<string[]>;
  dislikedExercises: FieldDraft<string[]>;
  averageSleepHours: FieldDraft<number>;
  baselineStress: FieldDraft<number>;
  generalRecovery: FieldDraft<number>;
};

type SaveSection = 'safety' | 'limitations' | 'preferences' | 'recovery';

const MUSCLE_GROUPS = Object.keys(muscleGroupMessageKeys) as MuscleGroup[];
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
const LIMITATION_KINDS: CoachingLimitation['kind'][] = [
  'PAIN',
  'INJURY',
  'FORBIDDEN_MOVEMENT',
  'DISCOURAGED_MOVEMENT',
  'FORBIDDEN_EXERCISE',
  'DISCOURAGED_EXERCISE',
];
const ACTIVITY_TYPES: CoachingOutsideActivity['type'][] = ['CARDIO', 'SPORT', 'PHYSICAL_WORK'];
const ACTIVITY_INTENSITIES = ['LOW', 'MODERATE', 'HIGH'] as const;

function fieldDraft<T>(field: { state: CoachingFieldState; value?: T | null }): FieldDraft<T> {
  return { state: field.state, value: field.state === 'KNOWN' ? (field.value ?? null) : null };
}

function toDraft(profile: CoachingProfile): CoachingDraft {
  return {
    healthStatus: fieldDraft(profile.healthStatus),
    trainingLevel: fieldDraft(profile.trainingLevel),
    availableWeekdays: fieldDraft(profile.availableWeekdays),
    limitations: fieldDraft(profile.limitations),
    maximumSessionDurationMin: fieldDraft(profile.maximumSessionDurationMin),
    priorityMuscles: fieldDraft(profile.priorityMuscles),
    priorityStrengthMovements: fieldDraft(profile.priorityStrengthMovements),
    outsideActivities: fieldDraft(profile.outsideActivities),
    likedExercises: fieldDraft(profile.likedExercises),
    dislikedExercises: fieldDraft(profile.dislikedExercises),
    averageSleepHours: fieldDraft(profile.averageSleepHours),
    baselineStress: fieldDraft(profile.baselineStress),
    generalRecovery: fieldDraft(profile.generalRecovery),
  };
}

function commaValues(value: string): string[] {
  const seen = new Set<string>();
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => {
      if (!item) return false;
      const key = item.toLocaleLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function fieldInput<T>(field: FieldDraft<T>) {
  if (field.state === 'KNOWN') {
    if (field.value == null) throw new Error('Known coaching profile fields require a value.');
    return { state: 'KNOWN' as const, value: field.value };
  }
  return { state: field.state as 'UNKNOWN' | 'NOT_APPLICABLE', value: null };
}

export function CoachingProfileSection({ initial }: { initial: CoachingProfile }) {
  const t = useTranslations('settings.profile.coaching');
  const exerciseT = useTranslations('exercises.muscleGroups');
  const format = useFormatter();
  const [draft, setDraft] = useState(() => toDraft(initial));
  const [updatedAt, setUpdatedAt] = useState(initial.updatedAt);
  const [pending, setPending] = useState<SaveSection | null>(null);
  const [errors, setErrors] = useState<Partial<Record<SaveSection, boolean>>>({});

  function patch<K extends keyof CoachingDraft>(key: K, value: CoachingDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function saveSection(section: SaveSection, fields: CoachingProfilePatch) {
    setPending(section);
    setErrors((current) => ({ ...current, [section]: false }));
    try {
      const response = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coachingProfile: fields }),
      });
      if (!response.ok) throw new Error(`Profile save failed with ${response.status}`);
      const payload = (await response.json()) as { coachingProfile: CoachingProfile };
      const savedDraft = toDraft(payload.coachingProfile);
      setDraft((current) => {
        const next = { ...current };
        for (const key of Object.keys(fields) as Array<keyof CoachingDraft>) {
          next[key] = savedDraft[key] as never;
        }
        return next;
      });
      setUpdatedAt(payload.coachingProfile.updatedAt);
      toast.success(t('saved'));
    } catch {
      setErrors((current) => ({ ...current, [section]: true }));
      toast.error(t('saveError'));
    } finally {
      setPending(null);
    }
  }

  const safetyValid =
    (draft.healthStatus.state !== 'KNOWN' || draft.healthStatus.value != null) &&
    (draft.trainingLevel.state !== 'KNOWN' || draft.trainingLevel.value != null) &&
    (draft.availableWeekdays.state !== 'KNOWN' ||
      (draft.availableWeekdays.value != null && draft.availableWeekdays.value.length > 0)) &&
    (draft.maximumSessionDurationMin.state !== 'KNOWN' ||
      (draft.maximumSessionDurationMin.value != null &&
        draft.maximumSessionDurationMin.value >= 20 &&
        draft.maximumSessionDurationMin.value <= 240));
  const limitationsValid =
    draft.limitations.state !== 'KNOWN' ||
    (draft.limitations.value != null &&
      draft.limitations.value.entries.length > 0 &&
      draft.limitations.value.entries.every(
        (entry) => entry.label.trim() && entry.affectedExerciseNames.length > 0,
      ));

  const weekdayLabels = [
    t('weekdays.monday'),
    t('weekdays.tuesday'),
    t('weekdays.wednesday'),
    t('weekdays.thursday'),
    t('weekdays.friday'),
    t('weekdays.saturday'),
    t('weekdays.sunday'),
  ];

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <HeartPulse className="size-5" />
          <h2 className="text-base font-semibold">{t('title')}</h2>
        </div>
        <p className="text-xs text-muted-foreground">{t('description')}</p>
        {updatedAt && (
          <p className="text-xs text-muted-foreground">
            {t('lastUpdated', {
              date: format.dateTime(new Date(updatedAt), {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              }),
            })}
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-8">
        <section className="space-y-4" aria-labelledby="coaching-safety-title">
          <div>
            <h3 id="coaching-safety-title" className="font-medium">
              {t('safetyTitle')}
            </h3>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t('healthStatus')}</Label>
              <Select
                value={
                  draft.healthStatus.state === 'KNOWN'
                    ? (draft.healthStatus.value ?? 'UNKNOWN')
                    : 'UNKNOWN'
                }
                onValueChange={(value) =>
                  patch(
                    'healthStatus',
                    value === 'UNKNOWN'
                      ? { state: 'UNKNOWN', value: null }
                      : { state: 'KNOWN', value: value as CoachingHealthStatus },
                  )
                }
              >
                <SelectTrigger aria-label={t('healthStatus')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="UNKNOWN">{t('unknown')}</SelectItem>
                  <SelectItem value="NO_SIGNIFICANT_ISSUES">{t('healthNoIssues')}</SelectItem>
                  <SelectItem value="TRAIN_WITH_LIMITATIONS">{t('healthLimitations')}</SelectItem>
                  <SelectItem value="MEDICAL_CLEARANCE_REQUIRED">{t('healthClearance')}</SelectItem>
                </SelectContent>
              </Select>
              {draft.healthStatus.value === 'MEDICAL_CLEARANCE_REQUIRED' && (
                <p className="text-xs text-amber-700">{t('clearanceHelp')}</p>
              )}
              {draft.healthStatus.value === 'TRAIN_WITH_LIMITATIONS' && (
                <p className="text-xs text-muted-foreground">{t('healthLimitationsHelp')}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>{t('trainingLevel')}</Label>
              <Select
                value={
                  draft.trainingLevel.state === 'KNOWN'
                    ? (draft.trainingLevel.value ?? 'UNKNOWN')
                    : 'UNKNOWN'
                }
                onValueChange={(value) =>
                  patch(
                    'trainingLevel',
                    value === 'UNKNOWN'
                      ? { state: 'UNKNOWN', value: null }
                      : { state: 'KNOWN', value: value as CoachingTrainingLevel },
                  )
                }
              >
                <SelectTrigger aria-label={t('trainingLevel')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="UNKNOWN">{t('unknown')}</SelectItem>
                  <SelectItem value="BEGINNER">{t('beginner')}</SelectItem>
                  <SelectItem value="INTERMEDIATE">{t('intermediate')}</SelectItem>
                  <SelectItem value="ADVANCED">{t('advanced')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label>{t('availableWeekdays')}</Label>
              <FieldStateSelect
                ariaLabel={t('availableWeekdays')}
                value={draft.availableWeekdays.state}
                onChange={(state) =>
                  patch('availableWeekdays', {
                    state,
                    value: state === 'KNOWN' ? (draft.availableWeekdays.value ?? []) : null,
                  })
                }
                labels={{ unknown: t('unknown'), known: t('known') }}
              />
            </div>
            {draft.availableWeekdays.state === 'KNOWN' && (
              <fieldset className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <legend className="sr-only">{t('availableWeekdays')}</legend>
                {WEEKDAYS.map((day) => (
                  <label key={day} className="flex min-h-tap items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={draft.availableWeekdays.value?.includes(day) ?? false}
                      onChange={(event) => {
                        const current = draft.availableWeekdays.value ?? [];
                        patch('availableWeekdays', {
                          state: 'KNOWN',
                          value: event.target.checked
                            ? [...current, day].sort((a, b) => a - b)
                            : current.filter((value) => value !== day),
                        });
                      }}
                      className="size-4"
                    />
                    <span>{weekdayLabels[day - 1]}</span>
                  </label>
                ))}
              </fieldset>
            )}
            <p className="text-xs text-muted-foreground">{t('weekdaysHelp')}</p>
          </div>
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label htmlFor="maximum-session-duration">{t('maximumDuration')}</Label>
              <FieldStateSelect
                ariaLabel={t('maximumDuration')}
                value={draft.maximumSessionDurationMin.state}
                onChange={(state) =>
                  patch('maximumSessionDurationMin', {
                    state,
                    value: state === 'KNOWN' ? (draft.maximumSessionDurationMin.value ?? 60) : null,
                  })
                }
                labels={{ unknown: t('unknown'), known: t('known') }}
              />
            </div>
            {draft.maximumSessionDurationMin.state === 'KNOWN' && (
              <Input
                id="maximum-session-duration"
                type="number"
                min={20}
                max={240}
                value={draft.maximumSessionDurationMin.value ?? ''}
                onChange={(event) =>
                  patch('maximumSessionDurationMin', {
                    state: 'KNOWN',
                    value: event.target.value ? Number(event.target.value) : null,
                  })
                }
                className="max-w-40"
                aria-invalid={!safetyValid}
              />
            )}
            <p className="text-xs text-muted-foreground">{t('maximumDurationHelp')}</p>
          </div>
          <SaveRow
            label={t('saveSafety')}
            pending={pending === 'safety'}
            error={errors.safety}
            errorMessage={t('saveError')}
            retryLabel={t('retry')}
            disabled={!safetyValid}
            onSave={() => {
              if (!safetyValid) return toast.error(t('fixFields'));
              void saveSection('safety', {
                healthStatus: fieldInput(draft.healthStatus),
                trainingLevel: fieldInput(draft.trainingLevel),
                availableWeekdays: fieldInput(draft.availableWeekdays),
                maximumSessionDurationMin: fieldInput(draft.maximumSessionDurationMin),
              });
            }}
          />
        </section>

        <section className="space-y-4 border-t pt-6" aria-labelledby="coaching-limitations-title">
          <div>
            <h3 id="coaching-limitations-title" className="font-medium">
              {t('limitationsTitle')}
            </h3>
            <p className="text-xs text-muted-foreground">{t('limitationsHelp')}</p>
          </div>
          <FieldStateSelect
            ariaLabel={t('limitationsTitle')}
            value={draft.limitations.state}
            allowNotApplicable
            onChange={(state) =>
              patch('limitations', {
                state,
                value:
                  state === 'KNOWN'
                    ? (draft.limitations.value ?? { entries: [], note: null })
                    : null,
              })
            }
            labels={{
              unknown: t('unknown'),
              known: t('known'),
              notApplicable: t('notApplicable'),
            }}
          />
          {draft.limitations.state === 'KNOWN' && (
            <div className="space-y-4">
              {(draft.limitations.value?.entries ?? []).map((entry, index) => (
                <div key={index} className="space-y-3 rounded-md border p-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label>{t('limitationKind')}</Label>
                      <Select
                        value={entry.kind}
                        onValueChange={(kind) => {
                          const entries = [...(draft.limitations.value?.entries ?? [])];
                          entries[index] = { ...entry, kind: kind as CoachingLimitation['kind'] };
                          patch('limitations', {
                            state: 'KNOWN',
                            value: { ...draft.limitations.value!, entries },
                          });
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {LIMITATION_KINDS.map((kind) => (
                            <SelectItem key={kind} value={kind}>
                              {t(`limitationKinds.${kind}`)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`limitation-label-${index}`}>{t('limitationLabel')}</Label>
                      <Input
                        id={`limitation-label-${index}`}
                        value={entry.label}
                        maxLength={120}
                        placeholder={t('limitationLabelPlaceholder')}
                        onChange={(event) => {
                          const entries = [...(draft.limitations.value?.entries ?? [])];
                          entries[index] = { ...entry, label: event.target.value };
                          patch('limitations', {
                            state: 'KNOWN',
                            value: { ...draft.limitations.value!, entries },
                          });
                        }}
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`limitation-exercises-${index}`}>
                      {t('affectedExercises')}
                    </Label>
                    <Input
                      id={`limitation-exercises-${index}`}
                      value={entry.affectedExerciseNames.join(', ')}
                      placeholder={t('affectedExercisesPlaceholder')}
                      onChange={(event) => {
                        const entries = [...(draft.limitations.value?.entries ?? [])];
                        entries[index] = {
                          ...entry,
                          affectedExerciseNames: commaValues(event.target.value),
                        };
                        patch('limitations', {
                          state: 'KNOWN',
                          value: { ...draft.limitations.value!, entries },
                        });
                      }}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`limitation-details-${index}`}>{t('details')}</Label>
                    <Textarea
                      id={`limitation-details-${index}`}
                      rows={2}
                      maxLength={500}
                      value={entry.details ?? ''}
                      placeholder={t('detailsPlaceholder')}
                      onChange={(event) => {
                        const entries = [...(draft.limitations.value?.entries ?? [])];
                        entries[index] = {
                          ...entry,
                          details: event.target.value || null,
                        };
                        patch('limitations', {
                          state: 'KNOWN',
                          value: { ...draft.limitations.value!, entries },
                        });
                      }}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const entries = (draft.limitations.value?.entries ?? []).filter(
                        (_, itemIndex) => itemIndex !== index,
                      );
                      patch('limitations', {
                        state: 'KNOWN',
                        value: { ...draft.limitations.value!, entries },
                      });
                    }}
                  >
                    <Trash2 className="mr-2 size-4" />
                    {t('removeLimitation')}
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                disabled={(draft.limitations.value?.entries.length ?? 0) >= 20}
                onClick={() =>
                  patch('limitations', {
                    state: 'KNOWN',
                    value: {
                      entries: [
                        ...(draft.limitations.value?.entries ?? []),
                        {
                          kind: 'PAIN',
                          label: '',
                          affectedExerciseNames: [],
                          details: null,
                        },
                      ],
                      note: draft.limitations.value?.note ?? null,
                    },
                  })
                }
              >
                <Plus className="mr-2 size-4" />
                {t('addLimitation')}
              </Button>
              <div className="space-y-1.5">
                <Label htmlFor="limitations-note">{t('limitationsNote')}</Label>
                <Textarea
                  id="limitations-note"
                  rows={2}
                  maxLength={1000}
                  value={draft.limitations.value?.note ?? ''}
                  onChange={(event) =>
                    patch('limitations', {
                      state: 'KNOWN',
                      value: {
                        entries: draft.limitations.value?.entries ?? [],
                        note: event.target.value || null,
                      },
                    })
                  }
                />
              </div>
            </div>
          )}
          <SaveRow
            label={t('saveLimitations')}
            pending={pending === 'limitations'}
            error={errors.limitations}
            errorMessage={t('saveError')}
            retryLabel={t('retry')}
            disabled={!limitationsValid}
            onSave={() => {
              if (!limitationsValid) return toast.error(t('fixFields'));
              void saveSection('limitations', { limitations: fieldInput(draft.limitations) });
            }}
          />
        </section>

        <section className="space-y-5 border-t pt-6" aria-labelledby="coaching-priorities-title">
          <h3 id="coaching-priorities-title" className="font-medium">
            {t('prioritiesTitle')}
          </h3>
          <StatefulStringList
            id="priority-strength-movements"
            label={t('priorityMovements')}
            placeholder={t('priorityMovementsPlaceholder')}
            field={draft.priorityStrengthMovements}
            onChange={(field) => patch('priorityStrengthMovements', field)}
            labels={{ unknown: t('unknown'), known: t('known'), notApplicable: t('notApplicable') }}
          />
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label>{t('priorityMuscles')}</Label>
              <FieldStateSelect
                ariaLabel={t('priorityMuscles')}
                value={draft.priorityMuscles.state}
                allowNotApplicable
                onChange={(state) =>
                  patch('priorityMuscles', {
                    state,
                    value: state === 'KNOWN' ? (draft.priorityMuscles.value ?? []) : null,
                  })
                }
                labels={{
                  unknown: t('unknown'),
                  known: t('known'),
                  notApplicable: t('notApplicable'),
                }}
              />
            </div>
            {draft.priorityMuscles.state === 'KNOWN' && (
              <fieldset className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <legend className="sr-only">{t('priorityMuscles')}</legend>
                {MUSCLE_GROUPS.map((muscle) => (
                  <label key={muscle} className="flex min-h-tap items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="size-4"
                      checked={draft.priorityMuscles.value?.includes(muscle) ?? false}
                      disabled={
                        !(draft.priorityMuscles.value?.includes(muscle) ?? false) &&
                        (draft.priorityMuscles.value?.length ?? 0) >= 15
                      }
                      onChange={(event) => {
                        const values = draft.priorityMuscles.value ?? [];
                        patch('priorityMuscles', {
                          state: 'KNOWN',
                          value: event.target.checked
                            ? [...values, muscle]
                            : values.filter((value) => value !== muscle),
                        });
                      }}
                    />
                    <span>{exerciseT(muscleGroupMessageKeys[muscle])}</span>
                  </label>
                ))}
              </fieldset>
            )}
          </div>
          <StatefulStringList
            id="liked-exercises"
            label={t('likedExercises')}
            placeholder={t('exerciseListPlaceholder')}
            field={draft.likedExercises}
            onChange={(field) => patch('likedExercises', field)}
            labels={{ unknown: t('unknown'), known: t('known'), notApplicable: t('notApplicable') }}
          />
          <StatefulStringList
            id="disliked-exercises"
            label={t('dislikedExercises')}
            placeholder={t('exerciseListPlaceholder')}
            field={draft.dislikedExercises}
            onChange={(field) => patch('dislikedExercises', field)}
            labels={{ unknown: t('unknown'), known: t('known'), notApplicable: t('notApplicable') }}
          />
          <div className="space-y-3">
            <div>
              <h4 className="text-sm font-medium">{t('outsideTitle')}</h4>
              <p className="text-xs text-muted-foreground">{t('outsideHelp')}</p>
            </div>
            <FieldStateSelect
              ariaLabel={t('outsideTitle')}
              value={draft.outsideActivities.state}
              allowNotApplicable
              onChange={(state) =>
                patch('outsideActivities', {
                  state,
                  value: state === 'KNOWN' ? (draft.outsideActivities.value ?? []) : null,
                })
              }
              labels={{
                unknown: t('unknown'),
                known: t('known'),
                notApplicable: t('notApplicable'),
              }}
            />
            {draft.outsideActivities.state === 'KNOWN' && (
              <div className="space-y-3">
                {(draft.outsideActivities.value ?? []).map((activity, index) => (
                  <div key={index} className="space-y-3 rounded-md border p-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label>{t('activityType')}</Label>
                        <Select
                          value={activity.type}
                          onValueChange={(type) => {
                            const activities = [...(draft.outsideActivities.value ?? [])];
                            activities[index] = {
                              ...activity,
                              type: type as CoachingOutsideActivity['type'],
                            };
                            patch('outsideActivities', { state: 'KNOWN', value: activities });
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ACTIVITY_TYPES.map((type) => (
                              <SelectItem key={type} value={type}>
                                {t(`activityTypes.${type}`)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor={`activity-name-${index}`}>{t('activityName')}</Label>
                        <Input
                          id={`activity-name-${index}`}
                          value={activity.name}
                          maxLength={120}
                          onChange={(event) => {
                            const activities = [...(draft.outsideActivities.value ?? [])];
                            activities[index] = { ...activity, name: event.target.value };
                            patch('outsideActivities', { state: 'KNOWN', value: activities });
                          }}
                        />
                      </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <NumberInput
                        id={`activity-sessions-${index}`}
                        label={t('sessionsPerWeek')}
                        value={activity.sessionsPerWeek ?? null}
                        min={0}
                        max={14}
                        onChange={(value) => {
                          const activities = [...(draft.outsideActivities.value ?? [])];
                          activities[index] = { ...activity, sessionsPerWeek: value };
                          patch('outsideActivities', { state: 'KNOWN', value: activities });
                        }}
                      />
                      <NumberInput
                        id={`activity-minutes-${index}`}
                        label={t('minutesPerWeek')}
                        value={activity.minutesPerWeek ?? null}
                        min={0}
                        max={3000}
                        onChange={(value) => {
                          const activities = [...(draft.outsideActivities.value ?? [])];
                          activities[index] = { ...activity, minutesPerWeek: value };
                          patch('outsideActivities', { state: 'KNOWN', value: activities });
                        }}
                      />
                      <div className="space-y-1.5">
                        <Label>{t('intensity')}</Label>
                        <Select
                          value={activity.intensity ?? 'UNKNOWN'}
                          onValueChange={(intensity) => {
                            const activities = [...(draft.outsideActivities.value ?? [])];
                            activities[index] = {
                              ...activity,
                              intensity:
                                intensity === 'UNKNOWN'
                                  ? null
                                  : (intensity as CoachingOutsideActivity['intensity']),
                            };
                            patch('outsideActivities', { state: 'KNOWN', value: activities });
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="UNKNOWN">{t('unknown')}</SelectItem>
                            {ACTIVITY_INTENSITIES.map((intensity) => (
                              <SelectItem key={intensity} value={intensity}>
                                {t(`intensities.${intensity}`)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`activity-details-${index}`}>{t('details')}</Label>
                      <Textarea
                        id={`activity-details-${index}`}
                        rows={2}
                        maxLength={500}
                        value={activity.details ?? ''}
                        placeholder={t('detailsPlaceholder')}
                        onChange={(event) => {
                          const activities = [...(draft.outsideActivities.value ?? [])];
                          activities[index] = {
                            ...activity,
                            details: event.target.value || null,
                          };
                          patch('outsideActivities', { state: 'KNOWN', value: activities });
                        }}
                      />
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        patch('outsideActivities', {
                          state: 'KNOWN',
                          value: (draft.outsideActivities.value ?? []).filter(
                            (_, itemIndex) => itemIndex !== index,
                          ),
                        })
                      }
                    >
                      <Trash2 className="mr-2 size-4" />
                      {t('removeActivity')}
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  disabled={(draft.outsideActivities.value?.length ?? 0) >= 20}
                  onClick={() =>
                    patch('outsideActivities', {
                      state: 'KNOWN',
                      value: [
                        ...(draft.outsideActivities.value ?? []),
                        {
                          type: 'CARDIO',
                          name: '',
                          sessionsPerWeek: null,
                          minutesPerWeek: null,
                          intensity: null,
                          details: null,
                        },
                      ],
                    })
                  }
                >
                  <Plus className="mr-2 size-4" />
                  {t('addActivity')}
                </Button>
              </div>
            )}
          </div>
          <SaveRow
            label={t('savePreferences')}
            pending={pending === 'preferences'}
            error={errors.preferences}
            errorMessage={t('saveError')}
            retryLabel={t('retry')}
            disabled={
              (draft.priorityMuscles.state === 'KNOWN' && !draft.priorityMuscles.value?.length) ||
              (draft.priorityStrengthMovements.state === 'KNOWN' &&
                !draft.priorityStrengthMovements.value?.length) ||
              (draft.likedExercises.state === 'KNOWN' && !draft.likedExercises.value?.length) ||
              (draft.dislikedExercises.state === 'KNOWN' &&
                !draft.dislikedExercises.value?.length) ||
              (draft.outsideActivities.state === 'KNOWN' &&
                (!draft.outsideActivities.value?.length ||
                  draft.outsideActivities.value.some((activity) => !activity.name.trim())))
            }
            onSave={() =>
              void saveSection('preferences', {
                priorityMuscles: fieldInput(draft.priorityMuscles),
                priorityStrengthMovements: fieldInput(draft.priorityStrengthMovements),
                likedExercises: fieldInput(draft.likedExercises),
                dislikedExercises: fieldInput(draft.dislikedExercises),
                outsideActivities: fieldInput(draft.outsideActivities),
              })
            }
          />
        </section>

        <section className="space-y-4 border-t pt-6" aria-labelledby="coaching-recovery-title">
          <div>
            <h3 id="coaching-recovery-title" className="font-medium">
              {t('recoveryTitle')}
            </h3>
            <p className="text-xs text-muted-foreground">{t('recoveryHelp')}</p>
          </div>
          <StatefulNumber
            id="average-sleep-hours"
            label={t('averageSleep')}
            field={draft.averageSleepHours}
            min={0}
            max={24}
            step={0.25}
            onChange={(field) => patch('averageSleepHours', field)}
            labels={{ unknown: t('unknown'), known: t('known'), notApplicable: t('notApplicable') }}
          />
          <StatefulRating
            id="baseline-stress"
            label={t('baselineStress')}
            field={draft.baselineStress}
            onChange={(field) => patch('baselineStress', field)}
            labels={{ unknown: t('unknown'), known: t('known'), notApplicable: t('notApplicable') }}
          />
          <StatefulRating
            id="general-recovery"
            label={t('generalRecovery')}
            field={draft.generalRecovery}
            onChange={(field) => patch('generalRecovery', field)}
            labels={{ unknown: t('unknown'), known: t('known'), notApplicable: t('notApplicable') }}
          />
          <SaveRow
            label={t('saveRecovery')}
            pending={pending === 'recovery'}
            error={errors.recovery}
            errorMessage={t('saveError')}
            retryLabel={t('retry')}
            onSave={() =>
              void saveSection('recovery', {
                averageSleepHours: fieldInput(draft.averageSleepHours),
                baselineStress: fieldInput(draft.baselineStress),
                generalRecovery: fieldInput(draft.generalRecovery),
              })
            }
          />
        </section>
      </CardContent>
    </Card>
  );
}

function FieldStateSelect({
  value,
  onChange,
  allowNotApplicable = false,
  ariaLabel,
  labels,
}: {
  value: CoachingFieldState;
  onChange: (value: CoachingFieldState) => void;
  allowNotApplicable?: boolean;
  ariaLabel?: string;
  labels: { unknown: string; known: string; notApplicable?: string };
}) {
  return (
    <Select value={value} onValueChange={(state) => onChange(state as CoachingFieldState)}>
      <SelectTrigger className="w-full max-w-64" aria-label={ariaLabel ?? labels.known}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="UNKNOWN">{labels.unknown}</SelectItem>
        <SelectItem value="KNOWN">{labels.known}</SelectItem>
        {allowNotApplicable && (
          <SelectItem value="NOT_APPLICABLE">{labels.notApplicable}</SelectItem>
        )}
      </SelectContent>
    </Select>
  );
}

function StatefulStringList({
  id,
  label,
  placeholder,
  field,
  onChange,
  labels,
}: {
  id: string;
  label: string;
  placeholder: string;
  field: FieldDraft<string[]>;
  onChange: (field: FieldDraft<string[]>) => void;
  labels: { unknown: string; known: string; notApplicable: string };
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        <FieldStateSelect
          ariaLabel={label}
          value={field.state}
          allowNotApplicable
          onChange={(state) =>
            onChange({ state, value: state === 'KNOWN' ? (field.value ?? []) : null })
          }
          labels={labels}
        />
      </div>
      {field.state === 'KNOWN' && (
        <Input
          id={id}
          value={field.value?.join(', ') ?? ''}
          placeholder={placeholder}
          onChange={(event) => onChange({ state: 'KNOWN', value: commaValues(event.target.value) })}
        />
      )}
    </div>
  );
}

function StatefulNumber({
  id,
  label,
  field,
  min,
  max,
  step,
  onChange,
  labels,
}: {
  id: string;
  label: string;
  field: FieldDraft<number>;
  min: number;
  max: number;
  step: number;
  onChange: (field: FieldDraft<number>) => void;
  labels: { unknown: string; known: string; notApplicable: string };
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        <FieldStateSelect
          ariaLabel={label}
          value={field.state}
          allowNotApplicable
          onChange={(state) =>
            onChange({ state, value: state === 'KNOWN' ? (field.value ?? min) : null })
          }
          labels={labels}
        />
      </div>
      {field.state === 'KNOWN' && (
        <Input
          id={id}
          type="number"
          min={min}
          max={max}
          step={step}
          value={field.value ?? ''}
          onChange={(event) =>
            onChange({
              state: 'KNOWN',
              value: event.target.value ? Number(event.target.value) : null,
            })
          }
          className="max-w-40"
        />
      )}
    </div>
  );
}

function StatefulRating({
  id,
  label,
  field,
  onChange,
  labels,
}: {
  id: string;
  label: string;
  field: FieldDraft<number>;
  onChange: (field: FieldDraft<number>) => void;
  labels: { unknown: string; known: string; notApplicable: string };
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        <FieldStateSelect
          ariaLabel={label}
          value={field.state}
          allowNotApplicable
          onChange={(state) =>
            onChange({ state, value: state === 'KNOWN' ? (field.value ?? 3) : null })
          }
          labels={labels}
        />
      </div>
      {field.state === 'KNOWN' && (
        <Select
          value={String(field.value ?? 3)}
          onValueChange={(value) => onChange({ state: 'KNOWN', value: Number(value) })}
        >
          <SelectTrigger id={id} className="max-w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[1, 2, 3, 4, 5].map((value) => (
              <SelectItem key={value} value={String(value)}>
                {value}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

function NumberInput({
  id,
  label,
  value,
  min,
  max,
  onChange,
}: {
  id: string;
  label: string;
  value: number | null;
  min: number;
  max: number;
  onChange: (value: number | null) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        min={min}
        max={max}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value ? Number(event.target.value) : null)}
      />
    </div>
  );
}

function SaveRow({
  label,
  pending,
  error,
  errorMessage,
  retryLabel,
  disabled = false,
  onSave,
}: {
  label: string;
  pending: boolean;
  error?: boolean;
  errorMessage: string;
  retryLabel: string;
  disabled?: boolean;
  onSave: () => void;
}) {
  return (
    <div className="space-y-2">
      <Button type="button" onClick={onSave} disabled={pending || disabled} className="min-h-tap">
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
        <span className="ml-2">{error ? retryLabel : label}</span>
      </Button>
      {error && (
        <p role="alert" className="text-sm text-rose-600">
          {errorMessage}
        </p>
      )}
    </div>
  );
}
