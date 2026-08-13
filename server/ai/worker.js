import crypto from 'crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { config } from '../config.js';
import { closePool, ensureDatabase } from '../db.js';
import {
  claimIndexJob,
  completeIndexJob,
  failIndexJob,
} from '../indexing.js';
import { processIndexJob } from './indexer.js';
import { assertAiIndexingConfiguration } from './vector-store.js';

const workerId = `ai-worker-${process.pid}-${crypto.randomUUID().slice(0, 8)}`;
let stopping = false;

export async function processOneIndexJob({ processor = processIndexJob } = {}) {
  const job = await claimIndexJob(workerId);
  if (!job) return null;

  try {
    await processor(job);
    await completeIndexJob(job.id);
    return { id: Number(job.id), status: 'completed' };
  } catch (error) {
    await failIndexJob(job, error, config.ai.worker.maxAttempts);
    console.error(`AI index job ${job.id} failed:`, error.message);
    return { id: Number(job.id), status: 'failed' };
  }
}

async function run() {
  await ensureDatabase();
  assertAiIndexingConfiguration();
  console.log(`AI index worker ${workerId} is ready.`);

  while (!stopping) {
    const result = await processOneIndexJob();
    if (!result) await delay(config.ai.worker.pollMs);
  }
}

async function shutdown() {
  stopping = true;
  await closePool();
}

process.on('SIGINT', () => shutdown().finally(() => process.exit(0)));
process.on('SIGTERM', () => shutdown().finally(() => process.exit(0)));

run().catch(async (error) => {
  console.error('AI index worker stopped:', error.message);
  await closePool();
  process.exit(1);
});
