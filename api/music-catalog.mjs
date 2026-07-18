import { publicCatalog, readCatalog, sendJson } from './_music-shared.mjs';

export default async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return sendJson(response, 405, { error: 'Method not allowed.' });
  }

  const catalog = await readCatalog();
  return sendJson(response, 200, publicCatalog(catalog), {
    cacheControl: 'public, max-age=0, s-maxage=60, stale-while-revalidate=300',
  });
}
