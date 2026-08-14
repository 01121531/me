import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  Bot,
  ChevronRight,
  Download,
  ExternalLink,
  File,
  FilePlus2,
  FileText,
  Folder,
  FolderOpen,
  Image as ImageIcon,
  Link2,
  ListFilter,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  ShieldOff,
  Tags,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { api } from '../../api.js';
import './resource-library.css';

const kindLabels = { file: '文件', link: '链接', text: '文本' };
const statusLabels = { draft: '草稿', processing: '处理中', ready: '可检索', failed: '处理失败' };
const aiLabels = { inherit: '允许 AI 使用', allow: '允许 AI 使用', deny: '禁止 AI 使用' };

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / (1024 ** index)).toFixed(index ? 1 : 0)} ${units[index]}`;
}

function formatDate(value) {
  if (!value) return '未记录';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

function friendlyProcessingError(value) {
  if (!value) return '';
  let message = String(value);
  try {
    const parsed = JSON.parse(message);
    message = parsed?.error?.message || parsed?.message || message;
  } catch {
    // The worker can also store a plain-text parser error.
  }

  if (/support image input|image input|vision/i.test(message)) {
    return '当前 OCR 模型不支持图片输入。请在设置中选择支持视觉识别的模型，然后重新处理。';
  }
  if (/invalid token|unauthorized|authentication|api.?key/i.test(message)) {
    return 'OCR 服务认证失败。请检查设置中的模型地址和密钥，然后重新处理。';
  }
  if (/timeout|timed out/i.test(message)) {
    return '内容识别超时，请稍后重新处理。';
  }
  return message.length > 240 ? `${message.slice(0, 240)}...` : message;
}

function ResourceIcon({ resource, size = 20 }) {
  if (resource.kind === 'link') return <Link2 size={size} />;
  if (resource.kind === 'text') return <FileText size={size} />;
  if (resource.latestVersion?.mimeType?.startsWith('image/')) return <ImageIcon size={size} />;
  return <File size={size} />;
}

function folderRows(folders) {
  const children = new Map();
  folders.forEach((folder) => {
    const key = folder.parentId || 0;
    if (!children.has(key)) children.set(key, []);
    children.get(key).push(folder);
  });
  const result = [];
  const visit = (parentId, depth, visited = new Set()) => {
    (children.get(parentId) || []).forEach((folder) => {
      if (visited.has(folder.id)) return;
      result.push({ ...folder, depth });
      visit(folder.id, depth + 1, new Set([...visited, folder.id]));
    });
  };
  visit(0, 0);
  folders.filter((folder) => !result.some((item) => item.id === folder.id)).forEach((folder) => result.push({ ...folder, depth: 0 }));
  return result;
}

function TaxonomyDialog({ type, folders, onClose, onChanged, addToast, askConfirm }) {
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState('');
  const [color, setColor] = useState('#4f46e5');
  const [busy, setBusy] = useState(false);
  const isFolder = type === 'folder';

  async function submit(event) {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      if (isFolder) await api.createWorkspaceFolder({ name: name.trim(), parentId: parentId || null });
      else await api.createWorkspaceTag({ name: name.trim(), color });
      addToast?.('success', '已创建', `${isFolder ? '目录' : '标签'}“${name.trim()}”已创建。`);
      await onChanged();
      setName('');
    } catch (error) {
      addToast?.('error', '创建失败', error.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(item) {
    const confirmed = await askConfirm?.(
      `删除${isFolder ? '目录' : '标签'}`,
      isFolder
        ? `删除“${item.name}”后，其中的资料会移到上级目录，不会删除资料。`
        : `删除“${item.name}”只会解除关联，不会删除任务、笔记或资料。`,
      '确认删除',
    );
    if (!confirmed) return;
    try {
      if (isFolder) await api.deleteWorkspaceFolder(item.id);
      else await api.deleteWorkspaceTag(item.id);
      await onChanged();
    } catch (error) {
      addToast?.('error', '删除失败', error.message);
    }
  }

  return (
    <div className="resource-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="resource-modal" role="dialog" aria-modal="true" aria-labelledby="taxonomy-title" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div>
            <span className="resource-kicker">由你维护</span>
            <h2 id="taxonomy-title">{isFolder ? '目录管理' : '标签管理'}</h2>
          </div>
          <button type="button" className="resource-icon-button" onClick={onClose} aria-label="关闭"><X size={20} /></button>
        </header>
        <form className="resource-taxonomy-form" onSubmit={submit}>
          <label>
            <span>{isFolder ? '目录名称' : '标签名称'}</span>
            <input value={name} onChange={(event) => setName(event.target.value)} maxLength={isFolder ? 120 : 80} autoFocus />
          </label>
          {isFolder ? (
            <label>
              <span>上级目录</span>
              <select value={parentId} onChange={(event) => setParentId(event.target.value)}>
                <option value="">根目录</option>
                {folderRows(folders).map((folder) => <option key={folder.id} value={folder.id}>{'　'.repeat(folder.depth)}{folder.name}</option>)}
              </select>
            </label>
          ) : (
            <label className="resource-color-field">
              <span>标签颜色</span>
              <input type="color" value={color} onChange={(event) => setColor(event.target.value)} />
            </label>
          )}
          <button type="submit" className="resource-primary-button" disabled={busy || !name.trim()}>
            {busy ? <LoaderCircle size={17} className="spin" /> : <Plus size={17} />}
            创建
          </button>
        </form>
        <div className="resource-taxonomy-list">
          {(isFolder ? folderRows(folders) : folders).map((item) => (
            <div key={item.id} className="resource-taxonomy-row" style={isFolder ? { paddingLeft: 12 + (item.depth || 0) * 18 } : undefined}>
              <span className="resource-taxonomy-mark" style={!isFolder && item.color ? { background: item.color } : undefined}>
                {isFolder ? <Folder size={16} /> : null}
              </span>
              <strong>{item.name}</strong>
              {!isFolder && <small>{item.counts?.total || 0} 次关联</small>}
              {isFolder && <small>{item.resourceCount || 0} 项资料</small>}
              <button type="button" className="resource-icon-button danger" onClick={() => remove(item)} aria-label={`删除${item.name}`}><Trash2 size={16} /></button>
            </div>
          ))}
          {!(isFolder ? folders.length : folders.length) && <p className="resource-empty-copy">还没有{isFolder ? '目录' : '标签'}。</p>}
        </div>
      </section>
    </div>
  );
}

function CreateResourceDialog({ mode: initialMode, folders, tags, onClose, onCreated, addToast }) {
  const [mode, setMode] = useState(initialMode || 'file');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [folderId, setFolderId] = useState('');
  const [tagIds, setTagIds] = useState([]);
  const [aiVisibility, setAiVisibility] = useState('inherit');
  const [url, setUrl] = useState('');
  const [content, setContent] = useState('');
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    if (mode === 'file' && !files.length) return;
    if (mode !== 'file' && !title.trim()) return;
    setBusy(true);
    try {
      let result;
      if (mode === 'file') {
        result = await api.uploadWorkspaceResources(files, {
          title: files.length === 1 ? title.trim() : '',
          description: description.trim(),
          folderId: folderId || '',
          aiVisibility,
          tagIds,
        });
        const duplicateCount = (result.items || []).reduce((sum, item) => sum + (item.duplicates?.length || 0), 0);
        addToast?.(
          duplicateCount ? 'info' : 'success',
          '上传完成',
          duplicateCount ? `资料已保存；检测到 ${duplicateCount} 个相同文件，可在详情中决定是否复用。` : `已保存 ${result.items?.length || files.length} 项资料。`,
        );
      } else {
        result = await api.createWorkspaceResource({
          kind: mode,
          title: title.trim(),
          description: description.trim() || null,
          folderId: folderId || null,
          aiVisibility,
          tagIds,
          url: mode === 'link' ? url.trim() : undefined,
          content: mode === 'text' ? content : undefined,
        });
        addToast?.('success', '资料已创建', mode === 'link' ? '网页正文将由后台安全提取。' : '文本资料已经可以检索。');
      }
      await onCreated(result);
      onClose();
    } catch (error) {
      addToast?.('error', '保存失败', error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="resource-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="resource-modal resource-create-modal" role="dialog" aria-modal="true" aria-labelledby="resource-create-title" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div>
            <span className="resource-kicker">加入资料库</span>
            <h2 id="resource-create-title">创建资料</h2>
          </div>
          <button type="button" className="resource-icon-button" onClick={onClose} aria-label="关闭"><X size={20} /></button>
        </header>
        <div className="resource-mode-control" role="tablist" aria-label="资料类型">
          {[
            ['file', '文件', Upload],
            ['link', '网页链接', Link2],
            ['text', '文本资料', FileText],
          ].map(([value, label, Icon]) => (
            <button key={value} type="button" className={mode === value ? 'active' : ''} onClick={() => setMode(value)} role="tab" aria-selected={mode === value}>
              <Icon size={17} />{label}
            </button>
          ))}
        </div>
        <form className="resource-create-form" onSubmit={submit}>
          {mode === 'file' && (
            <label className="resource-dropzone">
              <Upload size={24} />
              <strong>{files.length ? `已选择 ${files.length} 个文件` : '选择文件或拖到这里'}</strong>
              <span>图片、PDF、Office、文本和常见压缩包，单个不超过 50 MB</span>
              <input type="file" multiple onChange={(event) => setFiles(Array.from(event.target.files || []))} />
            </label>
          )}
          <label>
            <span>标题{mode === 'file' ? '（单文件可选）' : ''}</span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={mode === 'file' ? '默认使用文件名' : '资料标题'} maxLength={255} />
          </label>
          {mode === 'link' && <label><span>公开网址</span><input type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com/article" required /></label>}
          {mode === 'text' && <label><span>正文</span><textarea value={content} onChange={(event) => setContent(event.target.value)} rows={9} required /></label>}
          <label><span>说明</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} /></label>
          <div className="resource-form-grid">
            <label><span>目录</span><select value={folderId} onChange={(event) => setFolderId(event.target.value)}><option value="">根目录</option>{folderRows(folders).map((folder) => <option key={folder.id} value={folder.id}>{'　'.repeat(folder.depth)}{folder.name}</option>)}</select></label>
            <label><span>AI 可见性</span><select value={aiVisibility} onChange={(event) => setAiVisibility(event.target.value)}><option value="inherit">允许 AI 使用</option><option value="deny">禁止 AI 使用</option></select></label>
          </div>
          <fieldset className="resource-tag-picker">
            <legend>已有标签</legend>
            <div>
              {tags.map((tag) => <label key={tag.id}><input type="checkbox" checked={tagIds.includes(tag.id)} onChange={() => setTagIds((current) => current.includes(tag.id) ? current.filter((id) => id !== tag.id) : [...current, tag.id])} /><span style={tag.color ? { '--tag-color': tag.color } : undefined}>{tag.name}</span></label>)}
              {!tags.length && <p>请先创建标签；AI 不会自动创建分类。</p>}
            </div>
          </fieldset>
          <footer>
            <button type="button" className="resource-secondary-button" onClick={onClose}>取消</button>
            <button type="submit" className="resource-primary-button" disabled={busy || (mode === 'file' ? !files.length : !title.trim())}>
              {busy ? <LoaderCircle size={17} className="spin" /> : <FilePlus2 size={17} />}
              {busy ? '正在保存' : '保存资料'}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function ResourceDetailDrawer({ resource, folders, tags, tasks, onClose, onChanged, addToast, askConfirm, onOpenTask, onOpenNotes }) {
  const [detail, setDetail] = useState(resource);
  const [versions, setVersions] = useState([]);
  const [form, setForm] = useState({ title: resource.title, description: resource.description, folderId: resource.folderId || '', aiVisibility: resource.aiVisibility, tagIds: resource.tags.map((tag) => tag.id) });
  const [busy, setBusy] = useState(false);
  const [relationTaskId, setRelationTaskId] = useState('');
  const versionInput = useRef(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  async function reload() {
    const [nextDetail, versionResult] = await Promise.all([
      api.getWorkspaceResource(resource.publicId || resource.id),
      api.getWorkspaceResourceVersions(resource.publicId || resource.id),
    ]);
    setDetail(nextDetail);
    setVersions(versionResult.versions || []);
    setForm({ title: nextDetail.title, description: nextDetail.description, folderId: nextDetail.folderId || '', aiVisibility: nextDetail.aiVisibility, tagIds: nextDetail.tags.map((tag) => tag.id) });
  }

  useEffect(() => { reload().catch((error) => addToast?.('error', '资料读取失败', error.message)); }, [resource.id]);

  async function save() {
    setBusy(true);
    try {
      await api.updateWorkspaceResource(detail.publicId || detail.id, { ...form, folderId: form.folderId || null });
      await reload();
      await onChanged();
      addToast?.('success', '已保存', '资料信息已更新。');
    } catch (error) {
      addToast?.('error', '保存失败', error.message);
    } finally {
      setBusy(false);
    }
  }

  async function reprocess() {
    try {
      await api.reprocessWorkspaceResource(detail.publicId || detail.id);
      addToast?.('info', '已加入处理队列', '正文提取、OCR、摘要和索引会在后台完成。');
      await reload();
      await onChanged();
    } catch (error) {
      addToast?.('error', '处理失败', error.message);
    }
  }

  async function uploadVersion(event) {
    const [file] = Array.from(event.target.files || []);
    event.target.value = '';
    if (!file) return;
    try {
      await api.uploadWorkspaceResourceVersion(detail.publicId || detail.id, file);
      addToast?.('success', '新版本已上传', '原版本仍保留在版本历史中。');
      await reload();
      await onChanged();
    } catch (error) {
      addToast?.('error', '上传失败', error.message);
    }
  }

  async function addTaskRelation() {
    if (!relationTaskId) return;
    try {
      await api.addWorkspaceResourceRelation(detail.publicId || detail.id, { targetType: 'task', targetId: Number(relationTaskId), relationType: 'reference' });
      setRelationTaskId('');
      await reload();
      await onChanged();
    } catch (error) {
      addToast?.('error', '关联失败', error.message);
    }
  }

  async function removeRelation(relation) {
    try {
      await api.deleteWorkspaceResourceRelation(detail.publicId || detail.id, relation.id);
      await reload();
      await onChanged();
    } catch (error) {
      addToast?.('error', '解除关联失败', error.message);
    }
  }

  async function removeResource() {
    const confirmed = await askConfirm?.('移入资料回收状态', `确定移除“${detail.title}”吗？旧附件和文件不会被立即物理删除。`, '确认移除');
    if (!confirmed) return;
    try {
      await api.deleteWorkspaceResource(detail.publicId || detail.id, '用户从资料库移除');
      await onChanged();
      onClose();
    } catch (error) {
      addToast?.('error', '移除失败', error.message);
    }
  }

  const linkedTaskIds = new Set(detail.relations.filter((item) => item.targetType === 'task').map((item) => item.targetId));

  return (
    <div className="resource-drawer-backdrop" role="presentation" onMouseDown={onClose}>
      <aside className="resource-detail-drawer" role="dialog" aria-modal="true" aria-labelledby="resource-detail-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="resource-detail-header">
          <div className={`resource-detail-icon kind-${detail.kind}`}><ResourceIcon resource={detail} size={24} /></div>
          <div><span>{kindLabels[detail.kind]} · {statusLabels[detail.status]}</span><h2 id="resource-detail-title">{detail.title}</h2></div>
          <button type="button" className="resource-icon-button" onClick={onClose} aria-label="关闭"><X size={20} /></button>
        </header>

        <div className="resource-detail-scroll">
          {detail.latestVersion?.previewUrl && detail.latestVersion?.mimeType?.startsWith('image/') && (
            <a className="resource-image-preview" href={detail.latestVersion.previewUrl} target="_blank" rel="noreferrer"><img src={detail.latestVersion.previewUrl} alt={detail.title} /></a>
          )}
          <div className="resource-detail-actions">
            {detail.kind === 'link' && detail.latestVersion?.sourceUrl && <a className="resource-primary-button" href={detail.latestVersion.sourceUrl} target="_blank" rel="noreferrer"><ExternalLink size={17} />打开网页</a>}
            {detail.latestVersion?.downloadUrl && <a className="resource-primary-button" href={detail.latestVersion.downloadUrl}><Download size={17} />下载当前版本</a>}
            <button type="button" className="resource-secondary-button" onClick={reprocess}><RefreshCw size={17} />重新处理</button>
          </div>

          <section className="resource-detail-section">
            <div className="resource-section-heading"><div><span>资料信息</span><h3>可编辑元数据</h3></div><button type="button" className="resource-primary-button" onClick={save} disabled={busy}>{busy ? <LoaderCircle size={16} className="spin" /> : null}保存</button></div>
            <label><span>标题</span><input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label>
            <label><span>说明</span><textarea rows={3} value={form.description || ''} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
            <div className="resource-form-grid">
              <label><span>目录</span><select value={form.folderId} onChange={(event) => setForm({ ...form, folderId: event.target.value })}><option value="">根目录</option>{folderRows(folders).map((folder) => <option key={folder.id} value={folder.id}>{'　'.repeat(folder.depth)}{folder.name}</option>)}</select></label>
              <label><span>AI 可见性</span><select value={form.aiVisibility} onChange={(event) => setForm({ ...form, aiVisibility: event.target.value })}><option value="inherit">允许 AI 使用</option><option value="allow">明确允许 AI 使用</option><option value="deny">禁止 AI 使用</option></select></label>
            </div>
            <fieldset className="resource-tag-picker"><legend>已有标签</legend><div>{tags.map((tag) => <label key={tag.id}><input type="checkbox" checked={form.tagIds.includes(tag.id)} onChange={() => setForm((current) => ({ ...current, tagIds: current.tagIds.includes(tag.id) ? current.tagIds.filter((id) => id !== tag.id) : [...current.tagIds, tag.id] }))} /><span style={tag.color ? { '--tag-color': tag.color } : undefined}>{tag.name}</span></label>)}</div></fieldset>
          </section>

          <section className="resource-detail-section">
            <div className="resource-section-heading"><div><span>内容处理</span><h3>提取与 AI 摘要</h3></div>{detail.aiVisibility === 'deny' && <em className="resource-ai-denied"><ShieldOff size={15} />AI 已禁用</em>}</div>
            <div className="resource-content-summary">
              <p>{detail.content?.summary || (detail.status === 'processing' ? '正在提取正文并生成摘要。' : '当前版本还没有可显示的摘要。')}</p>
              <dl><div><dt>处理器</dt><dd>{detail.content?.parser || '未识别'}</dd></div><div><dt>文字</dt><dd>{detail.content?.textChars || 0} 字</dd></div><div><dt>页数</dt><dd>{detail.content?.pageCount ?? '未知'}</dd></div></dl>
              {detail.content?.error && <div className="resource-processing-error">{friendlyProcessingError(detail.content.error)}</div>}
            </div>
          </section>

          <section className="resource-detail-section">
            <div className="resource-section-heading"><div><span>关系</span><h3>关联任务</h3></div></div>
            <div className="resource-relation-add"><select value={relationTaskId} onChange={(event) => setRelationTaskId(event.target.value)}><option value="">选择任务</option>{tasks.filter((task) => !linkedTaskIds.has(task.id)).map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}</select><button type="button" className="resource-secondary-button" onClick={addTaskRelation} disabled={!relationTaskId}><Plus size={16} />关联</button></div>
            <div className="resource-relation-list">
              {detail.relations.map((relation) => {
                const task = tasks.find((item) => item.id === (relation.taskId || (relation.targetType === 'task' ? relation.targetId : null)));
                const openRelation = () => {
                  if (relation.targetType === 'note') onOpenNotes?.(relation.targetId, { includeLinked: true });
                  else if (task) onOpenTask?.(task, relation.targetType === 'log' ? 'logs' : 'attachments');
                };
                return <div key={relation.id}><button type="button" className="resource-relation-target" onClick={openRelation}><span>{relation.targetType === 'task' ? '任务' : relation.targetType === 'note' ? '笔记' : '日志'}</span><strong>{relation.label || task?.title || `#${relation.targetId}`}</strong><ChevronRight size={16} /></button><button type="button" className="resource-icon-button danger" onClick={() => removeRelation(relation)} aria-label="解除关联"><X size={15} /></button></div>;
              })}
              {!detail.relations.length && <p className="resource-empty-copy">当前资料尚未关联任务、日志或笔记。</p>}
            </div>
          </section>

          <section className="resource-detail-section">
            <div className="resource-section-heading"><div><span>版本</span><h3>版本历史</h3></div>{detail.kind === 'file' && <button type="button" className="resource-secondary-button" onClick={() => versionInput.current?.click()}><Upload size={16} />上传新版本</button>}</div>
            <input ref={versionInput} type="file" hidden onChange={uploadVersion} />
            <div className="resource-version-list">
              {versions.map((version) => <div key={version.id}><div><strong>v{version.versionNo}</strong><span>{version.originalName || '网页/文本版本'}</span><small>{formatDate(version.createdAt)} · {formatBytes(version.fileSize)}</small></div>{version.downloadUrl && <a className="resource-icon-button" href={version.downloadUrl} aria-label={`下载版本 ${version.versionNo}`}><Download size={16} /></a>}</div>)}
            </div>
          </section>

          <button type="button" className="resource-danger-button" onClick={removeResource}><Trash2 size={17} />移除资料</button>
        </div>
      </aside>
    </div>
  );
}

