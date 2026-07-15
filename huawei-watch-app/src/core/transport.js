export const ConnectionState = Object.freeze({
  CONNECTED: 'connected',
  CONNECTING: 'connecting',
  DISCONNECTED: 'disconnected',
  ERROR: 'error',
});

export function assertTransport(transport) {
  const required = [
    'connect',
    'disconnect',
    'send',
    'sendFile',
    'setConnectionHandler',
    'setMessageHandler',
    'setFileHandler',
  ];
  for (const method of required) {
    if (typeof transport[method] !== 'function') {
      throw new Error(`Transport is missing ${method}().`);
    }
  }
  return transport;
}

export function createUnavailableTransport(reason) {
  let connectionHandler = () => {};

  return {
    async connect() {
      await connectionHandler(ConnectionState.ERROR, reason);
    },
    async disconnect() {
      await connectionHandler(ConnectionState.DISCONNECTED, null);
    },
    async send() {
      throw new Error(reason);
    },
    async sendFile() {
      throw new Error(reason);
    },
    setConnectionHandler(handler) {
      connectionHandler = handler;
    },
    setMessageHandler() {},
    setFileHandler() {},
  };
}
