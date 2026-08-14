import assert from 'node:assert/strict';
import {
  dorisActivationThresholds,
  evaluateDorisReadiness,
  resolveAiDataRoute,
} from '../analytics-readiness.js';

const personalWorkspace = evaluateDorisReadiness({
  analyticsRows: 99_999,
  externalSources: 1,
});
assert.equal(personalWorkspace.provider, 'mysql');
assert.equal(personalWorkspace.dorisEnabled, false);
assert.equal(personalWorkspace.recommendation, 'keep_mysql');
assert.deepEqual(personalWorkspace.triggered, []);
assert.equal(personalWorkspace.metrics.reportP95Ms, null);

const largeWorkspace = evaluateDorisReadiness({
  analyticsRows: dorisActivationThresholds.analyticsRows,
});
assert.equal(largeWorkspace.recommendation, 'pilot');
assert.equal(largeWorkspace.triggers.analyticsRows, true);

const multiSourceWorkspace = evaluateDorisReadiness({ externalSources: 3 });
assert.equal(multiSourceWorkspace.triggers.externalSources, true);

const slowReports = evaluateDorisReadiness({ reportP95Ms: 2_001 });
assert.equal(slowReports.triggers.reportLatency, true);

const recurringAnalytics = evaluateDorisReadiness({ recurringAnalytics: true });
assert.equal(recurringAnalytics.triggers.recurringAnalytics, true);

assert.equal(resolveAiDataRoute('task_progress').provider, 'mysql');
assert.equal(resolveAiDataRoute('note_search').provider, 'mysql');
assert.equal(resolveAiDataRoute('note_search', { semanticEnabled: true }).provider, 'mysql_semantic');
assert.equal(resolveAiDataRoute('task_note', { semanticEnabled: true }).provider, 'mysql_semantic');
assert.equal(resolveAiDataRoute('attachment_search', { semanticEnabled: true }).provider, 'mysql_semantic');
assert.equal(resolveAiDataRoute('action_update_task').provider, 'approval');
assert.equal(resolveAiDataRoute('general', { hasActionPlan: true }).provider, 'approval');

console.log('Analytics readiness smoke test passed: Doris remains disabled and AI routes stay bounded.');
