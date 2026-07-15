export default {
  onCreate() {
    globalThis.__gymCoachWatchPlatform = null;
  },
  onDestroy() {
    globalThis.__gymCoachWatchPlatform = null;
  }
};
