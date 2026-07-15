import { WatchCompanion } from '../../../../../../../src/core/companion.js';
import { createVolatileStorageBackend, WatchStateRepository } from '../../../../../../../src/core/storage.js';
import { createUnavailableTransport } from '../../../../../../../src/core/transport.js';

const repository = new WatchStateRepository(createVolatileStorageBackend());
const companion = new WatchCompanion({
  deviceId: 'watch-unconfigured',
  repository,
  transport: createUnavailableTransport('Official Wear Engine adapter is not configured.'),
});

function labelsFor(state) {
  const connectionLabels = {
    connected: 'Connected',
    connecting: 'Connecting',
    disconnected: 'Offline',
    error: 'Error',
  };

  const syncLabels = {
    idle: 'Idle',
    requesting: 'Requesting',
    synced: 'Synced',
    error: 'Error',
  };

  return {
    connectionLabel: connectionLabels[state.connection] || 'Offline',
    connectionTone: state.connection,
    syncLabel: syncLabels[state.syncStatus] || 'Idle',
    protocolVersion: state.protocolVersion,
    pendingCount: String(state.pendingCount),
    lastResult: state.lastError || (state.lastPongAt ? `Pong ${state.lastPongAt}` : 'Waiting for phone'),
  };
}

export default {
  data: labelsFor(companion.getState()),

  async onInit() {
    companion.subscribe((state) => {
      Object.assign(this, labelsFor(state));
    });
    await companion.start();
  },

  async onDestroy() {
    await companion.stop();
  },

  async sendPing() {
    await companion.ping();
  },

  async requestState() {
    await companion.requestState('manual');
  },
};
