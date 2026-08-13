import { extractAttachmentText } from '../ai/attachment-text.js';

const result = await extractAttachmentText(
  { original_name: 'work-log.csv' },
  Buffer.from('task,hours\nindexing,1.5\n', 'utf8'),
  1000,
);

if (result.parser !== 'csv' || !result.text.includes('indexing,1.5')) {
  throw new Error('Attachment text extraction did not preserve CSV content.');
}

console.log('Attachment text smoke test passed: supported text is extracted without executing files.');
