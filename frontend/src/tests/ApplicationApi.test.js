import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApplication, fetchApplications } from '../api/client';
import { serviceBase } from '../api/endpoints';

afterEach(() => vi.unstubAllGlobals());

describe('deployed service endpoints and application history', () => {
  it('uses the public API in production and keeps localhost for development', () => {
    expect(serviceBase(undefined, false, 'http://localhost:4000', 'https://api.homr.web.id')).toBe('https://api.homr.web.id');
    expect(serviceBase(undefined, true, 'http://localhost:4000', 'https://api.homr.web.id')).toBe('http://localhost:4000');
    expect(serviceBase(' https://api.homr.web.id/ ', false, '', '')).toBe('https://api.homr.web.id');
    expect(serviceBase('http://localhost:4000', false, 'http://localhost:4000', 'https://api.homr.web.id')).toBe('https://api.homr.web.id');
    expect(serviceBase('http://127.0.0.1:4000', false, 'http://localhost:4000', 'https://api.homr.web.id')).toBe('https://api.homr.web.id');
    expect(serviceBase('http://localhost:4000', true, 'http://localhost:4000', 'https://api.homr.web.id')).toBe('http://localhost:4000');
  });

  it('reports network and CORS failures as unavailable history', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(fetchApplications()).rejects.toThrow('Cannot reach the application service');
  });

  it('rejects an HTML fallback page and invalid response shape instead of showing empty history', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => { throw new SyntaxError('Unexpected token <'); } })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) }));
    await expect(fetchApplications()).rejects.toThrow('invalid response');
    await expect(fetchApplications()).rejects.toThrow('invalid response');
  });

  it('reports backend failure and preserves valid application data', async () => {
    const data = { applications: [{ id: 'saved', status: 'PENDING' }] };
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: true, json: async () => data }));
    await expect(fetchApplications()).rejects.toThrow('HTTP 503');
    await expect(fetchApplications()).resolves.toEqual(data);
  });
});

describe('application submission', () => {
  it('explains a connection failure without reporting a successful submission', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    await expect(createApplication({})).rejects.toThrow('Cannot reach the application service');
  });

  it('preserves an error returned by the application service', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'walletAddress and propertyHash required' }),
    }));

    await expect(createApplication({})).rejects.toThrow('walletAddress and propertyHash required');
  });

  it('returns the saved application after a successful submission', async () => {
    const application = { id: 'test-application', status: 'PENDING' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => application,
    }));

    await expect(createApplication({})).resolves.toEqual(application);
  });
});
