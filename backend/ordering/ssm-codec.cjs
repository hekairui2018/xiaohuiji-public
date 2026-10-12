"use strict";
// 小灰机 · HDSet .ssm 连屏文件 解析/校验（V4.0.38，44/38 包新格式）
//
// 帧布局（真机逐包取证，见 docs/ssm格式取证-20260915.md 第十一~十三节）：
//   frame = 8字节头(55 55 55 55 55 55 55 D5) + payload + CRC32LE(4)
//   CRC 范围 frame[8 .. len-4]，poly=0xEDB88320 反射，初值/异或出 = 0xFFFFFFFF
// payload：
//   pl[0] = 类型   0x01 短包(25B) / 0x02 大表(521B)
//   pl[1] = 网口号 (1-based：口1=1 口2=2 口3=3 口4=4；全局表=0/255)
//   pl[4] = kind   0x05 INDEX 序号表 / 0x15 GEOM 几何表 / 0x52 每口区域表 / 3,7 封口短包 ...
//   大表头 [02,net,ff,00,kind,00,00,02]；记录从 payload offset 8 起，每条 8B = 4×u16LE
//
// 多网口分段（fourports-hTL.ssm，ConnectPartRange=21,37，38 包）：
//   前段 #2-#5   kind=0x52 每口区域/全局偏移表，首字=(net<<8)|2 (258/514/770/1026)
//   连接段每网口一组（net=1..4）：
//     [net 起始短包 kind3 首字=net]  (仅第1口带广播起始 #21)
//     BIG net kind=0x05 INDEX（每卡一条 + 尾 [..,0]）
//     BIG net kind=0x15 GEOM （每卡一条，按走线 S→E 顺序）
//     short net kind=3 param=2 首字=(net<<8)|1 (257/513/769/1025)
//     short net kind=7     首字=(net<<8)|1
//   空网口只有 kind3/kind7 两条封口短包，无 INDEX/GEOM 大表。
//
// GEOM(kind15) 记录 = [X, Y, H, W]（u16LE，注意后两位是 高,宽），口内相对仿射坐标；
//   h-TL 3×3、卡 W×H=344×256 实测：X=col*H (0/256/512)，Y=row*H + col*(W-H) (W-H=88)，
//   记录按 h-TL 蛇形访问序排列；v-BL 单列记录自下而上。
// INDEX(kind05) 记录 = [X', Y, 0, 5] + 尾 [..,0]，X'=GEOM.X 加蛇形小偏移(344×256 卡为 +8/列)。
// 卡物理全局偏移（每口阵列原点 X0/Y0）存 kind=0x52 区域表，GEOM 本身是口内相对坐标。

const fs = require("fs");

// ---- CRC32 (zlib/PNG 同款，反射) ----
let CRC_TABLE = null;
function buildTable() {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
}
function crc32(buf) {
  if (!CRC_TABLE) CRC_TABLE = buildTable();
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function u16(b, o) { return b.readUInt16LE(o); }

// 解析一帧 base64 Packet → { raw, pl, type, net, kind, crcOk, records, words }
function parseFrame(b64) {
  const raw = Buffer.from(b64, "base64");
  if (raw.length < 13) return { raw, pl: raw, type: null, net: null, kind: null, crcOk: null };
  const pl = raw.slice(8, raw.length - 4);
  const wantCrc = raw.readUInt32LE(raw.length - 4);
  const gotCrc = crc32(raw.slice(8, raw.length - 4));
  const type = pl[0];
  const net = pl[1];
  const kind = pl[4];
  const out = { raw, pl, type, net, kind, crcOk: wantCrc === gotCrc };
  if (type === 0x02 && (kind === 0x05 || kind === 0x15 || kind === 0x52)) {
    const records = [];
    for (let o = 8; o + 8 <= pl.length; o += 8) {
      const r = [u16(pl, o), u16(pl, o + 2), u16(pl, o + 4), u16(pl, o + 6)];
      if (r.some(v => v !== 0)) records.push(r);
    }
    out.records = records;
  } else if (type === 0x01) {
    const words = [];
    for (let o = 0; o + 2 <= pl.length; o += 2) words.push(u16(pl, o));
    out.words = words;
  }
  return out;
}

// 解析整个 .ssm（路径或 XML 字符串或 Buffer）
function parseSsm(input) {
  let xml = input;
  if (Buffer.isBuffer(input)) xml = input.toString("utf8");
  else if (typeof input === "string" && /[\\/]/.test(input) && fs.existsSync(input))
    xml = fs.readFileSync(input, "utf8");
  xml = String(xml);

  const attr = (name) => {
    const m = xml.match(new RegExp(name + '="([^"]*)"'));
    return m ? m[1] : null;
  };
  const attrs = {
    version: attr("Version"),
    connectPartRange: attr("ConnectPartRange"),
  };

  const re = /<Packet\b[^>]*?Value="([A-Za-z0-9+/=]+)"[^>]*?>/g;
  const packets = [];
  let m;
  while ((m = re.exec(xml))) packets.push(parseFrame(m[1]));

  // 按网口归集连接段
  const ports = new Map();
  packets.forEach((p, i) => {
    if (p.kind !== 0x05 && p.kind !== 0x15) return;
    const net = p.net;
    if (!ports.has(net)) ports.set(net, { net, index: [], geom: [], indexPkt: null, geomPkt: null });
    const po = ports.get(net);
    if (p.kind === 0x05) { po.index = p.records; po.indexPkt = i; }
    if (p.kind === 0x15) { po.geom = p.records; po.geomPkt = i; }
  });

  return {
    attrs,
    packetCount: packets.length,
    packets,
    ports: [...ports.values()].sort((a, b) => a.net - b.net),
  };
}

module.exports = { parseSsm, parseFrame, crc32 };

// CLI: node ssm-codec.cjs <file.ssm>
if (require.main === module) {
  const f = process.argv[2];
  if (!f) { console.error("usage: node ssm-codec.cjs <file.ssm>"); process.exit(1); }
  const r = parseSsm(f);
  console.log("file=", f);
  console.log("attrs=", JSON.stringify(r.attrs), "packets=", r.packetCount);
  let crcBad = 0;
  r.packets.forEach((p, i) => {
    if (p.crcOk === false) crcBad++;
    const kn = p.kind === 0x05 ? "INDEX" : p.kind === 0x15 ? "GEOM" :
               p.kind === 0x52 ? "REGION" : "kind" + p.kind;
    const tn = p.type === 0x02 ? "BIG" : p.type === 0x01 ? "short" : "t" + p.type;
    if (p.type === 0x02 && p.records)
      console.log(`#${i} ${tn} net${p.net} ${kn} recs=${p.records.length} crc=${p.crcOk} ` +
        p.records.map(x => `[${x.join(",")}]`).join(" "));
    else if (p.type === 0x01)
      console.log(`#${i} ${tn} net${p.net} ${kn} crc=${p.crcOk} words=[${(p.words || []).join(",")}]`);
  });
  console.log("crcBad=", crcBad);
  r.ports.forEach(po =>
    console.log(`port${po.net}: INDEX ${po.index.length}rec (#${po.indexPkt})  GEOM ${po.geom.length}rec (#${po.geomPkt})`));
}
