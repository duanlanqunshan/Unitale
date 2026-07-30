import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveSfxPlaybackUrl,
  assessRoleConfidence,
  normalizeRoleName,
  normalizeSfxAnnotation,
  splitDialogueText,
  splitDialogueLine,
  updateSfxQuery
} from '../unitale_logic.mjs';

test('LLM 音效标注会规范名称与位置并拒绝非法项', () => {
  assert.deepEqual(normalizeSfxAnnotation({ name: '  门响  ', position: '0.4' }), {
    name: '门响',
    position: 0.4
  });
  assert.deepEqual(normalizeSfxAnnotation({ name: '雷声' }), {
    name: '雷声',
    position: 0.5
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
