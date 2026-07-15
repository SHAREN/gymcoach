import {
  encodeSensorBatchForTransport,
  FILE_TARGET_BYTES,
  MAX_FILE_BYTES,
  validateSensorBatch,
  validateSensorSample,
} from './contracts.js';
import { PROTOCOL_VERSION, SCHEMA_VERSION, utf8ByteLength } from './messages.js';

export const SensorType = Object.freeze({
  HEART_RATE: 'HEART_RATE',
  ACCELEROMETER: 'ACCELEROMETER',
  GYROSCOPE: 'GYROSCOPE',
  WEAR_DETECTION: 'WEAR_DETECTION',
  ACTIVITY_MOTION: 'ACTIVITY_MOTION',
  AMBIENT_TEMPERATURE: 'AMBIENT_TEMPERATURE',
});

export const SensorPhase = Object.freeze({
  WORKOUT: 'WORKOUT',
  SET: 'SET',
  REST: 'REST',
  PAUSE: 'PAUSE',
  WARMUP: 'WARMUP',
  RECOVERY: 'RECOVERY',
});

const DOCUMENTED_SENSOR_TYPES = new Set(Object.values(SensorType));
const SENSOR_PHASES = new Set(Object.values(SensorPhase));
const FILE_ENVELOPE_RESERVE_BYTES = 4_096;
const DEFAULT_BATCH_TARGET_BYTES = FILE_TARGET_BYTES - FILE_ENVELOPE_RESERVE_BYTES;

export class SensorCollector {
  isSupported() {
    throw new Error('SensorCollector.isSupported() must be implemented.');
  }

  async requestPermission() {
    throw new Error('SensorCollector.requestPermission() must be implemented.');
  }

  async start(sessionContext) {
    void sessionContext;
    throw new Error('SensorCollector.start(sessionContext) must be implemented.');
  }

  async stop() {
    throw new Error('SensorCollector.stop() must be implemented.');
  }

  getCurrentValue() {
    throw new Error('SensorCollector.getCurrentValue() must be implemented.');
  }

  flushSamples() {
    throw new Error('SensorCollector.flushSamples() must be implemented.');
  }
}

export class UnavailableSensorCollector extends SensorCollector {
  constructor(sensorType, reason = 'Official Lite Wearable sensor adapter is not configured.') {
    super();
    if (!DOCUMENTED_SENSOR_TYPES.has(sensorType)) {
      throw new Error(`Unsupported production sensor type: ${sensorType}`);
    }
    this.sensorType = sensorType;
    this.reason = reason;
  }

  isSupported() {
    return false;
  }

  async requestPermission() {
    return false;
  }

  async start(sessionContext) {
    void sessionContext;
    throw new Error(this.reason);
  }

  async stop() {}

  getCurrentValue() {
    return null;
  }

  flushSamples() {
    return [];
  }
}

export function createUnavailableProductionCollectors() {
  return Object.values(SensorType).map((sensorType) => new UnavailableSensorCollector(sensorType));
}

export class SensorSampleBuffer {
  constructor(maxSamples = 2_048) {
    if (!Number.isInteger(maxSamples) || maxSamples < 1) {
      throw new Error('Sensor sample buffer size must be a positive integer.');
    }
    this.maxSamples = maxSamples;
    this.samples = [];
  }

  add(sample) {
    validateSensorSample(sample);
    if (this.samples.length >= this.maxSamples) {
      throw new Error('Sensor sample buffer is full and must be flushed.');
    }
    this.samples.push(clone(sample));
  }

  size() {
    return this.samples.length;
  }

  current() {
    return this.samples.length === 0 ? null : clone(this.samples[this.samples.length - 1]);
  }

  flushSamples() {
    const flushed = this.samples.map(clone);
    this.samples = [];
    return flushed;
  }
}

export function createSensorSample({
  context,
  quality = null,
  reading,
  sampleId,
  sensorType,
  source = 'WATCH',
  timestamp,
  unit,
}) {
  if (!SENSOR_PHASES.has(context.phase)) {
    throw new Error(`Unsupported sensor phase: ${context.phase}`);
  }
  if (!DOCUMENTED_SENSOR_TYPES.has(sensorType)) {
    throw new Error(`Unsupported production sensor type: ${sensorType}`);
  }
  let valid = reading.valid === true;
  let value = reading.value;
  let normalizedQuality = quality ?? reading.quality ?? null;
  if (sensorType === SensorType.HEART_RATE) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || !valid) {
      valid = false;
      value = null;
      normalizedQuality = normalizedQuality || 'INVALID';
    }
  } else if (!valid) {
    value = null;
    normalizedQuality = normalizedQuality || 'INVALID';
  }

  return validateSensorSample({
    sampleId,
    sessionId: context.sessionId,
    exerciseSessionId: context.exerciseSessionId ?? null,
    setId: context.setId ?? null,
    phase: context.phase,
    sensorType,
    value,
    unit,
    timestamp,
    source,
    valid,
    quality: normalizedQuality,
  });
}

