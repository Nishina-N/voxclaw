import * as http from 'http';
import * as https from 'https';
import * as fs from 'fs';
import * as url from 'url';

const SECRETS_PATH = '/secrets/keys.json';

function loadSecrets(): Record<string, any> {
  try {
    return JSON.parse(fs.readFileSync(SECRETS_PATH, 'utf-8'));
  } catch (e) {
    console.error('[keybinder] Failed to load secrets:', e);
    return {};
  }
}

function httpsGet(reqUrl: string, headers: Record<string, string> = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(reqUrl, { headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Request timeout')); });
  });
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url || '', true);
  const pathname = parsed.pathname || '';
  const query = parsed.query;

  res.setHeader('Content-Type', 'application/json');

  const secrets = loadSecrets();

  try {
    // ────────────────────────────────────────────
    // GET /brave?q=<query>
    // ────────────────────────────────────────────
    if (pathname === '/brave') {
      const q = query.q as string;
      if (!q) { res.writeHead(400); res.end(JSON.stringify({ error: 'Missing parameter: q' })); return; }

      const apiKey = secrets?.brave?.api_key;
      if (!apiKey) { res.writeHead(500); res.end(JSON.stringify({ error: 'Brave API key not configured' })); return; }

      const result = await httpsGet(
        `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}`,
        { 'Accept': 'application/json', 'X-Subscription-Token': apiKey }
      );
      res.writeHead(200);
      res.end(result);
      return;
    }

    // ────────────────────────────────────────────
    // GET /mapbox/static?lat=<lat>&lon=<lon>&zoom=<zoom>&width=<w>&height=<h>
    // ────────────────────────────────────────────
    if (pathname === '/mapbox/static') {
      const { lat, lon, zoom, width, height } = query as Record<string, string>;
      if (!lat || !lon) { res.writeHead(400); res.end(JSON.stringify({ error: 'Missing parameters: lat, lon' })); return; }

      const token = secrets?.mapbox?.access_token;
      if (!token) { res.writeHead(500); res.end(JSON.stringify({ error: 'Mapbox token not configured' })); return; }

      const z = zoom || '13';
      const w = width || '600';
      const h = height || '400';
      const mapUrl = `https://api.mapbox.com/styles/v1/mapbox/streets-v11/static/${lon},${lat},${z}/${w}x${h}?access_token=${token}`;

      // 画像はバイナリのため base64 で返す
      const imageData = await new Promise<string>((resolve, reject) => {
        https.get(mapUrl, (mapRes) => {
          const chunks: Buffer[] = [];
          mapRes.on('data', (chunk) => chunks.push(chunk));
          mapRes.on('end', () => resolve(Buffer.concat(chunks).toString('base64')));
        }).on('error', reject);
      });

      res.writeHead(200);
      res.end(JSON.stringify({ image_base64: imageData, content_type: 'image/png' }));
      return;
    }

    // ────────────────────────────────────────────
    // 404
    // ────────────────────────────────────────────
    res.writeHead(404);
    res.end(JSON.stringify({ error: `Unknown endpoint: ${pathname}` }));

  } catch (e: any) {
    console.error('[keybinder] Error:', e.message);
    res.writeHead(500);
    res.end(JSON.stringify({ error: e.message }));
  }
});

server.listen(3001, () => {
  console.log('[keybinder] listening on :3001');
});
