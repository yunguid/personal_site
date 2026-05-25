#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import catalog from '../src/data/yng-music.json' with { type: 'json' };

const execFileAsync = promisify(execFile);

const AUDIO_EXTENSIONS = new Set(['.aif', '.aiff', '.wav', '.mp3']);
const PROJECT_EXTENSIONS = new Set(['.als']);
const FLAT_ROOTS = [
  '/Users/luke/Desktop/render-project',
  '/Users/luke/Desktop/si-project',
];
const PROJECT_SEARCH_ROOTS = [
  '/Users/luke/Desktop/render-project',
  '/Users/luke/Desktop/si-project',
  '/Users/luke/Music',
  '/Users/luke/Documents',
];
const EXCLUDED_PATH_PARTS = new Set([
  'Backup',
  'Ableton Project Info',
  'Defaults',
  'Templates',
  'node_modules',
  '.git',
]);
const SOUNDCLOUD_PROFILE = process.env.SOUNDCLOUD_PROFILE || 'https://soundcloud.com/user-859103666';

function normalize(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/\.[^.]+$/, '')
    .replace(/[^\p{L}\p{N}\s.-]+/gu, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .toLowerCase();
}

function excluded(filePath) {
  return filePath.split('/').some(part => EXCLUDED_PATH_PARTS.has(part));
}

async function sha256(filePath) {
  const hash = createHash('sha256');
  await new Promise((resolve, reject) => {
    createReadStream(filePath)
      .on('data', chunk => hash.update(chunk))
      .on('error', reject)
      .on('end', resolve);
  });
  return hash.digest('hex');
}

async function flatInventory(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const projects = [];
  const audio = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;

    const filePath = join(root, entry.name);
    const ext = extname(entry.name).toLowerCase();
    if (!PROJECT_EXTENSIONS.has(ext) && !AUDIO_EXTENSIONS.has(ext)) continue;

    const fileStat = await stat(filePath);
    const item = {
      path: filePath,
      fileName: entry.name,
      ext,
      normalizedBase: normalize(basename(entry.name, ext)),
      sizeBytes: fileStat.size,
      modifiedAt: fileStat.mtime.toISOString(),
    };

    if (PROJECT_EXTENSIONS.has(ext)) projects.push(item);
    if (AUDIO_EXTENSIONS.has(ext)) audio.push(item);
  }

  return { root, projects, audio };
}

async function findProjects(root, depthLimit = 5) {
  const out = [];

  async function walk(dir, depth) {
    if (depth > depthLimit || excluded(dir)) return;

    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const filePath = join(dir, entry.name);
      if (excluded(filePath)) continue;

      if (entry.isDirectory()) {
        await walk(filePath, depth + 1);
      } else if (entry.isFile() && PROJECT_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
        const fileStat = await stat(filePath);
        out.push({
          path: filePath,
          directory: dirname(filePath),
          fileName: entry.name,
          normalizedBase: normalize(basename(entry.name, extname(entry.name))),
          sizeBytes: fileStat.size,
          modifiedAt: fileStat.mtime.toISOString(),
        });
      }
    }
  }

  await walk(root, 0);
  return out;
}

async function runJson(cmd, args) {
  const { stdout } = await execFileAsync(cmd, args, { maxBuffer: 1024 * 1024 * 50 });
  return JSON.parse(stdout || '{}');
}

async function soundcloudFlat(url) {
  try {
    const { stdout } = await execFileAsync('yt-dlp', [
      '--flat-playlist',
      '--dump-json',
      '--skip-download',
      '--no-warnings',
      url,
    ], { maxBuffer: 1024 * 1024 * 20 });

    return stdout.trim().split('\n').filter(Boolean).map(line => {
      const item = JSON.parse(line);
      return {
        id: item.id,
        title: item.title,
        url: item.url || item.webpage_url,
        webpageUrl: item.webpage_url,
        extractor: item.extractor,
        playlist: item.playlist,
        playlistIndex: item.playlist_index,
      };
    });
  } catch (error) {
    return { error: error.stderr || error.message };
  }
}

function catalogNameIndex() {
  const index = new Map();

  for (const track of catalog.tracks) {
    for (const value of [track.title, track.fileName, track.s3Key]) {
      const key = normalize(basename(String(value || ''), extname(String(value || ''))));
      if (!key) continue;
      index.set(key, [
        ...(index.get(key) || []),
        {
          title: track.title,
          fileName: track.fileName,
          s3Key: track.s3Key,
          sha256: track.sha256,
        },
      ]);
    }
  }

  return index;
}

