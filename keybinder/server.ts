import * as http from 'http';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import * as url from 'url';

const SECRETS_PATH = '/secrets/keys.json';
const TOKEN_PATH = '/secrets/token.json';
const CLIENT_SECRET_PATH = '/secrets/client_secret.json';

const GOOGLE_SCOPES = [
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/tasks',
];

const GOOGLE_OAUTH_REDIRECT_URI = process.env.GOOGLE_OAUTH_REDIRECT_URI || 'http://localhost:3000';

// ─── Secrets ─────────────────────────────────────────────────────────────────

function loadSecrets(): Record<string, any> {
  try {
    return JSON.parse(fs.readFileSync(SECRETS_PATH, 'utf-8'));
  } catch (e) {
    console.error('[keybinder] Failed to load secrets:', e);
    return {};
  }
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

function httpsRequest(
  method: string,
  reqUrl: string,
  headers: Record<string, string> = {},
  body?: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(reqUrl);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method,
      headers: {
        ...headers,
        ...(body != null ? { 'Content-Length': Buffer.byteLength(body) } : {}),
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode || 0, body: data }));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Request timeout')); });
    if (body != null) req.write(body);
    req.end();
  });
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => body += chunk);
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

// ─── Google OAuth2 token management ──────────────────────────────────────────

interface GoogleToken {
  access_token: string;
  refresh_token: string;
  client_id: string;
  client_secret: string;
  token_uri: string;
  expiry: string; // ISO 8601
}

function loadGoogleToken(): GoogleToken | null {
  try {
    return JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
  } catch {
    return null;
  }
}

function saveGoogleToken(token: GoogleToken): void {
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(token, null, 2));
}

async function getAccessToken(): Promise<string> {
  const token = loadGoogleToken();
  if (!token) {
    throw new Error('Google token not found. Run keybinder/setup_google_auth.py first.');
  }

  const BUFFER_MS = 5 * 60 * 1000; // refresh 5 minutes before expiry
  if (Date.now() < new Date(token.expiry).getTime() - BUFFER_MS) {
    return token.access_token;
  }

  // Refresh expired token
  const body = new URLSearchParams({
    client_id: token.client_id,
    client_secret: token.client_secret,
    refresh_token: token.refresh_token,
    grant_type: 'refresh_token',
  }).toString();

  const result = await httpsRequest('POST', 'https://oauth2.googleapis.com/token', {
    'Content-Type': 'application/x-www-form-urlencoded',
  }, body);

  const parsed = JSON.parse(result.body);
  if (!parsed.access_token) throw new Error(`Token refresh failed: ${result.body}`);

  token.access_token = parsed.access_token;
  token.expiry = new Date(Date.now() + parsed.expires_in * 1000).toISOString();
  saveGoogleToken(token);
  console.log('[keybinder] Google token refreshed');
  return token.access_token;
}

async function googleRequest(
  method: string,
  reqUrl: string,
  headers: Record<string, string> = {},
  body?: string,
): Promise<{ status: number; body: string }> {
  const accessToken = await getAccessToken();
  return httpsRequest(method, reqUrl, {
    'Authorization': `Bearer ${accessToken}`,
    ...headers,
  }, body);
}

// ─── Google Sheets chart helpers ─────────────────────────────────────────────

function columnLetterToIndex(col: string): number {
  let result = 0;
  for (const ch of col.toUpperCase()) {
    result = result * 26 + (ch.charCodeAt(0) - 65 + 1);
  }
  return result - 1;
}

