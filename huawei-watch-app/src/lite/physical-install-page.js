let locale = 'ru';
let screen = 'home';

function text() {
  if (locale === 'en') {
    return {
      activeWorkout: 'Active workout',
      noWorkout: 'No active workout',
      lastWorkout: 'Last workout',
      noHistory: 'No history yet',
      ping: 'Ping',
      sync: 'Sync',
      diagnostics: 'Diagnostics',
      ready: 'GT4 ready',
      installed: 'Installed',
      back: 'Back',
    };
  }
  return {
    activeWorkout: 'Активная тренировка',
    noWorkout: 'Нет активной тренировки',
    lastWorkout: 'Последняя тренировка',
    noHistory: 'Истории пока нет',
    ping: 'Ping',
    sync: 'Синхронизация',
    diagnostics: 'Диагностика',
    ready: 'GT4 готов',
    installed: 'Установлено',
    back: 'Назад',
  };
}

function render() {
  const labels = text();
  return {
    showHome: screen === 'home',
    showWorkout: false,
    showSetEntry: false,
    showRest: false,
    showExerciseSummary: false,
    showWorkoutSummary: false,
    showDiagnostics: screen === 'diagnostics',
    hasWorkout: false,
    noWorkout: true,
    hasLastWorkout: false,
    noLastWorkout: true,
    hasLastError: false,
    noLastError: true,
    showStartSet: false,
    showCompleteSet: false,
    showRemoteActiveSet: false,
    showExerciseNavigation: false,
    showPauseButton: false,
    showLastSetActions: false,
    connectionLabel: labels.ready,
    syncStatusLabel: labels.installed,
    pendingCount: '0',
    languageButton: locale === 'ru' ? 'EN' : 'RU',
    activeWorkoutLabel: labels.activeWorkout,
    lastWorkoutLabel: labels.lastWorkout,
    noLastWorkoutLabel: labels.noHistory,
    noWorkoutLabel: labels.noWorkout,
    pingLabel: labels.ping,
    syncLabel: labels.sync,
    diagnosticsLabel: labels.diagnostics,
    pendingLabel: locale === 'ru' ? 'В очереди' : 'Pending',
    backLabel: labels.back,
    exerciseName: labels.noWorkout,
    setLabel: locale === 'ru' ? 'Подход' : 'Set',
    setProgress: '0 / 0',
    elapsed: '00:00',
    lastWorkoutSets: labels.noHistory,
    lastWorkoutDuration: '00:00',
    lastWorkoutFinishedAt: '',
    diagnosticConnection: labels.ready,
    diagnosticSync: labels.installed,
    diagnosticProtocol: '1.0',
    diagnosticPending: '0',
    diagnosticConflicts: '0',
    diagnosticLastSync: labels.installed,
    diagnosticLastError: locale === 'ru' ? 'Ошибок нет' : 'No errors',
    phoneConnectionLabel: locale === 'ru' ? 'Телефон' : 'Phone',
    protocolLabel: locale === 'ru' ? 'Протокол' : 'Protocol',
    conflictsLabel: locale === 'ru' ? 'Конфликты' : 'Conflicts',
    lastSyncLabel: locale === 'ru' ? 'Последняя синхронизация' : 'Last sync',
    lastErrorLabel: locale === 'ru' ? 'Последняя ошибка' : 'Last error',
  };
}

function refresh(page) {
  const data = render();
  const keys = Object.keys(data);
  for (let index = 0; index < keys.length; index += 1) {
    page[keys[index]] = data[keys[index]];
  }
}

function idle(page) {
  refresh(page);
}

export default {
  data: render(),
  toggleLanguage() {
    locale = locale === 'ru' ? 'en' : 'ru';
    refresh(this);
  },
  openDiagnostics() {
    screen = 'diagnostics';
    refresh(this);
  },
  goHome() {
    screen = 'home';
    refresh(this);
  },
  closeSummary() {
    screen = 'home';
    refresh(this);
  },
  openWorkout() { idle(this); },
  openLastWorkout() { idle(this); },
  openExerciseSummary() { idle(this); },
  openWorkoutSummary() { idle(this); },
  previousSummaryExercise() { idle(this); },
  nextSummaryExercise() { idle(this); },
  openSetEntry() { idle(this); },
  closeSetEntry() { idle(this); },
  sendPing() { idle(this); },
  requestState() { idle(this); },
  previousExercise() { idle(this); },
  nextExercise() { idle(this); },
  startSet() { idle(this); },
  completeSet() { idle(this); },
  correctLastSet() { idle(this); },
  deleteLastSet() { idle(this); },
  skipRest() { idle(this); },
  add15Seconds() { idle(this); },
  add30Seconds() { idle(this); },
  togglePause() { idle(this); },
  startNextSet() { idle(this); },
  weightDown() { idle(this); },
  weightUp() { idle(this); },
  repsDown() { idle(this); },
  repsUp() { idle(this); },
  rirDown() { idle(this); },
  rirUp() { idle(this); },
};
