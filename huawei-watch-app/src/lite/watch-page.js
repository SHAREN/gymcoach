import { WatchCompanion } from '../core/companion.js';
import { labels } from '../core/i18n.js';
import { createVolatileStorageBackend, WatchStateRepository } from '../core/storage.js';
import { createUnavailableTransport } from '../core/transport.js';
import {
  completedSetsForExercise,
  currentExercise,
} from '../core/workout-state.js';
import {
  summarizeExercise,
  summarizeWorkout,
} from '../core/workout-summary.js';
import {
  createSummarySelection,
  moveSummaryExercise,
  selectSummaryWorkout as updateSummarySelection,
  selectedSummaryExercise,
} from '../core/summary-navigation.js';

const platform = globalThis.__gymCoachWatchPlatform || {};
const repository = new WatchStateRepository(
  platform.storageBackend || createVolatileStorageBackend(),
);
const companion = new WatchCompanion({
  deviceId: platform.deviceId || 'watch-unconfigured',
  repository,
  transport:
    platform.transport ||
    createUnavailableTransport('Official Wear Engine adapter is not configured.'),
});

let latestState = companion.getState();
let screen = 'home';
let locale = 'ru';
let draftExerciseSessionId = null;
let draftWeight = 0;
let draftReps = 1;
let draftRir = 2;
let summarySelection = createSummarySelection();
let pageVisible = false;
let timerHandle = null;

