import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveSfxPlaybackUrl,
  assessRoleConfidence,
  normalizeRoleName,
  normalizeSfxAnnotation,
  splitDialogueText,
  splitDialogueLine,
  updateSfxQuery,
  extractDialogueText,
  buildMappedSfxItem,
  attachManualSfxFile,
  validateDialogueCoverage,
  createSourceSegments,
  mergeSegmentAnalysis,
  markQuoteRoleConflicts,
  validateSourceSegments,
  compressChineseWhitespace,
  sanitizeEmotionFields,
  buildUnmatchedSfxListText,
  findBestMatchName,
  computeSfxPlayTime
} from '../unitale_logic.mjs';

test('LLM 音效标注会规范名称与位置并拒绝非法项', () => {
  assert.deepEqual(normalizeSfxAnnotation({ name: '  门响  ', position: '0.4' }), {
    name: '门响',
    position: 0.4,
    duration: null,
    anchor_text: '',
    anchor_mode: 'start',
    offset: 0,
    start_time: null,
    position_source: 'estimated'
  });
  assert.deepEqual(normalizeSfxAnnotation({ name: '雷声' }), {
    name: '雷声',
    position: 0.5,
    duration: null,
    anchor_text: '',
    anchor_mode: 'start',
    offset: 0,
    start_time: null,
    position_source: 'estimated'
  });
  assert.equal(normalizeSfxAnnotation({ name: '脚步', position: -2 }).position, 0);
  assert.equal(normalizeSfxAnnotation({ name: '脚步', position: 3 }).position, 1);
  assert.equal(normalizeSfxAnnotation({ name: '脚步', position: Number.NaN }).position, 0.5);
  assert.equal(normalizeSfxAnnotation(null), null);
  assert.equal(normalizeSfxAnnotation({ name: '   ' }), null);
});

test('扫描目录音效使用后端文件流地址试听', () => {
  const url = resolveSfxPlaybackUrl({
    filename: 'doors/metal_hit.wav',
    source: 'local_scan',
    scanRoot: 'D:/素材/音效'
  });

  assert.equal(
    url,
    '/v1/sfx/local_file?rel_path=doors%2Fmetal_hit.wav&root_path=D%3A%2F%E7%B4%A0%E6%9D%90%2F%E9%9F%B3%E6%95%88'
  );
});

test('没有可播放文件的未命中音效返回不可播放状态', () => {
  assert.equal(resolveSfxPlaybackUrl({ name: '暴雨声', source: 'unmatched' }), null);
});

test('编辑未命中名称会保留未命中状态并更新下次搜索词', () => {
  const sfx = {
    name: '旧名称',
    source: 'unmatched',
    lastQuery: '旧名称',
    unmatchedHint: '旧名称'
  };

  updateSfxQuery(sfx, '木门被猛烈撞开的声音');

  assert.deepEqual(sfx, {
    name: '木门被猛烈撞开的声音',
    source: 'unmatched',
    lastQuery: '木门被猛烈撞开的声音',
    unmatchedHint: '木门被猛烈撞开的声音'
  });
});

test('超长台词优先按自然标点拆分且不丢失字符', () => {
  const text = `${'甲'.repeat(70)}，${'乙'.repeat(65)}。${'丙'.repeat(40)}！`;
  const parts = splitDialogueText(text, 120);

  assert.ok(parts.length > 1);
  assert.ok(parts.every(part => Array.from(part).length <= 120));
  assert.equal(parts.join(''), text);
  assert.equal(parts[0].endsWith('，'), true);
});

test('拆分台词保留角色等元数据并把停顿放在最后一张', () => {
  const line = {
    id: 'line-1',
    type: 'dialogue',
    role: '旁白',
    text: `${'第一段。'.repeat(35)}${'最后一段。'.repeat(20)}`,
    emotion: '平静',
    break_duration: 2,
    audioUrl: 'blob:old-audio'
  };
  const result = splitDialogueLine(line, 120);

  assert.ok(result.length > 1);
  assert.ok(result.every(part => part.role === '旁白' && part.emotion === '平静'));
  assert.ok(result.slice(0, -1).every(part => part.break_duration === 0));
  assert.equal(result.at(-1).break_duration, 2);
  assert.ok(result.every(part => part.audioUrl === ''));
});

test('角色名会清理标点并统一旁白别名', () => {
  assert.equal(normalizeRoleName('「 Narrator：」'), '旁白');
  assert.equal(normalizeRoleName('“老李：”'), '老李');
});

test('代词和异常长角色名会标记为低置信待确认', () => {
  assert.deepEqual(assessRoleConfidence('他'), {
    needsReview: true,
    reason: '角色名是代词，需结合上下文确认'
  });
  assert.equal(assessRoleConfidence('这是一个明显不是角色名的完整描述句子').needsReview, true);
  assert.equal(assessRoleConfidence('老李').needsReview, false);
});

