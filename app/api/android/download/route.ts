import { readFile } from 'node:fs/promises';
import { NextResponse } from 'next/server';
import { readAndroidRelease } from '@/lib/android-release';

export const dynamic = 'force-dynamic';

export async function GET() {
  const artifact = await readAndroidRelease();
  if (!artifact) {
    return NextResponse.json({ error: 'Android APK is not published.' }, { status: 404 });
  }

  const apk = await readFile(artifact.apkPath);
  return new Response(apk, {
    headers: {
      'Cache-Control': 'no-cache',
      'Content-Disposition': `attachment; filename="GymCoach-${artifact.release.versionName}.apk"`,
      'Content-Length': String(apk.byteLength),
      'Content-Type': 'application/vnd.android.package-archive',
      Digest: `sha-256=${Buffer.from(artifact.release.sha256, 'hex').toString('base64')}`,
    },
  });
}
