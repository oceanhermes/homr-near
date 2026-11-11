export function serviceBase(configured, development, localBase, productionBase) {
  const value = configured?.trim();
  // A localhost value is useful for Vite development, but it can never reach
  // a user's browser after the frontend is deployed. Fall back to the public
  // service when an old or mis-scoped production env var leaks into a build.
  const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(?:\/|$)/i.test(value || '');
  return (value && (!isLocalhost || development) ? value : (development ? localBase : productionBase))
    .replace(/\/+$/, '');
}

export const API_BASE = serviceBase(
  import.meta.env.VITE_API_BASE, import.meta.env.DEV,
  'http://localhost:4000', 'https://api.homr.web.id',
);

// The faucet is part of the HOMR API (`/api/info`, `/api/claim-usdc`); the API
// also mirrors those routes under `/faucet/api/*`, so an older
// `VITE_FAUCET_API_BASE=https://host/faucet` keeps working.
export const FAUCET_API_BASE = serviceBase(
  import.meta.env.VITE_FAUCET_API_BASE, import.meta.env.DEV,
  API_BASE, API_BASE,
);
