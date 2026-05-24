import { randomUUID, timingSafeEqual } from 'node:crypto';
import { HeadObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import staticCatalog from '../src/data/yng-music.json' with { type: 'json' };

export const BUCKET = process.env.YNG_MUSIC_BUCKET || 'yng-music-archive';
export const REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';
export const PREFIX = process.env.YNG_MUSIC_PREFIX || 'tracks/render-project';
export const PUBLIC_BASE_URL = `https://${BUCKET}.s3.${REGION}.amazonaws.com`;
export const CATALOG_KEY = `${PREFIX}/catalog.json`;
export const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;

const s3 = new S3Client({ region: REGION });

export function sendJson(response, statusCode, data) {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(data));
}

export async function readJsonBody(request) {
  if (request.body && typeof request.body === 'object') return request.body;
  if (typeof request.body === 'string') return JSON.parse(request.body || '{}');

  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

export function requireUploadKey(request) {
  const expected = process.env.YNG_MUSIC_UPLOAD_KEY;
  if (!expected) {
    return { ok: false, statusCode: 503, message: 'Music uploads are not configured.' };
  }

  const provided = String(request.headers['x-yng-upload-key'] || '');
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  const matches = expectedBuffer.length === providedBuffer.length
    && timingSafeEqual(expectedBuffer, providedBuffer);

  return matches
    ? { ok: true }
    : { ok: false, statusCode: 401, message: 'Upload key required.' };
}

export function titleFromFilename(fileName) {
  return fileName
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || 'Untitled';
}

export function slugify(value) {
  const slug = value
    .normalize('NFKD')
    .replace(/[^\w\s.-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .toLowerCase();

  return slug || 'untitled';
}

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const rounded = Math.round(seconds);
  const minutes = Math.floor(rounded / 60);
  const secs = String(rounded % 60).padStart(2, '0');
  return `${minutes}:${secs}`;
}

export function publicUrlForKey(key) {
  return `${PUBLIC_BASE_URL}/${encodeURI(key).replace(/%2F/g, '/')}`;
}

export function buildTrack(input) {
  const fileName = String(input.fileName || '').trim();
  const sha256 = String(input.sha256 || '').toLowerCase();
  const title = String(input.title || titleFromFilename(fileName)).trim() || 'Untitled';
  const sizeBytes = Number(input.sizeBytes);
  const durationSeconds = Number(input.durationSeconds) || 0;
  const safeId = sha256 ? sha256.slice(0, 16) : randomUUID().replace(/-/g, '').slice(0, 16);
  const key = `${PREFIX}/${slugify(title)}-${safeId.slice(0, 12)}.mp3`;

  return {
    id: safeId,
    title,
    fileName,
    format: 'mp3',
    sizeBytes,
    modifiedAt: new Date().toISOString(),
    durationSeconds,
    duration: formatDuration(durationSeconds),
    sha256,
    s3Key: key,
    url: publicUrlForKey(key),
  };
}

export function validateUpload(input) {
  const fileName = String(input.fileName || '').trim();
  const sizeBytes = Number(input.sizeBytes);
  const sha256 = String(input.sha256 || '').toLowerCase();
  const contentType = String(input.contentType || 'audio/mpeg').toLowerCase();

  if (!fileName.toLowerCase().endsWith('.mp3')) return 'Only .mp3 uploads are supported here.';
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return 'Upload size is invalid.';
  if (sizeBytes > MAX_UPLOAD_BYTES) return 'Upload is too large.';
  if (!/^[a-f0-9]{64}$/.test(sha256)) return 'Upload checksum is invalid.';
  if (!['audio/mpeg', 'audio/mp3', 'application/octet-stream'].includes(contentType)) {
    return 'Upload must be an MP3 file.';
  }

  return '';
}

export async function createUpload(track, contentType) {
  const metadata = {
    sha256: track.sha256,
    filename: encodeURIComponent(track.fileName),
    title: encodeURIComponent(track.title),
    durationSeconds: String(track.durationSeconds || 0),
  };

  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: track.s3Key,
    ContentType: contentType || 'audio/mpeg',
    CacheControl: 'public, max-age=31536000, immutable',
    Metadata: metadata,
  });

  const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 300 });

  return {
    uploadUrl,
    headers: {
      'Content-Type': contentType || 'audio/mpeg',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  };
}

export async function verifyUploadedTrack(track) {
  const head = await s3.send(new HeadObjectCommand({
    Bucket: BUCKET,
    Key: track.s3Key,
  }));

  if (head.ContentLength !== track.sizeBytes) {
    throw new Error('Uploaded file size did not match.');
  }

  if (head.Metadata?.sha256 !== track.sha256) {
    throw new Error('Uploaded file checksum metadata did not match.');
  }

  return true;
}

export async function readCatalog() {
  try {
    const object = await s3.send(new GetObjectCommand({
      Bucket: BUCKET,
      Key: CATALOG_KEY,
    }));
    return JSON.parse(await object.Body.transformToString());
  } catch (error) {
    if (['NoSuchKey', 'NotFound'].includes(error.name)) return staticCatalog;
    return staticCatalog;
  }
}

export async function writeCatalog(tracks) {
  const sortedTracks = [...tracks].sort((a, b) => a.title.localeCompare(b.title));
  const catalog = {
    generatedAt: new Date().toISOString(),
    source: 'web-upload',
    bucket: BUCKET,
    prefix: PREFIX,
    publicBaseUrl: PUBLIC_BASE_URL,
    trackCount: sortedTracks.length,
    totalSizeBytes: sortedTracks.reduce((sum, track) => sum + Number(track.sizeBytes || 0), 0),
    tracks: sortedTracks,
  };

  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: CATALOG_KEY,
    Body: JSON.stringify(catalog, null, 2),
    ContentType: 'application/json; charset=utf-8',
    CacheControl: 'no-store',
  }));

  return catalog;
}

export function mergeTrack(catalog, track) {
  return [
    track,
    ...(catalog.tracks || []).filter(existing => (
      existing.s3Key !== track.s3Key
      && existing.sha256 !== track.sha256
    )),
  ];
}
