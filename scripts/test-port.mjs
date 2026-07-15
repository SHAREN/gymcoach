#!/usr/bin/env node

import net from 'node:net';

function isPortOpen(port) {
  return new Promise((resolveOpen) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const finish = (open) => {
      socket.destroy();
      resolveOpen(open);
    };
    socket.setTimeout(500);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  do {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  } while (Date.now() < deadline);
  return false;
}

const [command, target, timeoutArg] = process.argv.slice(2);
const timeoutMs = Number(timeoutArg ?? 15_000);

let passed = false;
if (command === 'assert-free') {
  const port = Number(target);
  passed = Number.isInteger(port) && !(await isPortOpen(port));
} else if (command === 'wait-open') {
  const port = Number(target);
  passed = Number.isInteger(port) && (await waitFor(() => isPortOpen(port), timeoutMs));
} else if (command === 'wait-closed') {
  const port = Number(target);
  passed =
    Number.isInteger(port) && (await waitFor(async () => !(await isPortOpen(port)), timeoutMs));
} else if (command === 'wait-http') {
  passed = await waitFor(async () => {
    try {
      return (await fetch(target, { signal: AbortSignal.timeout(1_000) })).status === 200;
    } catch {
      return false;
    }
  }, timeoutMs);
} else {
  console.error(
    'Usage: test-port.mjs assert-free|wait-open|wait-closed <port> [timeout-ms] | wait-http <url> [timeout-ms]',
  );
  process.exit(2);
}

if (!passed) {
  console.error(`Port/HTTP condition failed: ${command} ${target}`);
  process.exitCode = 1;
}