test('extractDialogueText 从各种字段名提取台词原文且拒绝空值', () => {
  // 主字段命中
  assert.equal(extractDialogueText({ text_content: '别接那个电话！' }), '别接那个电话！');
  // 兼容旧字段链
  assert.equal(extractDialogueText({ text: '老李猛地按住了我的手' }), '老李猛地按住了我的手');
  assert.equal(extractDialogueText({ content: '我愣住了' }), '我愣住了');
  assert.equal(extractDialogueText({ dialogue: '他来了' }), '他来了');
  assert.equal(extractDialogueText({ line: '对，' }), '对，');
  // 优先级：text_content 优先于 text
  assert.equal(extractDialogueText({ text_content: '主', text: '备' }), '主');
  // 空字符串/空格/缺失均返回空串，绝不回退到唇语猜测
  assert.equal(extractDialogueText({ text_content: '   ' }), '');
  assert.equal(extractDialogueText({ text_content: '' }), '');
  assert.equal(extractDialogueText({}), '');
  assert.equal(extractDialogueText(null), '');
  // 非字符串（数字/对象）也归一化为空串，不能把 [object Object] 写进台词
  assert.equal(extractDialogueText({ text_content: 123 }), '');
  assert.equal(extractDialogueText({ text: { x: 1 } }), '');
  // 保留内部空白（不能擅自 trim 掉原文里的换行或空格，只去两侧）
  assert.equal(extractDialogueText({ text_content: '  中 间 保 留  ' }), '中 间 保 留');
});

test('buildMappedSfxItem 本地命中写 local，未命中写 unmatched 并保留原始名供重试', () => {
  const library = [
    { name: '电话铃声', filename: 'ringtones/phone.wav' },
    { name: '关门声', filename: 'doors/close.wav' }
  ];

  // 本地命中
  const hit = buildMappedSfxItem({ name: '电话铃声', position: 1.0 }, library);
  assert.deepEqual(hit, {
    name: '电话铃声',
    position: 1.0,
    duration: null,
    anchor_text: '',
    anchor_mode: 'start',
    offset: 0,
    start_time: null,
    position_source: 'estimated',
    source: 'local',
    lastQuery: '电话铃声',
    unmatchedHint: null
  });

  // 未命中：保留 AI 原始名作 lastQuery / unmatchedHint，name 也保留以便用户看到
  const miss = buildMappedSfxItem({ name: '木门被猛烈撞开的声音', position: 0.3 }, library);
  assert.equal(miss.name, '木门被猛烈撞开的声音');
  assert.equal(miss.source, 'unmatched');
  assert.equal(miss.lastQuery, '木门被猛烈撞开的声音');
  assert.equal(miss.unmatchedHint, '木门被猛烈撞开的声音');
  assert.equal(miss.position, 0.3);

  // 模糊包含匹配应仍算本地命中（与现有 index.html findBestMatch 行为一致）
  const fuzzy = buildMappedSfxItem({ name: '电话', position: 0.5 }, library);
  assert.equal(fuzzy.source, 'local');
  assert.equal(fuzzy.name, '电话铃声');
  assert.equal(fuzzy.unmatchedHint, null);
});

test('attachManualSfxFile 把用户上传的文件绑定到未命中音效并切换为本地来源', () => {
  // 未命中 -> 手动上传绑定
  const sfx = {
    name: '木门被猛烈撞开的声音',
    position: 0.3,
    source: 'unmatched',
    lastQuery: '木门被猛烈撞开的声音',
    unmatchedHint: '木门被猛烈撞开的声音'
  };
  const fakeFile = { name: 'metal_hit.wav' };

  attachManualSfxFile(sfx, fakeFile, 'doors/metal_hit.wav', { scanRoot: 'D:/素材' });

  assert.equal(sfx.source, 'local_scan');
  assert.equal(sfx.filename, 'doors/metal_hit.wav');
  assert.equal(sfx.scanRoot, 'D:/素材');
  assert.equal(sfx.unmatchedHint, null);
  assert.equal(sfx.name, '木门被猛烈撞开的声音'); // 名称保留，用户可见可编辑
  assert.equal(sfx.lastQuery, '木门被猛烈撞开的声音');

  // 不带 scanRoot（进入 IndexedDB 的情况）
  const sfx2 = { name: '雷声', position: 0, source: 'unmatched', unmatchedHint: '雷声' };
  attachManualSfxFile(sfx2, { name: 'thunder.mp3' }, 'thunder.mp3');
  assert.equal(sfx2.source, 'local');
  assert.equal(sfx2.filename, 'thunder.mp3');
  assert.ok(!('scanRoot' in sfx2));
  assert.equal(sfx2.unmatchedHint, null);
});