export function buildSensorBatches({
  batchId,
  createdAt,
  deviceId,
  samples,
  sessionId,
  source = 'WATCH',
  targetBytes = DEFAULT_BATCH_TARGET_BYTES,
}) {
  if (!Array.isArray(samples) || samples.length === 0) {
    return [];
  }
  if (targetBytes >= MAX_FILE_BYTES || targetBytes < 1_024) {
    throw new Error('Sensor batch target must be at least 1,024 and below 4,000,000 bytes.');
  }
  for (const sample of samples) {
    validateSensorSample(sample);
    if (sample.sessionId !== sessionId || sample.source !== source) {
      throw new Error('Sensor batch samples must match envelope session and source.');
    }
  }

  const chunks = [];
  let current = [];
  for (const sample of samples) {
    const candidate = [...current, sample];
    const probe = rawSensorBatch({
      batchId,
      createdAt,
      deviceId,
      samples: candidate,
      sequence: 999_999,
      sessionId,
      source,
      totalSequences: 999_999,
    });
    const bytes = utf8ByteLength(JSON.stringify(probe));
    if (current.length > 0 && bytes > targetBytes) {
      chunks.push(current);
      current = [sample];
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) {
    chunks.push(current);
  }

  return chunks.map((chunk, index) => {
    const batch = rawSensorBatch({
      batchId,
      createdAt,
      deviceId,
      samples: chunk,
      sequence: index + 1,
      sessionId,
      source,
      totalSequences: chunks.length,
    });
    validateSensorBatch(batch);
    encodeSensorBatchForTransport(batch);
    return batch;
  });
}

export function summarizeHeartRate(samples, startedAt, finishedAt) {
  const validSamples = validHeartRateSamples(samples, startedAt, finishedAt);
  const values = validSamples.map((sample) => sample.value);
  return {
    start: values.length > 0 ? values[0] : null,
    end: values.length > 0 ? values[values.length - 1] : null,
    min: values.length > 0 ? Math.min(...values) : null,
    max: values.length > 0 ? Math.max(...values) : null,
    average: values.length > 0 ? average(values) : null,
    sampleCount: values.length,
    durationMs: Math.max(0, finishedAt - startedAt),
  };
}

export function summarizeRestHeartRate(samples, startedAt, finishedAt) {
  const validSamples = validHeartRateSamples(samples, startedAt, finishedAt);
  const values = validSamples.map((sample) => sample.value);
  const start = values.length > 0 ? values[0] : null;
  const at30Seconds =
    finishedAt >= startedAt + 30_000
      ? nearestValue(validSamples, startedAt + 30_000)
      : null;
  const at60Seconds =
    finishedAt >= startedAt + 60_000
      ? nearestValue(validSamples, startedAt + 60_000)
      : null;
  return {
    startedAt,
    finishedAt,
    start,
    min: values.length > 0 ? Math.min(...values) : null,
    average: values.length > 0 ? average(values) : null,
    at30Seconds,
    at60Seconds,
    drop30Seconds: start !== null && at30Seconds !== null ? start - at30Seconds : null,
    drop60Seconds: start !== null && at60Seconds !== null ? start - at60Seconds : null,
    sampleCount: values.length,
  };
}

function validHeartRateSamples(samples, startedAt, finishedAt) {
  return samples
    .filter(
      (sample) =>
        sample.sensorType === SensorType.HEART_RATE &&
        sample.valid === true &&
        typeof sample.value === 'number' &&
        Number.isFinite(sample.value) &&
        sample.value > 0 &&
        sample.timestamp >= startedAt &&
        sample.timestamp <= finishedAt,
    )
    .sort((left, right) => left.timestamp - right.timestamp);
}

function nearestValue(samples, timestamp) {
  if (samples.length === 0) {
    return null;
  }
  let nearest = samples[0];
  for (const sample of samples.slice(1)) {
    if (Math.abs(sample.timestamp - timestamp) < Math.abs(nearest.timestamp - timestamp)) {
      nearest = sample;
    }
  }
  return nearest.value;
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function rawSensorBatch({
  batchId,
  createdAt,
  deviceId,
  samples,
  sequence,
  sessionId,
  source,
  totalSequences,
}) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    schemaVersion: SCHEMA_VERSION,
    batchId,
    sessionId,
    source,
    deviceId,
    createdAt,
    sequence,
    totalSequences,
    sampleCount: samples.length,
    samples: samples.map(clone),
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
