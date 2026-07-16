import assert from 'node:assert/strict';
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';
import { parseAsync } from '@babel/core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checkOnly = process.argv.includes('--check');
const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'gymcoach-watch-bundle-'));

const paths = {
  productionApp: path.join(root, 'entry/src/main/js/MainAbility/app.js'),
  productionPage: path.join(root, 'entry/src/main/js/MainAbility/pages/index/index.js'),
  previewApp: path.join(root, 'preview-harness/entry/src/main/js/MainAbility/app.js'),
  previewPage: path.join(
    root,
    'preview-harness/entry/src/main/js/MainAbility/pages/index/index.js',
  ),
};

async function bundle(
  entryPoint,
  outfile,
  external = [],
  normalizeAppDefault = false,
) {
  await mkdir(path.dirname(outfile), { recursive: true });
  await build({
    bundle: true,
    entryPoints: [entryPoint],
    external,
    format: 'esm',
    legalComments: 'none',
    minify: true,
    outfile,
    platform: 'neutral',
    target: 'es2017',
  });
  const bundled = await readFile(outfile, 'utf8');
  const normalized = normalizeAppDefault
    ? bundled.replace(
        /export\s*\{\s*([A-Za-z_$][A-Za-z0-9_$]*)\s+as\s+default\s*\};?\s*$/u,
        'export default $1;',
      )
    : bundled;
  const code = normalized;
  if (normalizeAppDefault) {
    assert.match(code, /export default [A-Za-z_$][A-Za-z0-9_$]*;$/u);
  }
  await assertNoRegExp(code, outfile);
  await writeFile(outfile, `${code}\n`, 'utf8');
}

async function assertNoRegExp(code, outfile) {
  const ast = await parseAsync(code, { filename: outfile, sourceType: 'module' });
  const pending = [ast];
  while (pending.length > 0) {
    const value = pending.pop();
    if (!value || typeof value !== 'object') {
      continue;
    }
    if (value.type === 'RegExpLiteral') {
      throw new Error(
        `${outfile} contains RegExp /${value.pattern}/${value.flags} unsupported by Lite JerryScript.`,
      );
    }
    if (Array.isArray(value)) {
      pending.push(...value);
    } else {
      pending.push(...Object.values(value));
    }
  }
}

async function buildOutputs(base) {
  const outputs = Object.fromEntries(
    Object.entries(paths).map(([name, target]) => [name, path.join(base, name, path.basename(target))]),
  );
  await bundle(
    path.join(root, 'src/lite/physical-install-app.js'),
    outputs.productionApp,
    [],
    true,
  );
  await bundle(
    path.join(root, 'src/lite/physical-install-page.js'),
    outputs.productionPage,
    [],
    true,
  );
  await mkdir(path.dirname(outputs.previewApp), { recursive: true });
  await copyFile(path.join(root, 'src/lite/preview-app.js'), outputs.previewApp);
  await mkdir(path.dirname(outputs.previewPage), { recursive: true });
  await copyFile(path.join(root, 'src/lite/preview-page.js'), outputs.previewPage);
  return outputs;
}

async function assertPortable(file, { allowSystemImports = false } = {}) {
  const content = await readFile(file, 'utf8');
  assert.equal(/\brequire\s*\(/u.test(content), false, `${file} contains require().`);
  assert.equal(/from\s+["'](?:\.\.?\/|[A-Za-z]:)/u.test(content), false, `${file} has a local import.`);
  if (!allowSystemImports) {
    assert.equal(content.includes('@system.'), false, `${file} contains a system API import.`);
  }
  assert.equal(content.endsWith('\n'), true, `${file} must end with a newline.`);
}

async function compare(expected, actual) {
  assert.equal(await readFile(actual, 'utf8'), await readFile(expected, 'utf8'), `${actual} is stale.`);
}

try {
  const generated = await buildOutputs(tempRoot);
  await assertPortable(generated.productionApp, { allowSystemImports: true });
  await assertPortable(generated.productionPage);
  await assertPortable(generated.previewApp);
  await assertPortable(generated.previewPage);

  if (checkOnly) {
    for (const [name, target] of Object.entries(paths)) {
      await compare(generated[name], target);
    }
  } else {
    for (const [name, target] of Object.entries(paths)) {
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(generated[name], target);
    }

    const copies = [
      ['entry/src/main/js/MainAbility/pages/index/index.hml', 'preview-harness/entry/src/main/js/MainAbility/pages/index/index.hml'],
      ['entry/src/main/js/MainAbility/pages/index/index.css', 'preview-harness/entry/src/main/js/MainAbility/pages/index/index.css'],
      ['entry/src/main/resources/base/element/string.json', 'preview-harness/entry/src/main/resources/base/element/string.json'],
      ['entry/src/main/resources/base/media/icon.png', 'preview-harness/entry/src/main/resources/base/media/icon.png'],
      ['entry/src/main/resources/base/media/icon_small.png', 'preview-harness/entry/src/main/resources/base/media/icon_small.png'],
    ];
    for (const [source, target] of copies) {
      const absoluteTarget = path.join(root, target);
      await mkdir(path.dirname(absoluteTarget), { recursive: true });
      await copyFile(path.join(root, source), absoluteTarget);
    }
  }
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

console.log(checkOnly ? 'Lite bundles are current.' : 'Lite production and preview bundles generated.');