test('validateDialogueCoverage 检测模型是否完整保留全部原文', () => {
  const original = '老李说：“别接那个电话！”\n我愣住了。';

  const complete = validateDialogueCoverage(original, [
    { type: 'dialogue', text_content: '老李说：' },
    { type: 'dialogue', text_content: '别接那个电话！' },
    { type: 'bgImage', image_prompt: '办公室' },
    { type: 'dialogue', text_content: '我愣住了。' }
  ]);
  assert.equal(complete.ok, true);
  assert.equal(complete.missingTextCount, 0);

  // 模型直接漏掉整条对象：不能只靠“空 text_content”检查，必须对照原文发现。
  const omitted = validateDialogueCoverage(original, [
    { type: 'dialogue', text_content: '老李说：' },
    { type: 'dialogue', text_content: '别接那个电话！' }
  ]);
  assert.equal(omitted.ok, false);
  assert.equal(omitted.reason, 'content_mismatch');

  // 字数相同但擅自改写也必须失败。
  const rewritten = validateDialogueCoverage('甲推开门。', [
    { type: 'dialogue', text_content: '乙推开门。' }
  ]);
  assert.equal(rewritten.ok, false);

  // 允许结构化拆分造成的空白与引号边界差异，但不能忽略正文标点。
  const formattingOnly = validateDialogueCoverage('“你好，” 她说。', [
    { type: 'dialogue', text_content: '你好，' },
    { type: 'dialogue', text_content: '她说。' }
  ]);
  assert.equal(formattingOnly.ok, true);

  const emptyField = validateDialogueCoverage('你好。', [
    { type: 'dialogue', role_name: '旁白' }
  ]);
  assert.equal(emptyField.ok, false);
  assert.equal(emptyField.reason, 'empty_dialogue');
  assert.equal(emptyField.missingTextCount, 1);
});

test('createSourceSegments 从原文无损切片并隔离叙述与引号台词', () => {
  const original = '老李低声说：“别接那个电话！”\n我愣住了，看向门外。';
  const segments = createSourceSegments(original, 120);

  assert.equal(segments.map(segment => segment.text).join(''), original);
  assert.ok(segments.every(segment => segment.id && Array.from(segment.text).length <= 120));
  assert.ok(segments.every(segment => segment.text.trim().length > 0));
  assert.ok(segments.some(segment => segment.text.includes('老李低声说：')));
  assert.ok(segments.some(segment => segment.text.includes('别接那个电话！')));
  assert.ok(!segments.some(segment => segment.text.includes('说：“别接')));
});

test('createSourceSegments 保持 120 字以内的完整引语不被内部标点拆分', () => {
  const original = '张三压低声音：“你别动！我过去看看。要是有人追上来，你就马上离开。”李四点了点头。';
  const segments = createSourceSegments(original, 120);

  assert.deepEqual(segments.map(segment => segment.text), [
    '张三压低声音：',
    '“你别动！我过去看看。要是有人追上来，你就马上离开。”',
    '李四点了点头。'
  ]);
  assert.equal(segments.map(segment => segment.text).join(''), original);
});

test('createSourceSegments 不按普通逗号过度切片但保留冒号结构边界', () => {
  const original = '天黑了，他拿起钥匙，穿过走廊，打开了门。桌上写着：不要开灯。';
  const segments = createSourceSegments(original, 120);

  assert.deepEqual(segments.map(segment => segment.text), [
    '天黑了，他拿起钥匙，穿过走廊，打开了门。桌上写着：',
    '不要开灯。'
  ]);
  assert.equal(segments.map(segment => segment.text).join(''), original);
});

test('createSourceSegments 对超长无标点原文硬切但绝不丢字', () => {
  const original = '甲'.repeat(275);
  const segments = createSourceSegments(original, 120);
  assert.deepEqual(segments.map(segment => Array.from(segment.text).length), [120, 120, 35]);
  assert.equal(segments.map(segment => segment.text).join(''), original);
});

test('createSourceSegments 仅在完整引语超过上限后按标点切分并保留引语组关系', () => {
  const firstSentence = `“${'甲'.repeat(70)}，${'乙'.repeat(30)}。`;
  const secondSentence = `${'丙'.repeat(50)}！”`;
  const original = firstSentence + secondSentence;
  const segments = createSourceSegments(original, 120);

  assert.deepEqual(segments.map(segment => segment.text), [firstSentence, secondSentence]);
  assert.equal(segments.map(segment => segment.text).join(''), original);
  assert.ok(segments.every(segment => Array.from(segment.text).length <= 120));
  assert.equal(segments[0].quoteGroupId, segments[1].quoteGroupId);
  assert.deepEqual(segments.map(segment => segment.quotePart), [1, 2]);
  assert.deepEqual(segments.map(segment => segment.quotePartCount), [2, 2]);
});

