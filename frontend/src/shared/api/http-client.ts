import { env } from '../config/env';
import { ApiError } from './api-error';

// The one place a network request is made. Everything else in the app
// goes through here, so auth headers, token refresh, error shape, and
// correlation IDs are handled once rather than per call site.
//
// Auth is INJECTED rather than imported. `shared/` sits at the bottom of
// the layer stack and may not import from `entities/` or `features/`, so
// the app wires the concrete implementations in at bootstrap. The bonus
// is that tests can drive the refresh path without React or storage.

export interface HttpClientAuth {
  getAccessToken(): string | null;
  // Returns true if a NEW access token is now available to retry with.
  refresh(): Promise<boolean>;
  // Called when the session is unrecoverable and must be discarded.
  onAuthFailure(): void;
}

const noAuth: HttpClientAuth = {
  getAccessToken: () => null,
  refresh: () => Promise.resolve(false),
  onAuthFailure: () => {},
};

let auth: HttpClientAuth = noAuth;

export function configureHttpClient(next: HttpClientAuth): void {
  auth = next;
}

// Exported for tests, which need each case to start from a clean slate.
export function resetHttpClient(): void {
  auth = noAuth;
  inFlightRefresh = null;
}

// A single shared refresh promise. Without this, a page that fires five
// queries on mount with an expired access token would send five parallel
// refresh calls — and since the backend ROTATES refresh tokens and
// treats reuse of an old one as theft, four of them would arrive with a
// token that had just been invalidated and log the user out. Coalescing
// them into one call is what makes rotation and concurrency coexist.
let inFlightRefresh: Promise<boolean> | null = null;

function refreshOnce(): Promise<boolean> {
  inFlightRefresh ??= auth.refresh().finally(() => {
    inFlightRefresh = null;
  });
  return inFlightRefresh;
}

// Exposed so app bootstrap can eagerly restore a session (expired access
// token, valid refresh token) through the SAME gate the 401 path uses.
// If bootstrap called auth.refresh() directly, a query firing at the
// same moment would start a second, competing rotation.
export function refreshAuthOnce(): Promise<boolean> {
  return refreshOnce();
}

export type QueryParams = Record<
  string,
  string | number | boolean | undefined | null | (string | number)[]
>;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  params?: QueryParams;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  // Set on the refresh call itself, which must not recurse into the
  // refresh handling below.
  skipAuthRefresh?: boolean;
}

function buildUrl(path: string, params?: QueryParams): string {
  const url = new URL(
    path.replace(/^\//, ''),
    `${env.apiUrl.replace(/\/$/, '')}/`,
  );
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === '') continue;
      // Repeated key per item — matches how NestJS parses array query
      // params, so `?status=NEW&status=SHIPPED` arrives as an array.
      if (Array.isArray(value)) {
        for (const item of value) url.searchParams.append(key, String(item));
      } else {
        url.searchParams.append(key, String(value));
      }
    }
  }
  return url.toString();
}

function newCorrelationId(): string {
  // The backend generates one when the header is absent, so a failure
  // here costs traceability, never the request.
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `web-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function toApiError(response: Response): Promise<ApiError> {
  let messages: string[] = [];
  try {
    const body: unknown = await response.json();
    const raw = (body as { message?: unknown }).message;
    if (Array.isArray(raw)) messages = raw.map(String);
    else if (typeof raw === 'string') messages = [raw];
  } catch {
    // A non-JSON error body (a proxy's HTML 502, say) leaves the status
    // as the only signal, which ApiError already defaults on.
  }
  return new ApiError(response.status, messages);
}

async function send(path: string, options: RequestOptions): Promise<Response> {
  const { method = 'GET', body, params, headers = {}, signal } = options;

  const requestHeaders: Record<string, string> = {
    Accept: 'application/json',
    'X-Correlation-ID': newCorrelationId(),
    ...headers,
  };

  const accessToken = auth.getAccessToken();
  if (accessToken) {
    requestHeaders.Authorization = `Bearer ${accessToken}`;
  }
  // FormData (file uploads) is sent as-is — fetch sets its own
  // multipart/form-data boundary from the FormData object, and setting
  // Content-Type manually here would omit that boundary and break the
  // request server-side. Everything else is still plain JSON.
  const isFormData = body instanceof FormData;
  if (body !== undefined && !isFormData) {
    requestHeaders['Content-Type'] = 'application/json';
  }

  try {
    return await fetch(buildUrl(path, params), {
      method,
      headers: requestHeaders,
      body:
        body === undefined
          ? undefined
          : isFormData
            ? body
            : JSON.stringify(body),
      signal,
    });
  } catch (error) {
    // AbortError is a deliberate cancellation (query unmounted, params
    // changed) — it must propagate untouched so TanStack Query can tell
    // it apart from a real failure.
    if (error instanceof DOMException && error.name === 'AbortError')
      throw error;
    throw ApiError.network(
      error instanceof Error ? error.message : 'Network request failed',
    );
  }
}

export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  let response = await send(path, options);

  if (response.status === 401 && !options.skipAuthRefresh) {
    const refreshed = await refreshOnce();
    if (!refreshed) {
      auth.onAuthFailure();
      throw await toApiError(response);
    }
    // Retrying is safe even for a POST: a 401 is rejected by the guard
    // before the handler runs, so the first attempt cannot have had a
    // side effect. Exactly one retry — a second 401 means the fresh
    // token is genuinely not accepted, and looping would just hammer
    // the endpoint.
    response = await send(path, options);
    if (response.status === 401) {
      auth.onAuthFailure();
    }
  }

  if (!response.ok) {
    throw await toApiError(response);
  }

  // 204 is the backend's convention for a successful write with nothing
  // to say (logout, delete). But a 200 can ALSO arrive with an empty
  // body — a NestJS controller returning `null` (e.g. "no seller profile
  // for this user, and that's a normal, not-found-but-not-an-error
  // result") is sent as a genuinely empty response, not the JSON literal
  // `null`. Calling .json() on an empty string throws a native
  // SyntaxError — not an ApiError — which used to reach the UI as an
  // unhelpful "Something went wrong" for what is really just "no data."
  // Reading the body as text first and checking for emptiness handles
  // both cases the same way, regardless of which status code carried it.
  //
  // Everything from here down is wrapped: send()'s try/catch only
  // guards the fetch() call itself, not reading the body afterwards — a
  // connection that drops mid-stream (proxy hiccup, server restart
  // between headers and body) throws its own raw TypeError here, and an
  // unwrapped one would silently break this module's one promise:
  // every call site only ever has to handle ApiError.
  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    throw ApiError.network(
      error instanceof Error
        ? error.message
        : 'The connection was interrupted while reading the response',
    );
  }
  if (text.length === 0) {
    return undefined as T;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw ApiError.network('The server sent a response that could not be read');
  }
}

export const api = {
  get: <T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiRequest<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    apiRequest<T>(path, { ...options, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    apiRequest<T>(path, { ...options, method: 'PATCH', body }),
  delete: <T>(path: string, options?: Omit<RequestOptions, 'method'>) =>
    apiRequest<T>(path, { ...options, method: 'DELETE' }),
};