function renderPage() {
  const text = labels(locale);
  const activeWorkout = latestState.activeWorkout;
  const hasWorkout = activeWorkout !== null && activeWorkout.session.status !== 'FINISHED';
  const lastWorkout =
    latestState.lastWorkout ||
    (activeWorkout?.session.status === 'FINISHED' ? activeWorkout : null);
  const hasLastWorkout = lastWorkout !== null;
  const exercise = hasWorkout ? currentExercise(activeWorkout) : null;
  syncDraft(activeWorkout, exercise);
  const completed = exercise
    ? completedSetsForExercise(activeWorkout, exercise.exerciseSessionId).length
    : 0;
  const setNumber = activeWorkout?.pendingSet?.setNumber || completed + 1;
  const targetSets = exercise?.targetSets || 0;
  const timer = companion.timerState(Date.now());
  const restSummary = timer.restSummary;
  const summarySource = findSummaryWorkout(activeWorkout, lastWorkout);
  const summaryExercise = findSummaryExercise(summarySource);
  const exerciseSummary = summaryExercise
    ? summarizeExercise(summarySource, summaryExercise.exerciseSessionId)
    : null;
  const workoutSummary = summarizeWorkout(summarySource, Date.now());
  const lastWorkoutSummary = summarizeWorkout(lastWorkout, Date.now());
  const connectionLabels = {
    connected: text.connected,
    connecting: text.connecting,
    disconnected: text.offline,
    error: text.error,
  };
  const syncLabels = {
    idle: text.waiting,
    requesting: text.syncing,
    synced: text.synced,
    error: text.error,
  };

  return {
    showHome: screen === 'home',
    showWorkout: screen === 'workout',
    showSetEntry: screen === 'set',
    showRest: screen === 'rest',
    showExerciseSummary: screen === 'exerciseSummary',
    showWorkoutSummary: screen === 'workoutSummary',
    showDiagnostics: screen === 'diagnostics',
    hasWorkout,
    noWorkout: !hasWorkout,
    hasLastWorkout,
    noLastWorkout: !hasLastWorkout,
    hasLastError: latestState.lastErrorCode !== null,
    noLastError: latestState.lastErrorCode === null,
    showStartSet:
      hasWorkout && activeWorkout.session.status !== 'PAUSED' && activeWorkout.activeSetId === null,
    showCompleteSet:
      hasWorkout && activeWorkout.session.status !== 'PAUSED' && activeWorkout.pendingSet !== null,
    showRemoteActiveSet:
      hasWorkout && activeWorkout.activeSetId !== null && activeWorkout.pendingSet === null,
    showExerciseNavigation:
      hasWorkout &&
      activeWorkout.session.status !== 'PAUSED' &&
      activeWorkout.pendingSet === null &&
      activeWorkout.rest === null,
    showPauseButton: hasWorkout,
    showLastSetActions: completed > 0,
    connectionTone: latestState.connection,
    connectionLabel: connectionLabels[latestState.connection] || text.offline,
    syncStatusLabel: syncLabels[latestState.syncStatus] || text.waiting,
    pendingCount: String(latestState.pendingCount),
    languageButton: locale === 'ru' ? 'EN' : 'RU',
    activeWorkoutLabel: text.activeWorkout,
    lastWorkoutLabel: text.lastWorkout,
    noLastWorkoutLabel: text.noLastWorkout,
    exerciseSummaryLabel: text.exerciseSummary,
    workoutSummaryLabel: text.workoutSummary,
    diagnosticsLabel: text.diagnostics,
    phoneConnectionLabel: text.phoneConnection,
    currentHrLabel: text.currentHr,
    currentHeartRate:
      latestState.currentHeartRate === null
        ? text.noHr
        : `${latestState.currentHeartRate} BPM`,
    noWorkoutLabel: text.noWorkout,
    waitingLabel: text.waiting,
    openLabel: text.open,
    durationLabel: text.duration,
    pingLabel: text.ping,
    syncLabel: text.sync,
    pendingLabel: text.pending,
    protocolLabel: text.protocol,
    conflictsLabel: text.conflicts,
    lastSyncLabel: text.lastSync,
    lastErrorLabel: text.lastError,
    noErrorsLabel: text.noErrors,
    backLabel: text.back,
    setLabel: text.set,
    targetLabel: text.target,
    previousLabel: text.previous,
    nextLabel: text.next,
    editSetLabel: text.editSet,
    startSetLabel: text.startSet,
    completeSetLabel: text.completeSet,
    correctLastSetLabel: text.correctLastSet,
    deleteLastSetLabel: text.deleteLastSet,
    activeSetOnPhoneLabel: text.activeSetOnPhone,
    weightLabel: text.weight,
    repsLabel: text.reps,
    rirLabel: text.rir,
    restLabel: text.rest,
    restMinimumLabel: text.restMinimum,
    restAverageLabel: text.restAverage,
    restAt30Label: text.restAt30,
    restAt60Label: text.restAt60,
    skipLabel: text.skip,
    add15Label: text.add15,
    add30Label: text.add30,
    pauseResumeLabel:
      activeWorkout?.session.status === 'PAUSED' || timer.rest.paused
        ? text.resume
        : text.pause,
    exerciseName: exercise?.exerciseName || text.noWorkout,
    setProgress: `${setNumber} / ${targetSets}`,
    targetSummary: exercise
      ? `${exercise.targetReps} ${text.reps.toLowerCase()} · RIR ${exercise.targetRir}`
      : '-',
    elapsed: formatElapsed(timer.workoutElapsedMs),
    setElapsed: formatElapsed(timer.setElapsedMs),
    restCountdown: formatCountdown(timer.rest.remainingSeconds),
    restMinimum: formatHeartRate(restSummary?.min),
    restAverage: formatHeartRate(restSummary?.average),
    restAt30: formatHeartRate(restSummary?.at30Seconds),
    restAt60: formatHeartRate(restSummary?.at60Seconds),
    draftWeight: formatWeight(draftWeight),
    draftReps: String(draftReps),
    draftRir: String(draftRir),
    lastWorkoutSets: lastWorkoutSummary
      ? `${text.finishedSets}: ${lastWorkoutSummary.setCount}`
      : text.noLastWorkout,
    lastWorkoutDuration: lastWorkoutSummary
      ? `${text.duration}: ${formatElapsed(lastWorkoutSummary.durationMs)}`
      : '-',
    lastWorkoutFinishedAt: lastWorkout
      ? formatTimestamp(lastWorkout.session.finishedAt || lastWorkout.session.updatedAt)
      : text.notYet,
    summaryExerciseName: exerciseSummary?.exercise.exerciseName || text.noWorkout,
    summarySetCount: formatSummaryValue(exerciseSummary?.setCount),
    summaryVolume: formatVolume(exerciseSummary?.totalVolume),
    summaryAverageRir: formatSummaryNumber(exerciseSummary?.averageRir),
    summaryMaximumHeartRate: formatHeartRate(exerciseSummary?.maximumHeartRate),
    summaryAverageHeartRate: formatHeartRate(exerciseSummary?.averageSetHeartRate),
    summaryRecovery60: formatHeartRateDrop(exerciseSummary?.averageRecovery60),
    workoutExerciseCount: formatSummaryValue(workoutSummary?.exerciseCount),
    workoutSetCount: formatSummaryValue(workoutSummary?.setCount),
    workoutVolume: formatVolume(workoutSummary?.totalVolume),
    workoutAverageRir: formatSummaryNumber(workoutSummary?.averageRir),
    workoutMaximumHeartRate: formatHeartRate(workoutSummary?.maximumHeartRate),
    workoutAverageHeartRate: formatHeartRate(workoutSummary?.averageSetHeartRate),
    workoutAverageRestHeartRate: formatHeartRate(workoutSummary?.averageRestHeartRate),
    workoutRecovery60: formatHeartRateDrop(workoutSummary?.averageRecovery60),
    workoutSummaryDuration: workoutSummary
      ? formatElapsed(workoutSummary.durationMs)
      : '00:00',
    finishedSetsLabel: text.finishedSets,
    exerciseCountLabel: text.exerciseCount,
    totalVolumeLabel: text.totalVolume,
    averageRirLabel: text.averageRir,
    maximumHrLabel: text.maximumHr,
    averageHrLabel: text.averageHr,
    averageRestHrLabel: text.averageRestHr,
    recovery60Label: text.recovery60,
    summarySyncStatus: `${syncLabels[latestState.syncStatus] || text.waiting} · ${
      text.pending
    } ${latestState.pendingCount}`,
    diagnosticConnection: connectionLabels[latestState.connection] || text.offline,
    diagnosticSync: syncLabels[latestState.syncStatus] || text.waiting,
    diagnosticProtocol: latestState.protocolVersion,
    diagnosticPending: String(latestState.pendingCount),
    diagnosticConflicts: String(latestState.conflictCount),
    diagnosticLastSync: formatTimestamp(latestState.lastSyncAt) || text.notYet,
    diagnosticLastError: latestState.lastErrorCode || text.noErrors,
  };
}

