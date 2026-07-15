import { ConnectionState } from '../core/transport.js';

const SEND_SUCCESS_CODE = 207;

function requiredString(value, name) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} must be a non-blank string.`);
  }
  return value;
}

function requiredFunction(value, name) {
  if (typeof value !== 'function') {
    throw new Error(`${name} must be a function.`);
  }
  return value;
}

function normalizeError(value, fallback) {
  if (value instanceof Error) {
    return value;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    return new Error(value);
  }
  if (value && typeof value.data === 'string' && value.data.trim().length > 0) {
    return new Error(value.data);
  }
  return new Error(fallback);
}

function createMessage(Builder, Message, configure) {
  const builder = new Builder();
  configure(builder);
  const message = new Message(builder);

  // Lite Wear Engine SDK 5.0.2.306 reads this.builder from Message methods,
  // while its published Message constructor does not assign the argument.
  message.builder = builder;
  return message;
}

function descriptorFrom(value) {
  if (typeof value === 'string') {
    return { name: value, mode: 'text', mode2: 'R' };
  }
  if (value && typeof value.name === 'string' && value.name.trim().length > 0) {
    return {
      name: value.name,
      mode: value.mode || 'text',
      mode2: value.mode2 || 'R',
    };
  }
  throw new Error('Wear Engine outbound file writer did not return a file path.');
}

export class WearEngineTransport {
  constructor({
    sdk,
    peerPackageName,
    peerFingerprint,
    fileStore,
  }) {
    if (!sdk || typeof sdk !== 'object') {
      throw new Error('Wear Engine SDK bindings are required.');
    }

    this.P2pClient = requiredFunction(sdk.P2pClient, 'sdk.P2pClient');
    this.Message = requiredFunction(sdk.Message, 'sdk.Message');
    this.Builder = requiredFunction(sdk.Builder, 'sdk.Builder');
    this.peerPackageName = requiredString(peerPackageName, 'peerPackageName');
    this.peerFingerprint = requiredString(peerFingerprint, 'peerFingerprint');
    this.fileStore = fileStore || null;
    this.client = null;
    this.connected = false;
    this.connecting = null;
    this.connectionHandler = async () => {};
    this.messageHandler = async () => {};
    this.fileHandler = async () => {};
  }

  setConnectionHandler(handler) {
    this.connectionHandler = requiredFunction(handler, 'connectionHandler');
  }

  setMessageHandler(handler) {
    this.messageHandler = requiredFunction(handler, 'messageHandler');
  }

  setFileHandler(handler) {
    this.fileHandler = requiredFunction(handler, 'fileHandler');
  }

  async connect() {
    if (this.connected) {
      return;
    }
    if (this.connecting) {
      return this.connecting;
    }

    this.connecting = this.open();
    try {
      await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  async open() {
    await this.connectionHandler(ConnectionState.CONNECTING, null);

    try {
      const client = new this.P2pClient();
      client.setPeerPkgName(this.peerPackageName);
      client.setPeerFingerPrint(this.peerFingerprint);
      this.client = client;

      await new Promise((resolve, reject) => {
        client.registerReceiver({
          onSuccess: resolve,
          onFailure: (error) => reject(normalizeError(error, 'Wear Engine receiver registration failed.')),
          onReceiveMessage: (message) => this.receive(message),
        });
      });

      this.connected = true;
      await this.connectionHandler(ConnectionState.CONNECTED, null);
    } catch (error) {
      this.connected = false;
      const normalized = normalizeError(error, 'Wear Engine connection failed.');
      await this.connectionHandler(ConnectionState.ERROR, normalized);
      throw normalized;
    }
  }

  async disconnect() {
    const client = this.client;
    this.client = null;
    this.connected = false;

    try {
      if (client && typeof client.unregisterReceiver === 'function') {
        await new Promise((resolve, reject) => {
          try {
            client.unregisterReceiver({ onSuccess: resolve });
          } catch (error) {
            reject(error);
          }
        });
      }
    } finally {
      await this.connectionHandler(ConnectionState.DISCONNECTED, null);
    }
  }

  async send(serialized) {
    requiredString(serialized, 'serialized');
    const message = createMessage(this.Builder, this.Message, (builder) => {
      builder.setDescription(serialized);
    });
    await this.sendMessage(message, 'Wear Engine message send failed.');
  }

  async sendFile(serialized) {
    requiredString(serialized, 'serialized');
    const fileStore = this.requireFileStore();
    const descriptor = descriptorFrom(await fileStore.writeOutbound(serialized));
    const message = createMessage(this.Builder, this.Message, (builder) => {
      builder.setPayload(descriptor);
    });

    try {
      await this.sendMessage(message, 'Wear Engine file send failed.');
    } finally {
      if (typeof fileStore.removeOutbound === 'function') {
        await fileStore.removeOutbound(descriptor.name);
      }
    }
  }

  async sendMessage(message, fallbackError) {
    if (!this.connected || !this.client) {
      throw new Error('Wear Engine transport is disconnected.');
    }
    const client = this.client;

    try {
      await new Promise((resolve, reject) => {
        let settled = false;
        const complete = (action, value) => {
          if (!settled) {
            settled = true;
            action(value);
          }
        };

        client.send(message, {
          onSuccess: () => complete(resolve),
          onFailure: (error) => {
            if (error !== undefined && error !== null) {
              complete(reject, normalizeError(error, fallbackError));
              return;
            }

            // SDK 5.0.2.306 invokes onFailure() without details immediately
            // before onSendResult(resultCode), which contains the useful code.
            Promise.resolve().then(() => {
              complete(reject, normalizeError(null, fallbackError));
            });
          },
          onSendResult: (result) => {
            if (result && result.code === SEND_SUCCESS_CODE) {
              complete(resolve);
            } else {
              complete(reject, normalizeError(result, fallbackError));
            }
          },
          onSendProgress: () => {},
        });
      });
    } catch (error) {
      const normalized = normalizeError(error, fallbackError);
      if (this.client === client) {
        this.client = null;
        this.connected = false;
        await this.connectionHandler(ConnectionState.ERROR, normalized);
        if (typeof client.unregisterReceiver === 'function') {
          try {
            await new Promise((resolve, reject) => {
              client.unregisterReceiver({
                onSuccess: resolve,
                onFailure: (releaseError) => reject(
                  normalizeError(releaseError, 'Wear Engine receiver cleanup failed.'),
                ),
              });
            });
          } catch {
            // Preserve the original send failure while allowing a fresh client to reconnect.
          }
        }
      }
      throw normalized;
    }
  }

  receive(message) {
    const delivery = message && message.isFileType
      ? this.receiveFile(message.name)
      : this.messageHandler(message);

    Promise.resolve(delivery).catch((error) => {
      const normalized = normalizeError(error, 'Wear Engine inbound delivery failed.');
      return this.connectionHandler(ConnectionState.ERROR, normalized);
    });
  }

  async receiveFile(name) {
    const fileStore = this.requireFileStore();
    const serialized = await fileStore.readInbound(requiredString(name, 'inbound file name'));
    try {
      await this.fileHandler(serialized);
    } finally {
      if (typeof fileStore.removeInbound === 'function') {
        await fileStore.removeInbound(name);
      }
    }
  }

  requireFileStore() {
    if (
      !this.fileStore ||
      typeof this.fileStore.writeOutbound !== 'function' ||
      typeof this.fileStore.readInbound !== 'function'
    ) {
      throw new Error('Wear Engine fileStore must provide writeOutbound() and readInbound().');
    }
    return this.fileStore;
  }
}

export function createWearEngineTransport(options) {
  return new WearEngineTransport(options);
}
