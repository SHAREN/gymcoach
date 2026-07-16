import { safeFileToken } from '../core/portable-text.js';

const DEFAULT_STATE_URI = 'internal://app/gymcoach-state-v1.json';
const FILE_NOT_FOUND_CODE = 301;

function requiredFunction(value, name) {
  if (typeof value !== 'function') {
    throw new Error(`${name} must be a function.`);
  }
  return value;
}

function fileError(action, data, code) {
  const details = typeof data === 'string' && data.length > 0 ? `: ${data}` : '';
  return new Error(`${action} failed${details}${Number.isInteger(code) ? ` (${code})` : ''}`);
}

function invoke(fileApi, method, options, { missingValue, result } = {}) {
  requiredFunction(fileApi?.[method], `fileApi.${method}`);
  return new Promise((resolve, reject) => {
    fileApi[method](
      Object.assign({}, options, {
        success: (value) => resolve(result ? result(value) : value),
        fail: (data, code) => {
          if (missingValue !== undefined && code === FILE_NOT_FOUND_CODE) {
            resolve(missingValue);
            return;
          }
          reject(fileError(`File ${method}`, data, code));
        },
      }),
    );
  });
}

export function createLiteFileStore({ fileApi, now = Date.now } = {}) {
  let sequence = 0;

  return {
    async writeOutbound(serialized) {
      sequence += 1;
      const uri = `internal://app/gymcoach-${safeFileToken(now())}-${sequence}.json`;
      await invoke(fileApi, 'writeText', {
        append: false,
        encoding: 'UTF-8',
        text: serialized,
        uri,
      });
      return { mode: 'text', mode2: 'R', name: uri };
    },

    async readInbound(uri) {
      return invoke(
        fileApi,
        'readText',
        { encoding: 'UTF-8', uri },
        { result: (value) => value?.text ?? '' },
      );
    },

    async removeOutbound(uri) {
      await invoke(fileApi, 'delete', { uri }, { missingValue: null });
    },

    async removeInbound(uri) {
      await invoke(fileApi, 'delete', { uri }, { missingValue: null });
    },
  };
}

export function createLiteStorageBackend({ fileApi, stateUri = DEFAULT_STATE_URI } = {}) {
  return {
    async get() {
      return invoke(
        fileApi,
        'readText',
        { encoding: 'UTF-8', uri: stateUri },
        { missingValue: null, result: (value) => value?.text ?? '' },
      );
    },

    async set(_key, value) {
      await invoke(fileApi, 'writeText', {
        append: false,
        encoding: 'UTF-8',
        text: value,
        uri: stateUri,
      });
    },

    async remove() {
      await invoke(fileApi, 'delete', { uri: stateUri }, { missingValue: null });
    },
  };
}