function findSummaryWorkout(activeWorkout, lastWorkout) {
  if (summarySelection.workoutSessionId === null) {
    return activeWorkout || lastWorkout;
  }
  if (activeWorkout?.session.sessionId === summarySelection.workoutSessionId) {
    return activeWorkout;
  }
  if (lastWorkout?.session.sessionId === summarySelection.workoutSessionId) {
    return lastWorkout;
  }
  return activeWorkout || lastWorkout;
}

function findSummaryExercise(workout) {
  return selectedSummaryExercise(workout, summarySelection);
}

function syncDraft(activeWorkout, exercise) {
  if (!activeWorkout || !exercise || draftExerciseSessionId === exercise.exerciseSessionId) {
    return;
  }
  const previousSets = completedSetsForExercise(activeWorkout, exercise.exerciseSessionId);
  const previous = previousSets[previousSets.length - 1];
  draftExerciseSessionId = exercise.exerciseSessionId;
  draftWeight = previous?.weight || 0;
  draftReps = previous?.reps || Math.max(1, exercise.targetReps);
  draftRir = previous?.rir ?? exercise.targetRir;
}

function formatElapsed(elapsedMs) {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
    return '00:00';
  }
  const seconds = Math.floor(elapsedMs / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remaining = seconds % 60;
  if (hours > 0) {
    return `${hours}:${pad(minutes)}:${pad(remaining)}`;
  }
  return `${pad(minutes)}:${pad(remaining)}`;
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function formatWeight(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatCountdown(seconds) {
  return `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`;
}

function formatHeartRate(value) {
  return typeof value === 'number' ? `${Math.round(value)} BPM` : '-';
}

function formatSummaryValue(value) {
  return Number.isFinite(value) ? String(value) : '-';
}

function formatSummaryNumber(value) {
  return Number.isFinite(value) ? value.toFixed(1) : '-';
}

function formatVolume(value) {
  if (!Number.isFinite(value)) {
    return '-';
  }
  return `${formatWeight(value)} kg`;
}

function formatHeartRateDrop(value) {
  if (!Number.isFinite(value)) {
    return '-';
  }
  const prefix = value > 0 ? '-' : value < 0 ? '+' : '';
  return `${prefix}${formatWeight(Math.abs(value))} BPM`;
}

function formatTimestamp(value) {
  if (!Number.isInteger(value) || value < 0) {
    return '';
  }
  const date = new Date(value);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

function selectSummaryWorkout(workout, resetExercise = true) {
  summarySelection = updateSummarySelection(summarySelection, workout, { resetExercise });
}

function changeSummaryExercise(offset) {
  const activeWorkout = latestState.activeWorkout;
  const lastWorkout = latestState.lastWorkout;
  const workout = findSummaryWorkout(activeWorkout, lastWorkout);
  summarySelection = moveSummaryExercise(summarySelection, workout, offset);
}

function refresh(page) {
  Object.assign(page, renderPage());
  scheduleTimer(page);
}

function scheduleTimer(page) {
  if (timerHandle !== null) {
    clearTimeout(timerHandle);
    timerHandle = null;
  }
  const activeWorkout = latestState.activeWorkout;
  if (!pageVisible || !activeWorkout || activeWorkout.session.status === 'FINISHED') {
    return;
  }
  const rest = activeWorkout.rest;
  const remaining = rest ? companion.timerState(Date.now()).rest.remainingMs : 1_000;
  const delay = rest ? Math.max(50, Math.min(1_000, remaining || 50)) : 1_000;
  timerHandle = setTimeout(async () => {
    timerHandle = null;
    await companion.checkRestTimer(Date.now());
    refresh(page);
  }, delay);
}

async function run(page, action) {
  try {
    await action();
  } catch (error) {
    page.syncStatusLabel = error instanceof Error ? error.message : String(error);
  }
  refresh(page);
}

export default {
  data: renderPage(),

  async onInit() {
    companion.subscribe((state) => {
      latestState = state;
      if (state.activeWorkout?.rest) {
        screen = 'rest';
      } else if (
        state.activeWorkout?.session.status === 'FINISHED' &&
        ['workout', 'set', 'rest'].includes(screen)
      ) {
        selectSummaryWorkout(state.activeWorkout);
        screen = 'workoutSummary';
      } else if (screen === 'rest') {
        screen = 'workout';
      }
      refresh(this);
    });
    await companion.start();
  },

  async onDestroy() {
    pageVisible = false;
    if (timerHandle !== null) {
      clearTimeout(timerHandle);
      timerHandle = null;
    }
    await companion.lifecycleCheckpoint(Date.now());
    await companion.stop();
  },

  async onShow() {
    pageVisible = true;
    await run(this, () => companion.reconnect());
    await companion.lifecycleCheckpoint(Date.now());
    refresh(this);
  },

  async onHide() {
    pageVisible = false;
    if (timerHandle !== null) {
      clearTimeout(timerHandle);
      timerHandle = null;
    }
    await companion.lifecycleCheckpoint(Date.now());
  },

  toggleLanguage() {
    locale = locale === 'ru' ? 'en' : 'ru';
    refresh(this);
  },

  openWorkout() {
    if (
      latestState.activeWorkout &&
      latestState.activeWorkout.session.status !== 'FINISHED'
    ) {
      screen = 'workout';
      refresh(this);
    }
  },

  openLastWorkout() {
    const workout =
      latestState.lastWorkout ||
      (latestState.activeWorkout?.session.status === 'FINISHED'
        ? latestState.activeWorkout
        : null);
    if (!workout) {
      return;
    }
    selectSummaryWorkout(workout);
    screen = 'workoutSummary';
    refresh(this);
  },

  openExerciseSummary() {
    const keepExercise = screen === 'workoutSummary';
    const workout =
      keepExercise
        ? findSummaryWorkout(latestState.activeWorkout, latestState.lastWorkout)
        : latestState.activeWorkout;
    if (!workout) {
      return;
    }
    selectSummaryWorkout(workout, !keepExercise);
    screen = 'exerciseSummary';
    refresh(this);
  },

  openWorkoutSummary() {
    const keepExercise = screen === 'exerciseSummary' || screen === 'workoutSummary';
    const workout =
      keepExercise
        ? findSummaryWorkout(latestState.activeWorkout, latestState.lastWorkout)
        : latestState.activeWorkout || latestState.lastWorkout;
    if (!workout) {
      return;
    }
    selectSummaryWorkout(workout, !keepExercise);
    screen = 'workoutSummary';
    refresh(this);
  },

  openDiagnostics() {
    screen = 'diagnostics';
    refresh(this);
  },

  closeSummary() {
    const active = latestState.activeWorkout;
    screen =
      active &&
      active.session.status !== 'FINISHED' &&
      active.session.sessionId === summarySelection.workoutSessionId
        ? 'workout'
        : 'home';
    refresh(this);
  },

  previousSummaryExercise() {
    changeSummaryExercise(-1);
    refresh(this);
  },

  nextSummaryExercise() {
    changeSummaryExercise(1);
    refresh(this);
  },

  goHome() {
    screen = 'home';
    refresh(this);
  },

  openSetEntry() {
    screen = 'set';
    refresh(this);
  },

  closeSetEntry() {
    screen = 'workout';
    refresh(this);
  },

  async sendPing() {
    await run(this, () => companion.ping());
  },

  async requestState() {
    await run(this, () => companion.requestState('manual'));
  },

  async previousExercise() {
    await run(this, () => companion.changeExercise(-1));
  },

  async nextExercise() {
    await run(this, () => companion.changeExercise(1));
  },

  async startSet() {
    await run(this, () => companion.startSet());
  },

  async completeSet() {
    await run(this, () =>
      companion.completeSet({ weight: draftWeight, reps: draftReps, rir: draftRir }),
    );
  },

  async correctLastSet() {
    await run(this, () =>
      companion.updateLastSet({ weight: draftWeight, reps: draftReps, rir: draftRir }),
    );
  },

  async deleteLastSet() {
    await run(this, () => companion.deleteLastSet());
    draftExerciseSessionId = null;
    refresh(this);
  },

  async skipRest() {
    await run(this, () => companion.skipRest());
  },

  async add15Seconds() {
    await run(this, () => companion.adjustRest(15));
  },

  async add30Seconds() {
    await run(this, () => companion.adjustRest(30));
  },

  async togglePause() {
    await run(this, () => companion.togglePause());
  },

  async startNextSet() {
    await run(this, () => companion.startNextSetFromRest());
  },

  weightDown() {
    draftWeight = Math.max(0, draftWeight - 2.5);
    refresh(this);
  },

  weightUp() {
    draftWeight = Math.min(500, draftWeight + 2.5);
    refresh(this);
  },

  repsDown() {
    draftReps = Math.max(1, draftReps - 1);
    refresh(this);
  },

  repsUp() {
    draftReps = Math.min(100, draftReps + 1);
    refresh(this);
  },

  rirDown() {
    draftRir = Math.max(0, draftRir - 1);
    refresh(this);
  },

  rirUp() {
    draftRir = Math.min(5, draftRir + 1);
    refresh(this);
  },
};
