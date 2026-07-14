import { NextResponse } from 'next/server';
import { readAndroidRelease } from '@/lib/android-release';

export const dynamic = 'force-dynamic';

export async function GET() {
  const artifact = await readAndroidRelease();
  if (!artifact) {
    return NextResponse.json({ error: 'Android APK is not published.' }, { status: 404 });
  }

  return NextResponse.json(
    {
      ...artifact.release,
      downloadUrl: '/api/android/download',
    },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
    },
  );
}
