import { z } from 'zod';

const identifier = z.union([z.coerce.number().int().positive(), z.string().uuid()]);
const optionalIdentifier = z.union([identifier, z.null()]).optional();

export const folderCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  parentId: optionalIdentifier,
});

export const folderUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  parentId: optionalIdentifier,
  sortOrder: z.coerce.number().int().min(-100000).max(100000).optional(),
});

export const tagCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  color: z.string().trim().max(16).nullable().optional(),
});

export const tagUpdateSchema = tagCreateSchema.partial();

export const resourceCreateSchema = z.object({
  kind: z.enum(['link', 'text']),
  title: z.string().trim().min(1).max(255),
  description: z.string().trim().max(10000).nullable().optional(),
  folderId: optionalIdentifier,
  aiVisibility: z.enum(['inherit', 'allow', 'deny']).optional(),
  url: z.string().url().max(4000).optional(),
  content: z.string().max(500000).optional(),
  tagIds: z.array(identifier).max(50).optional(),
}).superRefine((value, context) => {
  if (value.kind === 'link' && !value.url) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['url'], message: '链接资料必须填写网址。' });
  }
  if (value.kind === 'text' && !String(value.content || '').trim()) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['content'], message: '文本资料内容不能为空。' });
  }
});

export const resourceUpdateSchema = z.object({
  title: z.string().trim().min(1).max(255).optional(),
  description: z.string().trim().max(10000).nullable().optional(),
  folderId: optionalIdentifier,
  aiVisibility: z.enum(['inherit', 'allow', 'deny']).optional(),
  tagIds: z.array(identifier).max(50).optional(),
});

export const resourceRelationSchema = z.object({
  targetType: z.enum(['task', 'log', 'note']),
  targetId: z.coerce.number().int().positive(),
  relationType: z.string().trim().min(1).max(32).optional(),
});

export function parseContract(schema, payload) {
  const result = schema.safeParse(payload);
  if (result.success) return result.data;
  const error = new Error(result.error.issues[0]?.message || '请求数据不符合接口约定。');
  error.statusCode = 400;
  error.details = result.error.flatten();
  throw error;
}
