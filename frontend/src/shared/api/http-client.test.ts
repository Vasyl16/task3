import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './api-error';
import { api, configureHttpClient, resetHttpClient } from './http-client';

// A fake backend. Requests are answered from a queue of handlers keyed
// by whether the caller presented the current access token, which is
// what makes the refresh-and-retry path observable.
const VALID_TOKEN = 'fresh-access-token';

let currentToken: string | null;
let refreshCalls: number;
let authFailures: number;
let requestLog: { url: string; headers: Headers }[];

function jsonResponse(status: number, body: unknown): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Answers 401 to anything not bearing VALID_TOKEN, 200 otherwise.
function tokenAwareFetch() {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const url = input instanceof Request ? input.url : input.toString();
    requestLog.push({ url, headers });
    return Promise.resolve(
      headers.get('Authorization') === `Bearer ${VALID_TOKEN}`
        ? jsonResponse(200, { ok: true })
        : jsonResponse(401, { message: 'Unauthorized' }),
    );
  });
}

beforeEach(() => {
  resetHttpClient();
  currentToken = 'stale-access-token';
  refreshCalls = 0;
  authFailures = 0;
  requestLog = [];

  configureHttpClient({
    getAccessToken: () => currentToken,
    refresh: async () => {
      refreshCalls += 1;
      // A real refresh is a network round trip. The delay is what makes
      // the concurrency test meaningful — without it the first refresh
      // would resolve before the sibling requests even reached the gate.
      await new Promise((resolve) => setTimeout(resolve, 10));
      currentToken = VALID_TOKEN;
      return true;
    },
    onAuthFailure: () => {
      authFailures += 1;
      currentToken = null;
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetHttpClient();
});

describe('apiRequest', () => {
  it('sends the access token as a bearer header', async () => {
    currentToken = VALID_TOKEN;
    vi.stubGlobal('fetch', tokenAwareFetch());

    await api.get('/products');

    expect(requestLog[0].headers.get('Authorization')).toBe(
      `Bearer ${VALID_TOKEN}`,
    );
  });

  it('sends a correlation id so a request can be traced in the backend logs', async () => {
    currentToken = VALID_TOKEN;
    vi.stubGlobal('fetch', tokenAwareFetch());

    await api.get('/products');

    expect(requestLog[0].headers.get('X-Correlation-ID')).toBeTruthy();
  });

  it('builds query strings, repeating a key per array item', async () => {
    currentToken = VALID_TOKEN;
    vi.stubGlobal('fetch', tokenAwareFetch());

    await api.get('/orders', {
      params: { page: 1, status: ['NEW', 'SHIPPED'], empty: undefined },
    });

    const url = new URL(requestLog[0].url);
    expect(url.searchParams.get('page')).toBe('1');
    expect(url.searchParams.getAll('status')).toEqual(['NEW', 'SHIPPED']);
    // An undefined param must be omitted, not sent as "undefined".
    expect(url.searchParams.has('empty')).toBe(false);
  });

  it('refreshes once and retries after a 401', async () => {
    vi.stubGlobal('fetch', tokenAwareFetch());

    await expect(api.get('/orders')).resolves.toEqual({ ok: true });

    expect(refreshCalls).toBe(1);
    expect(requestLog).toHaveLength(2);
    expect(requestLog[1].headers.get('Authorization')).toBe(
      `Bearer ${VALID_TOKEN}`,
    );
    expect(authFailures).toBe(0);
  });

  // The reason the single-flight gate exists. The backend ROTATES refresh
  // tokens and treats reuse of a spent one as theft, revoking the whole
  // family — so a page that fired several queries at once with an expired
  // access token would refresh several times in parallel and log the user
  // out. All of them must share one refresh.
  it('coalesces concurrent 401s into a single refresh', async () => {
    vi.stubGlobal('fetch', tokenAwareFetch());

    const results = await Promise.all([
      api.get('/cart'),
      api.get('/orders'),
      api.get('/notifications'),
      api.get('/products'),
    ]);

    expect(results).toEqual([
      { ok: true },
      { ok: true },
      { ok: true },
      { ok: true },
    ]);
    expect(refreshCalls).toBe(1);
    // Four initial 401s, then four retries — and only one refresh.
    expect(requestLog).toHaveLength(8);
  });

  it('allows a later request to refresh again once the first refresh settled', async () => {
    vi.stubGlobal('fetch', tokenAwareFetch());
    await api.get('/orders');
    expect(refreshCalls).toBe(1);

    // The token expires again later in the session.
    currentToken = 'stale-again';
    await api.get('/orders');

    // The gate must not be a one-shot latch that permanently blocks
    // future refreshes after the first one.
    expect(refreshCalls).toBe(2);
  });

  it('reports an auth failure and throws when the refresh fails', async () => {
    configureHttpClient({
      getAccessToken: () => currentToken,
      refresh: () => {
        refreshCalls += 1;
        return Promise.resolve(false);
      },
      onAuthFailure: () => {
        authFailures += 1;
      },
    });
    vi.stubGlobal('fetch', tokenAwareFetch());

    await expect(api.get('/orders')).rejects.toMatchObject({ status: 401 });

    expect(refreshCalls).toBe(1);
    expect(authFailures).toBe(1);
    // No retry when there is no new token to retry with.
    expect(requestLog).toHaveLength(1);
  });

  it('does not attempt a refresh when skipAuthRefresh is set', async () => {
    vi.stubGlobal('fetch', tokenAwareFetch());

    // This is how the refresh call itself is issued; without the flag it
    // would recurse into refreshing on its own 401.
    await expect(
      api.post(
        '/auth/refresh',
        { refreshToken: 'x' },
        { skipAuthRefresh: true },
      ),
    ).rejects.toMatchObject({ status: 401 });

    expect(refreshCalls).toBe(0);
  });

  it('collects every validation message from a 400', async () => {
    currentToken = VALID_TOKEN;
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          jsonResponse(400, {
            message: ['email must be an email', 'password is too short'],
          }),
        ),
      ),
    );

    // class-validator returns one message per failed constraint; showing
    // only the first would drip-feed the user their mistakes.
    await expect(api.post('/auth/register', {})).rejects.toMatchObject({
      messages: ['email must be an email', 'password is too short'],
    });
  });

  it('survives an error response that is not JSON', async () => {
    currentToken = VALID_TOKEN;
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(new Response('<html>502</html>', { status: 502 })),
      ),
    );

    // A proxy's HTML error page must surface as a 502, not as a JSON
    // parse error that hides the real status.
    await expect(api.get('/products')).rejects.toMatchObject({ status: 502 });
  });

  it('returns undefined for a 204 instead of failing to parse a body', async () => {
    currentToken = VALID_TOKEN;
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse(204, null))),
    );

    await expect(api.post('/auth/logout')).resolves.toBeUndefined();
  });

  // A NestJS controller returning `null` (e.g. GET /sellers/me/profile
  // when the caller has no seller profile — a normal, not-an-error
  // result) is sent as a genuinely EMPTY 200 body, not the 4-byte JSON
  // literal "null" and not a 204. Before this was handled, calling
  // response.json() on that empty string threw a native SyntaxError —
  // not an ApiError — which surfaced to the user as an unhelpful
  // "Something went wrong" instead of just... no data.
  it('returns undefined for a 200 with an empty body, same as a 204', async () => {
    currentToken = VALID_TOKEN;
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response('', {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
      ),
    );

    await expect(api.get('/sellers/me/profile')).resolves.toBeUndefined();
  });

  it('turns a network failure into a network ApiError', async () => {
    currentToken = VALID_TOKEN;
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    );

    const error = await api.get('/products').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).isNetworkError).toBe(true);
  });

  it('lets an abort propagate untouched', async () => {
    currentToken = VALID_TOKEN;
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new DOMException('Aborted', 'AbortError'))),
    );

    // TanStack Query relies on seeing AbortError to tell a cancelled
    // query apart from a genuine failure; wrapping it would make an
    // unmounted component look like an error state.
    const error = await api.get('/products').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DOMException);
    expect((error as DOMException).name).toBe('AbortError');
  });
});
