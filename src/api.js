const API_BASE = import.meta.env.VITE_API_BASE || '/api';

async function request(path, options = {}) {
  const isFormData = options.body instanceof FormData;
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: 'same-origin',
    headers: isFormData
      ? { ...(options.headers || {}) }
      : {
          'Content-Type': 'application/json',
          ...(options.headers || {}),
        },
    ...options,
  });

  if (response.status === 204) return null;

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.message || '请求失败');
  }
  return data;
}

function parseSseBlock(block) {
  let event = 'message';
  const data = [];

  block.split(/\r?\n/).forEach((line) => {
    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      data.push(line.slice(5).trimStart());
    }
  });

  if (!data.length) return null;
  const raw = data.join('\n');
  let payload = raw;
  try {
    payload = JSON.parse(raw);
  } catch {
    // Some SSE implementations may send plain text. Keep it usable.
  }
  return { event, payload };
}

async function streamRequest(path, payload, handlers = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.message || '请求失败');
  }
  if (!response.body) {
    throw new Error('浏览器不支持流式读取。');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const dispatch = (block) => {
    const parsed = parseSseBlock(block);
    if (!parsed) return;
    if (parsed.event === 'sources') handlers.onSources?.(parsed.payload || []);
    if (parsed.event === 'conversation') handlers.onConversation?.(parsed.payload || null);
    if (parsed.event === 'delta') handlers.onDelta?.(String(parsed.payload || ''));
    if (parsed.event === 'done') handlers.onDone?.(parsed.payload || {});
    if (parsed.event === 'error') {
      handlers.onError?.(parsed.payload || {});
      throw new Error(parsed.payload?.message || '流式问答失败');
    }
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() || '';
    blocks.forEach((block) => {
      if (block.trim()) dispatch(block);
    });
  }

  buffer += decoder.decode();
  if (buffer.trim()) dispatch(buffer);
}