test('createSourceSegments 处理边界空白后仍无损且每片不超过上限', () => {
  const original = `${'甲'.repeat(120)}\n下一段。`;
  const segments = createSourceSegments(original, 120);

  assert.equal(segments.map(segment => segment.text).join(''), original);
  assert.ok(segments.every(segment => Array.from(segment.text).length <= 120));
  assert.ok(segments.every(segment => segment.text.trim().length > 0));
});

test('createSourceSegments 将弯单引号和 ASCII 双引号识别为完整引语', () => {
  const original = '甲说：‘别动！我去看看。’乙说："马上回来，别逞强。"';
  const segments = createSourceSegments(original, 120);

  assert.deepEqual(segments.map(segment => segment.text), [
    '甲说：',
    '‘别动！我去看看。’',
    '乙说：',
    '"马上回来，别逞强。"'
  ]);
  assert.equal(segments.map(segment => segment.text).join(''), original);
  assert.ok(segments[1].quoteGroupId);
  assert.ok(segments[3].quoteGroupId);
});

test('mergeSegmentAnalysis 始终使用原文片段正文，AI 不返回正文或改写正文也不会丢原文', () => {
  const segments = createSourceSegments('门开了。“谁？”她问。', 120);
  const metadata = segments.map((segment, index) => ({
    segment_id: segment.id,
    role_name: index === 1 ? '小雨' : '旁白',
    // 即使模型输出了错误 text_content，也不允许覆盖原文。
    text_content: '模型擅自改写的内容',
    emotion: '平静',
    intensity: '中等'
  }));

  const result = mergeSegmentAnalysis(segments, metadata);
  assert.equal(result.lines.map(line => line.text).join(''), '门开了。“谁？”她问。');
  assert.equal(result.lines.some(line => line.text.includes('模型擅自改写')), false);
  const quotedLine = result.lines.find(line => line.quoteGroupId);
  assert.equal(quotedLine.quotePart, 1);
  assert.equal(quotedLine.quotePartCount, 1);
  assert.deepEqual(result.missingSegmentIds, []);
});

test('mergeSegmentAnalysis 明确返回 AI 漏掉的 ID，已返回片段仍按原文顺序合并', () => {
  const segments = createSourceSegments('第一句：“第二句。”第三句。', 120);
  const metadata = [
    { segment_id: segments[2].id, role_name: '旁白' },
    { segment_id: segments[0].id, role_name: '旁白' }
  ];
  const result = mergeSegmentAnalysis(segments, metadata);

  assert.deepEqual(result.missingSegmentIds, [segments[1].id]);
  assert.equal(result.lines.map(line => line.text).join(''), '第一句：第三句。');
  assert.deepEqual(result.lines.map(line => line.segmentId), [segments[0].id, segments[2].id]);
});

test('markQuoteRoleConflicts 保留角色和片段音效，仅将角色冲突的完整引语组全部标为待确认', () => {
  const lines = [
    { quoteGroupId: 'quote_0001', role_name: '张三', sfx: [{ name: '脚步', position: 0.2 }] },
    { quoteGroupId: 'quote_0001', role_name: '李四', sfx: [{ name: '关门', position: 0.8 }] },
    { quoteGroupId: 'quote_0002', role_name: '王五', sfx: [] },
    { quoteGroupId: 'quote_0002', role_name: '王五', sfx: [{ name: '雷声', position: 0.5 }] },
    { role_name: '旁白', sfx: [{ name: '风声', position: 0.4 }] }
  ];

  const result = markQuoteRoleConflicts(lines);

  assert.strictEqual(result, lines);
  assert.deepEqual(lines.slice(0, 2).map(line => line.role_name), ['张三', '李四']);
  assert.ok(lines[0]._roleNeedsReview);
  assert.ok(lines[1]._roleNeedsReview);
  assert.equal(lines[0]._roleReviewReason, '同一完整引语被识别为多个角色，请确认说话人');
  assert.equal(lines[1]._roleReviewReason, '同一完整引语被识别为多个角色，请确认说话人');
  assert.equal(lines[2]._roleNeedsReview, undefined);
  assert.equal(lines[3]._roleNeedsReview, undefined);
  assert.deepEqual(lines.map(line => line.sfx), [
    [{ name: '脚步', position: 0.2 }],
    [{ name: '关门', position: 0.8 }],
    [],
    [{ name: '雷声', position: 0.5 }],
    [{ name: '风声', position: 0.4 }]
  ]);
});

test('markQuoteRoleConflicts 使用规范化角色名判断同组是否冲突', () => {
  const lines = [
    { quoteGroupId: 'quote_0001', role_name: '“张三：”' },
    { quoteGroupId: 'quote_0001', role_name: '张三' }
  ];

  markQuoteRoleConflicts(lines);

  assert.equal(lines[0]._roleNeedsReview, undefined);
  assert.equal(lines[1]._roleNeedsReview, undefined);
});

