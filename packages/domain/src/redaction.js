const sensitivePatterns = [
  {
    type: 'password',
    pattern: /((?:密码|口令|password|passwd|pwd)\s*[:：=]\s*)([^\s,，;；]{4,})/gi,
    replace: '$1[已脱敏]',
  },
  {
    type: 'api_key',
    pattern: /\b(?:sk|tp|pk|rk)-[A-Za-z0-9_-]{12,}\b/g,
    replace: '[API_KEY 已脱敏]',
  },
  {
    type: 'bearer',
    pattern: /(Bearer\s+)[A-Za-z0-9._~+\/-]{16,}/gi,
    replace: '$1[令牌已脱敏]',
  },
  {
    type: 'token',
    pattern: /((?:api[_ -]?key|access[_ -]?token|secret|token)\s*[:：=]\s*)([A-Za-z0-9._~+\/-]{12,})/gi,
    replace: '$1[已脱敏]',
  },
  {
    type: 'id_card',
    pattern: /\b\d{17}[\dXx]\b/g,
    replace: '[身份证号已脱敏]',
  },
];

export function redactSensitiveText(value) {
  let text = String(value || '');
  for (const item of sensitivePatterns) {
    text = text.replace(item.pattern, item.replace);
  }
  return text;
}

export function inspectSensitiveText(value) {
  const source = String(value || '');
  const types = [];
  for (const item of sensitivePatterns) {
    item.pattern.lastIndex = 0;
    if (item.pattern.test(source)) types.push(item.type);
    item.pattern.lastIndex = 0;
  }
  return { sensitive: types.length > 0, types };
}
