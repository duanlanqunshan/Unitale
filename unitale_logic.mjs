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

const VALID_ANCHOR_MODES = new Set(['start', 'center', 'end', 'after_dialogue']);

/**
 * 规范化 LLM 返回的单个音效标注。
 *
 * 保留的字段：
 *   name           必填，非空字符串
 *   position       0~1，非法回退 0.5
 *   duration       LLM 建议制作时长（秒）；非法/缺失回退 null
 *   anchor_text    对应剧情/动作文本，仅语义参考，缺失为 ''
 *   anchor_mode    start|center|end|after_dialogue，非法回退 'start'
 *   offset         人工微调偏移（秒），非法回退 0
 *   start_time     以真实音频为标准的绝对起始秒数，默认 null
 *   position_source estimated|audio_aligned|manual，默认 estimated
 *
 * 真实 TTS 音频时间轴是音效定位的唯一最终标准；anchor_text 仅为语义线索，
 * 不参与最终播放秒数计算。老工程缺少新字段时全部回退默认值，不阻断导入。
 */
export function normalizeSfxAnnotation(value) {
  if (!value || typeof value !== 'object') return null;
  const name = String(value.name ?? '').trim();
  if (!name) return null;

  const parsedPosition = Number(value.position);
  const position = Number.isFinite(parsedPosition)
    ? Math.max(0, Math.min(1, parsedPosition))
    : 0.5;

  // duration：建议时长（秒）。范围 0.1~60，保留两位小数；非法/缺失 → null
  const rawDuration = value.duration;
  let duration = null;
  {
    const n = typeof rawDuration === 'number' ? rawDuration : Number(rawDuration);
    if (Number.isFinite(n) && n >= 0.1 && n <= 60) {
      duration = Math.round(n * 100) / 100;
    }
  }

  // anchor_text：语义锚点文本。仅作展示/人工对齐参考，缺失为 ''
  const anchor_text = typeof value.anchor_text === 'string' ? value.anchor_text : '';

  // anchor_mode：start|center|end|after_dialogue，非法回退 'start'
  const anchor_mode = VALID_ANCHOR_MODES.has(value.anchor_mode) ? value.anchor_mode : 'start';

  // offset：人工微调偏移（秒），可正可负，非法回退 0
  const rawOffset = value.offset;
  let offsetNum = 0;
  {
    const n = typeof rawOffset === 'number' ? rawOffset : Number(rawOffset);
    if (Number.isFinite(n)) offsetNum = n;
  }
  const offset = offsetNum;

  // start_time：真实音频绝对起始秒数；默认 null（表示尚未对齐）
  const rawStart = value.start_time;
  const start_time = typeof rawStart === 'number' && Number.isFinite(rawStart)
    ? rawStart
    : null;

  // position_source：estimated|audio_aligned|manual，默认 estimated
  const position_source = ['estimated', 'audio_aligned', 'manual'].includes(value.position_source)
    ? value.position_source
    : 'estimated';

  return { name, position, duration, anchor_text, anchor_mode, offset, start_time, position_source };
}

/**
 * 从 LLM 返回的 dialogue 对象中提取台词原文。
 *
 * 核心不变量：原文字字必保，不得回退到 [object Object]、不得静默吃掉空值。
 * 历史上 LLM 会交替使用 text_content / text / content / dialogue / line 等字段名，
 * 这里穷举所有备选字段并按优先级取第一个为非空字符串的字段；
 * 任何字段若不存在 / 为空 / 为数字 / 为对象，一律返回 ''，由上层校验发现为空即为数据完整性失败，
 * 绝不能把"看起来像台词"的占位值写进 UI。
 */
export function extractDialogueText(item) {
  if (!item || typeof item !== 'object') return '';
  const candidates = ['text_content', 'text', 'content', 'dialogue', 'line', 'txt'];
  for (const key of candidates) {
    const val = item[key];
    if (typeof val === 'string' && val.trim().length > 0) {
      return val.trim();
    }
  }
  return '';
}

