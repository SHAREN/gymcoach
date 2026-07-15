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
    await this.peer.fileHandler(serialized);
  }

  async injectFile(serialized) {
    await this.fileHandler(serialized);
  }
}

export function createDebugTransportPair() {
  const watch = new DebugTransportEndpoint('watch');
  const phone = new DebugTransportEndpoint('phone');
  watch.link(phone);
  phone.link(watch);
  return { watch, phone };
}
