import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { extname } from 'node:path';
import { diskStorage } from 'multer';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';

// Relative to process.cwd() — same convention as the log file path
// (config.log.file defaults to "logs/app.log"), and served back out at
// the matching public path by ServeStaticModule in app.module.ts
// (rootPath "uploads", serveRoot "/uploads").
export const PRODUCT_IMAGE_UPLOAD_DIR = 'uploads/products';

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

export const productImageMulterOptions: MulterOptions = {
  storage: diskStorage({
    // A function (not a bare string) so the directory is created lazily
    // on first upload — nothing else in the app needs this directory to
    // exist, and multer itself will NOT create it, only fail with ENOENT.
    destination: (_req, _file, callback) => {
      if (!existsSync(PRODUCT_IMAGE_UPLOAD_DIR)) {
        mkdirSync(PRODUCT_IMAGE_UPLOAD_DIR, { recursive: true });
      }
      callback(null, PRODUCT_IMAGE_UPLOAD_DIR);
    },
    // A random filename, never the client-supplied one — the original
    // name is untrusted input (path traversal, collisions, disclosure of
    // the uploader's local filesystem) and carries no information this
    // app needs; the extension is kept only so the file serves with a
    // sane Content-Type.
    filename: (_req, file, callback) => {
      callback(null, `${randomUUID()}${extname(file.originalname)}`);
    },
  }),
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
  fileFilter: (_req, file, callback) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      callback(
        new BadRequestException('Only JPEG, PNG, or WebP images are allowed'),
        false,
      );
      return;
    }
    callback(null, true);
  },
};
