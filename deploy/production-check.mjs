const apiBase = (process.env.HOMR_CHECK_API || 'https://api.homr.web.id').replace(/\/+$/, '');
const origins = ['https://homr.web.id', 'https://www.homr.web.id'];
let failures = 0;

async function check(name, run) {
  try {
    await run();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures++;
    console.error(`FAIL ${name}: ${error.message}`);
  }
}

async function request(path, options = {}) {
  return fetch(`${apiBase}${path}`, { ...options, signal: AbortSignal.timeout(20000) });
}

for (const origin of origins) {
  await check(`Application history from ${origin}`, async () => {
    const response = await request('/api/applications', { headers: { origin } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (response.headers.get('access-control-allow-origin') !== origin) throw new Error('Origin is missing from the CORS allowlist');
    const data = await response.json();
    if (!Array.isArray(data.applications)) throw new Error('Invalid response shape');
  });
  await check(`Application submission preflight from ${origin}`, async () => {
    const response = await request('/api/applications', {
      method: 'OPTIONS',
      headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' },
    });
    if (!response.ok || response.headers.get('access-control-allow-origin') !== origin) throw new Error('Submission is blocked by CORS');
  });
}

for (const path of ['/health', '/api/vault', '/api/loans', '/api/auctions', '/api/events?limit=1']) {
  await check(path, async () => {
    const response = await request(path);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    await response.json();
  });
}

await check('Admin endpoints require authentication', async () => {
  const response = await request('/api/admin/status');
  if (response.status !== 401) throw new Error(`Expected HTTP 401, received ${response.status}`);
});

await check('Faucet info and CORS', async () => {
  const origin = origins[1];
  const response = await request('/faucet/api/info', { headers: { origin } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (response.headers.get('access-control-allow-origin') !== origin) throw new Error('Faucet origin is missing from the CORS allowlist');
  const data = await response.json();
  if (!data.success || typeof data.dripBnb !== 'string' || typeof data.dripUsdc !== 'string') throw new Error('Invalid faucet response');
});

process.exitCode = failures ? 1 : 0;
