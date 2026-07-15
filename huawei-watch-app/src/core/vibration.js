export const VibrationCue = Object.freeze({
  REST_WARNING: 'REST_WARNING',
  REST_FINISHED: 'REST_FINISHED',
});

export class VibrationAdapter {
  isSupported() {
    throw new Error('VibrationAdapter.isSupported() must be implemented.');
  }

  async vibrate() {
    throw new Error('VibrationAdapter.vibrate(cue) must be implemented.');
  }
}

export class UnavailableVibrationAdapter extends VibrationAdapter {
  isSupported() {
    return false;
  }

  async vibrate() {
    return false;
  }
}

export function createUnavailableVibrationAdapter() {
  return new UnavailableVibrationAdapter();
}
