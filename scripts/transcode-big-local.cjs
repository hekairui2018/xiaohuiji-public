// 本机 ffmpeg 批量转 720p（绕开云端限流，零费用）
// 长边远<=1280、不放大、短边自动偶数；libx264 crf23；aac128k；+faststart 网页渐进播放
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const ROOT = 'D:\\xiaohuiji';
const OUT_DIR = path.join(ROOT, 'tmp', 'video-720p');
const FFMPEG = 'D:\\Program Files\\HD Show_2.1.1.0\\ffmpeg.exe';
const BASE = 'E:\\WXWork\\1688857708791124\\WeDrive\\灰度科技\\公司资料\\技术资料';
const CSV = path.join(ROOT, 'tmp', 'wedrive-led-operation-videos-final.csv');

function parseCsv(text) {
  const rows = [];
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  for (let k = 1; k < lines.length; k++) {
    const line = lines[k];
    let cells;
    if (line.includes('","')) {
      cells = line.match(/^"([^"]*)","([^"]*)","([^"]*)","([^"]*)"$/).slice(1);
    } else {
      cells = line.split(',');
      for (let n = 4; n < cells.length; n++) cells[3] += ',' + cells[n];
      cells = cells.slice(0, 4);
    }
    rows.push(cells);
  }
  return rows;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

function runFfmpeg(src, dst) {
  return new Promise((resolve, reject) => {
    // 等比缩进1280框(长边1280/只缩不放)，再把宽高各自取偶(yuv420p要求)；滤镜间逗号合法、表达式内无逗号
    const vf = 'scale=1280:1280:force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2';
    const args = ['-y', '-hide_banner', '-nostdin', '-i', src,
      '-vf', vf,
      '-map', '0:v:0', '-map', '0:a?',
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '23', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart',
      dst];
    const t0 = Date.now();
    const p = spawn(FFMPEG, args, { stdio: ['ignore', 'ignore', 'inherit'] });
    p.on('error', reject);
    p.on('close', code => {
      if (code === 0) resolve(Math.round((Date.now() - t0) / 1000));
      else reject(new Error('ffmpeg exit ' + code));
    });
  });
}

(async () => {
  const rows = parseCsv(fs.readFileSync(CSV, 'utf8')).filter(r => Number(r[1]) >= 100);
  console.log(`大视频 ${rows.length} 个，本机 ffmpeg 转 720p（已完成自动跳过）`);
  const results = [];
  for (let i = 0; i < rows.length; i++) {
    const [cat, mbS, name, rel] = rows[i];
    const src = BASE + rel;
    const dst = path.join(OUT_DIR, name);
    console.log(`\n=== ${i+1}/${rows.length} 源${mbS}MB [${cat}] ${name} ===`);
    if (!fs.existsSync(src)) { console.error('  源文件不存在!'); results.push({ name, status: 'fail', error: 'src missing' }); continue; }
    if (fs.existsSync(dst) && fs.statSync(dst).size > 1024 * 1024) {
      console.log(`跳过(已转) ${(fs.statSync(dst).size / 1048576).toFixed(1)}MB`);
      results.push({ name, status: 'skip' }); continue;
    }
    let ok = false;
    for (let attempt = 1; attempt <= 2 && !ok; attempt++) {
      try { const sec = await runFfmpeg(src, dst); const mb = (fs.statSync(dst).size / 1048576).toFixed(1); console.log(`[完成] 720p 用时${sec}s → ${mb}MB  ${name}`); results.push({ name, status: 'done', mb, sec }); ok = true; }
      catch (e) { console.error(`[尝试${attempt}失败] ${name} → ${e.message}`); if (attempt < 2) await sleep(5000); else results.push({ name, status: 'fail', error: e.message }); }
    }
  }
  fs.writeFileSync(path.join(ROOT, 'tmp', 'transcode-local-result.json'), JSON.stringify(results, null, 2));
  const done = results.filter(r => r.status === 'done').length;
  const skip = results.filter(r => r.status === 'skip').length;
  const fail = results.filter(r => r.status === 'fail').length;
  console.log(`\n===== 本机转码结束: 新转${done} 跳过${skip} 失败${fail} =====`);
  if (fail) results.filter(r => r.status === 'fail').forEach(r => console.error('失败:', r.name, r.error));
})();
