import {
  createSensorSample,
  SensorCollector,
  SensorSampleBuffer,
} from '../core/sensors.js';

export class DebugSensorCollector extends SensorCollector {
  constructor({ clock, sampleIdGenerator, sensorType, unit }) {
    super();
    this.clock = clock;
    this.sampleIdGenerator = sampleIdGenerator;
    this.sensorType = sensorType;
    this.unit = unit;
    this.context = null;
    this.permissionGranted = false;
    this.currentValue = null;
    this.buffer = new SensorSampleBuffer();
  }

  isSupported() {
    return true;
  }

  async requestPermission() {
    this.permissionGranted = true;
    return true;
  }

  async start(sessionContext) {
    if (!this.permissionGranted) {
      throw new Error('Debug sensor permission was not granted.');
    }
    this.context = { ...sessionContext };
  }

  async stop() {
    this.context = null;
  }

  getCurrentValue() {
    return this.currentValue;
  }

  flushSamples() {
    return this.buffer.flushSamples();
  }

  record(reading, overrides = {}) {
    if (!this.context) {
      throw new Error('Debug sensor collector is not started.');
    }
    const sample = createSensorSample({
      context: { ...this.context, ...overrides.context },
      quality: overrides.quality,
      reading,
      sampleId: this.sampleIdGenerator(),
      sensorType: this.sensorType,
      timestamp: overrides.timestamp ?? this.clock(),
      unit: this.unit,
    });
    this.currentValue = sample.valid ? sample.value : null;
    this.buffer.add(sample);
    return sample;
  }
}
