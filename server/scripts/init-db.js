import { closePool, ensureDatabase } from '../db.js';

await ensureDatabase();
console.log('Database and tables are ready.');
await closePool();
