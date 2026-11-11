import { NEAR_CONFIG } from '../contracts/addresses';

/**
 * NEAR view-call client.
 *
 * A dashboard render fans out into ~10 `view` calls (vault, loans, auction),
 * and the query layer polls them on an interval. Without rate shaping that
 * burst is enough to trip the public RPC's limit, and every failed read used
 * to be retried immediately, which kept the limit tripped. Three guards here
 * keep the client polite:
 *
 *   1. identical concurrent reads share one request (in-flight de-duplication),
 *   2. outgoing requests are spaced by `MIN_DISPATCH_GAP_MS`,
 *   3. repeated failures open a circuit breaker that fails fast for a cooldown
 *      instead of hammering the endpoint.
 */

const DEFAULT_RPC_URL = 'https://free.rpc.fastnear.com';
const MIN_DISPATCH_GAP_MS = 60;
const FAILURE_THRESHOLD = 3;
const BREAKER_COOLDOWN_MS = 30000;
const REQUEST_TIMEOUT_MS = 10000;

/** Typed RPC failure so callers can decide whether a retry is worth it. */
export class NearRpcError extends Error {
  constructor(message, { code = 'RPC_FAILED', status = null, retryAfterMs = null, cause = null } = {}) {
    super(message);
    this.name = 'NearRpcError';
    this.code = code;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
    if (cause) this.cause = cause;
  }
}

const inFlight = new Map();
let nextDispatchAt = 0;
let consecutiveFailures = 0;
let breakerOpenUntil = 0;

function encodeArgs(args) {
  const bytes = new TextEncoder().encode(JSON.stringify(args));
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

/** The archival RPC blocks browser CORS, so fall back to the public endpoint. */
function resolveRpcUrl() {
  const configured = NEAR_CONFIG.rpcUrl;
  return configured && !configured.includes('archival-rpc') ? configured : DEFAULT_RPC_URL;
}

function classifyFailure(message, status) {
  if (status === 429 || /rate limit|too many requests|429/i.test(message)) return 'RATE_LIMITED';
  if (/does not exist while viewing|AccountDoesNotExist|UNKNOWN_ACCOUNT|CodeDoesNotExist|MethodNotFound|no contract code|contract is not deployed/i.test(message)) {
    return 'CONTRACT_UNAVAILABLE';
  }
  return 'RPC_FAILED';
}

function retryAfterFrom(response) {
  const header = response.headers?.get?.('retry-after');
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null;
}

/** Reserves a dispatch slot synchronously, then waits for it. */
async function reserveDispatchSlot() {
  const now = Date.now();
  const slot = Math.max(now, nextDispatchAt);
  nextDispatchAt = slot + MIN_DISPATCH_GAP_MS;
  const wait = slot - now;
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
}

function breakerError() {
  const remaining = Math.max(1, breakerOpenUntil - Date.now());
  return new NearRpcError(
    `NEAR RPC reads are paused for ${Math.ceil(remaining / 1000)}s after repeated failures.`,
    { code: 'RATE_LIMITED', status: 429, retryAfterMs: remaining },
  );
}

function noteSuccess() {
  consecutiveFailures = 0;
  breakerOpenUntil = 0;
}

function noteFailure(error) {
  consecutiveFailures += 1;
  if (error.code === 'RATE_LIMITED' || consecutiveFailures >= FAILURE_THRESHOLD) {
    breakerOpenUntil = Date.now() + (error.retryAfterMs || BREAKER_COOLDOWN_MS);
  }
}

async function requestView(url, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      signal: controller.signal,
    });
  } catch (cause) {
    throw new NearRpcError(
      controller.signal.aborted ? `NEAR RPC timed out after ${REQUEST_TIMEOUT_MS / 1000}s.` : 'NEAR RPC is unreachable.',
      { code: 'RPC_UNREACHABLE', cause },
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new NearRpcError(`NEAR RPC request failed (${response.status})`, {
      code: classifyFailure('', response.status),
      status: response.status,
      retryAfterMs: retryAfterFrom(response),
    });
  }

  const payload = await response.json();
  if (payload.error) {
    // The RPC hides the useful detail in `data` / `cause.name`, which is where
    // "account … does not exist while viewing" lives — classify on all of it.
    const error = payload.error;
    const message = [error.message, error.data, error.cause?.name].filter(Boolean).join(' · ');
    throw new NearRpcError(message || 'NEAR RPC error', { code: classifyFailure(message || '', null) });
  }
  return payload;
}

export async function callNearView(methodName, args = {}, contractId = NEAR_CONFIG.contractId) {
  if (!contractId) return null;

  // Fast-fail while the breaker is open: no network traffic, no retry storm.
  if (breakerOpenUntil > Date.now()) throw breakerError();

  const url = resolveRpcUrl();
  const body = JSON.stringify({
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
  });

  const key = `${contractId}::${methodName}::${JSON.stringify(args)}`;
  const pending = inFlight.get(key);
  if (pending) return pending;

  const request = (async () => {
    await reserveDispatchSlot();
    try {
      const payload = await requestView(url, body);
      noteSuccess();
      const bytes = new Uint8Array(payload.result.result);
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch (error) {
      const rpcError = error instanceof NearRpcError
        ? error
        : new NearRpcError(error?.message || 'NEAR RPC error', { code: 'RPC_FAILED', cause: error });
      noteFailure(rpcError);
      throw rpcError;
    }
  })().finally(() => inFlight.delete(key));

  inFlight.set(key, request);
  return request;
}

/** Test hook: resets breaker/throttle state between cases. */
export function resetNearRpcState() {
  inFlight.clear();
  nextDispatchAt = 0;
  consecutiveFailures = 0;
  breakerOpenUntil = 0;
}
