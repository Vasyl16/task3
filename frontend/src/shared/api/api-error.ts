// One error type for every failed request, so UI code can branch on
// `status` instead of parsing strings or guessing at response shapes.

export class ApiError extends Error {
  readonly status: number;
  // class-validator returns an ARRAY of messages for a 400 (one per
  // failed constraint) but a single string elsewhere. Normalising both
  // into a list here means form code never has to handle two shapes.
  readonly messages: string[];

  constructor(status: number, messages: string[]) {
    super(messages[0] ?? `Request failed with status ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.messages = messages;
  }

  // A network failure, a CORS rejection, or an offline browser — the
  // request never reached the backend, so retrying may genuinely help.
  static network(message: string): ApiError {
    return new ApiError(0, [message]);
  }

  get isNetworkError(): boolean {
    return this.status === 0;
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  get isForbidden(): boolean {
    return this.status === 403;
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

// The message to actually show a user. Backend messages are safe to
// surface: they are validation and business-rule text, not stack traces.
// A 500 is the exception — whatever it says is an internal detail.
export function toUserMessage(error: unknown): string {
  if (!isApiError(error)) {
    return 'Something went wrong. Please try again.';
  }
  if (error.isNetworkError) {
    return 'Could not reach the server. Check your connection and try again.';
  }
  if (error.status >= 500) {
    return 'The server had a problem handling that. Please try again shortly.';
  }
  return error.message;
}
