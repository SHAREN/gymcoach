import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const includedExtensions = new Set(['.css', '.hml', '.js', '.json', '.md', '.mjs']);
const ignoredDirectories = new Set(['node_modules']);

async function collect(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.') || ignoredDirectories.has(entry.name)) {
      continue;
    }
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collect(absolute)));
    } else if (includedExtensions.has(path.extname(entry.name))) {
      files.push(absolute);
    }
  }

  return files;
}

const files = await collect(root);
for (const file of files) {
  const content = await readFile(file, 'utf8');
  const relative = path.relative(root, file);
  assert.equal(content.includes('\r'), false, `${relative} must use LF line endings.`);
  assert.equal(content.endsWith('\n'), true, `${relative} must end with a newline.`);
  assert.equal(content.endsWith('\n\n'), false, `${relative} has a blank line at EOF.`);
  assert.equal(/[\t ]+$/m.test(content), false, `${relative} has trailing whitespace.`);
  assert.equal(/[\u2013\u2014]/u.test(content), false, `${relative} contains an en dash or em dash.`);
}

console.log(`Checked formatting for ${files.length} files.`);