export default function ResourceLibraryView({ tasks = [], addToast, askConfirm, onOpenTask, onOpenNotes, focusRequest, workspaceRevision = 0 }) {
  const [folders, setFolders] = useState([]);
  const [tags, setTags] = useState([]);
  const [resources, setResources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ search: '', folderId: '', tagId: '', kind: '', status: '' });
  const [selected, setSelected] = useState(null);
  const [createMode, setCreateMode] = useState('');
  const [taxonomy, setTaxonomy] = useState('');

  async function loadTaxonomy() {
    const [folderResult, tagResult] = await Promise.all([api.getWorkspaceFolders(), api.getWorkspaceTags()]);
    setFolders(folderResult.folders || []);
    setTags(tagResult.tags || []);
  }

  async function loadResources(nextFilters = filters) {
    setLoading(true);
    try {
      const result = await api.getWorkspaceResources({ ...nextFilters, limit: 200 });
      setResources(result.resources || []);
    } catch (error) {
      addToast?.('error', '资料读取失败', error.message);
    } finally {
      setLoading(false);
    }
  }

  async function refreshAll() {
    await Promise.all([loadTaxonomy(), loadResources()]);
  }

  useEffect(() => {
    loadTaxonomy().catch((error) => addToast?.('error', '分类读取失败', error.message));
  }, [workspaceRevision]);

  useEffect(() => {
    const timer = window.setTimeout(() => loadResources(filters), filters.search ? 260 : 0);
    return () => window.clearTimeout(timer);
  }, [filters, workspaceRevision]);

  useEffect(() => {
    const target = focusRequest?.publicId || focusRequest?.id;
    if (!target) return;
    const found = resources.find((resource) => String(resource.publicId) === String(target) || String(resource.id) === String(target));
    if (found) setSelected(found);
    else api.getWorkspaceResource(target).then(setSelected).catch(() => {});
  }, [focusRequest, resources]);

  const activeFolder = useMemo(() => folders.find((folder) => String(folder.id) === String(filters.folderId)), [folders, filters.folderId]);

  return (
    <section className="resource-library-page">
      <header className="resource-library-header">
        <div><span className="resource-kicker">个人智能资料工作区</span><h2>资料库</h2><p>文件、网页和文本统一保存；目录与标签只由你创建。</p></div>
        <div className="resource-header-actions">
          <button type="button" className="resource-secondary-button" onClick={() => setTaxonomy('folder')}><FolderOpen size={17} />目录</button>
          <button type="button" className="resource-secondary-button" onClick={() => setTaxonomy('tag')}><Tags size={17} />标签</button>
          <button type="button" className="resource-primary-button" onClick={() => setCreateMode('file')}><Plus size={17} />添加资料</button>
        </div>
      </header>

      <div className="resource-library-layout">
        <aside className="resource-folder-pane" aria-label="资料目录">
          <div className="resource-pane-heading"><strong>目录</strong><button type="button" className="resource-icon-button" onClick={() => setTaxonomy('folder')} aria-label="管理目录"><Plus size={16} /></button></div>
          <button type="button" className={!filters.folderId ? 'resource-folder-row active' : 'resource-folder-row'} onClick={() => setFilters({ ...filters, folderId: '' })}><Archive size={17} /><span>全部资料</span><em>{resources.length}</em></button>
          <button type="button" className={filters.folderId === 'root' ? 'resource-folder-row active' : 'resource-folder-row'} onClick={() => setFilters({ ...filters, folderId: 'root' })}><Folder size={17} /><span>根目录</span></button>
          {folderRows(folders).map((folder) => <button key={folder.id} type="button" className={String(filters.folderId) === String(folder.id) ? 'resource-folder-row active' : 'resource-folder-row'} style={{ paddingLeft: 12 + folder.depth * 16 }} onClick={() => setFilters({ ...filters, folderId: String(folder.id) })}><Folder size={17} /><span>{folder.name}</span><em>{folder.resourceCount}</em></button>)}
          <div className="resource-tag-filter"><div className="resource-pane-heading"><strong>标签</strong><button type="button" className="resource-icon-button" onClick={() => setTaxonomy('tag')} aria-label="管理标签"><Plus size={16} /></button></div>{tags.map((tag) => <button key={tag.id} type="button" className={String(filters.tagId) === String(tag.id) ? 'resource-tag-filter-row active' : 'resource-tag-filter-row'} onClick={() => setFilters({ ...filters, tagId: String(filters.tagId) === String(tag.id) ? '' : String(tag.id) })}><span style={tag.color ? { background: tag.color } : undefined} /><strong>{tag.name}</strong><em>{tag.counts?.resources || 0}</em></button>)}</div>
        </aside>

        <div className="resource-main-pane">
          <div className="resource-toolbar">
            <label className="resource-search-box"><Search size={18} /><input value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} placeholder="搜索标题、说明或已提取正文..." /></label>
            <label className="resource-select-control"><ListFilter size={16} /><select value={filters.kind} onChange={(event) => setFilters({ ...filters, kind: event.target.value })}><option value="">全部类型</option><option value="file">文件</option><option value="link">链接</option><option value="text">文本</option></select></label>
            <label className="resource-select-control"><select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}><option value="">全部状态</option><option value="ready">可检索</option><option value="processing">处理中</option><option value="failed">处理失败</option></select></label>
            <button type="button" className="resource-icon-button" onClick={refreshAll} aria-label="刷新资料"><RefreshCw size={17} /></button>
          </div>
          <div className="resource-result-heading"><div><span>{activeFolder?.name || (filters.folderId === 'root' ? '根目录' : '全部资料')}</span><strong>{resources.length} 项</strong></div>{filters.tagId && <button type="button" onClick={() => setFilters({ ...filters, tagId: '' })}>清除标签筛选 <X size={14} /></button>}</div>

          <div className="resource-list" aria-busy={loading}>
            {loading && !resources.length && <div className="resource-loading"><LoaderCircle size={22} className="spin" />正在读取资料...</div>}
            {!loading && !resources.length && <div className="resource-empty-state"><FilePlus2 size={30} /><h3>这里还没有资料</h3><p>上传文件、保存公开网页，或创建一段可检索的文本资料。</p><button type="button" className="resource-primary-button" onClick={() => setCreateMode('file')}><Plus size={17} />添加第一项资料</button></div>}
            {resources.map((resource) => (
              <button key={resource.id} type="button" className="resource-list-row" onClick={() => setSelected(resource)}>
                <span className={`resource-list-icon kind-${resource.kind}`}><ResourceIcon resource={resource} size={21} /></span>
                <span className="resource-list-copy"><span className="resource-list-title"><strong>{resource.title}</strong>{resource.aiVisibility === 'deny' && <em title="禁止 AI 使用"><ShieldOff size={14} />AI 禁用</em>}</span><span className="resource-list-summary">{resource.content?.summary || resource.description || '暂无摘要'}</span><span className="resource-list-tags">{resource.tags.map((tag) => <em key={tag.id} style={tag.color ? { '--tag-color': tag.color } : undefined}>{tag.name}</em>)}</span></span>
                <span className="resource-list-meta"><em className={`status-${resource.status}`}>{statusLabels[resource.status] || resource.status}</em><span>{resource.folderName || '根目录'}</span><span>{resource.latestVersion?.originalName || kindLabels[resource.kind]}</span><small>{formatDate(resource.updatedAt)}</small></span>
                <ChevronRight size={18} className="resource-row-chevron" />
              </button>
            ))}
          </div>
        </div>
      </div>

      {createMode && <CreateResourceDialog mode={createMode} folders={folders} tags={tags} onClose={() => setCreateMode('')} onCreated={refreshAll} addToast={addToast} />}
      {taxonomy === 'folder' && <TaxonomyDialog type="folder" folders={folders} onClose={() => setTaxonomy('')} onChanged={refreshAll} addToast={addToast} askConfirm={askConfirm} />}
      {taxonomy === 'tag' && <TaxonomyDialog type="tag" folders={tags} onClose={() => setTaxonomy('')} onChanged={refreshAll} addToast={addToast} askConfirm={askConfirm} />}
      {selected && <ResourceDetailDrawer resource={selected} folders={folders} tags={tags} tasks={tasks} onClose={() => setSelected(null)} onChanged={refreshAll} addToast={addToast} askConfirm={askConfirm} onOpenTask={onOpenTask} onOpenNotes={onOpenNotes} />}
    </section>
  );
}
