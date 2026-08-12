import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

// CLI-only (migrate/generate/studio). The running app never reads this —
// it loads DATABASE_URL itself via @nestjs/config (src/config/).
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
