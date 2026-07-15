import file from '@system.file';

import { P2pClient, Message, Builder } from './pages/wearengine.js';
import {
  createLiteFileStore,
  createLiteStorageBackend,
} from '../../../../../src/platform/lite-file-store.js';
import { createWearEngineTransport } from '../../../../../src/platform/wear-engine-transport.js';
import {
  PHONE_DEBUG_SHA256_FINGERPRINT,
  PHONE_PACKAGE_NAME,
  WATCH_DEVICE_ID,
} from '../../../../../src/platform/watch-peer-config.js';

function createPlatformBindings() {
  const fileStore = createLiteFileStore({ fileApi: file });
  return {
    deviceId: WATCH_DEVICE_ID,
    storageBackend: createLiteStorageBackend({ fileApi: file }),
    transport: createWearEngineTransport({
      fileStore,
      peerFingerprint: PHONE_DEBUG_SHA256_FINGERPRINT,
      peerPackageName: PHONE_PACKAGE_NAME,
      sdk: { Builder, Message, P2pClient },
    }),
  };
}

export default {
  onCreate() {
    globalThis.__gymCoachWatchPlatform = createPlatformBindings();
  },
  onDestroy() {
    globalThis.__gymCoachWatchPlatform = null;
  },
};
