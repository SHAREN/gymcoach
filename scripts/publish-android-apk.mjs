import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputMetadataPath = path.join(
  root,
  'android/app/build/outputs/apk/debug/output-metadata.json',
);
const outputMetadata = JSON.parse(await readFile(outputMetadataPath, 'utf8'));
const output = outputMetadata.elements?.[0];
if (!output || !Number.isInteger(output.versionCode) || typeof output.versionName !== 'string') {
  throw new Error('Android output-metadata.json does not contain a valid debug APK version.');
}
const sourceApk = path.resolve(
  root,
  process.argv[2] ?? path.join(path.dirname(outputMetadataPath), output.outputFile),
);
const outputDirectory = path.resolve(
  root,
  process.env.ANDROID_RELEASE_DIR ?? 'data/android-release',
);
const apk = await readFile(sourceApk);
const sha256 = createHash('sha256').update(apk).digest('hex');
const apkFile = `gymcoach-${output.versionCode}-${sha256.slice(0, 12)}.apk`;

await mkdir(outputDirectory, { recursive: true });
await copyFile(sourceApk, path.join(outputDirectory, apkFile));

const publishedApk = await stat(path.join(outputDirectory, apkFile));
const metadata = {
  versionCode: output.versionCode,
  versionName: output.versionName,
  sha256,
  sizeBytes: publishedApk.size,
  publishedAt: new Date().toISOString(),
  apkFile,
};

const metadataPath = path.join(outputDirectory, 'latest.json');
const temporaryMetadataPath = path.join(
  outputDirectory,
  `.latest-${process.pid}-${Date.now()}.json`,
);
await writeFile(temporaryMetadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
await rename(temporaryMetadataPath, metadataPath);
console.log(
  `Published GymCoach Android ${output.versionName} (${output.versionCode}) to ${outputDirectory}`,
);
