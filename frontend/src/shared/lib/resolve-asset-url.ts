import { env } from '../config/env';

// Backend-served assets (product images, uploaded via multer — see
// ProductsController) come back as a host-relative path
// ("/uploads/products/<uuid>.jpg"), not a full URL — resolve it against
// the API origin, the same way a real browser resolves a relative href.
export function resolveAssetUrl(
  path: string | null | undefined,
): string | null {
  if (!path) return null;
  try {
    return new URL(path, env.apiUrl).toString();
  } catch {
    return null;
  }
}
