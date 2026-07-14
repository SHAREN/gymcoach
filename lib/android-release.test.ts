import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readAndroidRelease } from '@/lib/android-release';

const directories: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

async function releaseDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'gymcoach-android-release-'));
  directories.push(directory);
  vi.stubEnv('ANDROID_RELEASE_DIR', directory);
  return directory;
}

describe('readAndroidRelease', () => {
  it('returns null when no APK has been published', async () => {
    await releaseDirectory();

    await expect(readAndroidRelease()).resolves.toBeNull();
  });

  it('loads validated metadata and the matching APK', async () => {
    const directory = await releaseDirectory();
    await writeFile(path.join(directory, 'gymcoach-latest.apk'), 'apk');
    await writeFile(
      path.join(directory, 'latest.json'),
      JSON.stringify({
        versionCode: 2,
        versionName: '0.2.0',
        sha256: 'a'.repeat(64),
        sizeBytes: 3,
        publishedAt: '2026-07-13T12:00:00.000Z',
        apkFile: 'gymcoach-latest.apk',
      }),
    );

    await expect(readAndroidRelease()).resolves.toEqual({
      release: {
        versionCode: 2,
        versionName: '0.2.0',
        sha256: 'a'.repeat(64),
        sizeBytes: 3,
        publishedAt: '2026-07-13T12:00:00.000Z',
        apkFile: 'gymcoach-latest.apk',
      },
      apkPath: path.join(directory, 'gymcoach-latest.apk'),
    });
  });

  it('rejects unsafe APK paths from metadata', async () => {
    const directory = await releaseDirectory();
    await writeFile(
      path.join(directory, 'latest.json'),
      JSON.stringify({
        versionCode: 2,
        versionName: '0.2.0',
        sha256: 'a'.repeat(64),
        sizeBytes: 3,
        publishedAt: '2026-07-13T12:00:00.000Z',
        apkFile: '../gymcoach.apk',
      }),
    );

    await expect(readAndroidRelease()).rejects.toThrow();
  });
});
