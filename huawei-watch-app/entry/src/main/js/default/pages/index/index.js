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
    hasWorkout,
    noWorkout: !hasWorkout,
    showStartSet: hasWorkout && activeWorkout.activeSetId === null,
    showCompleteSet: hasWorkout && activeWorkout.pendingSet !== null,
    showRemoteActiveSet:
      hasWorkout && activeWorkout.activeSetId !== null && activeWorkout.pendingSet === null,
    showLastSetActions: completed > 0,
    connectionTone: latestState.connection,
    connectionLabel: connectionLabels[latestState.connection] || text.offline,
    syncStatusLabel: syncLabels[latestState.syncStatus] || text.waiting,
    pendingCount: String(latestState.pendingCount),
    languageButton: locale === 'ru' ? 'EN' : 'RU',
    activeWorkoutLabel: text.activeWorkout,
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
    exerciseName: exercise?.exerciseName || text.noWorkout,
    setProgress: `${setNumber} / ${targetSets}`,
    targetSummary: exercise
      ? `${exercise.targetReps} ${text.reps.toLowerCase()} · RIR ${exercise.targetRir}`
      : '-',
    elapsed: formatElapsed(activeWorkout?.startedAt),
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

function formatElapsed(startedAt) {
  if (!Number.isInteger(startedAt)) {
    return '00:00';
  }
  const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
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

function refresh(page) {
  Object.assign(page, renderPage());
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
      refresh(this);
    });
    await companion.start();
  },

  async onDestroy() {
    await companion.stop();
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