test('原文切片直接回填后必须通过完整性校验', () => {
  const samples = [
    '张三压低声音：“你别动！我过去看看。”\n李四点了点头。',
    '甲说：‘别动！’乙说："马上回来。"',
    `${'甲'.repeat(121)}\n${'乙'.repeat(120)}  `,
    '桌上写着：不要开灯。网址是 https://localhost:8080/path。',
    '他说：“第一层‘第二层’还在继续。”然后关门。'
  ];

  for (const original of samples) {
    const segments = createSourceSegments(original, 120);
    const canonical = segments.map(segment => ({ type: 'dialogue', text_content: segment.text }));
    assert.equal(validateDialogueCoverage(original, canonical).ok, true, JSON.stringify(original));
  }
});

test('createSourceSegments 保留闭合双引号后紧跟的句号和逗号作为边界不丢字', () => {
  const original = '甲说："女儿瞎了眼"。他攥着，"够狠"。她愣了。';
  const expected = '甲说："女儿瞎了眼"。他攥着，"够狠"。她愣了。';
  const segments = createSourceSegments(original, 120);
  assert.equal(segments.map(segment => segment.text).join(''), expected);
});

test('compressChineseWhitespace 清除中文标点前后的多余空格且字数不增', () => {
  const input = '那是三年前的事了 。  他握紧拳头 ， 一声不吭 。 ';
  const expected = '那是三年前的事了。他握紧拳头，一声不吭。';
  assert.equal(compressChineseWhitespace(input), expected);
  assert.equal(Array.from(compressChineseWhitespace(input)).length <= Array.from(input).length, true);
});
test('compressChineseWhitespace 对已规范文本不改变且保留分段', () => {
  const input = '第一行。\n二行续。三行。';
  assert.equal(compressChineseWhitespace(input), input);
});

test('validateSourceSegments 只按逐行拼接验证程序切片，不忽略空白或引号', () => {
  const original = '张三说：“别动！”\n李四回头。';
  const valid = createSourceSegments(original, 120);

  assert.deepEqual(validateSourceSegments(original, valid), { ok: true, reason: '' });
  assert.deepEqual(validateSourceSegments(original, valid.slice(0, -1)), {
    ok: false,
    reason: 'content_mismatch'
  });
  assert.deepEqual(validateSourceSegments(original, valid.map(segment => ({
    ...segment,
    text: segment.text.replace('\n', '')
  }))), {
    ok: false,
    reason: 'content_mismatch'
  });
});

test('sanitizeEmotionFields 把非法情绪和强度回退到合法默认值', () => {
  // 合法值保持不变
  assert.deepEqual(sanitizeEmotionFields('高兴', '强烈'), { emotion: '高兴', intensity: '强烈' });
  assert.deepEqual(sanitizeEmotionFields('平静', '中等'), { emotion: '平静', intensity: '中等' });
  // 空值与 null/undefined 回退
  assert.deepEqual(sanitizeEmotionFields('', ''), { emotion: '平静', intensity: '中等' });
  assert.deepEqual(sanitizeEmotionFields(null, undefined), { emotion: '平静', intensity: '中等' });
  // 列表外情绪回退
  assert.deepEqual(sanitizeEmotionFields('愤怒', '中等'), { emotion: '平静', intensity: '中等' });
  assert.deepEqual(sanitizeEmotionFields('紧张', '较强'), { emotion: '平静', intensity: '较强' });
  // 列表外强度回退
  assert.deepEqual(sanitizeEmotionFields('伤心', '极强'), { emotion: '伤心', intensity: '中等' });
  assert.deepEqual(sanitizeEmotionFields('害怕', '稍微'), { emotion: '害怕', intensity: '中等' });
  // 两侧都非法
  assert.deepEqual(sanitizeEmotionFields('惊讶', '非常强'), { emotion: '平静', intensity: '中等' });
});

test('splitDialogueLine 拆分后子片段携带清洗过的 emotion/intensity', () => {
  // 必须触发真正的拆分：文本长于 120 字才会走到带 sanitize 的分支
  const longText = '他低着头穿过走廊，脚步声回荡在空旷的楼道里，灯泡一闪一闪地预示着什么不祥的征兆。终于他在那扇紧闭的木门前停下，迟疑片刻，缓缓抬手——叩、叩、叩——三声敲击过后屋内毫无回应，只有窗户被风掀起的砰砰声。他再敲一次，依旧死寂。他咬咬牙推开门，门轴发出刺耳的吱呀声，仿佛是这间屋子多年未启的锁。';
  const line = {
    id: 'L1',
    text: longText,
    emotion: '愤怒',
    intensity: '极强'
  };
  const parts = splitDialogueLine(line, 120);
  assert.ok(parts.length >= 2, 'should split into multiple parts');
  parts.forEach(p => {
    assert.equal(p.emotion, '平静');
    assert.equal(p.intensity, '中等');
  });
});

