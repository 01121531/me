import { config } from '../config.js';
import {
  documentChecksum,
  getIndexState,
  loadIndexDocument,
  removeIndexState,
  removeIndexStateForTask,
  saveIndexState,
} from './documents.js';
import {
  deleteDocumentVector,
  deleteTaskVectors,
  upsertDocumentVector,
} from './vector-store.js';

export async function processIndexJob(job) {
  if (job.operation === 'delete') {
    if (job.entity_type === 'task') {
      await deleteTaskVectors(job.entity_id);
      await removeIndexStateForTask(job.entity_id);
      return;
    }
    await deleteDocumentVector(job.entity_type, job.entity_id);
    await removeIndexState(job.entity_type, job.entity_id);
    return;
  }

  const document = await loadIndexDocument(job.entity_type, job.entity_id);
  if (!document) {
    await deleteDocumentVector(job.entity_type, job.entity_id);
    await removeIndexState(job.entity_type, job.entity_id);
    return;
  }

  const checksum = documentChecksum(document, config.ai.indexVersion);
  const currentState = await getIndexState(document.entityType, document.entityId);
  if (
    currentState?.content_hash === checksum
    && currentState.index_version === config.ai.indexVersion
  ) {
    return;
  }

  await upsertDocumentVector(document);
  await saveIndexState(document, checksum, config.ai.indexVersion);
}
