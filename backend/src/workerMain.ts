// Standalone worker process: `npm run worker` (run with RUN_WORKER=false on the API to separate them).
import { ensureSenders } from './services/mailer';
import { ensureIndex } from './services/search';
import { startWorker } from './worker';

async function main() {
  await ensureSenders();
  await ensureIndex();
  startWorker();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
