import {
  MOBILE_SETTINGS_DIAGNOSTIC_POLICY,
  isSafeMobileSettingsCorrelationId,
  type MobileSettingsDiagnosticEvent,
} from '@/lib/mobile-settings-contract';

const crypto = process.getBuiltinModule('crypto') as typeof import('node:crypto');
const fs = process.getBuiltinModule('fs') as typeof import('node:fs');
const path = process.getBuiltinModule('path') as typeof import('node:path');

const EVENT_FILE_PATTERN = /^event-(\d{13})-[0-9a-f-]{36}\.json$/i;
const TEMP_FILE_PATTERN = /^\.tmp-[0-9a-f-]{36}\.json$/i;
const MAX_FUTURE_SKEW_MS = 60_000;

export interface MobileSettingsPersistentPolicy {
  maxEvents: number;
  maxBytes: number;
  maxAgeMs: number;
}

export interface MobileSettingsPersistentRetentionResult {
  keptEvents: number;
  keptBytes: number;
  removedFiles: number;
}

let retentionTimer: NodeJS.Timeout | null = null;

function configuredDirectory(explicitDirectory?: string): string | null {
  const value = explicitDirectory ?? process.env.GYMCOACH_MOBILE_SETTINGS_DIAGNOSTIC_DIR;
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function isFileSystemError(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === code
  );
}

function removeOwnedFile(path: string): boolean {
  try {
    fs.unlinkSync(path);
    return true;
  } catch (error) {
    if (isFileSystemError(error, 'ENOENT')) return false;
    throw error;
  }
}

function parseRetainedEvent(path: string): {
  event: MobileSettingsDiagnosticEvent;
  timestampMs: number;
  bytes: number;
} | null {
  try {
    const contents = fs.readFileSync(path, 'utf8');
    const value: unknown = JSON.parse(contents);
    if (!value || typeof value !== 'object') return null;
    const event = value as Partial<MobileSettingsDiagnosticEvent>;
    const timestampMs = typeof event.timestamp === 'string' ? Date.parse(event.timestamp) : NaN;
    if (
      event.schemaVersion !== 1 ||
      event.kind !== 'mobile-settings-request' ||
      typeof event.correlationId !== 'string' ||
      !isSafeMobileSettingsCorrelationId(event.correlationId) ||
      !Number.isFinite(timestampMs)
    ) {
      return null;
    }
    return {
      event: event as MobileSettingsDiagnosticEvent,
      timestampMs,
      bytes: Buffer.byteLength(contents, 'utf8'),
    };
  } catch {
    return null;
  }
}

export function prunePersistentMobileSettingsDiagnostics(
  options: {
    directory?: string;
    nowMs?: number;
    policy?: MobileSettingsPersistentPolicy;
  } = {},
): MobileSettingsPersistentRetentionResult {
  const directory = configuredDirectory(options.directory);
  if (!directory) return { keptEvents: 0, keptBytes: 0, removedFiles: 0 };
  const policy = options.policy ?? MOBILE_SETTINGS_DIAGNOSTIC_POLICY;
  const nowMs = options.nowMs ?? Date.now();
  const minimumTimestamp = nowMs - policy.maxAgeMs;
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });

  const candidates: Array<{ path: string; timestampMs: number; bytes: number }> = [];
  let removedFiles = 0;
  for (const name of fs.readdirSync(directory)) {
    const filePath = path.join(directory, name);
    if (TEMP_FILE_PATTERN.test(name)) {
      let ageMs: number;
      try {
        ageMs = nowMs - fs.statSync(filePath).mtimeMs;
      } catch (error) {
        if (isFileSystemError(error, 'ENOENT')) continue;
        throw error;
      }
      if (ageMs > MOBILE_SETTINGS_DIAGNOSTIC_POLICY.persistentSweepIntervalMs * 2) {
        removedFiles += removeOwnedFile(filePath) ? 1 : 0;
      }
      continue;
    }
    if (!EVENT_FILE_PATTERN.test(name)) continue;
    let fileBytes: number;
    try {
      fileBytes = fs.statSync(filePath).size;
    } catch (error) {
      if (isFileSystemError(error, 'ENOENT')) continue;
      throw error;
    }
    if (fileBytes > policy.maxBytes) {
      removedFiles += removeOwnedFile(filePath) ? 1 : 0;
      continue;
    }
    const retained = parseRetainedEvent(filePath);
    if (
      !retained ||
      retained.timestampMs < minimumTimestamp ||
      retained.timestampMs > nowMs + MAX_FUTURE_SKEW_MS
    ) {
      removedFiles += removeOwnedFile(filePath) ? 1 : 0;
      continue;
    }
    candidates.push({ path: filePath, timestampMs: retained.timestampMs, bytes: retained.bytes });
  }

  candidates.sort((left, right) => right.timestampMs - left.timestampMs);
  let keptEvents = 0;
  let keptBytes = 0;
  for (const candidate of candidates) {
    if (keptEvents >= policy.maxEvents || keptBytes + candidate.bytes > policy.maxBytes) {
      removedFiles += removeOwnedFile(candidate.path) ? 1 : 0;
      continue;
    }
    keptEvents += 1;
    keptBytes += candidate.bytes;
  }
  return { keptEvents, keptBytes, removedFiles };
}

export function persistMobileSettingsDiagnostic(
  event: MobileSettingsDiagnosticEvent,
  options: {
    directory?: string;
    nowMs?: number;
    policy?: MobileSettingsPersistentPolicy;
  } = {},
): boolean {
  const directory = configuredDirectory(options.directory);
  if (!directory || !isSafeMobileSettingsCorrelationId(event.correlationId)) return false;
  const policy = options.policy ?? MOBILE_SETTINGS_DIAGNOSTIC_POLICY;
  const nowMs = options.nowMs ?? Date.now();
  const timestampMs = Date.parse(event.timestamp);
  if (
    !Number.isFinite(timestampMs) ||
    timestampMs < nowMs - policy.maxAgeMs ||
    timestampMs > nowMs + MAX_FUTURE_SKEW_MS
  ) {
    prunePersistentMobileSettingsDiagnostics({ directory, nowMs, policy });
    return false;
  }

  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const serialized = `${JSON.stringify(event)}\n`;
  if (Buffer.byteLength(serialized, 'utf8') > policy.maxBytes) return false;
  const id = crypto.randomUUID();
  const temporaryPath = path.join(directory, `.tmp-${id}.json`);
  const finalPath = path.join(
    directory,
    `event-${String(timestampMs).padStart(13, '0')}-${id}.json`,
  );
  try {
    fs.writeFileSync(temporaryPath, serialized, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    fs.renameSync(temporaryPath, finalPath);
    prunePersistentMobileSettingsDiagnostics({ directory, nowMs, policy });
    return true;
  } catch {
    try {
      removeOwnedFile(temporaryPath);
    } catch {
      // A failed best-effort cleanup is handled by the bounded temp-file sweep.
    }
    return false;
  }
}

export function startPersistentMobileSettingsDiagnosticRetention(): void {
  const directory = configuredDirectory();
  if (!directory || retentionTimer) return;
  const sweep = () => {
    try {
      prunePersistentMobileSettingsDiagnostics({ directory });
    } catch {
      // Diagnostics must never affect request or server availability.
    }
  };
  sweep();
  retentionTimer = setInterval(sweep, MOBILE_SETTINGS_DIAGNOSTIC_POLICY.persistentSweepIntervalMs);
  retentionTimer.unref();
}
