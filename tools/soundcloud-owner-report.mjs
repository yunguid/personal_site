#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import catalog from '../src/data/yng-music.json' with { type: 'json' };

const execFileAsync = promisify(execFile);

const TMP_DIR = 'tmp';
const SOUNDCLOUD_PROFILE = process.env.SOUNDCLOUD_PROFILE || 'https://soundcloud.com/user-859103666';
const EXPECTED_UPLOADER_ID = process.env.SOUNDCLOUD_UPLOADER_ID || '335343118';
const STABLE_TSV_PATH = join(TMP_DIR, 'soundcloud-owner-track-report.tsv');

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

async function runYtDlpJsonLines(args) {
  const { stdout } = await execFileAsync('yt-dlp', args, { maxBuffer: 1024 * 1024 * 50 });
  return stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
}

async function publicFlatTracks() {
  return runYtDlpJsonLines([
    '--flat-playlist',
    '--dump-json',
    '--skip-download',
    '--no-warnings',
    `${SOUNDCLOUD_PROFILE}/tracks`,
  ]);
}

async function safeTrackMetadata(url) {
  try {
    const [metadata] = await runYtDlpJsonLines([
      '--dump-json',
      '--skip-download',
      '--no-warnings',
      '--no-playlist',
      url,
    ]);

    return {
      ok: true,
      id: metadata.id,
      title: metadata.title,
      uploader: metadata.uploader,
      uploaderId: metadata.uploader_id,
      webpageUrl: metadata.webpage_url,
      durationSeconds: metadata.duration ?? null,
      timestamp: metadata.timestamp ?? null,
      uploadDate: metadata.upload_date ?? null,
      description: metadata.description || '',
      license: metadata.license ?? null,
      availability: metadata.availability ?? null,
      publicMetadataDownloadableField: metadata.downloadable ?? null,
      formatCount: Array.isArray(metadata.formats) ? metadata.formats.length : 0,
    };
  } catch (error) {
    return {
      ok: false,
      error: error.stderr || error.message,
    };
  }
}

function tsvEscape(value) {
  return String(value ?? '').replaceAll('\t', ' ').replaceAll('\n', ' ');
}

function rowsToTsv(headers, rows) {
  return `${[
    headers,
    ...rows.map(row => headers.map(header => row[header] ?? '')),
  ].map(row => row.map(tsvEscape).join('\t')).join('\n')}\n`;
}

const catalogNames = catalogNameIndex();
const flatTracks = await publicFlatTracks();
const tracks = [];

for (const flatTrack of flatTracks) {
  const trackUrl = flatTrack.webpage_url || flatTrack.url;
  const metadata = await safeTrackMetadata(trackUrl);
  const title = metadata.title || flatTrack.title;
  const normalizedTitle = normalize(title);
  const catalogMatches = catalogNames.get(normalizedTitle) || [];
  const uploaderId = metadata.uploaderId || flatTrack.playlist_id || null;

  tracks.push({
    id: metadata.id || flatTrack.id,
    title,
    normalizedTitle,
    url: metadata.webpageUrl || trackUrl,
    uploader: metadata.uploader || null,
    uploaderId,
    uploaderMatchesExpected: uploaderId === EXPECTED_UPLOADER_ID,
    durationSeconds: metadata.durationSeconds ?? null,
    uploadDate: metadata.uploadDate ?? null,
    catalogNameMatchCount: catalogMatches.length,
    catalogNameMatches: catalogMatches.slice(0, 5),
    officialOriginalDownloadStatus: 'not-verified-from-public-metadata',
    nextOfficialDownloadStep: 'check signed-in SoundCloud web UI for a Download file button or request account data export/support archive',
    publicMetadataDownloadableField: metadata.publicMetadataDownloadableField ?? null,
    metadataOk: metadata.ok,
    metadataError: metadata.ok ? null : metadata.error,
  });
}

const report = {
  generatedAt: new Date().toISOString(),
  mode: 'metadata-only SoundCloud owner review; no media downloaded and no stream URLs stored',
  profile: SOUNDCLOUD_PROFILE,
  expectedUploaderId: EXPECTED_UPLOADER_ID,
  publicTracksCount: tracks.length,
  uploaderMatchedCount: tracks.filter(track => track.uploaderMatchesExpected).length,
  catalogNameMatchedCount: tracks.filter(track => track.catalogNameMatchCount > 0).length,
  catalogNameUnmatchedCount: tracks.filter(track => track.catalogNameMatchCount === 0).length,
  officialOriginalDownloadsVerifiedCount: 0,
  officialOriginalDownloadsPendingCount: tracks.length,
  tracks,
};

await mkdir(TMP_DIR, { recursive: true });
const stamp = Date.now();
const reportPath = join(TMP_DIR, `soundcloud-owner-track-report-${stamp}.json`);
const reportTsvPath = join(TMP_DIR, `soundcloud-owner-track-report-${stamp}.tsv`);
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);

const tsvHeaders = [
  'status',
  'title',
  'url',
  'id',
  'uploader_matches_expected',
  'catalog_name_match_count',
  'catalog_name_matches',
  'public_metadata_downloadable_field',
  'next_official_download_step',
  'local_original_file_path',
  'downloaded_sha256',
  'upload_decision',
  'notes',
];
const tsvRows = tracks.map(track => ({
  status: track.officialOriginalDownloadStatus,
  title: track.title,
  url: track.url,
  id: track.id,
  uploader_matches_expected: track.uploaderMatchesExpected ? 'yes' : 'no',
  catalog_name_match_count: track.catalogNameMatchCount,
  catalog_name_matches: track.catalogNameMatches.map(match => match.fileName || match.title).join('; '),
  public_metadata_downloadable_field: track.publicMetadataDownloadableField ?? '',
  next_official_download_step: track.nextOfficialDownloadStep,
  local_original_file_path: '',
  downloaded_sha256: '',
  upload_decision: '',
  notes: '',
}));
const tsv = rowsToTsv(tsvHeaders, tsvRows);
await writeFile(reportTsvPath, tsv);
await writeFile(STABLE_TSV_PATH, tsv);

console.log(JSON.stringify({
  reportPath: join(process.cwd(), reportPath),
  reportTsvPath: join(process.cwd(), reportTsvPath),
  stableReportTsvPath: join(process.cwd(), STABLE_TSV_PATH),
  publicTracksCount: report.publicTracksCount,
  uploaderMatchedCount: report.uploaderMatchedCount,
  catalogNameMatchedCount: report.catalogNameMatchedCount,
  catalogNameUnmatchedCount: report.catalogNameUnmatchedCount,
  officialOriginalDownloadsVerifiedCount: report.officialOriginalDownloadsVerifiedCount,
  officialOriginalDownloadsPendingCount: report.officialOriginalDownloadsPendingCount,
  unmatchedTitles: tracks
    .filter(track => track.catalogNameMatchCount === 0)
    .map(track => track.title),
}, null, 2));
