export function normalizeTaxonomyName(value, maxLength = 80) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

export function normalizedTaxonomyKey(value) {
  return normalizeTaxonomyName(value).toLocaleLowerCase('zh-CN');
}

export function splitLegacyTags(value) {
  const seen = new Set();
  return String(value || '')
    .split(/[,，;；]/)
    .map((item) => normalizeTaxonomyName(item))
    .filter((item) => {
      const key = normalizedTaxonomyKey(item);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
