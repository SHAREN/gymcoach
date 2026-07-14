import { Download, Smartphone } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { readAndroidRelease } from '@/lib/android-release';

export async function AndroidAppSection() {
  const t = await getTranslations('settings.androidApp');
  const artifact = await readAndroidRelease();

  return (
    <Card id="android-app-download">
      <CardHeader className="pb-3">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Smartphone className="size-4" />
          {t('title')}
        </h2>
        <p className="text-xs text-muted-foreground">{t('description')}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {artifact ? (
          <>
            <p className="text-sm text-muted-foreground">
              {t('version', { version: artifact.release.versionName })}
            </p>
            <Button asChild className="w-full sm:w-fit">
              <a href="/api/android/download" download>
                <Download className="mr-2 size-4" />
                {t('download')}
              </a>
            </Button>
            <p className="text-xs text-muted-foreground">{t('originHint')}</p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{t('unavailable')}</p>
        )}
      </CardContent>
    </Card>
  );
}
