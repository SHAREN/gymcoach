import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(scriptDir);
const logDir = path.join(root, 'logs');
const logPath = path.join(logDir, 'homepc-lan-proxy.log');
const listenHost = process.env.GYMCOACH_LAN_PROXY_HOST || '192.168.0.119';
const listenPort = Number(process.env.GYMCOACH_LAN_PROXY_PORT || '3030');
const targetHost = process.env.GYMCOACH_LAN_PROXY_TARGET_HOST || '127.0.0.1';
const targetPort = Number(process.env.GYMCOACH_LAN_PROXY_TARGET_PORT || '3030');

fs.mkdirSync(logDir, { recursive: true });

function log(message) {
  fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${message}\n`);
}

function start() {
  const server = net.createServer((client) => {
    const upstream = net.connect({ host: targetHost, port: targetPort });

    client.pipe(upstream);
    upstream.pipe(client);

    client.on('error', (error) => log(`client error: ${error.message}`));
    upstream.on('error', (error) => log(`upstream error: ${error.message}`));
    client.on('close', () => upstream.destroy());
    upstream.on('close', () => client.destroy());
  });

  server.on('error', (error) => {
    log(`listener error: ${error.message}`);
    setTimeout(start, 10000);
  });

  server.listen(listenPort, listenHost, () => {
    log(`listening on ${listenHost}:${listenPort}, forwarding to ${targetHost}:${targetPort}`);
  });
}

start();