// ============================================================
// 工单 A —— 音效数据规范化：duration / anchor_text / anchor_mode / offset / start_time / position_source
// ============================================================

test('normalizeSfxAnnotation 保留合法 duration 并清洗为数字', () => {
  // 合法数字
  assert.equal(normalizeSfxAnnotation({ name: '雷声', position: 0.3, duration: 1.5 }).duration, 1.5);
  // 数字字符串
  assert.equal(normalizeSfxAnnotation({ name: '雷声', position: 0.3, duration: '1.5' }).duration, 1.5);
  // 边界
  assert.equal(normalizeSfxAnnotation({ name: '雷声', position: 0.3, duration: 0.1 }).duration, 0.1);
  assert.equal(normalizeSfxAnnotation({ name: '雷声', position: 0.3, duration: 60 }).duration, 60);
});

test('normalizeSfxAnnotation 非法 duration 回退为 null 且不阻断音效', () => {
  assert.equal(normalizeSfxAnnotation({ name: '雷声', position: 0.3, duration: '1.5秒' }).duration, null);
  assert.equal(normalizeSfxAnnotation({ name: '雷声', position: 0.3, duration: -1 }).duration, null);
  assert.equal(normalizeSfxAnnotation({ name: '雷声', position: 0.3, duration: 0 }).duration, null);
  assert.equal(normalizeSfxAnnotation({ name: '雷声', position: 0.3, duration: 61 }).duration, null);
  assert.equal(normalizeSfxAnnotation({ name: '雷声', position: 0.3, duration: NaN }).duration, null);
  assert.equal(normalizeSfxAnnotation({ name: '雷声', position: 0.3, duration: null }).duration, null);
  assert.equal(normalizeSfxAnnotation({ name: '雷声', position: 0.3, duration: undefined }).duration, null);
  assert.equal(normalizeSfxAnnotation({ name: '雷声', position: 0.3 }).duration, null);
  // 即使 duration 非法，音效对象仍应返回（不阻断）
  const bad = normalizeSfxAnnotation({ name: '雷声', position: 0.3, duration: '坏值' });
  assert.ok(bad && bad.name === '雷声');
});

test('normalizeSfxAnnotation 保留 anchor_text / anchor_mode 并规范化', () => {
  const r = normalizeSfxAnnotation({
    name: '开门声',
    position: 0.5,
    anchor_text: '猛地推开了门',
    anchor_mode: 'start'
  });
  assert.equal(r.anchor_text, '猛地推开了门');
  assert.equal(r.anchor_mode, 'start');

  // anchor_mode 非法 → 回退 'start'
  assert.equal(normalizeSfxAnnotation({ name: 'x', anchor_mode: 'xxx' }).anchor_mode, 'start');
  // anchor_text 缺失 → 空串
  assert.equal(normalizeSfxAnnotation({ name: 'x' }).anchor_text, '');
  // anchor_text 非字符串 → 空串
  assert.equal(normalizeSfxAnnotation({ name: 'x', anchor_text: 123 }).anchor_text, '');
});

test('normalizeSfxAnnotation 默认 offset=0、start_time=null、position_source=estimated', () => {
  const r = normalizeSfxAnnotation({ name: 'x', position: 0.5 });
  assert.equal(r.offset, 0);
  assert.equal(r.start_time, null);
  assert.equal(r.position_source, 'estimated');
  // 合法 offset 保留
  assert.equal(normalizeSfxAnnotation({ name: 'x', offset: 1.5 }).offset, 1.5);
  assert.equal(normalizeSfxAnnotation({ name: 'x', offset: '-0.3' }).offset, -0.3);
  // 非法 offset → 0
  assert.equal(normalizeSfxAnnotation({ name: 'x', offset: 'abc' }).offset, 0);
});

test('旧工程 sfx 无新字段时仍能正常规范化且不抛错', () => {
  // 典型旧数据：只有 name 和 position
  const r = normalizeSfxAnnotation({ name: '脚步声', position: 0.4 });
  assert.deepEqual(r, {
    name: '脚步声',
    position: 0.4,
    duration: null,
    anchor_text: '',
    anchor_mode: 'start',
    offset: 0,
    start_time: null,
    position_source: 'estimated'
  });
});

test('buildMappedSfxItem 命中保留 duration/anchor 等定位字段', () => {
  const library = [{ name: '电话铃声', filename: 'phone.wav' }];
  const r = buildMappedSfxItem({
    name: '电话铃声',
    position: 0.8,
    duration: 1.2,
    anchor_text: '电话响了',
    anchor_mode: 'start',
    offset: 0.1
  }, library);
  assert.equal(r.source, 'local');
  assert.equal(r.duration, 1.2);
  assert.equal(r.anchor_text, '电话响了');
  assert.equal(r.anchor_mode, 'start');
  assert.equal(r.offset, 0.1);
  assert.equal(r.unmatchedHint, null);
});

