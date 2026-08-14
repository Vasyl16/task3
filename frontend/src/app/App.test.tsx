import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App';

// Smoke test for the composition itself — that the provider stack, the
// router, and the layout mount together and render a route. The pieces
// are covered in depth by their own tests; what this catches is a
// wiring mistake between them, such as a provider in the wrong order.

function stubSearchAndCategoriesFetch() {
  // The catalog route fires GET /search and GET /categories on mount,
  // and an authenticated shell ALSO fires GET /notifications (see
  // NotificationToaster/NotificationBellLink, both always mounted) —
  // each needs its own real shape — a single blanket response would let
  // a shape bug pass by accident (the assertions could resolve before
  // any query settled). Awaiting the empty-state text below forces the
  // search/categories queries to actually complete before a test does.
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : input.toString();
      const body =
        url.includes('/categories') || url.includes('/notifications')
          ? []
          : { items: [], total: 0, page: 1, limit: 20 };
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }),
  );
}

// No signature verification happens client-side (see shared/lib/jwt.ts)
// — a token shaped like this is exactly as good as a real one for
// exercising AuthProvider's restore path in a test.
function fakeAccessToken(claims: Record<string, unknown>): string {
  const segment = (value: unknown) =>
    btoa(JSON.stringify(value))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  return `${segment({ alg: 'none' })}.${segment(claims)}.signature`;
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('App', () => {
  it('signs an authenticated visitor straight into the catalog', async () => {
    window.localStorage.setItem(
      'marketplace.accessToken',
      fakeAccessToken({
        sub: 'user-1',
        email: 'buyer@example.com',
        role: 'CUSTOMER',
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    );
    window.localStorage.setItem('marketplace.refreshToken', 'refresh-token');
    stubSearchAndCategoriesFetch();

    render(<App />);

    expect(
      screen.getByRole('link', { name: 'Marketplace' }),
    ).toBeInTheDocument();
    // The profile link is an icon (see app-header.tsx), identified by
    // its accessible name rather than visible text.
    expect(
      await screen.findByRole('link', { name: 'Account: buyer@example.com' }),
    ).toBeInTheDocument();
    // The search query resolves and renders the empty state rather than
    // crashing on a malformed response.
    expect(
      await screen.findByText('No products match those filters'),
    ).toBeInTheDocument();
  });

  // Every route requires a session except /login and /register (see
  // router.tsx) — an anonymous visitor hitting the home route is turned
  // away to sign in rather than shown the catalog.
  it('redirects an anonymous visitor at the home route to sign in', async () => {
    render(<App />);

    expect(
      await screen.findByRole('heading', { name: 'Sign in' }),
    ).toBeInTheDocument();
  });
});
