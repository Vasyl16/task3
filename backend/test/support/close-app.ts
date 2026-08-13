import type { INestApplication } from '@nestjs/common';

// app.close() waits for every provider's shutdown hook, including
// @nestjs/bullmq's per-Worker close() — which can take a long time to
// resolve when a Worker's Redis connection never succeeded in the first
// place (e.g. no Redis running in this environment). That's a property
// of tearing down a never-connected socket, not a bug in the app itself;
// bounding it here keeps a missing dev-infra service from blocking the
// whole test suite, without changing any real runtime behavior (this
// file is test-only).
export async function closeApp(
  app: INestApplication,
  timeoutMs = 4000,
): Promise<void> {
  await Promise.race([
    app.close(),
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}
