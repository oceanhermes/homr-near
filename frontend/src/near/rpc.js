import { NEAR_CONFIG } from '../contracts/addresses';

function encodeArgs(args) {
  const bytes = new TextEncoder().encode(JSON.stringify(args));
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

export async function callNearView(methodName, args = {}, contractId = NEAR_CONFIG.contractId) {
  if (!contractId) return null;

  const response = await fetch(NEAR_CONFIG.rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'homr-near-view',
      method: 'query',
      params: {
        request_type: 'call_function',
        finality: 'final',
        account_id: contractId,
        method_name: methodName,
        args_base64: encodeArgs(args),
      },
    }),
  });

  if (!response.ok) throw new Error(`NEAR RPC request failed (${response.status})`);
  const payload = await response.json();
  if (payload.error) throw new Error(payload.error.message || 'NEAR RPC error');
  const bytes = new Uint8Array(payload.result.result);
  return JSON.parse(new TextDecoder().decode(bytes));
}