async function parseA1Range(spreadsheetId: string, source: string): Promise<{
  sheetId: number;
  startRowIndex: number;
  endRowIndex: number;
  startColumnIndex: number;
  endColumnIndex: number;
}> {
  let sheetTitle = '';
  let rangeStr = source;

  const bangIdx = source.indexOf('!');
  if (bangIdx !== -1) {
    sheetTitle = source.slice(0, bangIdx);
    rangeStr = source.slice(bangIdx + 1);
  }

  let sheetId = 0;
  if (sheetTitle) {
    const infoResult = await googleRequest('GET',
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties`
    );
    const info = JSON.parse(infoResult.body);
    const sheet = (info.sheets || []).find((s: any) => s.properties?.title === sheetTitle);
    if (!sheet) throw new Error(`Sheet not found: ${sheetTitle}`);
    sheetId = sheet.properties.sheetId;
  }

  const parseCell = (cell: string): { col: number; row: number } => {
    const m = cell.match(/^([A-Za-z]+)(\d+)$/);
    if (!m) throw new Error(`Invalid cell reference: ${cell}`);
    return { col: columnLetterToIndex(m[1]), row: parseInt(m[2]) - 1 };
  };

  const parts = rangeStr.split(':');
  const start = parseCell(parts[0]);
  const end = parts.length > 1 ? parseCell(parts[1]) : start;

  return {
    sheetId,
    startRowIndex: start.row,
    endRowIndex: end.row + 1,
    startColumnIndex: start.col,
    endColumnIndex: end.col + 1,
  };
}

// ─── HTTP server ──────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url || '', true);
  const pathname = parsed.pathname || '';
  const query = parsed.query;
  const method = req.method || 'GET';

  res.setHeader('Content-Type', 'application/json');

  const secrets = loadSecrets();

  try {
    // ────────────────────────────────────────────
    // GET /brave?q=<query>
    // ────────────────────────────────────────────
    if (pathname === '/brave' && method === 'GET') {
      const q = query.q as string;
      if (!q) { res.writeHead(400); res.end(JSON.stringify({ error: 'Missing parameter: q' })); return; }

      const apiKey = secrets?.brave?.api_key;
      if (!apiKey) { res.writeHead(500); res.end(JSON.stringify({ error: 'Brave API key not configured' })); return; }

      const result = await httpsRequest('GET',
        `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}`,
        { 'Accept': 'application/json', 'X-Subscription-Token': apiKey },
      );
      res.writeHead(result.status);
      res.end(result.body);
      return;
    }

    // ────────────────────────────────────────────
    // GET /mapbox/static?lat=<lat>&lon=<lon>&zoom=<zoom>&width=<w>&height=<h>
    // ────────────────────────────────────────────
    if (pathname === '/mapbox/static' && method === 'GET') {
      const { lat, lon, zoom, width, height } = query as Record<string, string>;
      if (!lat || !lon) { res.writeHead(400); res.end(JSON.stringify({ error: 'Missing parameters: lat, lon' })); return; }

      const token = secrets?.mapbox?.access_token;
      if (!token) { res.writeHead(500); res.end(JSON.stringify({ error: 'Mapbox token not configured' })); return; }

      const z = zoom || '13';
      const w = width || '600';
      const h = height || '400';
      const markers = query.markers as string | undefined;
      const overlay = markers ? `${markers}/` : '';
      const mapUrl = `https://api.mapbox.com/styles/v1/mapbox/streets-v11/static/${overlay}${lon},${lat},${z}/${w}x${h}?access_token=${token}`;

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
    // Google Drive
    // ────────────────────────────────────────────

    // GET /google/drive/list?folderId=<id>&query=<q>&pageSize=<n>
    if (pathname === '/google/drive/list' && method === 'GET') {
      const params = new URLSearchParams();
      params.set('fields', 'files(id,name,mimeType,size,modifiedTime)');
      if (query.pageSize) params.set('pageSize', query.pageSize as string);
      const qParts: string[] = ['trashed = false'];
      if (query.folderId) qParts.push(`'${query.folderId}' in parents`);
      if (query.query) qParts.push(query.query as string);
      params.set('q', qParts.join(' and '));

      const result = await googleRequest('GET',
        `https://www.googleapis.com/drive/v3/files?${params}`
      );
      res.writeHead(result.status);
      res.end(result.body);
      return;
    }

    // GET /google/drive/read?fileId=<id>
    if (pathname === '/google/drive/read' && method === 'GET') {
      const fileId = query.fileId as string;
      if (!fileId) { res.writeHead(400); res.end(JSON.stringify({ error: 'Missing parameter: fileId' })); return; }

      const result = await googleRequest('GET',
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`
      );
      if (result.status === 200) {
        res.writeHead(200);
        res.end(JSON.stringify({ content: result.body }));
      } else {
        res.writeHead(result.status);
        res.end(result.body);
      }
      return;
    }

    // POST /google/drive/create  body: { name, content, mimeType?, folderId? }
    if (pathname === '/google/drive/create' && method === 'POST') {
      const bodyStr = await readBody(req);
      const { name, content, mimeType = 'text/plain', folderId } = JSON.parse(bodyStr);
      if (!name || content == null) { res.writeHead(400); res.end(JSON.stringify({ error: 'Missing fields: name, content' })); return; }

      const boundary = 'voxclaw_boundary';
      const metadata: Record<string, any> = { name, mimeType };
      if (folderId) metadata.parents = [folderId];

      const multipart = [
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
        JSON.stringify(metadata),
        `\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
        content,
        `\r\n--${boundary}--`,
      ].join('');

      const result = await googleRequest('POST',
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
        { 'Content-Type': `multipart/related; boundary=${boundary}` },
        multipart,
      );
      res.writeHead(result.status);
      res.end(result.body);
      return;
    }

    // POST /google/drive/update  body: { fileId, content, mimeType? }
    if (pathname === '/google/drive/update' && method === 'POST') {
      const bodyStr = await readBody(req);
      const { fileId, content, mimeType = 'text/plain' } = JSON.parse(bodyStr);
      if (!fileId || content == null) { res.writeHead(400); res.end(JSON.stringify({ error: 'Missing fields: fileId, content' })); return; }

      const result = await googleRequest('PATCH',
        `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=media`,
        { 'Content-Type': mimeType },
        content,
      );
      res.writeHead(result.status);
      res.end(result.body);
      return;
    }

    // ────────────────────────────────────────────
    // Google Calendar
    // ────────────────────────────────────────────

    // GET /google/calendar/events?calendarId=<>&timeMin=<>&timeMax=<>&maxResults=<>
    if (pathname === '/google/calendar/events' && method === 'GET') {
      const calendarId = (query.calendarId as string) || 'primary';
      const params = new URLSearchParams();
      params.set('orderBy', 'startTime');
      params.set('singleEvents', 'true');
      if (query.timeMin) params.set('timeMin', query.timeMin as string);
      if (query.timeMax) params.set('timeMax', query.timeMax as string);
      if (query.maxResults) params.set('maxResults', query.maxResults as string);

      const result = await googleRequest('GET',
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`
      );
      res.writeHead(result.status);
      res.end(result.body);
      return;
    }

    // POST /google/calendar/events/create  body: { calendarId?, summary, start, end, description?, location? }
    //   start / end: { dateTime: "2026-03-20T10:00:00+09:00", timeZone: "Asia/Tokyo" }
    if (pathname === '/google/calendar/events/create' && method === 'POST') {
      const bodyStr = await readBody(req);
      const { calendarId = 'primary', ...eventData } = JSON.parse(bodyStr);

      const result = await googleRequest('POST',
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
        { 'Content-Type': 'application/json' },
        JSON.stringify(eventData),
      );
      res.writeHead(result.status);
      res.end(result.body);
      return;
    }

    // POST /google/calendar/events/update  body: { calendarId?, eventId, ...fields }
    if (pathname === '/google/calendar/events/update' && method === 'POST') {
      const bodyStr = await readBody(req);
      const { calendarId = 'primary', eventId, ...eventData } = JSON.parse(bodyStr);
      if (!eventId) { res.writeHead(400); res.end(JSON.stringify({ error: 'Missing field: eventId' })); return; }

      const result = await googleRequest('PATCH',
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
        { 'Content-Type': 'application/json' },
        JSON.stringify(eventData),
      );
      res.writeHead(result.status);
      res.end(result.body);
      return;
    }

    // POST /google/calendar/events/delete  body: { calendarId?, eventId }
    if (pathname === '/google/calendar/events/delete' && method === 'POST') {
      const bodyStr = await readBody(req);
      const { calendarId = 'primary', eventId } = JSON.parse(bodyStr);
      if (!eventId) { res.writeHead(400); res.end(JSON.stringify({ error: 'Missing field: eventId' })); return; }

      const result = await googleRequest('DELETE',
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`
      );
      // Calendar DELETE returns 204 No Content on success
      res.writeHead(result.status === 204 ? 200 : result.status);
      res.end(JSON.stringify({ success: result.status === 204 }));
      return;
    }

    // ────────────────────────────────────────────
    // Google Sheets
    // ────────────────────────────────────────────

    // POST /google/sheets/create  body: { title, sheets? }
    //   sheets: array of sheet names e.g. ["Sheet1", "Sheet2"] (optional)
    if (pathname === '/google/sheets/create' && method === 'POST') {
      const bodyStr = await readBody(req);
      const { title, sheets } = JSON.parse(bodyStr);
      if (!title) { res.writeHead(400); res.end(JSON.stringify({ error: 'Missing field: title' })); return; }

      const body: Record<string, any> = {
        properties: { title },
      };
      if (sheets && Array.isArray(sheets)) {
        body.sheets = sheets.map((name: string) => ({ properties: { title: name } }));
      }

      const result = await googleRequest('POST',
        'https://sheets.googleapis.com/v4/spreadsheets',
        { 'Content-Type': 'application/json' },
        JSON.stringify(body),
      );
      res.writeHead(result.status);
      res.end(result.body);
      return;
    }

    // GET /google/sheets/info?spreadsheetId=<id>
    if (pathname === '/google/sheets/info' && method === 'GET') {
      const spreadsheetId = query.spreadsheetId as string;
      if (!spreadsheetId) { res.writeHead(400); res.end(JSON.stringify({ error: 'Missing parameter: spreadsheetId' })); return; }

      const result = await googleRequest('GET',
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=spreadsheetId,properties.title,sheets.properties`
      );
      res.writeHead(result.status);
      res.end(result.body);
      return;
    }

    // GET /google/sheets/read?spreadsheetId=<id>&range=<A1notation>
    if (pathname === '/google/sheets/read' && method === 'GET') {
      const { spreadsheetId, range } = query as Record<string, string>;
      if (!spreadsheetId || !range) { res.writeHead(400); res.end(JSON.stringify({ error: 'Missing parameters: spreadsheetId, range' })); return; }

      const result = await googleRequest('GET',
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`
      );
      res.writeHead(result.status);
      res.end(result.body);
      return;
    }

    // POST /google/sheets/write  body: { spreadsheetId, range, values, valueInputOption? }
    //   values: 2D array e.g. [["A", "B"], [1, 2]]
    //   valueInputOption: "RAW" (default) or "USER_ENTERED" (parses formulas/dates)
    if (pathname === '/google/sheets/write' && method === 'POST') {
      const bodyStr = await readBody(req);
      const { spreadsheetId, range, values, valueInputOption = 'USER_ENTERED' } = JSON.parse(bodyStr);
      if (!spreadsheetId || !range || !values) { res.writeHead(400); res.end(JSON.stringify({ error: 'Missing fields: spreadsheetId, range, values' })); return; }

      const result = await googleRequest('PUT',
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueInputOption=${valueInputOption}`,
        { 'Content-Type': 'application/json' },
        JSON.stringify({ range, majorDimension: 'ROWS', values }),
      );
      res.writeHead(result.status);
      res.end(result.body);
      return;
    }

    // POST /google/sheets/append  body: { spreadsheetId, range, values, valueInputOption? }
    //   Appends rows after the last row with data in the given range
    if (pathname === '/google/sheets/append' && method === 'POST') {
      const bodyStr = await readBody(req);
      const { spreadsheetId, range, values, valueInputOption = 'USER_ENTERED' } = JSON.parse(bodyStr);
      if (!spreadsheetId || !range || !values) { res.writeHead(400); res.end(JSON.stringify({ error: 'Missing fields: spreadsheetId, range, values' })); return; }

      const result = await googleRequest('POST',
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:append?valueInputOption=${valueInputOption}&insertDataOption=INSERT_ROWS`,
        { 'Content-Type': 'application/json' },
        JSON.stringify({ majorDimension: 'ROWS', values }),
      );
      res.writeHead(result.status);
      res.end(result.body);
      return;
    }

    // ────────────────────────────────────────────
    // Google Tasks
    // ────────────────────────────────────────────

    // GET /google/tasks/lists
    if (pathname === '/google/tasks/lists' && method === 'GET') {
      const result = await googleRequest('GET',
        'https://tasks.googleapis.com/tasks/v1/users/@me/lists'
      );
      res.writeHead(result.status);
      res.end(result.body);
      return;
    }

    // GET /google/tasks/list?tasklistId=<id>&showCompleted=<bool>&maxResults=<n>
    if (pathname === '/google/tasks/list' && method === 'GET') {
      const tasklistId = (query.tasklistId as string) || '@default';
      const params = new URLSearchParams();
      if (query.showCompleted) params.set('showCompleted', query.showCompleted as string);
      if (query.maxResults) params.set('maxResults', query.maxResults as string);

      const result = await googleRequest('GET',
        `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(tasklistId)}/tasks?${params}`
      );
      res.writeHead(result.status);
      res.end(result.body);
      return;
    }

    // POST /google/tasks/create  body: { tasklistId?, title, notes?, due? }
    //   due: RFC 3339 timestamp e.g. "2026-03-20T00:00:00.000Z"
    if (pathname === '/google/tasks/create' && method === 'POST') {
      const bodyStr = await readBody(req);
      const { tasklistId = '@default', ...taskData } = JSON.parse(bodyStr);

      const result = await googleRequest('POST',
        `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(tasklistId)}/tasks`,
        { 'Content-Type': 'application/json' },
        JSON.stringify(taskData),
      );
      res.writeHead(result.status);
      res.end(result.body);
      return;
    }

    // POST /google/tasks/update  body: { tasklistId?, taskId, title?, notes?, due?, status? }
    //   status: "needsAction" or "completed"
    if (pathname === '/google/tasks/update' && method === 'POST') {
      const bodyStr = await readBody(req);
      const { tasklistId = '@default', taskId, ...taskData } = JSON.parse(bodyStr);
      if (!taskId) { res.writeHead(400); res.end(JSON.stringify({ error: 'Missing field: taskId' })); return; }

      const result = await googleRequest('PATCH',
        `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(tasklistId)}/tasks/${encodeURIComponent(taskId)}`,
        { 'Content-Type': 'application/json' },
        JSON.stringify(taskData),
      );
      res.writeHead(result.status);
      res.end(result.body);
      return;
    }

    // POST /google/tasks/delete  body: { tasklistId?, taskId }
    if (pathname === '/google/tasks/delete' && method === 'POST') {
      const bodyStr = await readBody(req);
      const { tasklistId = '@default', taskId } = JSON.parse(bodyStr);
      if (!taskId) { res.writeHead(400); res.end(JSON.stringify({ error: 'Missing field: taskId' })); return; }

      const result = await googleRequest('DELETE',
        `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(tasklistId)}/tasks/${encodeURIComponent(taskId)}`
      );
      res.writeHead(result.status === 204 ? 200 : result.status);
      res.end(JSON.stringify({ success: result.status === 204 }));
      return;
    }

    // ────────────────────────────────────────────
    // Google Sheets Charts
    // ────────────────────────────────────────────

    // POST /google/sheets/charts/add
    //   body: { spreadsheetId, chartType, title?, sourceRange, position? }
    //   chartType: "BAR" | "LINE" | "COLUMN" | "PIE" | "SCATTER" | "AREA"
    //   sourceRange: A1 notation e.g. "Sheet1!A1:B10"
    //   position: EmbeddedObjectPosition (defaults to new sheet)
    if (pathname === '/google/sheets/charts/add' && method === 'POST') {
      const bodyStr = await readBody(req);
      const { spreadsheetId, chartType, title, sourceRange, position } = JSON.parse(bodyStr);
      if (!spreadsheetId || !chartType || !sourceRange) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Missing fields: spreadsheetId, chartType, sourceRange' }));
        return;
      }

      const gridRange = await parseA1Range(spreadsheetId, sourceRange);

      // First column → domain (categories), remaining columns → series
      const domainRange = { ...gridRange, endColumnIndex: gridRange.startColumnIndex + 1 };
      const seriesRange = { ...gridRange, startColumnIndex: gridRange.startColumnIndex + 1 };

      let chartSpec: Record<string, any>;
      if (chartType === 'PIE') {
        chartSpec = {
          title: title || '',
          pieChart: {
            legendPosition: 'RIGHT_LEGEND',
            domain: { sourceRange: { sources: [domainRange] } },
            series: { sourceRange: { sources: [seriesRange] } },
          },
        };
      } else {
        chartSpec = {
          title: title || '',
          basicChart: {
            chartType,
            legendPosition: 'BOTTOM_LEGEND',
            headerCount: 1,
            domains: [{ domain: { sourceRange: { sources: [domainRange] } } }],
            series: [{ series: { sourceRange: { sources: [seriesRange] } } }],
          },
        };
      }

      const result = await googleRequest('POST',
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
        { 'Content-Type': 'application/json' },
        JSON.stringify({
          requests: [{ addChart: { chart: { spec: chartSpec, position: position || { newSheet: true } } } }],
        }),
      );

      if (result.status === 200) {
        const parsed = JSON.parse(result.body);
        const chartId = parsed.replies?.[0]?.addChart?.chart?.chartId;
        res.writeHead(200);
        res.end(JSON.stringify({ chartId, ...parsed }));
      } else {
        res.writeHead(result.status);
        res.end(result.body);
      }
      return;
    }

    // PUT /google/sheets/charts/update
    //   body: { spreadsheetId, chartId, spec, fields? }
    //   spec: ChartSpec object (partial or full)
    //   fields: FieldMask string (default "*" = full overwrite)
    //
    // Representative ChartSpec fields:
    //   title                                          Chart title
    //   titleTextFormat.fontSize                       Title font size
    //   basicChart.legendPosition                      BOTTOM_LEGEND / TOP_LEGEND / LEFT_LEGEND / RIGHT_LEGEND / NO_LEGEND
    //   basicChart.axis[].title                        Axis title
    //   basicChart.axis[].viewWindowOptions.viewWindowMin / viewWindowMax  Axis min/max
    //   basicChart.axis[].viewWindowOptions.viewWindowMode  EXPLICIT / PRETTY / MAXIMIZED
    //   basicChart.series[].color                      Series color { red, green, blue }
    //   basicChart.series[].dataLabel.type             Data label: DATA / CUSTOM / NONE
    //   basicChart.stackedType                         NOT_STACKED / STACKED / PERCENT_STACKED
    //   pieChart.legendPosition                        Pie chart legend position
    //   pieChart.pieHole                               Donut ratio (0.0–1.0)
    if (pathname === '/google/sheets/charts/update' && method === 'PUT') {
      const bodyStr = await readBody(req);
      const { spreadsheetId, chartId, spec, fields = '*' } = JSON.parse(bodyStr);
      if (!spreadsheetId || chartId == null || !spec) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Missing fields: spreadsheetId, chartId, spec' }));
        return;
      }

      const result = await googleRequest('POST',
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
        { 'Content-Type': 'application/json' },
        JSON.stringify({
          requests: [{ updateChartSpec: { chartId, spec } }],
        }),
      );
      res.writeHead(result.status);
      res.end(result.body);
      return;
    }

    // DELETE /google/sheets/charts/delete  body: { spreadsheetId, chartId }
    if (pathname === '/google/sheets/charts/delete' && method === 'DELETE') {
      const bodyStr = await readBody(req);
      const { spreadsheetId, chartId } = JSON.parse(bodyStr);
      if (!spreadsheetId || chartId == null) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Missing fields: spreadsheetId, chartId' }));
        return;
      }

      const result = await googleRequest('POST',
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
        { 'Content-Type': 'application/json' },
        JSON.stringify({ requests: [{ deleteEmbeddedObject: { objectId: chartId } }] }),
      );
      res.writeHead(result.status === 200 ? 200 : result.status);
      res.end(result.status === 200 ? JSON.stringify({ success: true }) : result.body);
      return;
    }

    // GET /google/sheets/charts/list?spreadsheetId=<id>
    if (pathname === '/google/sheets/charts/list' && method === 'GET') {
      const spreadsheetId = query.spreadsheetId as string;
      if (!spreadsheetId) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Missing parameter: spreadsheetId' }));
        return;
      }

      const result = await googleRequest('GET',
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets(charts,properties.title)`
      );

      if (result.status !== 200) {
        res.writeHead(result.status);
        res.end(result.body);
        return;
      }

      const parsed = JSON.parse(result.body);
      const charts: Array<{ chartId: number; title: string; chartType: string; sheetTitle: string }> = [];

      for (const sheet of parsed.sheets || []) {
        const sheetTitle = sheet.properties?.title || '';
        for (const chart of sheet.charts || []) {
          const spec = chart.spec || {};
          let chartType = 'UNKNOWN';
          if (spec.basicChart?.chartType) {
            chartType = spec.basicChart.chartType;
          } else if (spec.pieChart) {
            chartType = 'PIE';
          } else if (spec.areaChart) {
            chartType = 'AREA';
          }
          charts.push({ chartId: chart.chartId, title: spec.title || '', chartType, sheetTitle });
        }
      }

      res.writeHead(200);
      res.end(JSON.stringify({ charts }));
      return;
    }

    // ────────────────────────────────────────────
    // GET /auth/google/status  — token.json の存在・有効期限を返す
    // ────────────────────────────────────────────
    if (pathname === '/auth/google/status' && method === 'GET') {
      const token = loadGoogleToken();
      if (!token) {
        res.writeHead(200);
        res.end(JSON.stringify({ configured: false, expiry: null, expired: false }));
        return;
      }
      const expired = Date.now() > new Date(token.expiry).getTime();
      res.writeHead(200);
      res.end(JSON.stringify({ configured: true, expiry: token.expiry, expired }));
      return;
    }

    // ────────────────────────────────────────────
    // GET /auth/google/url  — OAuth認証URLを生成して返す
    // ────────────────────────────────────────────
    if (pathname === '/auth/google/url' && method === 'GET') {
      let cs: any;
      try {
        cs = JSON.parse(fs.readFileSync(CLIENT_SECRET_PATH, 'utf-8'));
      } catch {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'client_secret.json が見つかりません。keybinder/secrets/client_secret.json に配置してください。' }));
        return;
      }
      const creds = cs.installed || cs.web;
      const params = new URLSearchParams({
        client_id:     creds.client_id,
        redirect_uri:  GOOGLE_OAUTH_REDIRECT_URI,
        response_type: 'code',
        scope:         GOOGLE_SCOPES.join(' '),
        access_type:   'offline',
        prompt:        'consent',
      });
      res.writeHead(200);
      res.end(JSON.stringify({
        url: `https://accounts.google.com/o/oauth2/auth?${params}`,
        redirect_uri: GOOGLE_OAUTH_REDIRECT_URI,
      }));
      return;
    }

    // ────────────────────────────────────────────
    // POST /auth/google/exchange  body: { code }
    // ────────────────────────────────────────────
    if (pathname === '/auth/google/exchange' && method === 'POST') {
      const bodyStr = await readBody(req);
      const { code } = JSON.parse(bodyStr);
      if (!code) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Missing field: code' }));
        return;
      }
      let cs: any;
      try {
        cs = JSON.parse(fs.readFileSync(CLIENT_SECRET_PATH, 'utf-8'));
      } catch {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'client_secret.json が見つかりません' }));
        return;
      }
      const creds = cs.installed || cs.web;
      const tokenBody = new URLSearchParams({
        code,
        client_id:     creds.client_id,
        client_secret: creds.client_secret,
        redirect_uri:  GOOGLE_OAUTH_REDIRECT_URI,
        grant_type:    'authorization_code',
      }).toString();

      const result = await httpsRequest('POST', 'https://oauth2.googleapis.com/token', {
        'Content-Type': 'application/x-www-form-urlencoded',
      }, tokenBody);

      const parsed = JSON.parse(result.body);
      if (!parsed.access_token) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'トークン交換に失敗しました', details: parsed }));
        return;
      }

      const tokenData = {
        access_token:  parsed.access_token,
        refresh_token: parsed.refresh_token,
        client_id:     creds.client_id,
        client_secret: creds.client_secret,
        token_uri:     'https://oauth2.googleapis.com/token',
        expiry:        new Date(Date.now() + parsed.expires_in * 1000).toISOString(),
      };
      fs.mkdirSync(path.dirname(TOKEN_PATH), { recursive: true });
      fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokenData, null, 2));
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // ────────────────────────────────────────────
    // GET /keys  — キー設定状況を返す（値はマスク: 先頭4文字 + "..."）
    // ────────────────────────────────────────────
    if (pathname === '/keys' && method === 'GET') {
      const s = loadSecrets();
      const mask = (v: string | undefined) =>
        v ? v.slice(0, 4) + '...' : null;
      res.writeHead(200);
      res.end(JSON.stringify({
        brave:  { api_key:      mask(s?.brave?.api_key) },
        mapbox: { access_token: mask(s?.mapbox?.access_token) },
      }));
      return;
    }

    // ────────────────────────────────────────────
    // POST /keys  body: { service, key, value }
    // ────────────────────────────────────────────
    if (pathname === '/keys' && method === 'POST') {
      const bodyStr = await readBody(req);
      const { service, key, value } = JSON.parse(bodyStr);
      if (!service || !key || value == null) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Missing fields: service, key, value' }));
        return;
      }
      const s = loadSecrets();
      if (!s[service]) s[service] = {};
      s[service][key] = value;
      fs.mkdirSync(path.dirname(SECRETS_PATH), { recursive: true });
      fs.writeFileSync(SECRETS_PATH, JSON.stringify(s, null, 2));
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true }));
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