/**
 * 验证 LLM 生成的全部 dialogue 是否逐字覆盖输入原文。
 *
 * 模型拆分对话时通常会去掉包裹台词的引号，并可能重新分配换行/空格；这些属于结构化格式差异，
 * 因此比较时仅忽略空白与成对引号字符。其余汉字、字母、数字和正文标点必须完全一致且顺序不变。
 * 这样既能发现空字段，也能发现模型直接漏掉整条对象、截断结尾或擅自改写原文。
 */
export function validateDialogueCoverage(originalText, parsedItems) {
  const items = Array.isArray(parsedItems) ? parsedItems : [];
  const dialogues = items.filter(item => (item?.type || 'dialogue') === 'dialogue');
  const missingTextCount = dialogues.filter(item => !extractDialogueText(item)).length;

  if (missingTextCount > 0) {
    return {
      ok: false,
      reason: 'empty_dialogue',
      missingTextCount,
      originalLength: normalizeCoverageText(originalText).length,
      generatedLength: normalizeCoverageText(dialogues.map(extractDialogueText).join('')).length
    };
  }

  const normalizedOriginal = normalizeCoverageText(originalText);
  const normalizedGenerated = normalizeCoverageText(dialogues.map(extractDialogueText).join(''));
  return {
    ok: normalizedOriginal === normalizedGenerated,
    reason: normalizedOriginal === normalizedGenerated ? '' : 'content_mismatch',
    missingTextCount: 0,
    originalLength: Array.from(normalizedOriginal).length,
    generatedLength: Array.from(normalizedGenerated).length
  };
}

