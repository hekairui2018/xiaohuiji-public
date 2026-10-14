'use strict';
// Deterministic product/chip answer; shared by all presentation channels.
function createPresalesAnswer({aftersales,searchProducts,buildChipFirmware,enrichChipFirmware,leadIn,buildRelatedChips}) {
async function buildPresalesAnswer(message) {
  // 命中法则对标快查站搜索框：干净硬件词（整句无中文现象描述）先用“整串”搜，让完整型号精确命中的产品做主产品
  // （如 R5s Plus→HD-R5S Plus，而不是被拆词误取的 R5S；RB6→HD-RB6）；拆词 token 随后只补充同系列近似型号。
  const cleanHardwareQuery = !/[一-龥]/.test(String(message));
  const entityKeys = [...new Set([
    ...aftersales.extractProducts(message),
    ...(String(message).match(/\b\d{3,5}[A-Z]{0,2}\b/gi) || []),
  ])];
  const products = [];
  const seen = new Set();
  const addResults = (k) => searchProducts(k).forEach((r) => { if (!seen.has(r.name)) { seen.add(r.name); products.push(r); } });
  if (cleanHardwareQuery) addResults(String(message).trim()); // 整串优先：与快查站搜索框结果排序一致
  entityKeys.forEach(addResults);
  // 带现象的中文自然语句不整串搜（上面被 cleanHardwareQuery 门控跳过），只按提取出的型号 token 搜，
  // 避免整句被参数文本弱命中、冒出搜索框本不会给出的产品。
  let chipFirmware = null;
  try { chipFirmware = buildChipFirmware(message); } catch { /* ignore */ }
  if (!chipFirmware || !chipFirmware.hitCount) {
    for (const k of entityKeys) {
      try { const cf = buildChipFirmware(k); if (cf && cf.hitCount) { chipFirmware = cf; break; } } catch { /* ignore */ }
    }
  }
  // 短噪音：原 token 带字母小尾巴(如 6363q)精确查无、剥出的纯数字核能命中芯片固件 → 按核查并标记“推断”；
  // 只对芯片固件剥核(数字核稳定)，不据泛数字推产品(如 410 太泛易误配)。
  let inferredFrom = null;
  if (!products.length && !(chipFirmware && chipFirmware.hitCount)) {
    const rawTokens = [...new Set(entityKeys.concat(cleanHardwareQuery ? [String(message).trim()] : []))];
    for (const tok of rawTokens) {
      const mm = String(tok || "").match(/\d{3,5}/);
      if (!mm) continue;
      const core = mm[0];
      if (core === String(tok).replace(/[^A-Za-z0-9]/g, "")) continue; // 无尾巴=干净裸核，前面已精确查过
      let cf = null; try { cf = buildChipFirmware(core); } catch { cf = null; }
      if (cf && cf.hitCount) { chipFirmware = cf; inferredFrom = { raw: String(tok).trim(), core }; break; }
    }
  }
  if (!products.length && !(chipFirmware && chipFirmware.hitCount)) return null;
  // 主驱动芯片挂上“按接收卡型下载固件”（译码/借用芯片 firmwareFamily 为 null，enrich 自动不挂）
  try { enrichChipFirmware(chipFirmware); } catch { /* ignore */ }

  const L = [];
  // 拟人开场白：只点“主对象”（与正文一致：只平铺主产品/主芯片，其余型号转下方近似按钮），
  // 由大模型写一句陈述开场（按 key 缓存、同问同答）；LLM 不可用或不合格则不出开场、直接进正文，客户无感。
  // 下方参数/固件/规格书正文全部仍是本地确定性数据，一字不交给模型。
  const leadLabels = [];
  if (products[0]) leadLabels.push(`产品 ${String(products[0].name).replace(/^HD-/, "")}`);
  if (chipFirmware && chipFirmware.hitCount) {
    const cn = String(chipFirmware.primary.chip).split(/[\/\n]/).map((s) => s.trim()).filter(Boolean);
    if (cn[0]) leadLabels.push(`芯片 ${cn[0]}`);
  }
  if (leadLabels.length) {
    let kind = "product";
    let leadName = products[0] ? String(products[0].name).replace(/^HD-/, "") : "";
    if (chipFirmware && chipFirmware.hitCount) {
      const ff = (chipFirmware.primary && chipFirmware.primary.facts) || [];
      kind = ff.some((x) => x && x.label === "芯片类型") ? "chip-decoder" : "chip-driver";
      leadName = String((chipFirmware.primary && chipFirmware.primary.chip) || "").split(/[\/\n]/)[0].trim() || leadName;
    }
    const lead = leadIn(kind, leadName);
    if (lead) L.push(lead);
  }
  // 正文只平铺权重最高的 1 个产品，避免一次堆一大团；其余型号转成下方“近似型号”可点按钮
  const mainProduct = products[0] || null;
  if (mainProduct) {
    L.push(`\n【${mainProduct.name}】`);
    // 参数与快查站卡片完全同源（features）：类型/系列/带载/分辨率/输入接口/输出接口，最后一行才是产品特点；
    // 不再用残缺重复的 keyParams（那套会把音频当接口、丢掉视频输入、还混入 U盘播放分辨率）。
    const f = mainProduct.features || {};
    if (f.series) L.push(`· 类型：${f.series}`);
    if (f.color) L.push(`· 系列：${f.color}`);
    if (f.load) L.push(`· 带载：${f.load}`);
    if (f.resolution) L.push(`· 分辨率：${f.resolution}`);
    if (f.inputs) L.push(`· 输入接口：${f.inputs}`);
    if (f.outputs) L.push(`· 输出接口：${f.outputs}`);
    const detail = mainProduct.featureDetail || f.highlights || "";
    if (detail) L.push(`· 产品特点：${detail}`); // 小灰机给一段专业介绍，比快查站的短标签更丰满
    if (mainProduct.featureAdv) L.push(`· 亮点：${mainProduct.featureAdv}。`); // 竞品级亮点独立成行、标签左置顶
    const files = mainProduct.specFiles || [];
    if (files.length) L.push(`· 规格书：${files.slice(0, 2).join("、")}`); // 网页端按纯文件名渲染可点链接，企微端在展示层替换为 markdown 链接
  }
  if (chipFirmware && chipFirmware.hitCount) {
    L.push(`\n【${chipFirmware.primary.chip} 芯片固件】`);
    // facts 内部保留换行（异步卡尾缀多组各占一行），不再压成一行
    (chipFirmware.primary.facts || []).forEach((x) => L.push(`· ${x.label}：${x.text}`));
  }
  // 故障引导句单独成字段：网页放气泡框外，企微等纯文本通道再拼回 reply 末尾
  const presalesHint = ""; // 售前参数答案不再机械追加售后尾巴（已给答案还挂故障提示，体验差）
  // 近似型号：主产品之外的命中型号 + 同系列型号，去重并排除主产品后封顶 10 个，供前端渲染成可点按钮
  const related = [];
  const relSeen = new Set();
  const pushRel = (label, q) => { if (!label || relSeen.has(label)) return; relSeen.add(label); related.push({ label, q: q || label }); };
  products.slice(1).forEach((p) => pushRel(p.name, p.name));
  (products.length ? buildRelatedChips(products, entityKeys[0] || message) : []).forEach((c) => pushRel(c.label, c.q));
  const relatedModels = related.filter((c) => c.label !== (mainProduct && mainProduct.name)).slice(0, 10);
  // 中文语气/符号小尾巴(如 6363阿)：芯片已命中但原串不是规范裸丝印写法，同样声明推断
  if (!inferredFrom && chipFirmware && chipFirmware.hitCount) {
    const core = (String((chipFirmware.primary && chipFirmware.primary.chip) || "").match(/\d{3,5}/) || [])[0];
    const rawTrim = String(message).trim().replace(/\[[A-Z_]+(?::[^\]]*)?\]/g, "").replace(/\s+/g, "");
    if (core && rawTrim && rawTrim.includes(core)) {
      // 形态像规范裸丝印(前缀+数字核+0~2字母尾)且纯字母数字时，只有完整 token 真在芯片/产品库才算合法；
      // 完整 token 查无、纯数字核却命中(如 6363q)，或夹了中文/符号尾巴(如 6363阿)，都按噪声推断并声明。
      const cleanCanon = new RegExp("^(?:[A-Z]{0,4})?" + core + "[A-Z]{0,2}$", "i").test(rawTrim);
      const legal = cleanCanon && /^[A-Za-z0-9]+$/.test(rawTrim)
        && (aftersales.extractChips(rawTrim).length > 0 || searchProducts(rawTrim).length > 0);
      if (!legal) inferredFrom = { raw: String(message).trim(), core };
    }
  }
  if (inferredFrom) L.unshift(`你发的“${String(inferredFrom.raw).slice(0, 16)}”我按 ${inferredFrom.core} 来查了，若不是这个型号/丝印，请补充完整写法。`);
  return { reply: L.join("\n"), hint: presalesHint, products: mainProduct ? [mainProduct] : [], chipFirmware, related: relatedModels };
}


return buildPresalesAnswer;
}
module.exports={createPresalesAnswer};
