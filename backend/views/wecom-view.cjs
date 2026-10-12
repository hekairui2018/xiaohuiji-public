// ============================================================================
// wecom-view.cjs —— 企业微信「展示层」
// 职责（单一）：把 /api/ai/chat 的结构化回答（pyramid / clarify / reply）翻译成
//   1) markdown 正文（企微智能机器人支持标题/加粗/列表/引用/分割线/表格，≤20480 字节）
//   2) button_interaction 按钮交互卡片（承载 followUp / quickOptions 快捷选项）
// 业务层只产出结构化数据，本文件只负责“怎么在企业微信里显示”，不做检索与判断。
// 网页端继续用 pyramid 自行渲染，互不影响。
// ============================================================================

"use strict";

const MAX_BUTTONS = 6;          // 企微按钮交互卡片单卡按钮上限保守取 6
const MAX_REFERENCES = 3;       // pyramid.references 里最多列几条相关案例，避免冗长
const MAX_RELATED_CASES = 5;    // 售后主案例之外，企微再列匹配度最高的几条相关案例供参考（不占回复序号）
// 企微客户在手机外网，文档链接必须是绝对外网地址（花生壳入口 → 本地/OSS），可用环境变量覆盖
const EXTERNAL_BASE = String(process.env.EXTERNAL_BASE || "http://9vh47rq28469.vicp.fun").replace(/\/+$/, "");

