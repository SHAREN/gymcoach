import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

const androidReleaseSchema = z.object({
  versionCode: z.number().int().positive(),
  versionName: z.string().min(1).max(64),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  sizeBytes: z.number().int().positive(),
  publishedAt: z.string().datetime(),
  apkFile: z
    .string()
    .regex(/^[A-Za-z0-9._-]+\.apk$/)
    .refine((value) => path.basename(value) === value, 'APK filename must not contain a path.'),
});

export type AndroidRelease = z.infer<typeof androidReleaseSchema>;

export interface AndroidReleaseArtifact {
  release: AndroidRelease;
  apkPath: string;
}

export function getAndroidReleaseDirectory(): string {
  return (
    process.env.ANDROID_RELEASE_DIR?.trim() || path.join(process.cwd(), 'data', 'android-release')
  );
}

export async function readAndroidRelease(): Promise<AndroidReleaseArtifact | null> {
  const directory = getAndroidReleaseDirectory();
  const metadataPath = path.join(directory, 'latest.json');

  let raw: string;
  try {
    raw = await readFile(metadataPath, 'utf8');
  } catch (error) {
    if (isMissingFile(error)) return null;
    throw error;
  }

  const release = androidReleaseSchema.parse(JSON.parse(raw) as unknown);
  const apkPath = path.join(directory, release.apkFile);

  try {
    const apkStat = await stat(apkPath);
    if (!apkStat.isFile() || apkStat.size !== release.sizeBytes) {
      throw new Error('Published Android APK does not match latest.json.');
    }
  } catch (error) {
    if (isMissingFile(error)) return null;
    throw error;
  }

  return { release, apkPath };
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
