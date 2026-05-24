import {
  buildTrack,
  createUpload,
  mergeTrack,
  readCatalog,
  readJsonBody,
  requireUploadKey,
  sendJson,
  validateUpload,
  verifyUploadedTrack,
  writeCatalog,
} from './_music-shared.mjs';

export default async function handler(request, response) {
  if (request.method === 'OPTIONS') {
    response.statusCode = 204;
    return response.end();
  }

  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return sendJson(response, 405, { error: 'Method not allowed.' });
  }

  const auth = requireUploadKey(request);
  if (!auth.ok) return sendJson(response, auth.statusCode, { error: auth.message });

  try {
    const body = await readJsonBody(request);
    const validationError = validateUpload(body);
    if (validationError) return sendJson(response, 400, { error: validationError });

    const track = buildTrack(body);

    if (body.action === 'sign') {
      const upload = await createUpload(track, body.contentType || 'audio/mpeg');
      return sendJson(response, 200, { ...upload, track });
    }

    if (body.action === 'complete') {
      await verifyUploadedTrack(track);
      const catalog = await readCatalog();
      const updated = await writeCatalog(mergeTrack(catalog, track));
      return sendJson(response, 200, { track, catalog: updated });
    }

    return sendJson(response, 400, { error: 'Unknown upload action.' });
  } catch (error) {
    return sendJson(response, 500, { error: error.message || 'Upload failed.' });
  }
}
