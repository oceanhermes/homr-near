import { FAUCET_API_BASE } from './endpoints';
export { FAUCET_API_BASE } from './endpoints';

async function faucetRequest(path, options) {
  let response;
  try {
    response = await fetch(`${FAUCET_API_BASE}${path}`, options);
  } catch {
    throw new Error('The faucet is temporarily unavailable. Please try again later.');
  }

  const data = await response.json().catch(() => null);
  if (!data) throw new Error('The faucet service returned an invalid response. Please try again later.');
  if (!response.ok || !data?.success) {
    throw new Error(data?.error || `Faucet request failed (HTTP ${response.status}).`);
  }
  return data;
}

export async function fetchFaucetInfo() {
  const info = await faucetRequest('/api/info');
  if (typeof info.dripUsdc !== 'string') {
    throw new Error('The faucet server must be updated before tokens can be claimed.');
  }
  return info;
}

export function claimFaucetToken(token, address) {
  if (token !== 'bnb' && token !== 'usdc') throw new Error('Unknown faucet token.');
  return faucetRequest(`/api/claim-${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address })
  });
}