// 把正文里一行“· 规格书：a.pdf、b.pdf”纯文件名替换成可点 markdown 链接（点击直接打开 PDF，不跳网页）。
// pairs: [{name,url}]（走OSS时url为https绝对地址直接用；切回本地时为 /official-files/.. 相对路径，再拼花生壳EXTERNAL_BASE）。
function linkSpecLine(text, pairs) {
  if (!Array.isArray(pairs) || !pairs.length) return text;
  const line = "· 规格书：" + pairs.slice(0, 2)
    .map((p) => { const u = /^https?:\/\//.test(p.url) ? p.url : EXTERNAL_BASE + p.url; return `[${p.name}](${u})`; })
    .join("、");
  return String(text).replace(/^·\s*规格书：.*$/m, () => line);
}

function clean(s) {
  return String(s == null ? "" : s).replace(/\s+/g, " ").trim();
}

// 多行正文（配单方案等）：逐行收紧行内空白、压掉连续空行，但保留换行与每一行信息——
// 既不像 clean 那样把整篇压成一行，也不按关键词删行（企微配单与网页同源，内容不砍）。
function multiline(s) {
  return String(s == null ? "" : s)
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter((l, i, arr) => !(l === "" && (i === 0 || arr[i - 1] === "")))
    .join("\n")
    .trim();
}

// 配单网口折叠（仅企微展示层）：逐口走线超过 PORT_FOLD_AT 行时，只留前 PORT_SHOW_HEAD 行，
// 其余折叠成一句并给网页深链（?q= 打开即自动重算同一份完整方案）；网页端不经过本文件、始终全量。
// 逐口行特征：以 "- 网口N：" 开头（网口后紧跟序号数字）；"网口：N路主用…" 汇总头、模组尺寸等收尾行保留。
const PORT_FOLD_AT = 16;     // ≤16 口（含 VP1620S）完整显示，不折叠
const PORT_SHOW_HEAD = 12;   // 超过则只展示前 12 路
function collapseOrderingPorts(text, q) {
  const lines = String(text || "").split("\n");
  const portIdx = [];
  lines.forEach((l, i) => { if (/^\s*[-·*]?\s*网口\s*\d+\s*[：:]/.test(l)) portIdx.push(i); });
  if (portIdx.length <= PORT_FOLD_AT) return text;
  const head = new Set(portIdx.slice(0, PORT_SHOW_HEAD));
  const firstDrop = portIdx[PORT_SHOW_HEAD];
  const total = portIdx.length;
  const more = total - PORT_SHOW_HEAD;
  const link = q
    ? `> 其余 ${more} 路网口走线已折叠，[点这里在网页版查看全部 ${total} 路网口与拓扑图](${EXTERNAL_BASE}/?q=${encodeURIComponent(q)})`
    : `> 其余 ${more} 路网口走线已折叠，可在网页版查看完整方案（共 ${total} 路）`;
  const out = [];
  lines.forEach((l, i) => {
    if (portIdx.includes(i)) {
      if (head.has(i)) out.push(l);
      else if (i === firstDrop) out.push(link); // 在第 13 路原位置放折叠提示，后续逐口行跳过、收尾行保留
      return;
    }
    out.push(l);
  });
  return out.join("\n");
}

// 售后金字塔 → 企微 markdown
function pyramidToMarkdown(py) {
  if (!py) return "";
  const L = [];
  const conclusion = clean(py.conclusion);
  if (conclusion) {
    L.push("**结论**");
    L.push(`> ${conclusion}`);
    L.push("");
  }
  const scene = clean(py.scene);
  if (scene) {
    L.push("**现场情况**");
    L.push(`> ${scene}`);
    L.push("");
  }
  const steps = Array.isArray(py.steps) ? py.steps.filter((s) => clean(s.action)) : [];
  if (steps.length) {
    L.push(`**这样解决（按成功率从高到低，共 ${steps.length} 步）**`);
    steps.forEach((s, i) => {
      let line = `${i + 1}. ${clean(s.action)}`;
      const verify = clean(s.verify);
      if (verify) line += `（${verify}）`;
      L.push(line);
    });
    L.push("");
  }
  const fallback = clean(py.fallback);
  if (fallback) {
    L.push(`> ${fallback}`);
    L.push("");
  }
  const refs = (Array.isArray(py.references) ? py.references : []).slice(0, MAX_REFERENCES);
  if (refs.length) {
    L.push("**相关历史案例**");
    refs.forEach((r) => L.push(`- ${clean(r.title || r.id)}`));
    L.push("");
  }
  const source = clean(py.source);
  if (source) {
    L.push("---");
    L.push(`📎 来源：${source}`);
  }
  return L.join("\n").trim();
}

// 售后“其他高匹配案例”：业务层 candidates 已按 同硬件→同现象→相关、组内匹配度降序 排好并剔除主案例，
// 企微不能点折叠表，取前 N 条平铺；编号紧随测试引导（测试引导占 1)2)，案例从 3 起），客户回编号经桥还原成
// [CASE_DETAIL:案例号]，核心按 ID 直取该案例完整解法。
function getRelatedCases(payload) {
  return (Array.isArray(payload && payload.candidates) ? payload.candidates : [])
    .filter(Boolean)
    .slice(0, MAX_RELATED_CASES);
}
function caseHeadParts(c) {
  const pitch = ((c.module && c.module.pitches) || []).join("/");
  const chips = [...(c.driverChips || []), ...(c.decoderChips || [])]
    .filter((v, i, a) => v && a.indexOf(v) === i).join("+");
  const cards = [...(c.senderCards || []), ...(c.receiverCards || [])].filter(Boolean).join("/");
  return [pitch, chips, cards].filter(Boolean).join(" ");
}
function casePhen(c) {
  let phen = String(c.phenomenon || (c.detail && c.detail.title) || "").replace(/\s+/g, "").trim();
  if (phen.length > 30) phen = phen.slice(0, 30) + "…";
  return phen;
}
// 序号映射用短标签（桥只取 value，标签仅备查），完整现象以正文案例块为准
function caseOptionLabel(c) {
  const head = caseHeadParts(c);
  const sub = c.subCategory ? `${c.subCategory} ` : "";
  return `${sub}${head}`.trim().slice(0, 20) || `案例 ${c.id}`;
}
function relatedCasesBlock(cases, startIdx) {
  if (!Array.isArray(cases) || !cases.length) return "";
  const L = [`**其他高匹配案例 ${cases.length} 条（回复编号看完整解决办法）**`];
  cases.forEach((c, i) => {
    const head = caseHeadParts(c);
    const sub = c.subCategory ? `${c.subCategory}：` : "";
    L.push(`${startIdx + i}）${head ? `［${head}］` : ""}${sub}${casePhen(c)}`);
  });
  return L.join("\n");
}

// 企微点不了按钮：业务层 followUp.tip 是写给网页可点按钮的（“点这里/点下面/点选…”），
// 搬到企微要改成“回复数字”语义，否则客户会去找一个点不动的东西。网页端不经过本文件、按钮原样保留。
// 统一去掉句尾标点，调用方再决定怎么接“回复数字：”。
function wecomTipText(tip) {
  let t = clean(tip || "");
  if (!t) return "";
  // 句末“点这里/点此”是无宾语的纯指代指令，连同前面的逗号整段删掉（由调用方统一加“回复数字：”）
  t = t.replace(/[，,、\s]*(点击这里|点这里|点此)[^，。；;：:\n]*[：:]?\s*$/, "");
  // 带宾语的点击动词改写成“选”：点选最接近的现象→选最接近的现象；点下面→选一项
  t = t.replace(/点下面|点选下面|选下面/g, "选一项");
  t = t.replace(/点选|点击|轻点|点此/g, "选");
  t = t.replace(/[：:，,。、\s]+$/g, "");
  return t.trim();
}

// 收集本轮可点选项：优先 followUp.options，其次 clarify 的 quickOptions
function collectOptions(payload, caseOptions) {
  const opts = [];
  const push = (arr) => {
    (arr || []).forEach((o) => {
      if (!o) return;
      const label = clean(o.label != null ? o.label : o);
      const value = clean(o.value != null ? o.value : o.label != null ? o.label : o);
      if (label && !opts.some((x) => x.label === label)) opts.push({ label, value, ...(o.kind ? { kind: o.kind } : {}) });
    });
  };
  if (payload.followUp) push(payload.followUp.options);
  push(caseOptions); // 售后相关案例紧随测试引导之后，编号连续（1)2) 测试引导，3 起为案例）
  push(payload.quickOptions);
  // 售前：近似型号、相近芯片也做成可点按钮（排在 followUp 之后，总量封顶，避免相似型号在企微“消失”）
  const pre = payload.presales;
  if (pre) {
    const extra = [];
    (pre.related || []).forEach((o) => extra.push({ label: o.label || o.name, value: o.q || o.label || o.name }));
    const nearby = (pre.chipFirmware && pre.chipFirmware.nearby) || [];
    nearby.forEach((o) => extra.push({ label: o.chip, value: o.q || o.chip }));
    push(extra);
  }
  // 返回全部选项：文字“回复序号”行与桥接序号映射需要完整列表（售后两级选芯片时一级有十几个）；
  // 可点按钮卡的 6 个上限在 buildButtonCard 调用处再截取。
  return opts;
}

// 选项 → 企微按钮交互卡片；key 用序号，真实 value 通过 wecomOptions 同序回传给桥接做映射
function buildButtonCard(options, tip) {
  if (!options.length) return null;
  return {
    card_type: "button_interaction",
    main_title: {
      title: "下一步（点选即可，不用打字）",
      desc: clean(tip) || "点最接近你现场的一项，我继续精确匹配",
    },
    button_list: options.map((o, i) => ({ text: o.label, key: `opt_${i}`, style: 1 })),
    task_id: `xhj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  };
}

// 选型清单（和网页“选型清单”卡片同源，都取 ordering.bom）：只列模组/接收卡/控制器等已确定数量；无 bom 返回空串。
// 备用模组/接收卡、网线、电源等待定料不再向客户展示“另需现场确认”行（2026-09-26 去掉）。
const BOM_CATEGORY_CN = { module: "模组", receiver: "接收卡", controller: "控制器/播放盒", cabinet: "箱体" };
function selectionBlock(bom) {
  if (!bom || !Array.isArray(bom.items) || !bom.items.length) return "";
  const lines = bom.items.map((it) => {
    const name = BOM_CATEGORY_CN[it.category] || it.category || "";
    const qty = (it.quantity != null && it.quantity !== "") ? `${it.quantity} ${it.unit || ""}`.trim() : "";
    return `> ${name}：${it.model || ""}${qty ? `　${qty}` : ""}`;
  });
  return ["**选型清单**", "", ...lines].join("\n");
}


// 主入口：给即将下发给 /api/ai/chat 的 payload 挂上 wecomMarkdown / wecomCard / wecomOptions
function attachWeCom(payload) {
  if (!payload || typeof payload !== "object") return payload;
  let markdown = "";
  let caseOptions = []; // 售后“其他高匹配案例”的下钻选项（编号映射用，不进末尾提示行）

  const isOrdering = payload.model === "local-ordering" || !!payload.ordering;
  if (payload.status === "clarify") {
    markdown = ["**需要补充一点信息**", "", `> ${clean(payload.clarifyQuestion)}`].join("\n");
  } else if (payload.pyramid && (payload.pyramid.conclusion || (payload.pyramid.steps || []).length)) {
    markdown = pyramidToMarkdown(payload.pyramid);
    // 主案例之后平铺“其他高匹配案例”，编号紧随测试引导（followUp 占前 N 个），回编号下钻完整解法；
    // 插在来源分隔线之前，保持 结论→解法→同类参考→来源 的顺序
    const relatedCases = getRelatedCases(payload);
    const followUpN = payload.followUp && Array.isArray(payload.followUp.options) ? payload.followUp.options.length : 0;
    const related = relatedCasesBlock(relatedCases, followUpN + 1);
    if (related) {
      caseOptions = relatedCases.map((c) => ({ label: caseOptionLabel(c), value: `[CASE_DETAIL:${c.id}]`, kind: "case" }));
      markdown = markdown.includes("\n---\n")
        ? markdown.replace("\n---\n", `\n\n${related}\n\n---\n`)
        : `${markdown}\n\n${related}`;
    }
  } else if (payload.reply) {
    if (isOrdering) {
      // 配单：企微与网页同源；multiline 规整空白，网口过多时仅企微折叠（网页端始终全量）
      const body = collapseOrderingPorts(multiline(payload.reply), payload.meta && payload.meta.q);
      const hasResult = /(推荐(同步|异步)方案|屏体：|模组：|接收卡|网口|箱体：|卡数：|先按箱体方案|先给可用参考|拓扑)/m.test(body);
      let head;
      if (!hasResult) {
        head = "**还需补一项才能出方案**"; // 信息不足、还没算出实质清单时，不叫“暂定方案”
      } else {
        const oState = payload.ordering?.state === "formal" ? "formal"
          : (payload.ordering?.state === "conflict" ? "conflict" : "provisional");
        head = oState === "formal" ? "**配单方案**"
          : oState === "conflict" ? "**数据有冲突，请先核对一项**"
          : "**配单方案（已留余量·供参考）**";
      }
      const bom = payload.ordering && payload.ordering.bom;
      // 与网页口径一致：常规屏/箱体方案都附“选型清单”确定项（模组/接收卡/控制器），企微不再缺这块
      const sel = selectionBlock(bom);
      markdown = [head, sel, body].filter(Boolean).join("\n\n");
    } else {
      // 售前产品/芯片固件/软件等纯文本回答：正文在业务层本就按字段逐行拼好（L.join("\n")），
      // 用 multiline 保留换行、只规整行内空白，企微里每个参数一行、和网页端一样整齐；
      // 不能用 clean——它会把所有换行压成空格，参数就挤成一长段。
      markdown = multiline(payload.reply);
    }
  }

  const options = collectOptions(payload, caseOptions);
  const isPresales = !!(payload.presales) || payload.model === "local-presales";
  const isRxTree = options.some((o) => String(o.value || "").includes("[RX_STILL]"));
  const tip = clean(payload.followUp ? payload.followUp.tip : "");
  // 案例下钻选项只在正文案例块以编号呈现，不进末尾“回复数字”提示行/按钮卡（避免与测试引导重复）；但仍保留在 wecomOptions 供桥按编号还原
  const visibleOptions = options.filter((o) => !o.kind);
  const card = buildButtonCard(visibleOptions.slice(0, MAX_BUTTONS), tip); // 可点按钮卡守平台上限

  // 选项文字版：企微不一定能下发可点卡片，统一让客户“回复序号”；售前再说明也可直接发完整型号。
  // 售后两级选芯片（厂家/芯片十几个）时序号逐行排，其它场景一行紧凑排。
  if (visibleOptions.length) {
    if (markdown) markdown += "\n\n";
    let header;
    if (isPresales) {
      header = "回复数字选型，或直接发完整型号查对应产品参数：";
    } else if (tip) {
      const tipText = wecomTipText(tip);
      const connector = /[？?！!]$/.test(tipText) ? "\n回复数字：" : "，回复数字：";
      header = tipText ? tipText + connector : "回复序号即可：";
    } else {
      header = "回复序号即可：";
    }
    const sep = isRxTree ? "\n" : "　";
    markdown += header + "\n" + visibleOptions.map((o) => `${options.indexOf(o) + 1}）${o.label}`).join(sep);
  }

  payload.wecomMarkdown = markdown.trim();
  payload.wecomCard = card;
  payload.wecomOptions = options; // [{label,value}] 全量，桥接按序号/opt_i 取回 value（按钮卡只用前 6）
  // 兼容老桥接：它只读顶层 reply；售后 pyramid / 反问原本没有 reply，这里用企微正文兜底。网页端读 pyramid，不受影响。
  if (!payload.reply && markdown.trim()) payload.reply = markdown.trim();
  return payload;
}

module.exports = { attachWeCom, pyramidToMarkdown, collectOptions, buildButtonCard, linkSpecLine, collapseOrderingPorts };
