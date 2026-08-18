#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const manifestPath = process.env.SOUNDCLOUD_MANIFEST
  || '/Users/luke/Documents/ChatGPT/music/soundcloud-export/manifest.csv';
const remoteHost = process.env.YNG_MUSIC_AWS_HOST || 'm2';
const intervalMs = Number(process.env.SOUNDCLOUD_WATCH_INTERVAL_MS || 45_000);
const expectedRows = Number(process.env.SOUNDCLOUD_EXPECTED_ROWS || 978);
const reportPath = `${root}/tmp/soundcloud-upload-plan.json`;
const preparedPath = `${root}/tmp/soundcloud-browser-upload-files.json`;
const syncScript = `${root}/tools/music-sync.mjs`;
const liveCatalogPath = `${root}/tmp/yng-music-live-catalog.json`;
const sourceManifestPath = `${root}/tmp/soundcloud-watch-source.tsv`;
const awsDir = join(homedir(), '.aws');
const awsConfigPath = join(awsDir, 'config');
const awsCredentialsPath = join(awsDir, 'credentials');

let stopping = false;

function log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

async function run(command, args, options = {}) {
  const result = await execFileAsync(command, args, {
    cwd: root,
    maxBuffer: 1024 * 1024 * 20,
    ...options,
  });
  if (result.stdout.trim()) console.log(result.stdout.trim());
  if (result.stderr.trim()) console.error(result.stderr.trim());
  return result.stdout.trim();
}

async function hasLocalCredentials() {
  try {
    await Promise.all([access(awsConfigPath), access(awsCredentialsPath)]);
    return true;
  } catch {
    return false;
  }
}

async function ensureLocalCredentials() {
  if (await hasLocalCredentials()) return;

  await run('ssh', ['-o', 'ConnectTimeout=12', '-o', 'BatchMode=yes', remoteHost, 'true']);
  const temporary = await mkdtemp(join(tmpdir(), 'yng-m2-aws.'));
  try {
    await run('scp', [
      '-q',
      `${remoteHost}:/Users/luke/.aws/config`,
      `${remoteHost}:/Users/luke/.aws/credentials`,
      `${temporary}/`,
    ]);
    const [config, credentials] = await Promise.all([
      readFile(join(temporary, 'config'), 'utf8'),
      readFile(join(temporary, 'credentials'), 'utf8'),
    ]);
    if (!/^\s*\[[^\]]+\]/m.test(config)) throw new Error('Copied AWS config is invalid.');
    if (!/^\s*aws_access_key_id\s*=/m.test(credentials)) throw new Error('Copied AWS credentials lack an access key.');
    if (!/^\s*aws_secret_access_key\s*=/m.test(credentials)) throw new Error('Copied AWS credentials lack a secret key.');

    await mkdir(awsDir, { recursive: true, mode: 0o700 });
    await copyFile(join(temporary, 'config'), awsConfigPath, constants.COPYFILE_EXCL);
    await copyFile(join(temporary, 'credentials'), awsCredentialsPath, constants.COPYFILE_EXCL);
    await Promise.all([chmod(awsConfigPath, 0o600), chmod(awsCredentialsPath, 0o600)]);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
  await run('aws', ['sts', 'get-caller-identity', '--output', 'json']);
  log('AWS credentials copied locally; m2 is no longer needed for uploads');
}

async function syncPrepared(files) {
  await writeFile(sourceManifestPath, `path\n${files.join('\n')}\n`);
  await run('aws', [
    's3', 'cp',
    's3://yng-music-archive/tracks/render-project/catalog.json',
    liveCatalogPath,
    '--only-show-errors',
  ]);
  await run('node', [syncScript, 'sync', '--merge-catalog'], {
    env: {
      ...process.env,
      YNG_MUSIC_SOURCE_MANIFEST: sourceManifestPath,
      YNG_MUSIC_CATALOG_PATH: liveCatalogPath,
      YNG_MUSIC_BUCKET: 'yng-music-archive',
      YNG_MUSIC_PREFIX: 'tracks/render-project',
      YNG_MUSIC_UPLOAD_CONCURRENCY: '4',
      YNG_MUSIC_CATALOG_CHECKPOINT_EVERY: '25',
      AWS_REGION: 'us-east-1',
    },
  });
}

async function manifestRowCount() {
  const text = await readFile(manifestPath, 'utf8');
  return Math.max(0, text.trim().split(/\r?\n/).length - 1);
}

async function cycle() {
  await ensureLocalCredentials();
  await run('node', ['tools/soundcloud-export-upload.mjs', 'plan']);
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  const rows = await manifestRowCount();

  if (report.uploadCount === 0) {
    log(`checkpoint clean: rows=${rows}, downloaded=${report.manifestTrackCount}, catalog=${report.catalogTrackCount}`);
    return rows;
  }

  log(`syncing ${report.uploadCount} candidate(s); clear duplicates=${report.clearDuplicateCount}; review candidates retained=${report.reviewCandidateCount}`);
  await run('node', ['tools/soundcloud-export-upload.mjs', 'prepare']);
  const prepared = JSON.parse(await readFile(preparedPath, 'utf8'));
  if (prepared.files.length > 0) await syncPrepared(prepared.files);

  const response = await fetch(`https://yng.sh/api/music-catalog?refresh=${Date.now()}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Live catalog verification failed: HTTP ${response.status}`);
  const live = await response.json();
  log(`live catalog verified: ${live.trackCount ?? live.tracks?.length} tracks`);
  return rows;
}

process.on('SIGINT', () => { stopping = true; });
process.on('SIGTERM', () => { stopping = true; });

log('continuous SoundCloud sync watcher started');
let failures = 0;
while (!stopping) {
  try {
    const rows = await cycle();
    failures = 0;
    if (rows >= expectedRows) {
      log(`all ${rows} account rows are represented; watcher complete`);
      break;
    }
  } catch (error) {
    failures += 1;
    console.error(`[${new Date().toISOString()}] cycle failed (${failures}): ${error.stack || error.message}`);
  }
  if (!stopping) await new Promise(resolve => setTimeout(resolve, intervalMs));
}

log('watcher stopped');