function normalizeCoverageText(value) {
  return String(value ?? '')
    .replace(/[\s\u00a0]+/gu, '')
    .replace(/["'“”‘’「」『』]/gu, '');
}

const OPENING_QUOTES = new Map([
  ['“', '”'],
  ['‘', '’'],
  ['「', '」'],
  ['『', '』'],
  ['"', '"']
]);

/**
 * 把原文切成不可变、带稳定 ID 的片段。
 *
 * 先在中文引号边界处分开“说话提示/旁白”和“直接引语”，再按自然标点与长度上限切分。
 * 每个输出片段都是原文的连续切片，所有片段依序拼接必须严格等于输入；AI 只能给这些 ID
 * 补角色和情绪，不能再负责抄写正文。
 */
export function createSourceSegments(originalText, limit = 120) {
  const source = compressChineseWhitespace(originalText);
  if (!source) return [];

  const quoteAwareChunks = [];
let current = '';
let expectedClosingQuote = '';
const SENTENCE_CLOSING_PUNCT = new Set(['。', '！', '？', '；', '，', '\n']);

for (const char of Array.from(source)) {
  if (!expectedClosingQuote && OPENING_QUOTES.has(char)) {
    if (current) quoteAwareChunks.push(current);
    current = char;
    expectedClosingQuote = OPENING_QUOTES.get(char);
    continue;
  }

  current += char;
  if (expectedClosingQuote && char === expectedClosingQuote) {
    quoteAwareChunks.push(current);
    current = '';
    expectedClosingQuote = '';
    continue;
  }
}
if (current) quoteAwareChunks.push(current);

for (let i = 0; i < quoteAwareChunks.length - 1; i++) {
  const nextChar = quoteAwareChunks[i + 1][0];
  if (SENTENCE_CLOSING_PUNCT.has(nextChar)) {
    quoteAwareChunks[i] += nextChar;
    quoteAwareChunks[i + 1] = quoteAwareChunks[i + 1].slice(1);
  }
}
for (let i = 0; i < quoteAwareChunks.length - 1; i++) {
  if (quoteAwareChunks[i] === '') {
    quoteAwareChunks.splice(i, 1);
    i--;
  }
}

  let quoteGroupNumber = 0;
  const structuralChunks = quoteAwareChunks.flatMap(chunk => {
    const isCompleteQuote = OPENING_QUOTES.get(chunk[0]) === chunk.at(-1);
    if (isCompleteQuote) {
      quoteGroupNumber += 1;
      return [{ text: chunk, quoteGroupId: `quote_${String(quoteGroupNumber).padStart(4, '0')}` }];
    }
    return splitAtColons(chunk).map(text => ({ text }));
  });
  const rawPieces = structuralChunks.flatMap(chunk => {
    const texts = splitSourceChunk(chunk.text, limit);
    return texts.map((text, index) => ({
      text,
      ...(chunk.quoteGroupId ? {
        quoteGroupId: chunk.quoteGroupId,
        quotePart: index + 1,
        quotePartCount: texts.length
      } : {})
    }));
  });
  const pieces = [];
  let leadingWhitespace = '';
  for (const piece of rawPieces) {
    if (!piece.text.trim()) {
      if (pieces.length > 0) pieces[pieces.length - 1].text += piece.text;
      else leadingWhitespace += piece.text;
      continue;
    }
    pieces.push({ ...piece, text: leadingWhitespace + piece.text });
    leadingWhitespace = '';
  }
  if (leadingWhitespace && pieces.length > 0) pieces[pieces.length - 1].text += leadingWhitespace;

  return pieces
    .filter(piece => piece.text !== '')
    .map((piece, index) => ({
      ...piece,
      id: `seg_${String(index + 1).padStart(4, '0')}`,
      text: piece.text
    }));
}

export function validateSourceSegments(originalText, sourceSegments) {
  const source = String(originalText ?? '');
  const segments = Array.isArray(sourceSegments) ? sourceSegments : [];
  const reconstructed = segments.map(segment => String(segment?.text ?? '')).join('');
  return {
    ok: reconstructed === source,
    reason: reconstructed === source ? '' : 'content_mismatch'
  };
}

export function compressChineseWhitespace(text) {
  const s = String(text ?? '');
  if (!s) return s;
  return s
    .replace(/[ \t]+/g, ' ')
    .replace(/ ([。，！？；：""''）】）》>、\n])/g, '$1')
    .replace(/([。，！？；：""''（【《<（]) /g, '$1')
    .replace(/\n /g, '\n')
    .replace(/ \n/g, '\n')
    .replace(/^\s+/, '')
    .replace(/\s+$/, '');
}

function splitAtColons(text) {
  const chunks = [];
  let current = '';
  for (const char of Array.from(text)) {
    current += char;
    if (char === '：' || char === ':') {
      chunks.push(current);
      current = '';
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function splitSourceChunk(chunk, limit) {
  if (Array.from(chunk).length <= limit) return [chunk];
  return splitDialogueText(chunk, limit);
}

/**
 * 将 AI 返回的“片段元数据”合并回原文片段。
 * 正文永远来自 sourceSegments；metadata 中任何 text/text_content 字段都会被忽略。
 * 返回缺失 ID，调用方可只针对这些 ID 自动补分析。
 */
export function mergeSegmentAnalysis(sourceSegments, metadataItems) {
  const segments = Array.isArray(sourceSegments) ? sourceSegments : [];
  const metadata = Array.isArray(metadataItems) ? metadataItems : [];
  const metadataById = new Map();

  for (const item of metadata) {
    const id = String(item?.segment_id || item?.segmentId || item?.id || '').trim();
    if (id && !metadataById.has(id)) metadataById.set(id, item);
  }

  const missingSegmentIds = [];
  const lines = [];
  for (const segment of segments) {
    const meta = metadataById.get(segment.id);
    if (!meta) {
      missingSegmentIds.push(segment.id);
      continue;
    }
    lines.push({
      ...meta,
      ...segment,
      segmentId: segment.id,
      text: segment.text
    });
  }

  return { lines, missingSegmentIds };
}

export function markQuoteRoleConflicts(lines) {
  const items = Array.isArray(lines) ? lines : [];
  const groups = new Map();

  for (const item of items) {
    const groupId = String(item?.quoteGroupId || item?.quote_group_id || '').trim();
    if (!groupId) continue;
    if (!groups.has(groupId)) groups.set(groupId, []);
    groups.get(groupId).push(item);
  }

  for (const group of groups.values()) {
    const roles = new Set(group.map(item => normalizeRoleName(item.role_name || item.role || '旁白')));
    if (roles.size <= 1) continue;
    for (const item of group) {
      item._roleNeedsReview = true;
      item._roleReviewReason = '同一完整引语被识别为多个角色，请确认说话人';
    }
  }

  return items;
}

/**
 * 在 LLM 兜底/本地扫描后统一生成 mappedSfx 对象。
 * 把"本地命中 vs 未命中"的状态语义集中到一处，避免 index.html 里到处 if（容易漏字段）。
 *
 * - 本地命中（包含模糊包含匹配）：source='local'，unmatchedHint=null
 * - 未命中：source='unmatched'，保留 AI 原始名作 lastQuery / unmatchedHint 供重新匹配
 */
export function buildMappedSfxItem(annotation, library) {
  const s = normalizeSfxAnnotation(annotation);
  if (!s) return null;

  const matched = findBestMatchName(s.name, library || []);
  return {
    name: matched || s.name,
    position: s.position,
    duration: s.duration,
    anchor_text: s.anchor_text,
    anchor_mode: s.anchor_mode,
    offset: s.offset,
    start_time: s.start_time,
    position_source: s.position_source,
    source: matched ? 'local' : 'unmatched',
    lastQuery: s.name,
    unmatchedHint: matched ? null : s.name
  };
}

/**
 * 把用户手动上传的音频文件绑定到一条未匹配音效上，使其立即可播放。
 *
 * - 有 scanRoot（用户从扫描目录选择 / 文件在自定义根下）: source='local_scan'，记录 scanRoot
 * - 无 scanRoot（直接进入 IndexedDB）: source='local'，不写 scanRoot 字段
 *
 * 名称 lastQuery / unmatchedHint 的处理：
 *   - unmatchedHint 清空，表示已解除待匹配状态
 *   - lastQuery 保留原名，"重新匹配"按钮再次调用仍可用此 query
 *   - name 保留原名（不强制改成文件名），用户能看到 AI 当初想要的语义，自己决定是否改
 */
export function attachManualSfxFile(sfx, file, relPath, options = {}) {
  if (!sfx || typeof sfx !== 'object') return sfx;
  sfx.filename = relPath;
  if (options.scanRoot) {
    sfx.scanRoot = options.scanRoot;
    sfx.source = 'local_scan';
  } else {
    if ('scanRoot' in sfx) delete sfx.scanRoot;
    sfx.source = 'local';
  }
  sfx.unmatchedHint = null;
  return sfx;
}

// 内部：本地字符串匹配（精确 + 包含），返回命中条目的 name，未命中返回空串。
// 与 index.html 里 findBestMatch 行为等价，提到 mjs 后可被测、可被复用。
export function findBestMatchName(target, library) {
  if (!target) return '';
  const lib = Array.isArray(library) ? library : [];
  const t = String(target).trim().toLowerCase();
  if (!t) return '';
  // 1. 精确匹配
  const exact = lib.find(i => String(i.name).toLowerCase() === t);
  if (exact) return exact.name;

  // 2. 模糊匹配（包含关系）
  const candidates = lib.filter(i => {
    const n = String(i.name).toLowerCase();
    return n.includes(t) || t.includes(n);
  });
  if (candidates.length > 0) {
    candidates.sort(
      (a, b) => Math.abs(String(a.name).length - target.length) - Math.abs(String(b.name).length - target.length)
    );
    return candidates[0].name;
  }
  return '';
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
  if (parts.length === 1) return [{ ...line, ...sanitizeEmotionFields(line?.emotion, line?.intensity) }];

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
      ...sanitizeEmotionFields(line.emotion, line.intensity),
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

/**
 * 清洗 AI 返回的 emotion/intensity 字段，防止 50% 情绪漏选问题。
 * - 不在白名单的情绪 → 回退 '平静'
 * - 空 intensity 或非合法值 → 回退 '中等'
 * 返回清洗后的新字段（不修改原对象）。
 */
const VALID_EMOTIONS = new Set(['高兴', '生气', '伤心', '害怕', '厌恶', '低落', '惊喜', '平静']);
const VALID_INTENSITIES = new Set(['微弱', '稍弱', '中等', '较强', '强烈']);

export function sanitizeEmotionFields(rawEmotion, rawIntensity) {
  const emotion = String(rawEmotion ?? '').trim();
  const intensity = String(rawIntensity ?? '').trim();
  return {
    emotion: VALID_EMOTIONS.has(emotion) ? emotion : '平静',
    intensity: VALID_INTENSITIES.has(intensity) ? intensity : '中等',
  };
}

// ============================================================
// 工单 B —— 未匹配音效清单文本生成
// ============================================================
//
// 未匹配仅指 source==='unmatched' 或仍带 unmatchedHint 的音效。
// 同名音效在多条台词中出现时，按每个台词位置分别输出建议时长、触发文本、触发方式、相对位置，
// 不求平均、不互相覆盖；duration 缺失显示"未提供"。
// 真实 TTS 音频时间轴才是音效定位的最终标准，anchor_text 仅作语义参考。
const ANCHOR_MODE_LABELS = {
  start: '动作开始时',
  center: '动作中段',
  end: '动作结束时',
  after_dialogue: '台词结束后'
};

function formatDuration(sec) {
  if (typeof sec !== 'number' || !Number.isFinite(sec)) return '未提供';
  return `${sec.toFixed(2)} 秒`;
}

export function buildUnmatchedSfxListText(scriptLines, generatedAt) {
  const items = Array.isArray(scriptLines) ? scriptLines : [];
  const groups = new Map(); // name -> [{ lineNo, sfx }]

  items.forEach((line, index) => {
    if (!line || !Array.isArray(line.sfx)) return;
    line.sfx.forEach(s => {
      if (s.source !== 'unmatched' && !s.unmatchedHint) return;
      const name = String(s.unmatchedHint || s.name || '(未命名)');
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push({ lineNo: index + 1, sfx: s });
    });
  });

  if (groups.size === 0) return '';

  const now = generatedAt instanceof Date ? generatedAt : new Date();
  const pad = n => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const totalOccurrences = [...groups.values()].reduce((sum, arr) => sum + arr.length, 0);

  let content = '';
  content += '='.repeat(30) + '\n';
  content += `未匹配音效清单\n`;
  content += `生成时间：${stamp}\n`;
  content += `共 ${groups.size} 条未匹配音效，涉及 ${totalOccurrences} 处台词\n`;
  content += '='.repeat(30) + '\n\n';

  let i = 1;
  for (const [name, occurrences] of groups) {
    content += `【${i}】${name}\n`;
    for (const { lineNo, sfx } of occurrences) {
      const posPct = Math.round((Number(sfx.position ?? 0)) * 100);
      const anchorText = sfx.anchor_text || '(无)';
      const anchorLabel = ANCHOR_MODE_LABELS[sfx.anchor_mode] || ANCHOR_MODE_LABELS.start;
      content += `  - 台词 #${lineNo}\n`;
      content += `    触发文本：${anchorText}\n`;
      content += `    触发方式：${anchorLabel}\n`;
      content += `    相对位置：${posPct}%\n`;
      content += `    建议时长：${formatDuration(sfx.duration)}\n`;
    }
    content += '\n';
    i++;
  }
  return content;
}
