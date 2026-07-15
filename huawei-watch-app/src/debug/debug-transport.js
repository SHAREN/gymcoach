import { ConnectionState } from '../core/transport.js';

class DebugTransportEndpoint {
  constructor(name) {
    this.name = name;
    this.connected = false;
    this.peer = null;
    this.connectionHandler = () => {};
    this.messageHandler = async () => {};
    this.fileHandler = async () => {};
    this.sent = [];
    this.filesSent = [];
    this.nextFileMutator = null;
  }

  link(peer) {
    this.peer = peer;
  }

  setConnectionHandler(handler) {
    this.connectionHandler = handler;
  }

  setMessageHandler(handler) {
    this.messageHandler = handler;
  }

  setFileHandler(handler) {
    this.fileHandler = handler;
  }

  async connect() {
    this.connected = true;
    await this.connectionHandler(ConnectionState.CONNECTED, null);
  }

  async disconnect() {
    this.connected = false;
    await this.connectionHandler(ConnectionState.DISCONNECTED, null);
  }

  async reconnect() {
    await this.disconnect();
    await this.connect();
  }

  async send(serialized) {
    if (!this.connected) {
      throw new Error(`${this.name} debug transport is disconnected.`);
    }
    if (!this.peer || !this.peer.connected) {
      throw new Error(`${this.name} debug transport peer is disconnected.`);
    }

    this.sent.push(serialized);
    await this.peer.messageHandler(serialized);
  }

  async inject(serialized) {
    await this.messageHandler(serialized);
  }

  async sendFile(serialized) {
    if (!this.connected) {
      throw new Error(`${this.name} debug transport is disconnected.`);
    }
    if (!this.peer || !this.peer.connected) {
      throw new Error(`${this.name} debug transport peer is disconnected.`);
    }

    this.filesSent.push(serialized);
    let delivered = serialized;
    if (this.nextFileMutator) {
      delivered = this.nextFileMutator(serialized);
      this.nextFileMutator = null;
    }
    await this.peer.fileHandler(delivered);
  }

  async injectFile(serialized) {
    await this.fileHandler(serialized);
  }

  corruptNextFile() {
    this.nextFileMutator = (serialized) => {
      const envelope = JSON.parse(serialized);
      if (Array.isArray(envelope.payload?.samples) && envelope.payload.samples.length > 0) {
        const sample = envelope.payload.samples[0];
        if (typeof sample.value === 'number') {
          sample.value += 1;
        } else if (typeof sample.quality === 'string') {
          sample.quality = [...sample.quality].reverse().join('');
        }
      } else {
        envelope.payloadId = `${envelope.payloadId}-corrupted`;
      }
      return JSON.stringify(envelope);
    };
  }

  async redeliverLastFile() {
    if (this.filesSent.length === 0) {
      throw new Error(`${this.name} debug transport has no file to redeliver.`);
    }
    if (!this.peer || !this.peer.connected) {
      throw new Error(`${this.name} debug transport peer is disconnected.`);
    }
    await this.peer.fileHandler(this.filesSent[this.filesSent.length - 1]);
  }
}

export function createDebugTransportPair() {
  const watch = new DebugTransportEndpoint('watch');
  const phone = new DebugTransportEndpoint('phone');
  watch.link(phone);
  phone.link(watch);
  return { watch, phone };
}
