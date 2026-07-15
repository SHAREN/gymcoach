import { VibrationAdapter } from '../core/vibration.js';

export class DebugVibrationRecorder extends VibrationAdapter {
  constructor() {
    super();
    this.cues = [];
  }

  isSupported() {
    return true;
  }

  async vibrate(cue) {
    this.cues.push(cue);
    return true;
  }
}