test('buildMappedSfxItem 未命中同样保留 duration/anchor 等定位字段', () => {
  const library = [{ name: '电话铃声', filename: 'phone.wav' }];
  const r = buildMappedSfxItem({
    name: '木门猛然撞击',
    position: 0.3,
    duration: 0.8,
    anchor_text: '猛地撞开门',
    anchor_mode: 'end'
  }, library);
  assert.equal(r.source, 'unmatched');
  assert.equal(r.duration, 0.8);
  assert.equal(r.anchor_text, '猛地撞开门');
  assert.equal(r.anchor_mode, 'end');
  assert.equal(r.unmatchedHint, '木门猛然撞击');
});

test('splitDialogueLine 拆分时保留每个音效的 duration 和定位字段', () => {
  const longText = `${'甲'.repeat(70)}，${'乙'.repeat(65)}。`;
  const line = {
    id: 'L1',
    text: longText,
    emotion: '平静',
    intensity: '中等',
    sfx: [
      {
        name: '脚步',
        position: 0.1,
        duration: 1.5,
        anchor_text: '走',
        anchor_mode: 'start',
        offset: 0.2,
        start_time: null,
        position_source: 'estimated'
      },
      {
        name: '关门',
        position: 0.9,
        duration: 0.5,
        anchor_text: '关',
        anchor_mode: 'end',
        offset: 0,
        start_time: 12.3,
        position_source: 'manual'
      }
    ]
  };
  const parts = splitDialogueLine(line, 120);
  assert.ok(parts.length >= 2);
  // 每个拆分片段里的音效都应保留 duration / anchor_text / anchor_mode / offset / start_time / position_source
  const allSfx = parts.flatMap(p => p.sfx);
  assert.ok(allSfx.length > 0);
  allSfx.forEach(s => {
    assert.equal(typeof s.duration, 'number');
    assert.equal(typeof s.anchor_text, 'string');
    assert.ok(['start', 'center', 'end', 'after_dialogue'].includes(s.anchor_mode));
    assert.equal(typeof s.offset, 'number');
    // start_time 可以是 null 或 number
    assert.ok(s.start_time === null || typeof s.start_time === 'number');
    assert.ok(['estimated', 'audio_aligned', 'manual'].includes(s.position_source));
  });
});

// ============================================================
// 工单 B —— 未匹配音效清单纯文本生成
// ============================================================

test('buildUnmatchedSfxListText 按每个台词位置输出建议时长和锚点信息', () => {
  const lines = [
    { sfx: [{ name: '木门_猛然推开', source: 'unmatched', unmatchedHint: '木门_猛然推开', position: 0.55, duration: 1.2, anchor_text: '猛地推开了门', anchor_mode: 'start' }] },
    { sfx: [{ name: '暴雨_屋外_持续', source: 'unmatched', unmatchedHint: '暴雨_屋外_持续', position: 0.0, duration: 8, anchor_text: '暴雨声', anchor_mode: 'start' }] }
  ];
  const text = buildUnmatchedSfxListText(lines, new Date('2026-08-04T18:30:00'));
  assert.ok(text.includes('木门_猛然推开'));
  assert.ok(text.includes('#1'));
  assert.ok(text.includes('猛地推开了门'));
  assert.ok(text.includes('1.20'));
  assert.ok(text.includes('暴雨_屋外_持续'));
  assert.ok(text.includes('8.00'));
});

test('buildUnmatchedSfxListText 同名音效在多句台词中分别保留各自 duration', () => {
  const lines = [
    { sfx: [{ name: '脚步声', source: 'unmatched', unmatchedHint: '脚步声', position: 0.1, duration: 3.0 }] },
    { sfx: [{ name: '脚步声', source: 'unmatched', unmatchedHint: '脚步声', position: 0.3, duration: 6.5 }] }
  ];
  const text = buildUnmatchedSfxListText(lines, new Date('2026-08-04T18:30:00'));
  // 两条独立条目，不是合并展示
  assert.ok(text.includes('#1'));
  assert.ok(text.includes('#2'));
  assert.ok(text.includes('3.00'));
  assert.ok(text.includes('6.50'));
});

test('buildUnmatchedSfxListText duration 缺失显示"未提供"', () => {
  const lines = [
    { sfx: [{ name: '雷声', source: 'unmatched', unmatchedHint: '雷声', position: 0.5 }] }
  ];
  const text = buildUnmatchedSfxListText(lines, new Date('2026-08-04T18:30:00'));
  assert.ok(text.includes('未提供'));
});

