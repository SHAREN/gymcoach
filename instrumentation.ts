export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { startPersistentMobileSettingsDiagnosticRetention } =
    await import('@/lib/mobile-settings-diagnostic-store');
  startPersistentMobileSettingsDiagnosticRetention();
}
