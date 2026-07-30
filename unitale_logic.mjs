export function resolveSfxPlaybackUrl(item) {
  if (!item || !item.filename) return null;

  const filename = String(item.filename).replace(/\\/g, '/');
  if (/^(https?:\/\/|blob:)/i.test(filename)) return filename;

  if (item.source === 'local_scan' || item.source === 'freesound_file' || item.scanRoot) {
    const params = new URLSearchParams({ rel_path: filename });
    if (item.scanRoot) params.set('root_path', item.scanRoot);
    return `/v1/sfx/local_file?${params.toString()}`;
  }

  return filename;
}

export function updateSfxQuery(sfx, nextName) {
  const query = String(nextName ?? '').trim();
  sfx.name = query;
  sfx.lastQuery = query;
  sfx.unmatchedHint = query;
  sfx.source = 'unmatched';
  return sfx;
}

export function normalizeSfxAnnotation(value) {
  if (!value || typeof value !== 'object') return null;
  const name = String(value.name ?? '').trim();
  if (!name) return null;

  const parsedPosition = Number(value.position);
  const position = Number.isFinite(parsedPosition)
    ? Math.max(0, Math.min(1, parsedPosition))
    : 0.5;

  return { name, position };
}

const NATURAL_SEGMENT_PATTERN = /[^。！？!?；;：:，,\n]+[。！？!?；;：:，,]?|\n+/gu;

function hardSplit(text, limit) {
  const chars = Array.from(text);
  const parts = [];
  for (let start = 0; start < chars.length; start += limit) {
    parts.push(chars.slice(start, start + limit).join(''));
  }
  return parts;
}

export function splitDialogueText(text, limit = 120) {
  const source = String(text ?? '');
  if (!source) return [''];
  if (Array.from(source).length <= limit) return [source];

  const units = source.match(NATURAL_SEGMENT_PATTERN) || [source];
  const result = [];
  let current = '';

  for (const unit of units) {
    const unitLength = Array.from(unit).length;
    const currentLength = Array.from(current).length;
    if (unitLength > limit) {
      if (current) {
        result.push(current);
        current = '';
      }
      const hardParts = hardSplit(unit, limit);
      result.push(...hardParts.slice(0, -1));
      current = hardParts.at(-1) || '';
    } else if (currentLength + unitLength <= limit) {
      current += unit;
    } else {
      if (current) result.push(current);
      current = unit;
    }
  }
  if (current) result.push(current);
  return result;
}

export function splitDialogueLine(line, limit = 120) {
  const parts = splitDialogueText(line?.text ?? '', limit);
  if (parts.length === 1) return [{ ...line }];

  const totalLength = Math.max(1, Array.from(line.text || '').length);
  let consumed = 0;
  return parts.map((text, index) => {
    const startRatio = consumed / totalLength;
    consumed += Array.from(text).length;
    const endRatio = consumed / totalLength;
    const sfx = (line.sfx || [])
      .filter(effect => {
        const position = Number(effect.position ?? 0);
        return index === parts.length - 1
          ? position >= startRatio && position <= endRatio
          : position >= startRatio && position < endRatio;
      })
      .map(effect => ({
        ...effect,
        position: Math.max(0, Math.min(1, (Number(effect.position ?? 0) - startRatio) / Math.max(0.0001, endRatio - startRatio)))
      }));

    return {
      ...line,
      id: `${line.id || 'line'}_part_${index + 1}`,
      text,
      sfx,
      break_duration: index === parts.length - 1 ? (line.break_duration || 0) : 0,
      audioUrl: '',
      trimStart: 0,
      trimEnd: 1,
      isGenerating: false
    };
  });
}

const NARRATOR_ALIASES = new Set(['旁白', 'narrator', '叙述者', ' narrator ']);
const PRONOUN_ROLES = new Set(['他', '她', '它', '你', '你们', '他们', '她们', '众人', '某人']);

export function normalizeRoleName(role) {
  const cleaned = String(role ?? '')
    .trim()
    .replace(/^[\s"'“”‘’「」『』【】]+|[\s"'“”‘’「」『』【】]+$/gu, '')
    .replace(/[：:]$/u, '')
    .trim();
  return NARRATOR_ALIASES.has(cleaned.toLowerCase()) ? '旁白' : (cleaned || '旁白');
}

export function assessRoleConfidence(role) {
  const normalized = normalizeRoleName(role);
  if (normalized === '旁白') return { needsReview: false, reason: '' };
  if (PRONOUN_ROLES.has(normalized)) {
    return { needsReview: true, reason: '角色名是代词，需结合上下文确认' };
  }
  if (Array.from(normalized).length > 12 || /[，。！？!?；;]/u.test(normalized)) {
    return { needsReview: true, reason: '角色名过长或包含句子标点' };
  }
  return { needsReview: false, reason: '' };
}