test('buildUnmatchedSfxListText 跳过已匹配音效', () => {
  const lines = [
    { sfx: [{ name: '雷声', source: 'local', position: 0.5, duration: 2 }] },
    { sfx: [{ name: '开门声', source: 'unmatched', unmatchedHint: '开门声', position: 0.3, duration: 1 }] }
  ];
  const text = buildUnmatchedSfxListText(lines, new Date('2026-08-04T18:30:00'));
  assert.ok(!text.includes('雷声'));
  assert.ok(text.includes('开门声'));
});

test('buildUnmatchedSfxListText 无未匹配音效时返回空串', () => {
  const lines = [{ sfx: [{ name: 'x', source: 'local' }] }];
  const text = buildUnmatchedSfxListText(lines, new Date('2026-08-04T18:30:00'));
  assert.equal(text, '');
});

// 工单 C：findBestMatchName 本地匹配（导出后供本地重新匹配复用）
test('findBestMatchName 精确命中返回库条目名', () => {
  const lib = [{ name: '脚步_走廊_远去' }, { name: '心跳_单人_紧张' }];
  assert.equal(findBestMatchName('脚步_走廊_远去', lib), '脚步_走廊_远去');
});

test('findBestMatchName 模糊包含命中返回最接近长度的库条目名', () => {
  const lib = [{ name: '脚步' }, { name: '脚步_走廊_远去' }];
  // '脚步_走廊_远去改写' 既被库里两项包含（库里短名被它包含），按 |len-target| 升序取最接近的
  assert.equal(findBestMatchName('脚步', lib), '脚步');
  assert.equal(findBestMatchName('脚步_走廊_远去改写', lib), '脚步_走廊_远去');
});

test('findBestMatchName 大小写不敏感', () => {
  const lib = [{ name: 'Door Close' }];
  assert.equal(findBestMatchName('door close', lib), 'Door Close');
});

test('findBestMatchName 库为空或 target 为空返回空串', () => {
  assert.equal(findBestMatchName('', [{ name: 'x' }]), '');
  assert.equal(findBestMatchName('x', []), '');
  assert.equal(findBestMatchName('x', null), '');
});

// 工单 E：computeSfxPlayTime —— 计算音效在真实音频时间轴上的播放起点
// 规则：
//   1. 若 sfx 已被人工手动微调（position_source === 'manual' 且 start_time 为有限数），
//      直接返回人工 start_time，position_source 仍回写 'manual'
//   2. 否则按 position（0~1）在台词 [evtTime, evtTime+evtDuration] 区间内计算
//      写回 start_time，position_source = 'audio_aligned'
//   3. position 越界自动 clamp 到 [0,1]；非数字按 0 处理
//   4. offset 字段作为附加微调秒数叠加到最终 start_time
const _sfx = (extra) => ({ name: 'x', position: 0.5, source: 'local', ...extra });

test('computeSfxPlayTime 按 position 在台词区间内计算并对齐音频', () => {
  const s = _sfx({ position: 0.5 });
  const r = computeSfxPlayTime(s, { time: 10, duration: 4 });
  assert.equal(r.start_time, 12);
  assert.equal(r.position_source, 'audio_aligned');
});

test('computeSfxPlayTime position 越界自动 clamp', () => {
  assert.equal(computeSfxPlayTime(_sfx({ position: -1 }), { time: 1, duration: 2 }).start_time, 1);
  assert.equal(computeSfxPlayTime(_sfx({ position: 1.5 }), { time: 1, duration: 2 }).start_time, 3);
});

test('computeSfxPlayTime offset 作为附加微调秒数叠加', () => {
  const r = computeSfxPlayTime(_sfx({ position: 0.25, offset: 0.5 }), { time: 4, duration: 4 });
  assert.equal(r.start_time, 5.5);
});

test('computeSfxPlayTime 人工 manual 优先不被覆盖', () => {
  const s = _sfx({ position: 0.9, position_source: 'manual', start_time: 7.3 });
  const r = computeSfxPlayTime(s, { time: 10, duration: 4 });
  assert.equal(r.start_time, 7.3);
  assert.equal(r.position_source, 'manual');
});

test('computeSfxPlayTime 写回的 sfx 对象包含完整字段且 position 保留原值', () => {
  const s = _sfx({ position: 0.4, anchor_text: '关门', anchor_mode: 'end', duration: 0.6 });
  const r = computeSfxPlayTime(s, { time: 0, duration: 5 });
  assert.equal(r.position, 0.4);
  assert.equal(r.anchor_text, '关门');
  assert.equal(r.anchor_mode, 'end');
  assert.equal(r.duration, 0.6);
  assert.equal(r.start_time, 2);
  assert.equal(r.position_source, 'audio_aligned');
});
