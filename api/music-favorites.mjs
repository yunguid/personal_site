import {
  readFavorites,
  readJsonBody,
  requireUploadKey,
  sendJson,
  writeFavorites,
} from './_music-shared.mjs';

export default async function handler(request, response) {
  if (request.method === 'GET') {
    try {
      return sendJson(response, 200, await readFavorites());
    } catch (error) {
      return sendJson(response, 500, { error: error.message || 'Favorites could not be loaded.' });
    }
  }

  if (request.method !== 'POST') {
    response.setHeader('Allow', 'GET, POST');
    return sendJson(response, 405, { error: 'Method not allowed.' });
  }

  const auth = requireUploadKey(request);
  if (!auth.ok) return sendJson(response, auth.statusCode, { error: auth.message });

  try {
    const body = await readJsonBody(request);
    if (!Array.isArray(body.trackIds) || body.trackIds.length > 5000) {
      return sendJson(response, 400, { error: 'Favorite track IDs are invalid.' });
    }
    return sendJson(response, 200, await writeFavorites(body.trackIds));
  } catch (error) {
    return sendJson(response, 500, { error: error.message || 'Favorites could not be saved.' });
  }
}
