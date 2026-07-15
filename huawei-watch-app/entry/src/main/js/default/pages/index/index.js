import { WatchCompanion } from '../../../../../../../src/core/companion.js';
import { labels } from '../../../../../../../src/core/i18n.js';
import { createVolatileStorageBackend, WatchStateRepository } from '../../../../../../../src/core/storage.js';
import { createUnavailableTransport } from '../../../../../../../src/core/transport.js';
import {
  completedSetsForExercise,
  currentExercise,
} from '../../../../../../../src/core/workout-state.js';

const repository = new WatchStateRepository(createVolatileStorageBackend());
const companion = new WatchCompanion({
  deviceId: 'watch-unconfigured',
  repository,
  transport: createUnavailableTransport('Official Wear Engine adapter is not configured.'),
});

let latestState = companion.getState();
let screen = 'home';
let locale = 'ru';
let draftExerciseSessionId = null;
let draftWeight = 0;
let draftReps = 1;
let draftRir = 2;
let pageVisible = false;
let timerHandle = null;

function renderPage() {
  const text = labels(locale);
  const activeWorkout = latestState.activeWorkout;
  const hasWorkout = activeWorkout !== null && activeWorkout.session.status !== 'FINISHED';
  const exercise = hasWorkout ? currentExercise(activeWorkout) : null;
  syncDraft(activeWorkout, exercise);
  const completed = exercise
    ? completedSetsForExercise(activeWorkout, exercise.exerciseSessionId).length
    : 0;
  const setNumber = activeWorkout?.pendingSet?.setNumber || completed + 1;
  const targetSets = exercise?.targetSets || 0;
  const timer = companion.timerState(Date.now());
  const restSummary = timer.restSummary;
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
    hasWorkout,
    noWorkout: !hasWorkout,
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
    pauseResumeLabel: timer.rest.paused ? text.resume : text.pause,
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
  };
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
    if (latestState.activeWorkout) {
      screen = 'workout';
      refresh(this);
    }
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