function summarizeRoot(root) {
  const audioNames = new Set(root.audio.map(item => item.normalizedBase));
  const projectNames = new Set(root.projects.map(item => item.normalizedBase));
  const projectsWithoutRender = root.projects.filter(item => !audioNames.has(item.normalizedBase));

  return {
    root: root.root,
    projectCount: root.projects.length,
    audioCount: root.audio.length,
    audioByExt: root.audio.reduce((acc, item) => {
      acc[item.ext] = (acc[item.ext] || 0) + 1;
      return acc;
    }, {}),
    projectsWithSameBasenameRender: root.projects.length - projectsWithoutRender.length,
    projectsWithoutSameBasenameRender: projectsWithoutRender.length,
    renderedWithoutSameBasenameProject: root.audio.filter(item => !projectNames.has(item.normalizedBase)).length,
    sampleProjectsWithoutRender: projectsWithoutRender.slice(0, 30).map(item => item.path),
  };
}

const catalogHashes = new Set(catalog.tracks.map(track => track.sha256));
const catalogKeys = new Set(catalog.tracks.map(track => track.s3Key));
const catalogNames = catalogNameIndex();

const roots = [];
for (const root of FLAT_ROOTS) {
  roots.push(await flatInventory(root));
}

const candidateAudio = roots.flatMap(root => (
  root.audio.map(item => ({ ...item, root: root.root }))
));

for (const [index, item] of candidateAudio.entries()) {
  item.sha256 = await sha256(item.path);
  item.exactCatalogMatch = catalogHashes.has(item.sha256);
  item.nameCatalogMatches = catalogNames.get(item.normalizedBase) || [];
  if ((index + 1) % 50 === 0) {
    console.error(`hashed ${index + 1}/${candidateAudio.length}`);
  }
}

const allProjects = [];
for (const root of PROJECT_SEARCH_ROOTS) {
  allProjects.push(...await findProjects(root));
}
const uniqueProjects = [...new Map(allProjects.map(item => [item.path, item])).values()];

const archive = await runJson('aws', [
  's3api',
  'list-objects-v2',
  '--bucket',
  'yng-music-archive',
  '--prefix',
  'tracks/render-project/',
]);
const olderHomepageBucket = await runJson('aws', [
  's3api',
  'list-objects-v2',
  '--bucket',
  'lukemusicbucket',
]);
const archiveKeys = new Set((archive.Contents || []).map(item => item.Key));

const publicTracks = await soundcloudFlat(`${SOUNDCLOUD_PROFILE}/tracks`);
const publicAll = await soundcloudFlat(SOUNDCLOUD_PROFILE);

