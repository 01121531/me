const analyticsTables = [
  'tasks',
  'work_logs',
  'task_notes',
  'log_attachments',
  'note_attachments',
  'task_attachments',
  'ai_messages',
  'audit_events',
];

export const dorisActivationThresholds = Object.freeze({
  analyticsRows: 1_000_000,
  externalSources: 3,
  reportP95Ms: 2_000,
});

export function evaluateDorisReadiness({
  analyticsRows = 0,
  externalSources = 1,
  reportP95Ms = null,
  recurringAnalytics = false,
} = {}) {
  const hasReportP95 = reportP95Ms !== null && reportP95Ms !== undefined && reportP95Ms !== '';
  const normalized = {
    analyticsRows: Math.max(0, Number(analyticsRows) || 0),
    externalSources: Math.max(1, Number(externalSources) || 1),
    reportP95Ms: hasReportP95 && Number.isFinite(Number(reportP95Ms))
      ? Math.max(0, Number(reportP95Ms))
      : null,
    recurringAnalytics: Boolean(recurringAnalytics),
  };
  const triggers = {
    analyticsRows: normalized.analyticsRows >= dorisActivationThresholds.analyticsRows,
    externalSources: normalized.externalSources >= dorisActivationThresholds.externalSources,
    reportLatency: normalized.reportP95Ms !== null
      && normalized.reportP95Ms > dorisActivationThresholds.reportP95Ms,
    recurringAnalytics: normalized.recurringAnalytics,
  };
  const triggered = Object.entries(triggers)
    .filter(([, active]) => active)
    .map(([name]) => name);

  return {
    provider: 'mysql',
    dorisEnabled: false,
    recommendation: triggered.length ? 'pilot' : 'keep_mysql',
    metrics: normalized,
    thresholds: dorisActivationThresholds,
    triggers,
    triggered,
  };
}

export async function getAnalyticsReadiness(db, metrics = {}) {
  const [rows] = await db.query(
    analyticsTables
      .map((table) => `SELECT ? AS table_name, COUNT(*) AS row_count FROM ${table}`)
      .join(' UNION ALL '),
    analyticsTables,
  );
  const tableRows = Object.fromEntries(rows.map((row) => [row.table_name, Number(row.row_count || 0)]));
  const analyticsRows = Object.values(tableRows).reduce((sum, count) => sum + count, 0);
  return {
    ...evaluateDorisReadiness({ analyticsRows, externalSources: 1, ...metrics }),
    tableRows,
  };
}

export function resolveAiDataRoute(intent, { hasActionPlan = false, semanticEnabled = false } = {}) {
  if (hasActionPlan || String(intent || '').startsWith('action')) {
    return {
      provider: 'approval',
      stores: ['mysql'],
      reason: '写操作必须进入现有审批流程。',
      futureProvider: null,
    };
  }
  if (['note', 'note_search', 'task_note', 'attachment_search', 'link_search', 'general'].includes(intent)) {
    if (!semanticEnabled) {
      return {
        provider: 'mysql',
        stores: ['mysql'],
        reason: '语义索引未参与本次请求，事实直接来自 MySQL。',
        futureProvider: null,
      };
    }
    return {
      provider: 'mysql_semantic',
      stores: ['mysql', 'llamaindex', 'qdrant'],
      reason: 'MySQL 提供事实，LlamaIndex/Qdrant 只补充语义召回。',
      futureProvider: null,
    };
  }
  return {
    provider: 'mysql',
    stores: ['mysql'],
    reason: '实时任务、日志和报表事实继续直接查询 MySQL。',
    futureProvider: 'doris',
  };
}
