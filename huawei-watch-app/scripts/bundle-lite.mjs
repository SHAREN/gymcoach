import assert from 'node:assert/strict';
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';
import { transformAsync } from '@babel/core';

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

async function bundle(entryPoint, outfile, external = [], normalizeAppDefault = false) {
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
    target: 'es2015',
  });
  const bundled = await readFile(outfile, 'utf8');
  const transformed = await transformAsync(bundled, {
    comments: false,
    compact: true,
    filename: outfile,
    minified: true,
    presets: [
      [
        '@babel/preset-env',
        {
          modules: false,
          targets: {
            ie: '11',
          },
          useBuiltIns: false,
        },
      ],
    ],
    sourceType: 'module',
  });
  assert.equal(typeof transformed?.code, 'string', `Babel did not emit ${outfile}.`);
  const code = normalizeAppDefault
    ? transformed.code.replace(
        /export\{([A-Za-z_$][A-Za-z0-9_$]*) as default\};?$/u,
        'export default $1;',
      )
    : transformed.code;
  if (normalizeAppDefault) {
    assert.match(code, /export default [A-Za-z_$][A-Za-z0-9_$]*;$/u);
  }
  await writeFile(outfile, `${code}\n`, 'utf8');
}

async function buildOutputs(base) {
  const outputs = Object.fromEntries(
    Object.entries(paths).map(([name, target]) => [name, path.join(base, name, path.basename(target))]),
  );
  await bundle(
    path.join(root, 'src/lite/production-app.js'),
    outputs.productionApp,
    ['@system.file', '@system.wearengine'],
    true,
  );
  await bundle(path.join(root, 'src/lite/watch-page.js'), outputs.productionPage);
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