const manifest = {
  generatedAt: new Date().toISOString(),
  mode: 'read-only inventory; no uploads, exports, deletes, or catalog/source mutations performed',
  repo: process.cwd(),
  catalog: {
    path: 'src/data/yng-music.json',
    bucket: catalog.bucket,
    prefix: catalog.prefix,
    generatedAt: catalog.generatedAt,
    trackCountDeclared: catalog.trackCount,
    trackCountActual: catalog.tracks.length,
    uniqueHashes: catalogHashes.size,
    duplicateHashes: catalog.tracks.length - catalogHashes.size,
    uniqueKeys: catalogKeys.size,
    duplicateKeys: catalog.tracks.length - catalogKeys.size,
    formats: catalog.tracks.reduce((acc, track) => {
      acc[track.format] = (acc[track.format] || 0) + 1;
      return acc;
    }, {}),
    totalSizeBytes: catalog.totalSizeBytes,
  },
  s3: {
    archive: {
      bucket: 'yng-music-archive',
      prefix: 'tracks/render-project/',
      listedObjectCount: (archive.Contents || []).length,
      totalSizeBytes: (archive.Contents || []).reduce((sum, item) => sum + Number(item.Size || 0), 0),
      catalogKeysMissingInS3: [...catalogKeys].filter(key => !archiveKeys.has(key)),
      archiveObjectsNotInCatalog: [...archiveKeys].filter(key => (
        key !== 'tracks/render-project/catalog.json' && !catalogKeys.has(key)
      )),
    },
    olderHomepageBucket: {
      bucket: 'lukemusicbucket',
      listedObjectCount: (olderHomepageBucket.Contents || []).length,
      totalSizeBytes: (olderHomepageBucket.Contents || []).reduce((sum, item) => sum + Number(item.Size || 0), 0),
      keys: (olderHomepageBucket.Contents || []).map(item => item.Key),
    },
  },
  local: {
    rootSummaries: roots.map(summarizeRoot),
    discoveredProjectCountUnderSearchRoots: uniqueProjects.length,
    discoveredProjects: uniqueProjects,
    discoveredProjectSamples: uniqueProjects.slice(0, 100),
    candidateAudioCount: candidateAudio.length,
    candidateAudioByExt: candidateAudio.reduce((acc, item) => {
      acc[item.ext] = (acc[item.ext] || 0) + 1;
      return acc;
    }, {}),
    candidateAudioTotalSizeBytes: candidateAudio.reduce((sum, item) => sum + item.sizeBytes, 0),
    exactLocalAudioAlreadyInCatalogBySha256: candidateAudio.filter(item => item.exactCatalogMatch).length,
    localAudioWithCatalogNameMatch: candidateAudio.filter(item => item.nameCatalogMatches.length > 0).length,
    localAudioWithoutExactOrNameCatalogMatch: candidateAudio.filter(item => (
      !item.exactCatalogMatch && item.nameCatalogMatches.length === 0
    )).length,
    localAudioWithoutCatalogNameMatchSamples: candidateAudio
      .filter(item => !item.exactCatalogMatch && item.nameCatalogMatches.length === 0)
      .slice(0, 80)
      .map(item => ({
        path: item.path,
        ext: item.ext,
        sizeBytes: item.sizeBytes,
        sha256: item.sha256,
      })),
    candidateAudio: candidateAudio.map(item => ({
      path: item.path,
      root: item.root,
      fileName: item.fileName,
      normalizedBase: item.normalizedBase,
      ext: item.ext,
      sizeBytes: item.sizeBytes,
      modifiedAt: item.modifiedAt,
      sha256: item.sha256,
      exactCatalogMatch: item.exactCatalogMatch,
      nameCatalogMatchCount: item.nameCatalogMatches.length,
      nameCatalogMatches: item.nameCatalogMatches.slice(0, 5),
    })),
  },
  soundcloud: {
    profile: SOUNDCLOUD_PROFILE,
    publicTracksUrl: `${SOUNDCLOUD_PROFILE}/tracks`,
    publicTracksCount: Array.isArray(publicTracks) ? publicTracks.length : null,
    publicTracks: Array.isArray(publicTracks) ? publicTracks : [],
    publicAllCount: Array.isArray(publicAll) ? publicAll.length : null,
    publicAllSample: Array.isArray(publicAll) ? publicAll.slice(0, 30) : [],
    privateOrOwnerOnlyStatus: 'not inventoried; use authenticated browser/session or official SoundCloud export/download UI without storing credentials',
  },
};

await mkdir('tmp', { recursive: true });
const manifestPath = `tmp/music-migration-inventory-${Date.now()}.json`;
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(JSON.stringify({
  manifestPath: join(process.cwd(), manifestPath),
  catalog: manifest.catalog,
  s3: manifest.s3,
  local: {
    rootSummaries: manifest.local.rootSummaries,
    discoveredProjectCountUnderSearchRoots: manifest.local.discoveredProjectCountUnderSearchRoots,
    candidateAudioCount: manifest.local.candidateAudioCount,
    candidateAudioByExt: manifest.local.candidateAudioByExt,
    candidateAudioTotalSizeBytes: manifest.local.candidateAudioTotalSizeBytes,
    exactLocalAudioAlreadyInCatalogBySha256: manifest.local.exactLocalAudioAlreadyInCatalogBySha256,
    localAudioWithCatalogNameMatch: manifest.local.localAudioWithCatalogNameMatch,
    localAudioWithoutExactOrNameCatalogMatch: manifest.local.localAudioWithoutExactOrNameCatalogMatch,
  },
  soundcloud: {
    profile: manifest.soundcloud.profile,
    publicTracksCount: manifest.soundcloud.publicTracksCount,
    publicTrackTitles: manifest.soundcloud.publicTracks.map(track => track.title),
    publicAllCount: manifest.soundcloud.publicAllCount,
    privateOrOwnerOnlyStatus: manifest.soundcloud.privateOrOwnerOnlyStatus,
  },
}, null, 2));
