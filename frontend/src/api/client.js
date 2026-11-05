import { API_BASE } from './endpoints';
export { API_BASE } from './endpoints';
export const ADMIN_API_KEY = import.meta.env.VITE_ADMIN_API_KEY || 'dev-admin-key-change-me';

const headers = {
  'Content-Type': 'application/json',
};

const adminHeaders = {
  'Content-Type': 'application/json',
  'x-api-key': ADMIN_API_KEY,
};

// Public Endpoints
export async function fetchVault() {
  const res = await fetch(`${API_BASE}/api/vault`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function fetchLoans() {
  const res = await fetch(`${API_BASE}/api/loans`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function fetchLoan(id) {
  const res = await fetch(`${API_BASE}/api/loans/${id}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function fetchEvents(limit = 50) {
  const res = await fetch(`${API_BASE}/api/events?limit=${limit}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function fetchApplications() {
  let res;
  try {
    res = await fetch(`${API_BASE}/api/applications`);
  } catch {
    throw new Error('Cannot reach the application service. Please try again once the connection is restored.');
  }
  if (!res.ok) throw new Error(`The application service is unavailable (HTTP ${res.status}). Please try again later.`);
  const data = await res.json().catch(() => null);
  if (!Array.isArray(data?.applications)) {
    throw new Error('The application service returned an invalid response. Please try again later.');
  }
  return data;
}

export async function createApplication(data) {
  const body = JSON.stringify(data);
  let res;
  try {
    res = await fetch(`${API_BASE}/api/applications`, {
      method: 'POST',
      headers,
      body,
    });
  } catch {
    throw new Error('Cannot reach the application service. Please try again once the connection is restored.');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function fetchAuctions() {
  const res = await fetch(`${API_BASE}/api/auctions`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Admin Endpoints
export async function fetchAdminStatus() {
  const res = await fetch(`${API_BASE}/api/admin/status`, {
    headers: adminHeaders,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function reviewApplication(id, { decision, maxPrincipal, reviewedBy, reviewNote }) {
  const res = await fetch(`${API_BASE}/api/admin/applications/${id}/review`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({ decision, maxPrincipal, reviewedBy, reviewNote }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function startAuctionApi({ commitDuration, revealDuration }) {
  const res = await fetch(`${API_BASE}/api/admin/auctions`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({ commitDuration, revealDuration }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function finalizeAuctionApi(auctionId) {
  const res = await fetch(`${API_BASE}/api/admin/auctions/${auctionId}/finalize`, {
    method: 'POST',
    headers: adminHeaders,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || err.error || `HTTP ${res.status}`);
  }
  return res.json();
}
