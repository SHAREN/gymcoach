'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Loader2, Sparkles, Trash2, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import type { GeneratedProgram } from '@/lib/schemas/program-generation';
import type {
  ProgramDesignAnswers,
  ProgramHealthStatus,
  ProgramDesignMode,
  TrainingExperience,
} from '@/lib/schemas/program-design';
import type { ProgramDesignQuestion } from '@/lib/program-design-context';
import type { ProgramDesignValidation } from '@/lib/program-design-validation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
import { muscleGroupMessageKeys } from '@/i18n/enum-keys';

type Draft = GeneratedProgram;

type GenerationResponse =
  | {
      status: 'needs-input';
      questions: ProgramDesignQuestion[];
      methodologyVersion: string;
      sourceProgramId: string | null;
    }
  | {
      status: 'generated';
      program: Draft;
      validation: ProgramDesignValidation;
      methodologyVersion: string;
      sourceProgramId: string | null;
    };

export function ProgramGenerator() {
  const t = useTranslations('programs');
  const common = useTranslations('common');
  const exerciseT = useTranslations('exercises');
  const router = useRouter();
  const [goal, setGoal] = useState('');
  const [mode, setMode] = useState<ProgramDesignMode>('NEW_PROGRAM');
  const [answers, setAnswers] = useState<ProgramDesignAnswers>({});
  const [questions, setQuestions] = useState<ProgramDesignQuestion[]>([]);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [validation, setValidation] = useState<ProgramDesignValidation | null>(null);
  const [methodologyVersion, setMethodologyVersion] = useState<string | null>(null);
  const [sourceProgramId, setSourceProgramId] = useState<string | null>(null);

  async function generate() {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch('/api/programs/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal, mode, answers }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `Error ${res.status}`);
      }
      const j = (await res.json()) as GenerationResponse;
      setMethodologyVersion(j.methodologyVersion);
      setSourceProgramId(j.sourceProgramId);
      if (j.status === 'needs-input') {
        setQuestions(j.questions);
        setDraft(null);
        setValidation(null);
        return;
      }
      setQuestions([]);
      setDraft(j.program);
      setValidation(j.validation);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('generator.generationError'));
    } finally {
      setGenerating(false);
    }
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/programs/build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          program: draft,
          goal,
          mode,
          answers,
          sourceProgramId,
          methodologyVersion,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `Error ${res.status}`);
      }
      const j = (await res.json()) as { id: string };
      toast.success(t('created'));
      router.push(`/programs/${j.id}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('generator.saveError'));
      setSaving(false);
    }
  }

  function patchProgram(patch: Partial<Draft>) {
    setValidation(null);
    setDraft((d) => (d ? { ...d, ...patch } : d));
  }

  function patchWorkout(wi: number, patch: Partial<Draft['workouts'][number]>) {
    setValidation(null);
    setDraft((d) =>
      d ? { ...d, workouts: d.workouts.map((w, i) => (i === wi ? { ...w, ...patch } : w)) } : d,
    );
  }

  function patchExercise(
    wi: number,
    ei: number,
    patch: Partial<Draft['workouts'][number]['exercises'][number]>,
  ) {
    setValidation(null);
    setDraft((d) => {
      if (!d) return d;
      const workouts = d.workouts.map((w, i) =>
        i !== wi
          ? w
          : { ...w, exercises: w.exercises.map((e, j) => (j === ei ? { ...e, ...patch } : e)) },
      );
      return { ...d, workouts };
    });
  }

  function removeExercise(wi: number, ei: number) {
    setValidation(null);
    setDraft((d) => {
      if (!d) return d;
      const workouts = d.workouts.map((w, i) =>
        i !== wi ? w : { ...w, exercises: w.exercises.filter((_, j) => j !== ei) },
      );
      return { ...d, workouts: workouts.filter((w) => w.exercises.length > 0) };
    });
  }

  function removeWorkout(wi: number) {
    setValidation(null);
    setDraft((d) => (d ? { ...d, workouts: d.workouts.filter((_, i) => i !== wi) } : d));
  }

  const num = (v: string) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const hasValidationErrors =
    validation?.issues.some((issue) => issue.severity === 'error') ?? false;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Wand2 className="size-5" />
            <h2 className="text-base font-semibold">{t('generator.title')}</h2>
          </div>
          <p className="text-xs text-muted-foreground">{t('generator.description')}</p>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="space-y-1.5">
            <Label className="text-sm">{t('generator.mode')}</Label>
            <Select
              value={mode}
              onValueChange={(value) => {
                setMode(value as ProgramDesignMode);
                setDraft(null);
                setValidation(null);
                setQuestions([]);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NEW_PROGRAM">{t('generator.modeNew')}</SelectItem>
                <SelectItem value="NEXT_MESOCYCLE">{t('generator.modeNext')}</SelectItem>
                <SelectItem value="REVISE_CURRENT">{t('generator.modeRevise')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Textarea
            value={goal}
            onChange={(e) => {
              setGoal(e.target.value);
              setValidation(null);
            }}
            rows={4}
            placeholder={t('generator.placeholder')}
          />
          <div>
            <Button
              type="button"
              onClick={generate}
              disabled={generating || goal.trim().length < 10}
              className="min-h-tap"
            >
              {generating ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  <span className="ml-2">{t('generator.generating')}</span>
                </>
              ) : (
                <>
                  <Sparkles className="size-4" />
                  <span className="ml-2">{common('actions.generate')}</span>
                </>
              )}
            </Button>
          </div>
          {error && <p className="text-sm text-rose-600">{error}</p>}
          {questions.length > 0 && (
            <div className="space-y-3 border-t pt-3">
              <div>
                <p className="text-sm font-medium">{t('generator.questionsTitle')}</p>
                <p className="text-xs text-muted-foreground">
                  {t('generator.questionsDescription')}
                </p>
              </div>
              {questions.map((question) => (
                <ProgramDesignQuestionField
                  key={question.id}
                  question={question}
                  answers={answers}
                  onChange={setAnswers}
                  labels={{
                    healthStatus: t('generator.healthStatus'),
                    healthNoConcerns: t('generator.healthNoConcerns'),
                    healthClearedLimitations: t('generator.healthClearedLimitations'),
                    healthNeedsClearance: t('generator.healthNeedsClearance'),
                    trainingExperience: t('generator.trainingExperience'),
                    beginner: t('generator.experienceBeginner'),
                    intermediate: t('generator.experienceIntermediate'),
                    advanced: t('generator.experienceAdvanced'),
                    weeklyFrequency: t('generator.weeklyFrequency'),
                    availableDays: t('generator.availableDays'),
                    monday: t('generator.monday'),
                    tuesday: t('generator.tuesday'),
                    wednesday: t('generator.wednesday'),
                    thursday: t('generator.thursday'),
                    friday: t('generator.friday'),
                    saturday: t('generator.saturday'),
                    sunday: t('generator.sunday'),
                    sessionDuration: t('generator.sessionDuration'),
                    limitations: t('generator.limitations'),
                    limitationsPlaceholder: t('generator.limitationsPlaceholder'),
                    equipmentAccess: t('generator.equipmentAccess'),
                    equipmentAccessPlaceholder: t('generator.equipmentAccessPlaceholder'),
                    postBlockAssessment: t('generator.postBlockAssessment'),
                    postBlockNoIssues: t('generator.postBlockNoIssues'),
                    postBlockDreading: t('generator.postBlockDreading'),
                    postBlockSleep: t('generator.postBlockSleep'),
                    postBlockPerformance: t('generator.postBlockPerformance'),
                    postBlockStress: t('generator.postBlockStress'),
                    postBlockAches: t('generator.postBlockAches'),
                  }}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {draft && (
        <Card>
          <CardHeader className="pb-3">
            <h2 className="text-base font-semibold">{t('generator.review')}</h2>
            <p className="text-xs text-muted-foreground">{t('generator.reviewDescription')}</p>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            {validation && validation.issues.length > 0 && (
              <div className="space-y-2 border-b pb-4">
                <p className="text-sm font-medium">{t('generator.validationTitle')}</p>
                <ul className="space-y-1 text-xs">
                  {validation.issues.map((issue, index) => (
                    <li
                      key={`${issue.code}-${index}`}
                      className={issue.severity === 'error' ? 'text-rose-600' : 'text-amber-700'}
                    >
                      {issue.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-sm">{t('programName')}</Label>
                <Input
                  value={draft.name}
                  onChange={(e) => patchProgram({ name: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">{t('phase')}</Label>
                <Input
                  value={draft.phase}
                  onChange={(e) => patchProgram({ phase: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">{common('fields.description')}</Label>
              <Textarea
                value={draft.description ?? ''}
                rows={2}
                onChange={(e) => patchProgram({ description: e.target.value })}
              />
            </div>

            {draft.workouts.map((w, wi) => (
              <div key={wi} className="rounded-lg border p-3">
                <div className="mb-3 flex items-center gap-2">
                  <Input
                    value={w.name}
                    onChange={(e) => patchWorkout(wi, { name: e.target.value })}
                    className="font-medium"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeWorkout(wi)}
                    aria-label={t('generator.removeWorkout')}
                  >
                    <Trash2 className="size-4 text-rose-600" />
                  </Button>
                </div>

                <ul className="flex flex-col gap-3">
                  {w.exercises.map((ex, ei) => (
                    <li key={ei} className="rounded-md bg-muted/40 p-2">
                      <div className="mb-2 flex items-center gap-2">
                        <Input
                          value={ex.name}
                          onChange={(e) => patchExercise(wi, ei, { name: e.target.value })}
                          className="h-8 text-sm"
                        />
                        <Badge variant="secondary" className="shrink-0 text-[10px]">
                          {exerciseT(`muscleGroups.${muscleGroupMessageKeys[ex.muscleGroup]}`)}
                        </Badge>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeExercise(wi, ei)}
                          aria-label={t('generator.removeExercise')}
                        >
                          <Trash2 className="size-4 text-rose-600" />
                        </Button>
                      </div>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
                        <NumField
                          label={t('exercise.sets')}
                          value={ex.targetSets}
                          onChange={(v) => patchExercise(wi, ei, { targetSets: num(v) })}
                        />
                        <NumField
                          label={t('exercise.dropSets')}
                          value={ex.targetDropSets ?? 0}
                          onChange={(v) => patchExercise(wi, ei, { targetDropSets: num(v) })}
                        />
                        <NumField
                          label={t('exercise.repsMin')}
                          value={ex.targetRepsMin}
                          onChange={(v) => patchExercise(wi, ei, { targetRepsMin: num(v) })}
                        />
                        <NumField
                          label={t('exercise.repsMax')}
                          value={ex.targetRepsMax}
                          onChange={(v) => patchExercise(wi, ei, { targetRepsMax: num(v) })}
                        />
                        <NumField
                          label="RIR"
                          value={ex.targetRIR}
                          onChange={(v) => patchExercise(wi, ei, { targetRIR: num(v) })}
                        />
                        <NumField
                          label={t('exercise.rest')}
                          value={ex.restSec}
                          onChange={(v) => patchExercise(wi, ei, { restSec: num(v) })}
                        />
                      </div>
                      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                        <div className="space-y-1">
                          <Label className="text-[11px] text-muted-foreground">
                            {t('exercise.autoregulationMode')}
                          </Label>
                          <Select
                            value={ex.autoregulationMode ?? 'PRESERVE_RIR'}
                            onValueChange={(value) =>
                              patchExercise(wi, ei, {
                                autoregulationMode: value as 'PRESERVE_RIR' | 'PRESERVE_REPS',
                              })
                            }
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="PRESERVE_RIR">
                                {t('exercise.preserveRir')}
                              </SelectItem>
                              <SelectItem value="PRESERVE_REPS">
                                {t('exercise.preserveReps')}
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <OptionalNumField
                          label={t('exercise.fatigueRate')}
                          value={ex.fatigueRate}
                          onChange={(value) => patchExercise(wi, ei, { fatigueRate: value })}
                        />
                        <OptionalNumField
                          label={t('exercise.loadAdjustment')}
                          value={ex.loadAdjustmentPct}
                          onChange={(value) => patchExercise(wi, ei, { loadAdjustmentPct: value })}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}

            <div>
              <Button
                type="button"
                onClick={save}
                disabled={saving || draft.workouts.length === 0 || hasValidationErrors}
                className="min-h-tap"
              >
                {saving ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Sparkles className="size-4" />
                )}
                <span className="ml-2">{t('createProgram')}</span>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ProgramDesignQuestionField({
  question,
  answers,
  onChange,
  labels,
}: {
  question: ProgramDesignQuestion;
  answers: ProgramDesignAnswers;
  onChange: (answers: ProgramDesignAnswers) => void;
  labels: {
    healthStatus: string;
    healthNoConcerns: string;
    healthClearedLimitations: string;
    healthNeedsClearance: string;
    trainingExperience: string;
    beginner: string;
    intermediate: string;
    advanced: string;
    weeklyFrequency: string;
    availableDays: string;
    monday: string;
    tuesday: string;
    wednesday: string;
    thursday: string;
    friday: string;
    saturday: string;
    sunday: string;
    sessionDuration: string;
    limitations: string;
    limitationsPlaceholder: string;
    equipmentAccess: string;
    equipmentAccessPlaceholder: string;
    postBlockAssessment: string;
    postBlockNoIssues: string;
    postBlockDreading: string;
    postBlockSleep: string;
    postBlockPerformance: string;
    postBlockStress: string;
    postBlockAches: string;
  };
}) {
  if (question.id === 'healthStatus') {
    return (
      <div className="space-y-1.5">
        <Label>{labels.healthStatus}</Label>
        <Select
          value={answers.healthStatus}
          onValueChange={(value) =>
            onChange({ ...answers, healthStatus: value as ProgramHealthStatus })
          }
        >
          <SelectTrigger>
            <SelectValue placeholder={labels.healthStatus} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="NO_SIGNIFICANT_ISSUES">{labels.healthNoConcerns}</SelectItem>
            <SelectItem value="TRAIN_WITH_LIMITATIONS">
              {labels.healthClearedLimitations}
            </SelectItem>
            <SelectItem value="MEDICAL_CLEARANCE_REQUIRED">
              {labels.healthNeedsClearance}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
    );
  }

  if (question.id === 'trainingExperience') {
    return (
      <div className="space-y-1.5">
        <Label>{labels.trainingExperience}</Label>
        <Select
          value={answers.trainingExperience}
          onValueChange={(value) =>
            onChange({ ...answers, trainingExperience: value as TrainingExperience })
          }
        >
          <SelectTrigger>
            <SelectValue placeholder={labels.trainingExperience} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="BEGINNER">{labels.beginner}</SelectItem>
            <SelectItem value="INTERMEDIATE">{labels.intermediate}</SelectItem>
            <SelectItem value="ADVANCED">{labels.advanced}</SelectItem>
          </SelectContent>
        </Select>
      </div>
    );
  }
  if (question.id === 'sessionDurationMin') {
    return (
      <div className="space-y-1.5">
        <Label htmlFor="program-session-duration">{labels.sessionDuration}</Label>
        <Input
          id="program-session-duration"
          type="number"
          min={question.min}
          max={question.max}
          value={answers.sessionDurationMin ?? ''}
          onChange={(event) =>
            onChange({
              ...answers,
              sessionDurationMin: event.target.value ? Number(event.target.value) : undefined,
            })
          }
        />
      </div>
    );
  }
  if (question.id === 'weeklyFrequency') {
    return (
      <div className="space-y-1.5">
        <Label htmlFor="program-weekly-frequency">{labels.weeklyFrequency}</Label>
        <Input
          id="program-weekly-frequency"
          type="number"
          min={question.min}
          max={question.max}
          value={answers.weeklyFrequency ?? ''}
          onChange={(event) =>
            onChange({
              ...answers,
              weeklyFrequency: event.target.value ? Number(event.target.value) : undefined,
            })
          }
        />
      </div>
    );
  }
  if (question.id === 'availableDays') {
    const days = [
      [1, labels.monday],
      [2, labels.tuesday],
      [3, labels.wednesday],
      [4, labels.thursday],
      [5, labels.friday],
      [6, labels.saturday],
      [7, labels.sunday],
    ] as const;
    return (
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{labels.availableDays}</legend>
        {days.map(([day, label]) => (
          <label key={day} className="flex min-h-tap items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={answers.availableDays?.includes(day) ?? false}
              onChange={(event) =>
                onChange({
                  ...answers,
                  availableDays: event.target.checked
                    ? [...(answers.availableDays ?? []), day].sort((a, b) => a - b)
                    : answers.availableDays?.filter((value) => value !== day),
                })
              }
              className="h-4 w-4"
            />
            <span>{label}</span>
          </label>
        ))}
      </fieldset>
    );
  }

  if (question.id === 'equipmentAccess') {
    return (
      <div className="space-y-1.5">
        <Label htmlFor="program-equipment-access">{labels.equipmentAccess}</Label>
        <Textarea
          id="program-equipment-access"
          rows={2}
          value={answers.equipmentAccess ?? ''}
          placeholder={labels.equipmentAccessPlaceholder}
          onChange={(event) => onChange({ ...answers, equipmentAccess: event.target.value })}
        />
      </div>
    );
  }
  if (question.id === 'postBlockAssessment') {
    const values = answers.postBlockAssessment;
    const options = [
      ['dreadingTraining', labels.postBlockDreading],
      ['sleepWorse', labels.postBlockSleep],
      ['performanceDecreasing', labels.postBlockPerformance],
      ['lifeStressHigher', labels.postBlockStress],
      ['achesAndPainsWorse', labels.postBlockAches],
    ] as const;
    const emptyAssessment = {
      dreadingTraining: false,
      sleepWorse: false,
      performanceDecreasing: false,
      lifeStressHigher: false,
      achesAndPainsWorse: false,
    };
    const noIssues = values != null && !Object.values(values).some(Boolean);
    return (
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{labels.postBlockAssessment}</legend>
        {options.map(([key, label]) => (
          <label key={key} className="flex min-h-tap items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={values?.[key] ?? false}
              onChange={(event) =>
                onChange({
                  ...answers,
                  postBlockAssessment: {
                    ...(values ?? emptyAssessment),
                    [key]: event.target.checked,
                  },
                })
              }
              className="h-4 w-4"
            />
            <span>{label}</span>
          </label>
        ))}
        <label className="flex min-h-tap items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={noIssues}
            onChange={(event) =>
              onChange({
                ...answers,
                postBlockAssessment: event.target.checked ? emptyAssessment : undefined,
              })
            }
            className="h-4 w-4"
          />
          <span>{labels.postBlockNoIssues}</span>
        </label>
      </fieldset>
    );
  }
  return (
    <div className="space-y-1.5">
      <Label htmlFor="program-limitations">{labels.limitations}</Label>
      <Textarea
        id="program-limitations"
        rows={2}
        value={answers.limitations ?? ''}
        placeholder={labels.limitationsPlaceholder}
        onChange={(event) => onChange({ ...answers, limitations: event.target.value })}
      />
    </div>
  );
}

function NumField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      <Input
        type="number"
        inputMode="numeric"
        value={String(value)}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 text-sm"
      />
    </div>
  );
}

function OptionalNumField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      <Input
        type="number"
        inputMode="decimal"
        value={value ?? ''}
        onChange={(event) => {
          const next = event.target.value;
          onChange(next === '' ? undefined : Number(next));
        }}
        className="h-8 text-sm"
      />
    </div>
  );
}
