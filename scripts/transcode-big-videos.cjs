/*
 * 批量把 16 个大视频(>=100MB)云端转码为 720p/H.264，下载到 tmp/video-720p/<同名>。
 * 串行、可断点续做（成品已存在且>1MB 则跳过）；直接 spawn mediakit-cli.exe，argv 传 JSON，绕开 PowerShell 转义。
 * 日志：stdout（重定向到日志文件）。用法：node scripts/transcode-big-videos.cjs
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const BASE = 'E:\\WXWork\\1688857708791124\\WeDrive\\灰度科技\\公司资料\\技术资料';
const CSV = path.join(ROOT, 'tmp', 'wedrive-led-operation-videos-final.csv');
const OUT = path.join(ROOT, 'tmp', 'video-720p');
const EXE = 'C:\\Users\\HD\\AppData\\Local\\Doubao\\User Data\\Default\\sandbox_envs_dir\\envs\\1c15eb48-fcd5-4a9d-96da-aca2171dcacd\\override_dlcs\\mediakit-cli.exe';
const VIDEO_PARAMS = { codec: 'h264', scale_type: 1, scale_long: 1280, scale_mode: 0, bitrate_mode: 'abr', bitrate_kbps: 1800 };

function parseCsv(text){const rows=[];let row=[],cur='',q=false;for(let i=0;i<text.length;i++){const c=text[i];if(q){if(c=='"'){if(text[i+1]=='"'){cur+='"';i++;}else q=false;}else cur+=c;}else if(c=='"')q=true;else if(c==','){row.push(cur);cur='';}else if(c=='\n'){row.push(cur.replace(/\r$/,''));rows.push(row);row=[];cur='';}else if(c!='\r')cur+=c;}if(cur.length||row.length){row.push(cur.replace(/\r$/,''));rows.push(row);}return rows.filter(r=>r.length>=4&&r[0]!=='Cat');}

function run(args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const t = Date.now();
    const p = spawn(EXE, args, { windowsHide: true });
    let out = '', err = '';
    p.stdout.on('data', d => out += d.toString('utf8'));
    p.stderr.on('data', d => err += d.toString('utf8'));
    const timer = setTimeout(() => { p.kill(); reject(new Error('超时 ' + timeoutMs + 'ms')); }, timeoutMs);
    p.on('close', code => { clearTimeout(timer); code === 0 ? resolve({ out, err, secs: ((Date.now()-t)/1000).toFixed(0) }) : reject(new Error('exit ' + code + ': ' + (err || out).slice(-300))); });
    p.on('error', reject);
  });
}
function parseJsonTail(s) {
  const i = s.indexOf('{'); const j = s.lastIndexOf('}');
  if (i < 0 || j <= i) throw new Error('无 JSON 输出: ' + s.slice(-200));
  return JSON.parse(s.slice(i, j + 1));
}
function download(url, dest) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https:') ? https : http;
    const doReq = u => lib.get(u, r => {
      if ([301,302,303,307,308].includes(r.statusCode) && r.headers.location) { r.resume(); return doReq(new URL(r.headers.location, u).toString()); }
      if (r.statusCode !== 200) { r.resume(); return reject(new Error('HTTP ' + r.statusCode)); }
      const ws = fs.createWriteStream(dest);
      r.pipe(ws);
      ws.on('finish', () => ws.close(() => resolve(fs.statSync(dest).size)));
      ws.on('error', reject);
    }).on('error', reject);
    doReq(url);
  });
}
async function transcodeOne(name, src) {
  const dest = path.join(OUT, name);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 1048576) {
    console.log(`跳过(已转) ${(fs.statSync(dest).size/1048576).toFixed(1)}MB  ${name}`);
    return { name, status: 'skip' };
  }
  console.log(`[提交] ${name}`);
  const sub = await run(['video','transcode-video','--video-url',src,'--container-format','MP4','--video',JSON.stringify(VIDEO_PARAMS)], 900000);
  const taskId = parseJsonTail(sub.out).task_id;
  console.log(`  task_id=${taskId}（提交${sub.secs}s），轮询转码…`);
  const poll = await run(['shared','query-task','--task-id',taskId,'--poll-complete'], 900000);
  const res = parseJsonTail(poll.out);
  if (res.status !== 'completed' || !res.video_url) throw new Error('转码未完成: ' + poll.out.slice(-200));
  const bytes = await download(res.video_url, dest);
  console.log(`[完成] ${res.resolution} ${res.duration?.toFixed(0)}s → ${(bytes/1048576).toFixed(1)}MB  ${name}`);
  return { name, status: 'done', mb: +(bytes/1048576).toFixed(1), resolution: res.resolution };
}
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const rows = parseCsv(fs.readFileSync(CSV, 'utf8').replace(/^﻿/, '')).filter(r => Number(r[1]) >= 100);
  console.log(`待转码大视频 ${rows.length} 个，目标 720p/H264/1800kbps`);
  const results = [];
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < rows.length; i++) {
    const [cat, mbS, name, rel] = rows[i];
    const src = BASE + rel;
    console.log(`\n=== ${i+1}/${rows.length} 源${mbS}MB [${cat}] ${name} ===`);
    let done = false;
    for (let attempt = 1; attempt <= 3 && !done; attempt++) {
      try { results.push(await transcodeOne(name, src)); done = true; }
      catch (e) {
        const em = e.message.split('\n')[0];
        console.error(`[尝试${attempt}/3失败] ${name} → ${em}`);
        if (attempt < 3) { console.log('  云端可能限流，等待 25s 后重试…'); await sleep(25000); }
        else { console.error('[放弃]', name); results.push({ name, status: 'fail', error: e.message }); done = true; }
      }
    }
  }
  const ok = results.filter(r => r.status !== 'fail').length, fail = results.filter(r => r.status === 'fail');
  fs.writeFileSync(path.join(ROOT, 'tmp', 'transcode-big-result.json'), JSON.stringify(results, null, 2), 'utf8');
  console.log(`\n全部结束：成功/跳过 ${ok}，失败 ${fail.length}`);
  if (fail.length) { console.log('失败清单：'); fail.forEach(f => console.log('  - ' + f.name + ' :: ' + f.error)); process.exit(1); }
})();