export const api = {
  getAuthStatus: () => request('/auth/me'),
  loginWithPassword: (password) =>
    request('/auth/password-login', {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),
  logout: () =>
    request('/auth/logout', {
      method: 'POST',
    }),
  getSettings: () => request('/settings'),
  updateAiSettings: (payload) =>
    request('/settings/ai', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  testAiSettings: (payload) =>
    request('/settings/ai/test', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updatePassword: (payload) =>
    request('/settings/password', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  getOnlineUpdateStatus: () => request('/settings/update'),
  startOnlineUpdate: (payload = {}) =>
    request('/settings/update', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  searchWorkspace: (question, options = {}) =>
    request('/ai/search', {
      method: 'POST',
      body: JSON.stringify({ question, ...options }),
    }),
  askWorkspace: (question, options = {}) =>
    request('/ai/ask', {
      method: 'POST',
      body: JSON.stringify({ question, ...options }),
    }),
  streamAskWorkspace: (question, options = {}, handlers = {}) =>
    streamRequest('/ai/ask-stream', { question, ...options }, handlers),
  formatNoteWithAi: (payload) =>
    request('/ai/notes/format', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  streamFormatNoteWithAi: (payload, handlers = {}) =>
    streamRequest('/ai/notes/format-stream', payload, handlers),
  getAiConversations: (params = {}) => {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') query.set(key, value);
    });
    const suffix = query.toString() ? `?${query}` : '';
    return request(`/ai/conversations${suffix}`);
  },
  createAiConversation: (payload = {}) =>
    request('/ai/conversations', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateAiConversation: (id, payload = {}) =>
    request(`/ai/conversations/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  deleteAiConversation: (id) =>
    request(`/ai/conversations/${id}`, {
      method: 'DELETE',
    }),
  getAiConversationMessages: (id) => request(`/ai/conversations/${id}/messages`),
  getTaskAiSuggestions: (taskId, payload = {}) =>
    request(`/ai/tasks/${taskId}/suggestions`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getTaskAiSummary: (taskId) =>
    request(`/ai/tasks/${taskId}/summary`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  generateLogDraftFromNote: (taskId, noteId) =>
    request(`/ai/tasks/${taskId}/notes/${noteId}/log-draft`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  createAiTaskSuggestionAction: (payload) =>
    request('/ai/task-suggestions/actions', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getActionRequests: (params = {}) => {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value) query.set(key, value);
    });
    const suffix = query.toString() ? `?${query}` : '';
    return request(`/action-requests${suffix}`);
  },
  approveActionRequest: (id) =>
    request(`/action-requests/${id}/approve`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  rejectActionRequest: (id, reason = '') =>
    request(`/action-requests/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  getTasks: (params = {}) => {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value) query.set(key, value);
    });
    const suffix = query.toString() ? `?${query}` : '';
    return request(`/tasks${suffix}`);
  },
  createTask: (payload) =>
    request('/tasks', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateTask: (id, payload) =>
    request(`/tasks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  reorderTasks: (items) =>
    request('/tasks/reorder', {
      method: 'PATCH',
      body: JSON.stringify({ items }),
    }),
  deleteTask: (id) =>
    request(`/tasks/${id}`, {
      method: 'DELETE',
    }),
  getNoteCategories: () => request('/note-categories'),
  getLogs: (taskId, params = {}) => {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value) query.set(key, value);
    });
    const suffix = query.toString() ? `?${query}` : '';
    return request(`/tasks/${taskId}/logs${suffix}`);
  },
  getNotes: (taskId, params = {}) => {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value) query.set(key, value);
    });
    const suffix = query.toString() ? `?${query}` : '';
    return request(`/tasks/${taskId}/notes${suffix}`);
  },
  createNote: (taskId, payload) =>
    request(`/tasks/${taskId}/notes`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getStandaloneNotes: (params = {}) => {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value) query.set(key, value);
    });
    const suffix = query.toString() ? `?${query}` : '';
    return request(`/notes${suffix}`);
  },
  createStandaloneNote: (payload) =>
    request('/notes', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateNote: (id, payload) =>
    request(`/notes/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  getNoteVersions: (id) => request(`/notes/${id}/versions`),
  restoreNoteVersion: (noteId, versionId, snapshot = 'before') =>
    request(`/notes/${noteId}/versions/${versionId}/restore`, {
      method: 'POST',
      body: JSON.stringify({ snapshot }),
    }),
  uploadNoteAttachments: (noteId, files, note = '') => {
    const formData = new FormData();
    Array.from(files).forEach((file) => formData.append('files', file));
    if (note) formData.append('note', note);
    return request(`/notes/${noteId}/attachments`, {
      method: 'POST',
      body: formData,
    });
  },
  deleteNoteAttachment: (id) =>
    request(`/note-attachments/${id}`, {
      method: 'DELETE',
    }),
  getTaskAttachments: (taskId) => request(`/tasks/${taskId}/attachments`),
  uploadTaskAttachments: (taskId, files, note = '') => {
    const formData = new FormData();
    Array.from(files).forEach((file) => formData.append('files', file));
    if (note) formData.append('note', note);
    return request(`/tasks/${taskId}/attachments`, {
      method: 'POST',
      body: formData,
    });
  },
  deleteTaskAttachment: (id) =>
    request(`/task-attachments/${id}`, {
      method: 'DELETE',
    }),
  reextractAttachment: (kind, id) =>
    request(`/attachments/${kind}/${id}/reextract`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  reorderNotes: (items) =>
    request('/notes/reorder', {
      method: 'PATCH',
      body: JSON.stringify({ items }),
    }),
  deleteNote: (id) =>
    request(`/notes/${id}`, {
      method: 'DELETE',
    }),
  createLog: (taskId, payload) =>
    request(`/tasks/${taskId}/logs`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateLog: (id, payload) =>
    request(`/logs/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  getLogVersions: (id) => request(`/logs/${id}/versions`),
  uploadAttachments: (logId, files, note = '') => {
    const formData = new FormData();
    Array.from(files).forEach((file) => formData.append('files', file));
    if (note) formData.append('note', note);
    return request(`/logs/${logId}/attachments`, {
      method: 'POST',
      body: formData,
    });
  },
  updateAttachment: (id, payload) =>
    request(`/attachments/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  deleteAttachment: (id) =>
    request(`/attachments/${id}`, {
      method: 'DELETE',
    }),
  deleteLog: (id) =>
    request(`/logs/${id}`, {
      method: 'DELETE',
    }),
  getTrash: (type = 'all') => request(`/trash?type=${encodeURIComponent(type)}`),
  restoreTrashItem: (type, id) =>
    request(`/trash/${type}/${id}/restore`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  permanentlyDeleteTrashItem: (type, id) =>
    request(`/trash/${type}/${id}`, {
      method: 'DELETE',
    }),
  restoreTrashAttachment: (kind, id) =>
    request(`/trash/attachment/${kind}/${id}/restore`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  permanentlyDeleteTrashAttachment: (kind, id) =>
    request(`/trash/attachment/${kind}/${id}`, {
      method: 'DELETE',
    }),
  getAttachmentCenter: (params = {}) => {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') query.set(key, value);
    });
    const suffix = query.toString() ? `?${query}` : '';
    return request(`/attachment-center${suffix}`);
  },
  moveAttachmentsToTrash: (items, reason = '') =>
    request('/attachment-center/trash', {
      method: 'PATCH',
      body: JSON.stringify({ items, reason }),
    }),
  updateCenterAttachment: (kind, id, payload = {}) =>
    request(`/attachment-center/${kind}/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  getWorkbench: (params = {}) => {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value) query.set(key, value);
    });
    const suffix = query.toString() ? `?${query}` : '';
    return request(`/workbench${suffix}`);
  },
  getReport: (from, to) => request(`/reports?from=${from}&to=${to}`),
  workspaceExportUrl: ({ from, to, format = 'markdown' } = {}) => {
    const query = new URLSearchParams();
    if (from) query.set('from', from);
    if (to) query.set('to', to);
    query.set('format', format);
    return `${API_BASE}/exports/workspace?${query}`;
  },
  getAiReportSummary: (payload) =>
    request('/ai/reports/summary', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getBackups: (limit = 20) => request(`/backups?limit=${limit}`),
  createBackup: () =>
    request('/backups', {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  verifyBackup: (backupDir = '') =>
    request('/backups/verify', {
      method: 'POST',
      body: JSON.stringify({ backupDir }),
    }),
};
