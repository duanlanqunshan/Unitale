const fs = require('fs');
const path = require('path');

const targetPath = process.argv[2] || 'E:\\Unitale工程文件_20260404_174532.json';

function safeSlice(text, start, end) {
  if (!text) return '';
  return text.slice(start, end).replace(/\r/g, '\\r').replace(/\n/g, '\\n');
}

function printSection(title, value) {
  console.log(`\n=== ${title} ===`);
  console.log(value);
}

function summarizeProject(data) {
  const summary = {
    version: data?.version,
    hasProject: !!data?.project,
    hasLibraries: !!data?.libraries,
    currentScriptId: data?.project?.currentScriptId,
    scriptCount: Array.isArray(data?.project?.scriptList) ? data.project.scriptList.length : 0,
    characterCount: Array.isArray(data?.project?.characters) ? data.project.characters.length : 0,
    sfxCount: Array.isArray(data?.libraries?.sfx) ? data.libraries.sfx.length : 0,
    bgmCount: Array.isArray(data?.libraries?.bgm) ? data.libraries.bgm.length : 0,
    timbreCount: Array.isArray(data?.libraries?.timbres) ? data.libraries.timbres.length : 0,
  };

  printSection('工程摘要', JSON.stringify(summary, null, 2));

  if (Array.isArray(data?.project?.scriptList)) {
    const scripts = data.project.scriptList.map((script, index) => ({
      index,
      id: script?.id,
      name: script?.name,
      lineCount: Array.isArray(script?.data?.scriptLines) ? script.data.scriptLines.length : 0,
      rawScriptLength: (script?.data?.rawScript || '').length,
    }));
    printSection('脚本列表', JSON.stringify(scripts, null, 2));
  }
}

function tryDirectParse(text) {
  return JSON.parse(text);
}

function tryCompatParse(text) {
  const extractedBlobs = [];
  const tinyJsonStr = text.replace(/"(_fileData|audioBase64|imageBase64)":"(data:[^"]+)"/g, (match, key, base64) => {
    extractedBlobs.push(base64);
    return `"${key}":"__EXTRACTED_BASE64_${extractedBlobs.length - 1}__"`;
  });

  return {
    data: JSON.parse(tinyJsonStr),
    extractedBlobs,
    tinyJsonStr,
  };
}

function main() {
  console.log(`诊断文件: ${targetPath}`);

  if (!fs.existsSync(targetPath)) {
    console.error('文件不存在。');
    process.exit(2);
  }

  const stat = fs.statSync(targetPath);
  printSection('文件信息', JSON.stringify({
    sizeBytes: stat.size,
    sizeMB: +(stat.size / 1024 / 1024).toFixed(3),
    modified: stat.mtime.toISOString(),
    ext: path.extname(targetPath),
  }, null, 2));

  const text = fs.readFileSync(targetPath, 'utf8');

  printSection('文本长度', String(text.length));
  printSection('文件头部片段', safeSlice(text, 0, 300));
  printSection('文件尾部片段', safeSlice(text, Math.max(0, text.length - 500), text.length));

  if (!text.trim()) {
    console.error('\n结论: 文件内容为空。');
    process.exit(3);
  }

  try {
    const directData = tryDirectParse(text);
    console.log('\n直接 JSON.parse 成功。');
    summarizeProject(directData);
    process.exit(0);
  } catch (err) {
    console.error('\n直接 JSON.parse 失败:', err.message);
  }

  try {
    const { data, extractedBlobs, tinyJsonStr } = tryCompatParse(text);
    console.log('\n兼容路径 JSON.parse 成功。');
    printSection('提取到的 Base64 数量', String(extractedBlobs.length));
    printSection('兼容路径尾部片段', safeSlice(tinyJsonStr, Math.max(0, tinyJsonStr.length - 500), tinyJsonStr.length));
    summarizeProject(data);
    process.exit(0);
  } catch (err) {
    console.error('\n兼容路径 JSON.parse 失败:', err.message);
    if (/position (\d+)/.test(err.message)) {
      const pos = Number(err.message.match(/position (\d+)/)[1]);
      const text = fs.readFileSync(targetPath, 'utf8');
      printSection('报错位置附近原文', safeSlice(text, Math.max(0, pos - 120), pos + 120));
    }
    process.exit(1);
  }
}

main();
