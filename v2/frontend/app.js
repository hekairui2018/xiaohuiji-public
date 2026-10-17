// 展示层：快查站前端逻辑
// 职责：页面交互、调用后端 API、按契约渲染响应
// 禁止：意图分类、型号识别、知识检索（这些在后端）

const aiInput = document.getElementById("aiInput");
const aiSendBtn = document.getElementById("aiSendBtn");
const aiMessages = document.getElementById("aiMessages");

// V2资料搜索使用/wiki；/quick仅兼容旧链接，客服问答保持/huiai。
const VIEW_PATHS = { quick: "/wiki", ai: "/huiai" };
function viewFromPath() {
  const p = location.pathname.replace(/\/+$/, "") || "/";
  if (p === "/huiai") return "ai";
  if (p === "/wiki" || p === "/quick") return "quick";
  return localStorage.getItem("xhj_view") === "ai" ? "ai" : "quick";
}
// 统一视图切换：改 body 标记 + 记住偏好 + 同步顶部按钮 + 用 pushState 更新地址（opts.push=false 时只切不改地址，供初始化/ popstate / 吉祥物复用）
function applyView(view, opts) {
  const push = !opts || opts.push !== false;
  document.body.dataset.view = view;
  localStorage.setItem("xhj_view", view);
  document.querySelectorAll(".view-switch .vs-btn").forEach((b) =>
    b.classList.toggle("active", b.dataset.view === view));
  if (push) {
    const target = VIEW_PATHS[view] || "/wiki";
    if (location.pathname !== target) history.pushState({ view }, "", target);
  }
}
(function initViewSwitch() {
  applyView(viewFromPath(), { push: false });
  document.querySelectorAll(".view-switch .vs-btn").forEach((b) =>
    b.addEventListener("click", () => applyView(b.dataset.view)));
  window.addEventListener("popstate", () => applyView(viewFromPath(), { push: false }));
})();

// 售后会话历史：多轮反问时把已确认的现象/型号带给后端（元素 {role, content}）
let chatHistory = [];
function getSid() {
  if (window.__v2SessionId) return window.__v2SessionId;
  let s = localStorage.getItem("xhj_sid");
  if (!s) { s = "w-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); localStorage.setItem("xhj_sid", s); }
  return s;
}
// 自动化自测开关：URL 带 ?selftest=1 或 localStorage xhj_selftest=1 时，请求标记 web-selftest，
// 3791 质检后台据此把会话统一归并到「网页测试」专用框；正常客户/真人访问不带此标记，仍按设备 sid 归并
function isSelftestEnv() {
  try {
    if (new URLSearchParams(location.search).get("selftest") === "1") return true;
    return localStorage.getItem("xhj_selftest") === "1";
  } catch (e) { return false; }
}
// 分流路径累计回显：{ root:"原始问题", steps:["每步按钮label"] }，让客户看到自己选过什么；手动输入新问题时清空
let triagePath = null;
// 最近一轮“可按序号选择”的选项（followUp/quickOptions/售前相关），供键盘敲 1/2 时等价点按钮，15分钟过期
let lastNumericOptions = null;
// 从后端响应里提炼一段可被下一轮检索的纯文本（用于历史上下文）
function assistantTextOf(data) {
  if (data.status === "answer" && data.model === "v2-rules" && data.result && data.result.bom) {
    bubble.appendChild(renderV2Ordering(data.result));
  } else if (data.status === "answer" && data.pyramid) {
    const p = data.pyramid;
    return [p.conclusion, p.scene, ...(p.steps || []).map((s) => s.action), p.fallback].filter(Boolean).join(" ");
  }
  return data.clarifyQuestion || data.message || data.reply || "";
}

function addUserMessage(text, imageDataUrl) {
  const div = document.createElement("div");
  div.className = "ai-msg ai-msg-user";
  div.innerHTML = `<div class="ai-msg-bubble"></div>`;
  const bubble = div.querySelector(".ai-msg-bubble");
  if (imageDataUrl) {
    const im = document.createElement("img");
    im.className = "ai-msg-img";
    im.src = imageDataUrl;
    im.alt = "客户截图";
    bubble.appendChild(im);
  }
  if (text) {
    const t = document.createElement("div");
    t.className = "ai-msg-img-text";
    t.textContent = text;
    bubble.appendChild(t);
  }
  aiMessages.appendChild(div);
  aiMessages.scrollTop = aiMessages.scrollHeight;
}

function addAssistantLoading(label) {
  const div = document.createElement("div");
  div.className = "ai-msg ai-msg-assistant";
  div.id = "aiLoading";
  const lb0 = document.createElement("div");
  lb0.className = "ai-msg-bubble";
  lb0.textContent = label || "思考中…";
  div.appendChild(lb0);
  aiMessages.appendChild(div);
  aiMessages.scrollTop = aiMessages.scrollHeight;
  return div;
}

function removeLoading() {
  const el = document.getElementById("aiLoading");
  if (el) el.remove();
}

// 按 pyramid 契约渲染
function renderPyramid(pyramid) {
  const wrap = document.createElement("div");
  wrap.className = "pyramid";

  // 第一层：结论
  if (pyramid.conclusion) {
    const c = document.createElement("div");
    c.className = "pyramid-conclusion";
    c.textContent = pyramid.conclusion;
    wrap.appendChild(c);
  }

  // 第一层补充：权重最大案例的现场情况总结（供客户对照是不是同一种现场）
  if (pyramid.scene) {
    const sc = document.createElement("div");
    sc.className = "pyramid-scene";
    sc.innerHTML = `<span class="pyramid-scene-label">现场情况</span><span class="pyramid-scene-text"></span>`;
    sc.querySelector(".pyramid-scene-text").textContent = pyramid.scene;
    wrap.appendChild(sc);
  }

  // 第二层：步骤
  if (Array.isArray(pyramid.steps) && pyramid.steps.length) {
    const stepsWrap = document.createElement("div");
    stepsWrap.className = "pyramid-steps";
    const title = document.createElement("div");
    title.className = "pyramid-steps-title";
    title.textContent = "这样解决";
    stepsWrap.appendChild(title);
    const ol = document.createElement("ol");
    ol.className = "pyramid-step-list";
    pyramid.steps.forEach((step) => {
      const li = document.createElement("li");
      li.className = "pyramid-step";
      const action = document.createElement("div");
      action.className = "pyramid-step-action";
      action.textContent = step.action || "";
      li.appendChild(action);
      if (step.why) {
        const why = document.createElement("div");
        why.className = "pyramid-step-why";
        why.textContent = "为什么：" + step.why;
        li.appendChild(why);
      }
      // 通用验证语不逐步骤显示，统一放到兜底框
      const isGenericVerify = /做完观察画面是否恢复正常|恢复即可停在此步/.test(step.verify || "");
      if (step.verify && !isGenericVerify) {
        const verify = document.createElement("div");
        verify.className = "pyramid-step-verify";
        verify.textContent = "怎么验证：" + step.verify;
        li.appendChild(verify);
      }
      ol.appendChild(li);
    });
    stepsWrap.appendChild(ol);
    wrap.appendChild(stepsWrap);
  }

  // 解决办法下方标注首选案例来源（可追溯），不再显示黄色兜底卡
  if (pyramid.source) {
    const src = document.createElement("div");
    src.className = "pyramid-source";
    src.textContent = "来源：" + pyramid.source;
    wrap.appendChild(src);
  }

  // 参考案例
  if (Array.isArray(pyramid.references) && pyramid.references.length) {
    const refs = document.createElement("div");
    refs.className = "pyramid-refs";
    refs.textContent = "参考案例：" + pyramid.references.map((r) => r.title || r.id).join("、");
    wrap.appendChild(refs);
  }

  return wrap;
}

// 答案卡之下的“相关历史案例”可搜索表格：默认露8行，搜索框本地过滤，点行展开解决办法
const CASE_DEFAULT_SHOW = 8;
function caseRowText(c) {
  return [
    c.subCategory, c.phenomenon, (c.module.vendor || ""), (c.module.pitches || []).join(" "),
    c.driverChips.join(" "), c.decoderChips.join(" "),
    c.senderCards.join(" "), c.receiverCards.join(" "), c.id,
  ].join(" ").toUpperCase();
}
function caseCellText(parts) { const t = (parts || []).join(" / "); return t || "—"; }
function renderCaseDetail(c) {
  const d = c.detail || {};
  const box = document.createElement("div");
  box.className = "case-detail";
  const cause = String(d.finalCause || "").replace(/^【[^】]*】$/, "");
  const sol = String(d.solution || "").replace(/^【[^】]*】$/, "");
  let html = `<div class="case-detail-title">${escHtml(c.id)}｜${escHtml(d.title || c.phenomenon)}</div>`;
  if (cause) html += `<div class="case-detail-row"><span class="cd-label">根因</span><span>${escHtml(cause)}</span></div>`;
  if (sol) html += `<div class="case-detail-row"><span class="cd-label">解决</span><span class="cd-solution">${escHtml(sol)}</span></div>`;
  const ver = [...(d.softwareVersions || []), ...(d.firmwareVersions || [])];
  if (ver.length) html += `<div class="case-detail-row"><span class="cd-label">版本</span><span>${escHtml(ver.join(" / "))}</span></div>`;
  if (d.source && d.source.locator) html += `<div class="case-detail-src">出处：${escHtml(d.source.fileName || "")} · ${escHtml(d.source.locator)}</div>`;
  box.innerHTML = html;
  return box;
}
function renderCaseTable(cands) {
  if (!Array.isArray(cands) || !cands.length) return null;
  const wrap = document.createElement("div");
  wrap.className = "case-table-wrap";

  const head = document.createElement("div");
  head.className = "case-table-head";
  head.textContent = `相关历史案例 ${cands.length} 条（按匹配度排序，点一行看解决办法）`;
  wrap.appendChild(head);

  const filter = document.createElement("input");
  filter.className = "case-filter";
  filter.type = "text";
  filter.placeholder = "在这些案例里筛：芯片 / 型号 / P几 / 现象";
  wrap.appendChild(filter);

  const table = document.createElement("div");
  table.className = "case-table";
  wrap.appendChild(table);

  const moreBtn = document.createElement("button");
  moreBtn.type = "button";
  moreBtn.className = "case-more-btn";
  wrap.appendChild(moreBtn);

  const GROUP_LABEL = { sameHw: "该设备 / 芯片的其他问题", samePhen: "同类现象的其他案例", related: "其他相关案例" };
  const GROUP_ORDER = ["sameHw", "samePhen", "related"];
  // 后端已分组排序，这里保证顺序稳定
  const sorted = [...cands].sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group));
  let kw = "", showAll = false, openId = null;
  function draw() {
    const k = kw.trim().toUpperCase();
    let list = k ? sorted.filter((c) => caseRowText(c).includes(k)) : sorted;
    const visible = (showAll || k) ? list : list.slice(0, CASE_DEFAULT_SHOW);

    let html = `<div class="case-row case-row-head"><span>模组</span><span>驱动/译码</span><span>控制卡</span><span>现象</span></div>`;
    if (!visible.length) html += `<div class="case-empty">没有匹配的案例，换个词试试</div>`;
    let lastGroup = null;
    visible.forEach((c) => {
      if (c.group && c.group !== lastGroup && GROUP_LABEL[c.group]) {
        lastGroup = c.group;
        html += `<div class="case-group-label">${GROUP_LABEL[c.group]}</div>`;
      }
      const module = [(c.module.vendor || ""), (c.module.pitches || []).join("/")].filter(Boolean).join(" ") || "—";
      const chip = [c.driverChips.join("+"), c.decoderChips.length ? "译" + c.decoderChips.join("+") : ""].filter(Boolean).join(" / ") || "—";
      const card = [...c.senderCards.map((x) => "发送端" + x), ...c.receiverCards.map((x) => "接收端" + x)].join(" ") || "—";
      const open = openId === c.id;
      html += `<div class="case-row${open ? " case-row-open" : ""}" data-id="${escHtml(c.id)}">
        <span>${escHtml(module)}</span><span>${escHtml(chip)}</span><span>${escHtml(card)}</span><span class="case-row-phen">${escHtml(c.phenomenon)}</span></div>`;
      if (open) html += `<div class="case-detail-slot" data-slot="${escHtml(c.id)}"></div>`;
    });
    table.innerHTML = html;

    table.querySelectorAll(".case-row[data-id]").forEach((row) => {
      row.addEventListener("click", () => {
        const id = row.dataset.id;
        openId = openId === id ? null : id;
        draw();
        if (openId) {
          const c = cands.find((x) => x.id === openId);
          const slot = table.querySelector(`.case-detail-slot[data-slot="${openId}"]`);
          if (c && slot) slot.appendChild(renderCaseDetail(c));
        }
      });
    });

    if (k) { moreBtn.style.display = "none"; }
    else if (list.length > CASE_DEFAULT_SHOW) {
      moreBtn.style.display = "block";
      moreBtn.textContent = showAll ? "收起案例表" : `展开其余 ${list.length - CASE_DEFAULT_SHOW} 条`;
    } else { moreBtn.style.display = "none"; }
  }
  filter.addEventListener("input", () => { kw = filter.value; draw(); });
  moreBtn.addEventListener("click", () => { showAll = !showAll; draw(); });
  draw();
  return wrap;
}

function addAssistantMessage(data) {
  const div = document.createElement("div");
  div.className = "ai-msg ai-msg-assistant";
  const bubble = document.createElement("div");
  bubble.className = "ai-msg-bubble";
  let outsideHint = "";  // 售前故障引导句：渲染在白色气泡框外

  // 记录本轮“可按序号选择”的选项，顺序与企微一致：followUp → quickOptions → 售前相关/相近芯片；无则清空
  const _numOpts = [];
  if (data.followUp && Array.isArray(data.followUp.options)) _numOpts.push(...data.followUp.options);
  if (Array.isArray(data.quickOptions)) _numOpts.push(...data.quickOptions);
  if (data.presales) {
    (data.presales.related || []).forEach((o) => _numOpts.push({ label: o.label || o.name, value: o.q || o.label || o.name }));
    const _nearby = (data.presales.chipFirmware && data.presales.chipFirmware.nearby) || [];
    _nearby.forEach((o) => _numOpts.push({ label: o.chip, value: o.q || o.chip }));
  }
  if (data.result && data.result.resources && data.result.resources.view) {
    (data.result.resources.view.nearby || []).forEach(o => _numOpts.push({ label: o.chip, value: o.chip }));
  }
  lastNumericOptions = _numOpts.length ? { options: _numOpts, at: Date.now() } : null;

  if (data.status === "answer" && data.pyramid) {
    bubble.appendChild(renderPyramid(data.pyramid));
    const caseTable = renderCaseTable(data.candidates);
    if (caseTable) bubble.appendChild(caseTable);
    if (data.followUp && Array.isArray(data.followUp.options) && data.followUp.options.length) {
      bubble.appendChild(renderFollowUp(data.followUp));
    }
  } else if (data.status === "clarify") {
    const q = document.createElement("div");
    q.className = "clarify-question";
    q.textContent = data.clarifyQuestion || "请补充信息。";
    bubble.appendChild(q);
    if (Array.isArray(data.quickOptions) && data.quickOptions.length) {
      const opts = document.createElement("div");
      opts.className = "clarify-options";
      data.quickOptions.forEach((opt) => {
        const btn = document.createElement("button");
        btn.className = "clarify-option-btn";
        btn.textContent = (typeof opt === "string" ? opt : opt.label);
        btn.onclick = () => sendOption(opt);
        opts.appendChild(btn);
      });
      bubble.appendChild(opts);
    }
  } else if (data.model === "v2-rules" && data.status === "answer" && data.result && data.result.resources) {
    const resources = data.result.resources;
    if (resources.kind === "software") bubble.appendChild(renderSoftware({ items: resources.items, isList: resources.items.length !== 1 }));
    else if (resources.kind === "videos") bubble.appendChild(renderVideoAnswer(resources.items.map(v => ({ ...v, url: v.publicUrl }))));
    else if (resources.kind === "chips" && resources.view) {
      const card = document.createElement("div"); card.innerHTML = renderChipFirmwareCard(resources.view); bubble.appendChild(card);
      if (resources.view.nearby.length) bubble.appendChild(renderNearbyChips(resources.view.nearby));
    } else if (["firmware", "documents"].includes(resources.kind)) bubble.appendChild(renderV2ResourceLinks(resources));
    else bubble.textContent = data.reply;
  } else if (data.model === "local-ordering" && data.status === "answer") {
    bubble.appendChild(renderOrdering(data));  // 配单：选型清单 + 拓扑图 + 明细折叠
    if (data.followUp && Array.isArray(data.followUp.options) && data.followUp.options.length) {
      bubble.appendChild(renderFollowUp(data.followUp));
    }
  } else if (data.model === "local-software" && data.software && Array.isArray(data.software.items) && data.software.items.length) {
    bubble.appendChild(renderSoftware(data.software));  // 软件下载：用途 + OSS下载按钮 + 官网资料
  } else if (data.model === "local-software" && data.video && Array.isArray(data.video.items) && data.video.items.length) {
    bubble.appendChild(renderVideoAnswer(data.video.items));  // 操作/教学视频：内嵌在线播放 + 下载
  } else if (data.model === "local-presales" && data.reply) {
    bubble.appendChild(renderPresalesReply(data.reply, (data.presales && data.presales.products) || []));  // 每个【产品/芯片】块可折叠，规格书渲染成可点链接
    outsideHint = data.hint || "";
    const cf = data.presales && data.presales.chipFirmware;
    const nearby = cf && Array.isArray(cf.nearby) ? cf.nearby : [];
    if (nearby.length) bubble.appendChild(renderNearbyChips(nearby));
    const relModels = (data.presales && Array.isArray(data.presales.related)) ? data.presales.related : [];
    if (relModels.length) bubble.appendChild(renderRelatedModels(relModels));  // 其余命中/同系列型号做成可点按钮
  } else if (data.status === "escalate") {
    bubble.textContent = data.message || "已为你转接人工。";
    bubble.style.whiteSpace = "pre-wrap";  // 转人工话术含两段（结论+拆单块引导），保留换行
  } else if (data.reply) {
    bubble.textContent = data.reply;
  } else {
    bubble.textContent = "（无响应内容）";
  }

  div.appendChild(bubble);
  if (outsideHint) {
    const hintEl = document.createElement("div");
    hintEl.className = "ai-msg-hint";
    hintEl.textContent = outsideHint;  // 框外引导句，不放进白色气泡
    div.appendChild(hintEl);
  }
  aiMessages.appendChild(div);
  // 回答可能很长（结论+步骤+案例表），定位到本条回答开头，而不是滚到容器最底让客户往上翻
  const delta = div.getBoundingClientRect().top - aiMessages.getBoundingClientRect().top;
  aiMessages.scrollTop += delta - 6;
}

// 软件回答：单软件给一张完整卡片（操作视频在线看 + 中文说明书 + 下载）；多软件/全家桶给紧凑清单
function renderSoftware(sw) {
  const frag = document.createDocumentFragment();
  const items = sw.items || [];
  if (!sw.isList && items.length === 1) {
    frag.appendChild(buildSoftwareCard(items[0]));
    return frag;
  }
  const intro = document.createElement("div");
  intro.className = "sw-intro";
  intro.textContent = sw.isList
    ? "灰度 HD 软件全家桶（含手机 APP、云平台），点“视频/资料”看操作视频与说明书，也可以直接回复软件名："
    : "为你找到以下相关软件：";
  frag.appendChild(intro);
  frag.appendChild(buildSoftwareGroupedList(items, buildSoftwareRow));
  return frag;
}

// 手机 APP / 云平台入口（无 PC 下载器时）：网页版、App Store、安卓落地页 + 商店搜索提示
function buildMobileActions(s) {
  const frag = document.createDocumentFragment();
  const m = s.mobile;
  if (!m) {
    const nodl = document.createElement("span");
    nodl.className = "sw-no-dl";
    nodl.textContent = s.name + "为" + (s.line || "手机/云端应用") + "，无电脑下载器，请在手机应用商店搜索安装或查看上方说明书。";
    frag.appendChild(nodl);
    return frag;
  }
  const mk = (text, href) => {
    const a = document.createElement("a");
    a.className = "sw-btn-download sw-btn-sm";
    a.href = href; a.target = "_blank"; a.rel = "noopener";
    a.textContent = text;
    frag.appendChild(a);
  };
  if (m.webUrl) mk(m.webLabel || "网页版（免安装）", m.webUrl);
  if (m.iosUrl) mk(m.iosLabel || "iPhone 下载", m.iosUrl);
  if (m.androidUrl) mk(m.androidLabel || "安卓下载", m.androidUrl);
  if (m.storeHint) {
    const hint = document.createElement("span");
    hint.className = "sw-no-dl";
    hint.textContent = m.storeHint;
    frag.appendChild(hint);
  }
  return frag;
}

function buildSoftwareCard(s) {
  const card = document.createElement("div");
  card.className = "sw-card";
  const head = document.createElement("div");
  head.className = "sw-head";
  const name = document.createElement("span"); name.className = "sw-name"; name.textContent = s.name;
  const ver = document.createElement("span"); ver.className = "sw-ver"; ver.textContent = s.version || "";
  const tag = document.createElement("span"); tag.className = "sw-line-tag"; tag.textContent = s.line || "";
  head.append(name, ver, tag);
  card.appendChild(head);

  const purpose = document.createElement("div");
  purpose.className = "sw-purpose"; purpose.textContent = s.purpose;
  card.appendChild(purpose);

  // ① 顶部操作视频：内嵌播放器在线看（preload=metadata 不自动拉流，省流量），可下载，其余视频折叠切换
  const vids = s.videos || { primary: null, more: [] };
  if (vids.primary) {
    const vw = document.createElement("div");
    vw.className = "sw-video-wrap";
    const video = document.createElement("video");
    video.className = "sw-video";
    video.controls = true;
    video.preload = "metadata";
    video.setAttribute("playsinline", "");
    video.src = vids.primary.url;
    const vbar = document.createElement("div");
    vbar.className = "sw-video-bar";
    const vtitle = document.createElement("span");
    vtitle.className = "sw-video-title"; vtitle.textContent = vids.primary.name;
    const vdl = document.createElement("a");
    vdl.className = "sw-link sw-video-dl";
    vdl.href = vids.primary.url; vdl.target = "_blank"; vdl.rel = "noopener";
    vdl.setAttribute("download", vids.primary.name + ".mp4");
    vdl.textContent = "下载视频";
    vbar.append(vtitle, vdl);
    vw.append(video, vbar);
    card.appendChild(vw);

    if (vids.more && vids.more.length) {
      const det = document.createElement("details");
      det.className = "sw-more";
      const sum = document.createElement("summary");
      sum.textContent = `其余 ${vids.more.length} 个操作视频`;
      const box = document.createElement("div");
      box.className = "sw-vlist";
      vids.more.forEach((m) => {
        const b = document.createElement("button");
        b.type = "button"; b.className = "sw-vitem"; b.textContent = m.name;
        b.addEventListener("click", () => {
          video.src = m.url; video.load();
          vtitle.textContent = m.name;
          vdl.href = m.url; vdl.setAttribute("download", m.name + ".mp4");
          video.scrollIntoView({ behavior: "smooth", block: "center" });
        });
        box.appendChild(b);
      });
      det.append(sum, box);
      card.appendChild(det);
    }
  }

  // ② 中文使用说明书：可点胶囊（OSS 上 PDF，点开下载/查看）
  if (s.manuals && s.manuals.length) {
    const mwrap = document.createElement("div");
    mwrap.className = "sw-manuals";
    const lab = document.createElement("div");
    lab.className = "sw-sec-label"; lab.textContent = "中文使用说明书";
    const row = document.createElement("div");
    row.className = "sw-doc-row";
    s.manuals.forEach((m) => {
      const a = document.createElement("a");
      a.className = "sw-doc-link"; a.href = m.url; a.target = "_blank"; a.rel = "noopener";
      a.textContent = m.label;
      row.appendChild(a);
    });
    mwrap.append(lab, row);
    card.appendChild(mwrap);
  }

  // ③ 下载：有 PC 下载器给按钮；手机 APP / 云平台无下载器则灰字提示，不做空链接
  const actions = document.createElement("div");
  actions.className = "sw-actions";
  if (s.hasDownloader && s.downloadUrl) {
    const dl = document.createElement("a");
    dl.className = "sw-btn-download"; dl.href = s.downloadUrl; dl.target = "_blank"; dl.rel = "noopener";
    dl.textContent = "下载 " + s.name;
    actions.appendChild(dl);
  } else {
    actions.appendChild(buildMobileActions(s));
  }
  if (s.manualUrl) {
    const m = document.createElement("a");
    m.className = "sw-link"; m.href = s.manualUrl; m.target = "_blank"; m.rel = "noopener";
    m.textContent = s.manualLabel || "官网资料";
    actions.appendChild(m);
  }
  card.appendChild(actions);
  return card;
}

function buildSoftwareRow(s) {
  const row = document.createElement("div");
  row.className = "sw-list-item";
  const main = document.createElement("div");
  main.className = "sw-list-main";
  const title = document.createElement("div");
  title.className = "sw-list-title";
  const tname = document.createElement("span"); tname.className = "sw-name"; tname.textContent = s.name + " ";
  const tag = document.createElement("span"); tag.className = "sw-line-tag"; tag.textContent = s.line || "";
  title.append(tname, tag);
  const purpose = document.createElement("div");
  purpose.className = "sw-list-purpose"; purpose.textContent = s.purpose;
  main.append(title, purpose);
  const acts = document.createElement("div");
  acts.className = "sw-row-actions";
  const hasMedia = (s.videos && s.videos.primary) || (s.manuals && s.manuals.length);
  if (hasMedia) {
    const detail = document.createElement("button");
    detail.type = "button"; detail.className = "sw-btn-detail";
    detail.textContent = "视频/资料";
    detail.addEventListener("click", () => sendMessage(s.name));
    acts.appendChild(detail);
  }
  if (s.hasDownloader && s.downloadUrl) {
    const dl = document.createElement("a");
    dl.className = "sw-btn-download sw-btn-sm"; dl.href = s.downloadUrl; dl.target = "_blank"; dl.rel = "noopener";
    dl.textContent = "下载";
    acts.appendChild(dl);
  } else if (s.mobile) {
    const mb = document.createElement("button");
    mb.type = "button"; mb.className = "sw-btn-detail";
    mb.textContent = s.mobile.webUrl ? "网页/手机版" : "手机下载";
    mb.addEventListener("click", () => sendMessage(s.name));
    acts.appendChild(mb);
  } else {
    const nd = document.createElement("span");
    nd.className = "sw-row-nodl"; nd.textContent = "手机/云端";
    acts.appendChild(nd);
  }
  row.append(main, acts);
  return row;
}

// 软件全家桶清单：按后端给定分组（LED 主控 / 手机·云 / LCD）输出，组间加小标题；makeRow 负责每一行（问答区与分类页行内按钮行为不同）
const SW_GROUP_ORDER = ["led", "mobile", "lcd", "other"];
function buildSoftwareGroupedList(items, makeRow) {
  const wrap = document.createElement("div");
  wrap.className = "sw-list sw-list-grouped";
  const buckets = {};
  items.forEach((s) => {
    const key = s.group || "catalog";
    if (!buckets[key]) buckets[key] = { label: s.groupLabel || "软件与应用", rows: [] };
    buckets[key].rows.push(s);
  });
  [...SW_GROUP_ORDER, ...Object.keys(buckets).filter((key) => !SW_GROUP_ORDER.includes(key))].forEach((key) => {
    const b = buckets[key];
    if (!b || !b.rows.length) return;
    const h = document.createElement("div");
    h.className = "sw-group-title";
    h.textContent = b.label;
    wrap.appendChild(h);
    b.rows.forEach((s) => wrap.appendChild(makeRow(s)));
  });
  return wrap;
}

// 售前回答：前导说明（命中/过渡句）正常显示；每个【产品/芯片】块渲染成可折叠卡片，第一个默认展开、其余收起。
// products 提供每个产品的规格书文件名→可点链接映射（与网站搜索结果同一套 /official-files 链接）
function renderPresalesReply(text, products) {
  const frag = document.createDocumentFragment();
  const lead = [];                       // 第一个【】块之前的普通说明行
  const productByName = {};
  (products || []).forEach((p) => { if (p && p.name) productByName[p.name] = p; });
  let details = null, body = null, blockIdx = 0, specMap = null;
  const flushLead = () => {
    if (!lead.length) return;
    const p = document.createElement("div");
    p.className = "ps-lead";
    p.textContent = lead.join("\n");
    frag.appendChild(p);
    lead.length = 0;
  };
  // 一行“· 规格书：a.pdf、b.pdf”：有本地链接的渲染成可点 <a>（新标签打开），无链接的显示为灰字
  const buildSpecRow = (t) => {
    const row = document.createElement("div");
    row.className = "ps-row ps-spec-row";
    const lab = document.createElement("span");
    lab.className = "ps-spec-label";
    lab.textContent = "· 规格书：";
    row.appendChild(lab);
    t.replace(/^·\s*规格书：/, "").split("、").filter(Boolean).forEach((fn) => {
      const url = specMap ? specMap[fn] : null;
      if (url) {
        const a = document.createElement("a");
        a.href = url; a.target = "_blank"; a.rel = "noreferrer";
        a.className = "spec-link"; a.textContent = "📄 " + fn;
        row.appendChild(a);
      } else {
        const s = document.createElement("span");
        s.className = "spec-link spec-link-nourl"; s.textContent = "📄 " + fn;
        row.appendChild(s);
      }
    });
    return row;
  };
  // 普通“· 标签：内容”行：标签固定左上（置顶、不收缩），内容在右列，长文本换行后与内容列左缘对齐
  const buildLabelRow = (t) => {
    const row = document.createElement("div");
    row.className = "ps-row";
    const m = t.match(/^(·?\s*[^：:]{1,8}[：:])\s*([\s\S]*)$/);
    if (m) {
      const lab = document.createElement("span");
      lab.className = "ps-row-label";
      lab.textContent = m[1];
      const val = document.createElement("span");
      val.className = "ps-row-value";
      val.textContent = m[2];
      row.appendChild(lab);
      row.appendChild(val);
    } else {
      row.textContent = t;
    }
    return row;
  };
  String(text).split("\n").forEach((raw) => {
    const t = raw.trim();
    if (/^【.+】$/.test(t)) {             // 新折叠块
      flushLead();
      const name = t.slice(1, -1);       // 去掉【】，即产品/芯片名
      details = document.createElement("details");
      details.className = "ps-block";
      if (blockIdx === 0) details.open = true;
      blockIdx += 1;
      const sum = document.createElement("summary");
      sum.className = "ps-block-head";
      sum.textContent = name;
      details.appendChild(sum);
      body = document.createElement("div");
      body.className = "ps-block-body";
      details.appendChild(body);
      frag.appendChild(details);
      specMap = {};
      const p = productByName[name];
      if (p && Array.isArray(p.specFiles)) {
        p.specFiles.forEach((fn, i) => { specMap[fn] = (p.specLinks && p.specLinks[i]) || null; });
      }
    } else if (!t) {
      return;                            // 丢弃块间空行
    } else if (body) {
      body.appendChild(/^·\s*规格书：/.test(t) ? buildSpecRow(t) : buildLabelRow(t));
    } else {
      lead.push(t);
    }
  });
  flushLead();
  // 产品卡「固件」标签：规格书行本就在产品块正文末尾，把固件按钮 append 进 body 即落在规格书正下方；
  // 芯片块（【xx 芯片固件】）在 productByName 里取不到产品、firmwareGroup 为空，自动跳过、搜芯片逻辑不受影响。
  frag.querySelectorAll(".ps-block").forEach((blk) => {
    const headEl = blk.querySelector(".ps-block-head");
    const pName = headEl ? headEl.textContent.trim() : "";
    const p = pName && productByName[pName];
    const fg = p && p.firmwareGroup;
    if (!fg || !Array.isArray(fg.items) || !fg.items.length) return;
    const pbody = blk.querySelector(".ps-block-body");
    if (!pbody) return;
    const row = document.createElement("div");
    row.className = "ps-row ps-fw-row";
    const lab = document.createElement("span");
    lab.className = "ps-row-label";
    lab.textContent = "· 固件：";
    row.appendChild(lab);
    const wrap = document.createElement("span");
    wrap.className = "ps-fw-links";
    fg.items.forEach((it) => {
      const a = document.createElement("a");
      a.href = it.url; a.target = "_blank"; a.rel = "noreferrer";
      a.className = "doc-link fw-link";
      a.textContent = it.clean || it.btn || it.name;
      a.title = it.name || ""; // hover 看真实固件文件名
      if (it.name) a.setAttribute("download", it.name);
      wrap.appendChild(a);
    });
    row.appendChild(wrap);
    pbody.appendChild(row);
  });
  return frag;
}

// 售前问芯片：回答下方的“其他相近芯片”椭圆可点标签（点击=以该芯片重新发问）
function renderNearbyChips(nearby) {
  const box = document.createElement("div");
  box.className = "nearby-chips";
  const title = document.createElement("div");
  title.className = "nearby-chips-title";
  title.textContent = `其他相近芯片（共 ${nearby.length} 个，点击可查）`;
  box.appendChild(title);
  const row = document.createElement("div");
  row.className = "nearby-chips-row";
  nearby.forEach((n) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "nearby-chip";
    const name = document.createElement("span");
    name.className = "nearby-chip-name";
    name.textContent = n.chip;
    const fw = document.createElement("span");
    fw.className = "nearby-chip-fw";
    fw.textContent = n.firmware || "";
    btn.appendChild(name);
    if (n.firmware) btn.appendChild(fw);
    btn.title = `点此查询 ${n.chip}`;
    btn.onclick = () => sendMessage(n.chip);
    row.appendChild(btn);
  });
  box.appendChild(row);
  return box;
}

// 售前问产品：主答案只展开最匹配的 1 个，其余命中/同系列型号做成“近似型号”可点椭圆（点击=以该型号重新发问）
function renderRelatedModels(related) {
  const box = document.createElement("div");
  box.className = "nearby-chips related-models";
  const title = document.createElement("div");
  title.className = "nearby-chips-title";
  title.textContent = `近似型号（共 ${related.length} 个，点击直接查）`;
  box.appendChild(title);
  const row = document.createElement("div");
  row.className = "nearby-chips-row";
  related.forEach((c) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "nearby-chip";
    const name = document.createElement("span");
    name.className = "nearby-chip-name";
    name.textContent = c.label;
    btn.appendChild(name);
    btn.title = `点此查询 ${c.label}`;
    btn.onclick = () => sendMessage(c.q || c.label);
    row.appendChild(btn);
  });
  box.appendChild(row);
  return box;
}

// ===== 拓扑图：点击灯箱放大 + 下载 PNG / SVG（企微侧发 PNG 图片，本身可点开/保存）=====
function topoSerialize(svg){
  const clone=svg.cloneNode(true);
  clone.setAttribute("xmlns","http://www.w3.org/2000/svg");
  const vb=svg.viewBox&&svg.viewBox.baseVal;
  if(!clone.getAttribute("width")&&vb&&vb.width){clone.setAttribute("width",vb.width);clone.setAttribute("height",vb.height);}
  return new XMLSerializer().serializeToString(clone);
}
function topoTrigger(href,name){const a=document.createElement("a");a.href=href;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(href),5000);}
function downloadTopoSvg(svg){
  const blob=new Blob([topoSerialize(svg)],{type:"image/svg+xml;charset=utf-8"});
  topoTrigger(URL.createObjectURL(blob),"接收卡连接拓扑.svg");
}
function downloadTopoPng(svg){
  const svgUrl=URL.createObjectURL(new Blob([topoSerialize(svg)],{type:"image/svg+xml;charset=utf-8"}));
  const img=new Image();
  img.onload=()=>{
    const rc=svg.getBoundingClientRect();
    const vb=svg.viewBox&&svg.viewBox.baseVal;
    const w=(vb&&vb.width)?vb.width:rc.width, h=(vb&&vb.height)?vb.height:rc.height;
    let scale=3;const MAX_EDGE=16000,MAX_AREA=160*1000*1000;
    while(scale>1&&(w*scale>MAX_EDGE||h*scale>MAX_EDGE||w*h*scale*scale>MAX_AREA))scale=Math.round((scale-0.25)*100)/100;
    const cv=document.createElement("canvas");cv.width=Math.round(w*scale);cv.height=Math.round(h*scale);
    const ctx=cv.getContext("2d");ctx.fillStyle="#ffffff";ctx.fillRect(0,0,cv.width,cv.height);ctx.drawImage(img,0,0,cv.width,cv.height);
    URL.revokeObjectURL(svgUrl);
    try{
      cv.toBlob(b=>{ if(b){topoTrigger(URL.createObjectURL(b),"接收卡连接拓扑.png");}else{downloadTopoSvg(svg);} },"image/png");
    }catch(e){ downloadTopoSvg(svg); }
  };
  img.onerror=()=>{URL.revokeObjectURL(svgUrl);downloadTopoSvg(svg);};
  img.src=svgUrl;
}
// 选型清单导出 PNG：标题 + 屏体摘要 + 物料表，纯手写 SVG 转 canvas（零运行时依赖，矢量清晰）
function downloadBomPng(o, items) {
  const catName = { module: "模组", receiver: "接收卡", controller: "控制器/播放盒", splicer: "视频处理器" };
  const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const isCJK = (ch) => /[一-鿿　-￯]/.test(ch);
  const textW = (s, fs) => { let w = 0; for (const ch of String(s)) w += isCJK(ch) ? fs : (ch === " " ? 0.32 * fs : 0.58 * fs); return w; };
  const W = 820, PAD = 26;
  const modelX = PAD + 96, qtyX = W - PAD - 8, modelMaxW = qtyX - modelX - 18;
  const wrapModel = (text, fs) => {
    if (textW(text, fs) <= modelMaxW) return [text];
    const chars = [...String(text)]; let line = ""; const lines = [];
    for (const ch of chars) {
      if (textW(line + ch, fs) > modelMaxW) { lines.push(line); line = ch; if (lines.length === 2) break; }
      else line += ch;
    }
    if (lines.length < 2) lines.push(line);
    const used = lines.join("").length;
    if (chars.length > used) { let l2 = lines[1] || ""; while (l2.length > 1 && textW(l2 + "…", fs) > modelMaxW) l2 = l2.slice(0, -1); lines[1] = l2 + "…"; }
    return lines;
  };
  const prepared = items.map((it) => ({
    cat: catName[it.category] || it.category || "",
    qty: `${it.quantity} ${it.unit || ""}`.trim(),
    lines: wrapModel(it.model || "", 15),
  }));
  const HEAD_Y = 96, ROW_H1 = 30, ROW_H2 = 50;
  let y = HEAD_Y + 30;
  prepared.forEach((r) => { r.y = y; y += (r.lines.length > 1 ? ROW_H2 : ROW_H1); });
  const footY = y + 6, H = footY + 30;
  const FONT = "'Microsoft YaHei',Arial,sans-serif";
  const p = [];
  p.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>`);
  p.push(`<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" fill="none" stroke="#e2e8f0"/>`);
  p.push(`<text x="${PAD}" y="42" font-family="${FONT}" font-size="20" font-weight="700" fill="#0f172a">选型清单</text>`);
  if (o.screen && o.screen.text) {
    p.push(`<rect x="${PAD}" y="56" width="${W - PAD * 2}" height="32" rx="6" fill="#eef4ff" stroke="#cfe0ff"/>`);
    p.push(`<text x="${PAD + 12}" y="77" font-family="${FONT}" font-size="14" fill="#2b5cd9">${esc(o.screen.text)}</text>`);
  }
  p.push(`<text x="${PAD + 8}" y="${HEAD_Y + 8}" font-family="${FONT}" font-size="12.5" fill="#8a9099">类别</text>`);
  p.push(`<text x="${modelX}" y="${HEAD_Y + 8}" font-family="${FONT}" font-size="12.5" fill="#8a9099">型号 / 规格</text>`);
  p.push(`<text x="${qtyX}" y="${HEAD_Y + 8}" text-anchor="end" font-family="${FONT}" font-size="12.5" fill="#8a9099">数量</text>`);
  p.push(`<line x1="${PAD}" y1="${HEAD_Y + 18}" x2="${W - PAD}" y2="${HEAD_Y + 18}" stroke="#eceef2"/>`);
  prepared.forEach((r) => {
    const rh = r.lines.length > 1 ? ROW_H2 : ROW_H1;
    p.push(`<line x1="${PAD}" y1="${r.y + rh - 6}" x2="${W - PAD}" y2="${r.y + rh - 6}" stroke="#f4f6f9"/>`);
    p.push(`<text x="${PAD + 8}" y="${r.y + 20}" font-family="${FONT}" font-size="13" fill="#64748b">${esc(r.cat)}</text>`);
    r.lines.forEach((ln, i) => p.push(`<text x="${modelX}" y="${r.y + 20 + i * 20}" font-family="${FONT}" font-size="15" font-weight="600" fill="#0f172a">${esc(ln)}</text>`));
    p.push(`<text x="${qtyX}" y="${r.y + 20}" text-anchor="end" font-family="${FONT}" font-size="15" font-weight="700" fill="#1d4ed8">${esc(r.qty)}</text>`);
  });
  p.push(`<text x="${PAD}" y="${footY + 18}" font-family="${FONT}" font-size="11.5" fill="#9aa0a6">小灰机配单结果·供参考，正式施工以 HDSet 连屏文件 / 人工复核为准</text>`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${p.join("")}</svg>`;
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  const img = new Image();
  img.onload = () => {
    const scale = 2, cv = document.createElement("canvas");
    cv.width = W * scale; cv.height = H * scale;
    const ctx = cv.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.scale(scale, scale); ctx.drawImage(img, 0, 0);
    URL.revokeObjectURL(url);
    cv.toBlob((b) => { const u = URL.createObjectURL(b); const name = `选型清单_${o.screen ? o.screen.w + "x" + o.screen.h : ""}.png`; topoTrigger(u, name); }, "image/png");
  };
  img.onerror = () => URL.revokeObjectURL(url);
  img.src = url;
}

function openTopoLightbox(svgStr){
  const ov=document.createElement("div");ov.className="topo-lightbox";
  const stage=document.createElement("div");stage.className="topo-lightbox-stage";
  const wrap=document.createElement("div");wrap.className="topo-lightbox-wrap";
  wrap.innerHTML=svgStr;
  const ls=wrap.querySelector("svg");
  stage.appendChild(wrap);

  const bar=document.createElement("div");bar.className="topo-lightbox-bar";
  const mk=(txt,title,fn,cls)=>{const b=document.createElement("button");b.type="button";b.className="tlb-btn"+(cls?" "+cls:"");b.innerHTML=txt;b.title=title;b.addEventListener("click",ev=>{ev.stopPropagation();fn();});bar.appendChild(b);return b;};

  let rawW=1180,rawH=700;
  if(ls){
    const vb=ls.viewBox&&ls.viewBox.baseVal;
    rawW=parseFloat(ls.getAttribute("width"))||(vb&&vb.width)||1180;
    rawH=parseFloat(ls.getAttribute("height"))||(vb&&vb.height)||700;
    ls.setAttribute("width",rawW);ls.setAttribute("height",rawH);
    ls.style.width=rawW+"px";ls.style.height=rawH+"px";ls.style.display="block";
  }
  let k=1,tx=0,ty=0,kFit=1;
  const sW=()=>stage.clientWidth,sH=()=>stage.clientHeight;
  function apply(){wrap.style.transform="translate("+tx+"px,"+ty+"px) scale("+k+")";}
  function fit(){kFit=Math.min((sW()-24)/rawW,(sH()-24)/rawH,1);k=kFit;tx=(sW()-rawW*k)/2;ty=(sH()-rawH*k)/2;wrap.style.cursor="grab";apply();}
  const KMAX=8;
  function zoomAt(cx,cy,f){const nk=Math.min(KMAX,Math.max(kFit,k*f));if(nk===k)return;const wx=(cx-tx)/k,wy=(cy-ty)/k;k=nk;tx=cx-wx*k;ty=cy-wy*k;apply();}
  const dist=p=>Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y);
  const midP=p=>({x:(p[0].x+p[1].x)/2,y:(p[0].y+p[1].y)/2});
  const centerZoom=f=>zoomAt(sW()/2,sH()/2,f);
  mk("&plus;","放大",()=>centerZoom(1.3));
  mk("&minus;","缩小",()=>centerZoom(1/1.3));
  mk("复位","复位到整屏（也可双击图）",fit,"tlb-reset");
  mk("&times;","关闭",hide,"tlb-close");
  ov.appendChild(stage);ov.appendChild(bar);

  // 滚轮：以鼠标位置为中心缩放（矢量 SVG，放多大字/线都清晰）
  stage.addEventListener("wheel",e=>{e.preventDefault();const r=stage.getBoundingClientRect();zoomAt(e.clientX-r.left,e.clientY-r.top,Math.exp(-e.deltaY*0.0015));},{passive:false});
  wrap.addEventListener("dblclick",e=>{e.stopPropagation();fit();});

  // 指针：单指/鼠标按住拖动；双指捏合缩放
  const ptr=new Map();let drag=null,pinch=null;
  stage.addEventListener("pointerdown",e=>{
    if(e.target.closest&&e.target.closest(".tlb-btn"))return;
    try{stage.setPointerCapture(e.pointerId);}catch(_){}
    ptr.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(ptr.size===1){drag={x:e.clientX,y:e.clientY,tx,ty,moved:false};wrap.style.cursor="grabbing";}
    else if(ptr.size===2){drag=null;const ps=[...ptr.values()];const r=stage.getBoundingClientRect();const m=midP(ps);pinch={d:dist(ps),k:k,cx:m.x-r.left,cy:m.y-r.top,tx:tx,ty:ty};}
  });
  stage.addEventListener("pointermove",e=>{
    if(!ptr.has(e.pointerId))return;
    ptr.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(ptr.size>=2&&pinch){const ps=[...ptr.values()];const nd=dist(ps);const r=stage.getBoundingClientRect();const m=midP(ps);
      const nk=Math.min(KMAX,Math.max(kFit,pinch.k*(nd/pinch.d)));
      const cx=m.x-r.left,cy=m.y-r.top;const wx=(pinch.cx-pinch.tx)/pinch.k,wy=(pinch.cy-pinch.ty)/pinch.k;
      k=nk;tx=cx-wx*k;ty=cy-wy*k;apply();return;}
    if(drag){const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(Math.abs(dx)>4||Math.abs(dy)>4)drag.moved=true;tx=drag.tx+dx;ty=drag.ty+dy;apply();}
  });
  function endPtr(e){
    const wasDrag=drag;
    if(ptr.has(e.pointerId)){const n=ptr.size;ptr.delete(e.pointerId);
      if(n===1&&wasDrag&&!wasDrag.moved&&e.target===stage)hide();
      if(ptr.size===1){const p=[...ptr.values()][0];drag={x:p.x,y:p.y,tx:tx,ty:ty,moved:true};wrap.style.cursor="grabbing";}
      else{drag=null;pinch=null;wrap.style.cursor="grab";}
      try{stage.releasePointerCapture(e.pointerId);}catch(_){}
    }
  }
  stage.addEventListener("pointerup",endPtr);
  stage.addEventListener("pointercancel",endPtr);

  function onKey(e){if(e.key==="Escape")hide();else if(e.key==="+"||e.key==="=")centerZoom(1.3);else if(e.key==="-"||e.key==="_")centerZoom(1/1.3);else if(e.key==="0")fit();}
  function onResize(){fit();}
  document.addEventListener("keydown",onKey);
  window.addEventListener("resize",onResize);
  function hide(){if(ov.parentNode)ov.parentNode.removeChild(ov);document.removeEventListener("keydown",onKey);window.removeEventListener("resize",onResize);}
  document.body.appendChild(ov);
  fit();
}
// 配单结果：状态徽标 + 选型清单(BOM) + 拓扑图 + 完整明细折叠；企微纯文本仍用 reply，不受影响
function renderOrdering(data) {
  const frag = document.createDocumentFragment();
  const o = data.ordering || {};
  const isFormal = o.state === "formal";
  const isConflict = o.state === "conflict";
  // 2) 选型清单 BOM（先算，用于判断方案是否已成型）
  const items = (o.bom && Array.isArray(o.bom.items)) ? o.bom.items
    : (Array.isArray(o.bom) ? o.bom.map((b) => ({ category: b.kind, model: b.name, quantity: b.qty, unit: b.kind === "controller" ? "台" : "张" })) : []);
  const hasPlan = items.length > 0 || !!o.topologySvg; // 已能给出清单/拓扑即方案成型，仅同/异步二选一未定不算“待补全”

  // 1) 方案状态：正式锁定 / 已成型供参考 / 数据冲突 / 确实还缺参数
  const state = document.createElement("div");
  let stateCls, stateText;
  if (isFormal) { stateCls = "formal"; stateText = "配单方案"; }
  else if (isConflict) { stateCls = "conflict"; stateText = "数据有冲突，请先核对一项"; }
  else if (hasPlan) { stateCls = "ready"; stateText = "配单方案（已留余量·供参考）"; }
  else { stateCls = "provisional"; stateText = "配单方案（信息待补全）"; }
  state.className = "ord-state " + stateCls;
  state.textContent = stateText;
  frag.appendChild(state);
  if (items.length) {
    const card = document.createElement("div");
    card.className = "ord-bom";
    const title = document.createElement("div");
    title.className = "ord-bom-title";
    title.textContent = "选型清单";
    card.appendChild(title);
    if (o.screen && o.screen.text) {
      const scr = document.createElement("div");
      scr.className = "ord-bom-screen";
      scr.textContent = o.screen.text;
      card.appendChild(scr);
    }
    const catName = { module: "模组", receiver: "接收卡", controller: "控制器/播放盒", splicer: "视频处理器" };
    const list = document.createElement("div");
    list.className = "ord-bom-list";
    items.forEach((it) => {
      const row = document.createElement("div");
      row.className = "ord-bom-row";
      const c = document.createElement("span"); c.className = "ord-bom-cat"; c.textContent = catName[it.category] || it.category;
      const m = document.createElement("span"); m.className = "ord-bom-model"; m.textContent = it.model || "";
      const q = document.createElement("span"); q.className = "ord-bom-qty"; q.textContent = `${it.quantity} ${it.unit || ""}`;
      row.append(c, m, q);
      list.appendChild(row);
    });
    card.appendChild(list);
    const bomTools = document.createElement("div");
    bomTools.className = "ord-bom-tools";
    const bBomPng = document.createElement("button");
    bBomPng.type = "button"; bBomPng.className = "ord-topo-btn"; bBomPng.textContent = "下载清单 PNG";
    bBomPng.addEventListener("click", (e) => { e.stopPropagation(); downloadBomPng(o, items); });
    bomTools.appendChild(bBomPng);
    card.appendChild(bomTools);
    frag.appendChild(card);
  }

  // 3) 接收卡连接拓扑图（后端生成的可信 SVG，自适应宽度，默认展开）
  if (o.topologySvg) {
    const tw = document.createElement("details");
    tw.className = "ord-topo"; tw.open = true;
    const sum = document.createElement("summary"); sum.textContent = "接收卡连接拓扑图"; tw.appendChild(sum);
    const box = document.createElement("div");
    box.className = "ord-topo-box ord-topo-zoomable";
    box.title = "点击放大";
    box.innerHTML = o.topologySvg;
    const svg = box.querySelector("svg");
    if (svg) { svg.removeAttribute("width"); svg.removeAttribute("height"); svg.style.width = "100%"; svg.style.height = "auto"; }
    box.addEventListener("click", () => openTopoLightbox(o.topologySvg));
    tw.appendChild(box);
    const tools = document.createElement("div"); tools.className = "ord-topo-tools";
    const tip = document.createElement("span"); tip.className = "ord-topo-tip"; tip.textContent = "点击图片可放大"; tools.appendChild(tip);
    const bPng = document.createElement("button"); bPng.type = "button"; bPng.className = "ord-topo-btn"; bPng.textContent = "下载 PNG";
    const bSvg = document.createElement("button"); bSvg.type = "button"; bSvg.className = "ord-topo-btn"; bSvg.textContent = "下载 SVG";
    bPng.addEventListener("click", e => { e.stopPropagation(); if (svg) downloadTopoPng(svg); });
    bSvg.addEventListener("click", e => { e.stopPropagation(); if (svg) downloadTopoSvg(svg); });
    tools.appendChild(bPng); tools.appendChild(bSvg);
    if (o.ssm && o.ssm.available && o.ssm.url) {
      const bSsm = document.createElement("a");
      bSsm.className = "ord-topo-btn";
      bSsm.textContent = "下载 HDSet 连屏";
      bSsm.title = "可在 HDSet「显示屏配置」中导入的连屏配置文件";
      bSsm.href = o.ssm.url;
      bSsm.download = o.ssm.fileName || "HDSet连屏.ssm";
      bSsm.addEventListener("click", (e) => e.stopPropagation());
      tools.appendChild(bSsm);
    }
    tw.appendChild(tools);
    frag.appendChild(tw);
  }

  // 4) 完整方案明细（屏体/网口分配等长文本）默认折叠，需要时展开
  if (data.reply) {
    const d = document.createElement("details");
    d.className = "ord-detail";
    const s = document.createElement("summary"); s.textContent = "查看完整方案明细（屏体 / 网口分配等）"; d.appendChild(s);
    const body = document.createElement("div");
    body.className = "ord-detail-body";
    body.textContent = data.reply;
    d.appendChild(body);
    frag.appendChild(d);
  }
  return frag;
}

// 答案末尾的跟进按钮（接收卡测试分流 / 补芯片等）。选项过多时（如案例库全量芯片）只平铺高频前若干个，
// 其余折叠到“展开其余 N 项”，避免一长串按钮把对话撑到底；客户也可以不理按钮、直接手打。
function renderFollowUp(fu) {
  const box = document.createElement("div");
  box.className = "followup-box";
  const tip = document.createElement("div");
  tip.className = "followup-tip";
  tip.textContent = fu.tip || "";
  box.appendChild(tip);
  const row = document.createElement("div");
  row.className = "clarify-options followup-options";
  // 跟进按钮最多平铺前 6（售后高频芯片正好 6 个；售前一长串近似型号时其余折叠），客户也可不理按钮直接手打。
  const PREVIEW = 6;
  const opts = fu.options || [];
  const mkBtn = (opt) => {
    const btn = document.createElement("button");
    btn.className = "clarify-option-btn followup-btn";
    btn.textContent = opt.label;
    btn.onclick = () => sendOption(opt);
    return btn;
  };
  opts.slice(0, PREVIEW).forEach((opt) => row.appendChild(mkBtn(opt)));
  if (opts.length > PREVIEW) {
    const rest = opts.slice(PREVIEW);
    const toggle = document.createElement("button");
    toggle.className = "followup-more-btn";
    toggle.textContent = `展开其余 ${rest.length} 项 ▾`;
    let opened = false;
    toggle.onclick = () => {
      opened = !opened;
      if (opened) {
        rest.forEach((opt) => row.insertBefore(mkBtn(opt), toggle));
        toggle.textContent = "收起 ▴";
      } else {
        rest.forEach(() => { const b = row.querySelectorAll(".followup-btn")[PREVIEW]; if (b) b.remove(); });
        toggle.textContent = `展开其余 ${rest.length} 项 ▾`;
      }
    };
    row.appendChild(toggle);
  }
  box.appendChild(row);
  return box;
}
// 取会话里最近一条用户原始问题（去掉内部标记），点分流按钮时拼回，保证后端拿得到原现象/型号
function lastUserQuestion() {
  for (let i = chatHistory.length - 1; i >= 0; i--) {
    if (chatHistory[i].role === "user") return chatHistory[i].content.replace(/\[[A-Z_]+\]/g, "").trim();
  }
  return "";
}
// 快捷/分流选项：带内部标记的（接收卡测试/同步异步/补型号）自动拼上原问题，并把每步选择累计进用户气泡
function sendOption(opt) {
  const label = typeof opt === "string" ? opt : opt.label;
  const value = typeof opt === "string" ? opt : opt.value;
  const tagged = /\[[A-Z_]+\]/.test(value);
  if (tagged) {
    const root = lastUserQuestion();
    if (!triagePath || triagePath.root !== root) triagePath = { root, steps: [] };
    triagePath.steps.push(label);
    const send = `${value} ${root}`.trim();
    const show = [triagePath.root, ...triagePath.steps].filter(Boolean).join(" · ");
    sendMessage(send, show);
  } else {
    if (triagePath) triagePath.steps.push(label);
    const show = triagePath ? [triagePath.root, ...triagePath.steps].filter(Boolean).join(" · ") : label;
    sendMessage(value, show);
  }
}

// displayOverride：点分流按钮时界面显示累计路径，实际仍发送带内部标记的 message
async function sendMessage(forceText, displayOverride) {
  const text = (forceText !== undefined ? forceText : aiInput.value).trim();
  if (!text) return;
  if (forceText === undefined) {
    // 手动输入：若是“裸序号”且上一轮刚给过选项，等价于点对应按钮（1 / 1) / 1. / ①）；多位型号 410/6363 不拦截
    let _idx = -1;
    const _plain = text.match(/^(\d{1,2})[.、)）]?$/);
    const _circ = text.match(/^[①②③④⑤⑥⑦⑧⑨⑩]$/);
    if (_circ) _idx = "①②③④⑤⑥⑦⑧⑨⑩".indexOf(_circ[0]);
    else if (_plain) _idx = parseInt(_plain[1], 10) - 1;
    const _opt = (_idx >= 0 && lastNumericOptions && Date.now() - lastNumericOptions.at < 15 * 60000)
      ? lastNumericOptions.options[_idx] : null;
    if (_opt) { sendOption(_opt); return; }
    triagePath = null;  // 手动输入=开启新问题，清空累计路径
    lastNumericOptions = null;  // 新问题开始，上一轮序号选项失效
  }
  const displayText = (displayOverride !== undefined
    ? displayOverride
    : text.replace(/\[[A-Z_]+\]/g, "")).trim();  // 界面不显示内部分流标记
  aiInput.value = "";
  aiInput.disabled = true;
  aiSendBtn.disabled = true;

  addUserMessage(displayText);
  const loading = addAssistantLoading();
  const historyForRequest = chatHistory.slice(-8);

  try {
    const resp = await fetch("/api/ai/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, history: historyForRequest, source: isSelftestEnv() ? "web-selftest" : "quick-site", sessionId: getSid() })
    });
    const data = await resp.json();
    removeLoading();
    addAssistantMessage(data);
    // 记录本轮到会话历史，供下一轮反问续问继承现象/型号
    chatHistory.push({ role: "user", content: text });
    chatHistory.push({ role: "assistant", content: assistantTextOf(data), model: data.model || "" });
  } catch (err) {
    removeLoading();
    const div = document.createElement("div");
    div.className = "ai-msg ai-msg-assistant";
    div.innerHTML = `<div class="ai-msg-bubble" style="color:#c00">请求失败：${err.message}</div>`;
    aiMessages.appendChild(div);
  } finally {
    aiInput.disabled = false;
    aiSendBtn.disabled = false;
    aiInput.focus();
  }
}

aiSendBtn.addEventListener("click", () => sendMessage());
aiInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.isComposing) sendMessage();
});
// ============ 截图 OCR：把配单文字 / 聊天截图识别成纯文本，再走同一套问答链路 ============
// 边界：OCR 只做「图片→文字」，不做意图判断、不查库；识别后自动直接发问，不回填输入框、不在气泡铺文字；任何失败都提示直接打字，绝不硬猜。
const aiImgBtn = document.getElementById("aiImgBtn");
const aiImgFile = document.getElementById("aiImgFile");
const aiImgPreview = document.getElementById("aiImgPreview");
const aiImgThumb = document.getElementById("aiImgThumb");
const aiImgStatus = document.getElementById("aiImgStatus");
const aiImgRemove = document.getElementById("aiImgRemove");
let ocrState = { dataUrl: null, text: "", busy: false };

function setOcrStatus(msg, isError) {
  if (!aiImgStatus) return;
  aiImgStatus.textContent = msg;
  aiImgStatus.classList.toggle("is-error", !!isError);
}
function clearOcrImage() {
  ocrState = { dataUrl: null, text: "", busy: false };
  if (aiImgFile) aiImgFile.value = "";
  if (aiImgPreview) aiImgPreview.hidden = true;
  if (aiImgThumb) aiImgThumb.removeAttribute("src");
  if (aiInput) aiInput.classList.remove("drag-over");
  if (aiMessages) aiMessages.classList.remove("drag-over");
}
async function handleOcrFile(file) {
  if (!file || !/^image\//.test(file.type)) {
    if (aiImgPreview) aiImgPreview.hidden = false;
    setOcrStatus('请选择图片文件（截图 / 照片均可）', true);
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    ocrState = { dataUrl: null, text: '', busy: false };
    if (aiImgPreview) aiImgPreview.hidden = false;
    if (aiImgThumb) aiImgThumb.removeAttribute('src');
    setOcrStatus('图片超过 10MB，发张小点的图或直接打字', true);
    return;
  }
  if (ocrState.busy) return;  // 上一张还在识别 / 应答，忽略并发拖入
  const reader = new FileReader();
  reader.onload = async () => {
    const dataUrl = String(reader.result || '');
    if (aiImgPreview) aiImgPreview.hidden = true;  // 自动流程不占用输入框上方预览条
    await sendImageMessage(dataUrl);
  };
  reader.onerror = () => {
    if (aiImgPreview) aiImgPreview.hidden = false;
    setOcrStatus('图片读取失败，可以直接打字', true);
  };
  reader.readAsDataURL(file);
}

// 图片消息：气泡只显示截图（识别文字不回填输入框、也不在气泡铺文字，避免和客户要打的字混淆）；
// OCR 文字直接作为客户问题走原问答 / 配单链路，客户无需再点发送；识别失败或无字则提示直接打字。
async function sendImageMessage(dataUrl) {
  ocrState = { dataUrl, text: '', busy: true };
  if (aiImgFile) aiImgFile.value = '';
  addUserMessage('', dataUrl);  // 只显示截图，不显示识别文字
  addAssistantLoading('正在识别图片文字…');
  let text = '';
  try {
    const resp = await fetch('/api/ocr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: dataUrl })
    });
    const j = await resp.json();
    if (j.ok && j.text) text = String(j.text).trim();
    const ocrImageId = (j.ok && j.imageId) ? j.imageId : '';
  } catch (e) { text = ''; }
  if (!text) {
    removeLoading();
    const div = document.createElement('div');
    div.className = 'ai-msg ai-msg-assistant';
    const b = document.createElement('div');
    b.className = 'ai-msg-bubble';
    b.textContent = '图片里没认出文字，请直接用文字把【设备型号】和【现场现象 / 屏体尺寸】发我（例如“C16L花屏一直闪”或“P3宽6米高3米同步”），我来帮你查。';
    div.appendChild(b);
    aiMessages.appendChild(div);
    aiMessages.scrollTop = aiMessages.scrollHeight;
    ocrState = { dataUrl: null, text: '', busy: false };
    return;
  }
  // 识别成功：文字直接进入对话历史与请求（界面不显示），客户无需再点发送
  chatHistory.push({ role: 'user', content: text });
  const lb = document.getElementById('aiLoading') && document.getElementById('aiLoading').querySelector('.ai-msg-bubble');
  if (lb) lb.textContent = '思考中…';
  aiInput.disabled = true;
  aiSendBtn.disabled = true;
  try {
    const resp = await fetch('/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, history: chatHistory.slice(-8), source: isSelftestEnv() ? 'web-selftest' : 'quick-site', sessionId: getSid(), images: ocrImageId ? [ocrImageId] : [] })
    });
    const data = await resp.json();
    removeLoading();
    addAssistantMessage(data);
    chatHistory.push({ role: 'assistant', content: assistantTextOf(data), model: data.model || '' });
  } catch (err) {
    removeLoading();
    const div = document.createElement('div');
    div.className = 'ai-msg ai-msg-assistant';
    const b = document.createElement('div');
    b.className = 'ai-msg-bubble';
    b.style.color = '#c00';
    b.textContent = '请求失败：' + err.message;
    div.appendChild(b);
    aiMessages.appendChild(div);
  } finally {
    aiInput.disabled = false;
    aiSendBtn.disabled = false;
    ocrState = { dataUrl: null, text: '', busy: false };
    aiInput.focus();
    aiMessages.scrollTop = aiMessages.scrollHeight;
  }
}
if (aiImgBtn && aiImgFile) {
  aiImgBtn.addEventListener("click", () => aiImgFile.click());
  aiImgFile.addEventListener("change", () => {
    const f = aiImgFile.files && aiImgFile.files[0];
    if (f) handleOcrFile(f);
  });
}
if (aiImgRemove) aiImgRemove.addEventListener("click", clearOcrImage);
// 粘贴截图：输入框聚焦时 Ctrl+V 图片即识别
aiInput.addEventListener("paste", (e) => {
  const items = (e.clipboardData && e.clipboardData.items) || [];
  for (const it of items) {
    if (it.type && it.type.indexOf("image/") === 0) {
      const f = it.getAsFile();
      if (f) { e.preventDefault(); handleOcrFile(f); }
      break;
    }
  }
});
// 拖拽截图到聊天区 / 输入框
["dragover", "dragenter"].forEach((ev) => {
  [aiMessages, aiInput].forEach((el) => el && el.addEventListener(ev, (e) => {
    if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files")) {
      e.preventDefault();
      el.classList.add("drag-over");
    }
  }));
});
["dragleave", "drop"].forEach((ev) => {
  [aiMessages, aiInput].forEach((el) => el && el.addEventListener(ev, (e) => {
    el.classList.remove("drag-over");
    if (ev === "drop" && e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
      e.preventDefault();
      handleOcrFile(e.dataTransfer.files[0]);
    }
  }));
});


// ============ 快查站产品搜索 ============
const quickSearchInput = document.getElementById("quickSearchInput");
const quickSearchBtn = document.getElementById("quickSearchBtn");
const searchResults = document.getElementById("searchResults");

// 搜索框下资料分类：all 全部 / spec 规格书 / manual 说明书 / software 软件 / video 视频 / firmware 固件
const CAT_LABEL = { all: "全部", spec: "规格书", manual: "说明书", software: "软件", video: "视频", firmware: "固件", other: "其他资料", pending: "待确认" };
const CAT_GROUP_KEYS = { spec: ["spec"], manual: ["manual"], firmware: ["firmware"], other: ["other"], pending: ["pending"] }; // 各分类在产品资料组里保留的 key
const CAT_PLACEHOLDER = {
  all: "如 R708规格书、6363固件、A5说明书、HDPlayer软件、复位视频",
  allNarrow: "R708/6363/A5/HDSet/复位",
  spec: "输入产品型号查规格书，如 R708、VP410",
  manual: "输入产品或软件名查说明书，如 A5、HDPlayer",
  software: "输入软件名，如 HDSet、HDPlayer",
  video: "输入操作 / 故障关键词，如 复位、WiFi、接线",
  firmware: "输入接收卡型号或芯片数字，如 R708、6363",
  other: "输入产品型号或资料关键词",
  pending: "输入产品型号，查看需要核对的资料",
};
// “全部”分类：宽屏每类各给一个例子；窄屏(手机)用短版，避免单行输入框被截断
function pickQuickPlaceholder(cat) {
  if (cat !== "all") return CAT_PLACEHOLDER[cat] || CAT_PLACEHOLDER.all;
  return (window.matchMedia && window.matchMedia("(max-width:640px)").matches) ? CAT_PLACEHOLDER.allNarrow : CAT_PLACEHOLDER.all;
}
let activeCat = "all";
let lastSearch = null; // 最近一次产品搜索 {results, query, data}，切分类时本地重渲染、不重复请求
const quickCats = document.getElementById("quickCats");
function setActiveCat(cat) {
  activeCat = CAT_LABEL[cat] ? cat : "all";
  if (quickCats) {
    quickCats.querySelectorAll(".qc-btn").forEach((b) => {
      const on = b.dataset.cat === activeCat;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
  }
  if (quickSearchInput) quickSearchInput.placeholder = pickQuickPlaceholder(activeCat);
}
window.addEventListener("resize", () => { if (activeCat === "all" && quickSearchInput) quickSearchInput.placeholder = pickQuickPlaceholder("all"); });

const quickExamples = document.getElementById("quickExamples");
// 空态示例：仅在没有搜索词且“全部”分类下出现，引导新客户上手；开始搜或切到具体分类即隐藏
function updateQuickExamples() {
  if (!quickExamples) return;
  const q0 = quickSearchInput.value.trim();
  quickExamples.style.display = (!q0 && activeCat === "all") ? "flex" : "none";
}
if (quickExamples) {
  quickExamples.querySelectorAll(".qe-btn").forEach((b) => {
    b.addEventListener("click", () => {
      const huiai = b.dataset.huiai;
      if (huiai) { location.href = "/huiai?mode=ordering&q=" + encodeURIComponent(huiai); return; }
      const eq = b.dataset.q || "";
      const cat = b.dataset.cat || "all";
      setActiveCat(cat);
      quickSearchInput.value = eq;
      updateQuickExamples();
      if (cat === "software") renderSoftwareCategory(eq);
      else if (cat === "video") renderVideoCategory(eq);
      else doSearch();
    });
  });
  updateQuickExamples();
}

function escHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (m) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}

// IC固件速查卡：芯片数字/全名反查灰度自家卡型固件尾缀
function renderChipFirmwareCard(cf) {
  if (!cf) return "";
  let h = `<article class="chip-fw-card"><span class="chip-fw-label">IC固件速查</span>`;
  h += `<h3 class="chip-fw-title">${escHtml(cf.title)}</h3><dl class="chip-fw-table">`;
  h += `<div><dt>芯片型号</dt><dd>${escHtml(cf.primary.chip)}</dd></div>`;
  // 智能设置/芯片类型/固件尾缀统一由后端 facts 输出，避免“智能设置”与“智能设置选择”重复两行
  (cf.primary.facts || []).forEach((f) => {
    h += `<div><dt>${escHtml(f.label)}</dt><dd>${escHtml(f.text || "").replace(/\n/g, "<br>")}</dd></div>`;
  });
  h += `</dl>`;
  // 主驱动芯片：按接收卡型折叠的该系列最新固件下载（译码/借用芯片无 firmwareItems，自动不显示）
  const fwItems = Array.isArray(cf.firmwareItems) ? cf.firmwareItems : [];
  if (fwItems.length) {
    h += `<details class="chip-fw-dl">`;
    h += `<summary>📥 下载对应固件（${escHtml(cf.firmwareSeriesLabel || "对应系列")} · ${fwItems.length} 款接收卡）</summary>`;
    h += `<p class="chip-fw-dl-tip">固件必须按手上接收卡的型号刷（看卡上丝印，如 R708），刷错会黑屏/花屏；列表里没有你的卡型、或拿不准，直接把接收卡型号发我。</p>`;
    h += `<div class="search-docs"><div class="doc-group doc-group-firmware">`;
    fwItems.forEach((it) => {
      const label = escHtml(it.clean || it.btn || it.name);
      h += `<a class="doc-link fw-link" href="${escHtml(it.url)}" target="_blank" rel="noreferrer" download="${escHtml(it.name || "")}" title="${escHtml(it.name || it.clean || "")}">${label}</a>`;
    });
    h += `</div></div></details>`;
  }
  const others = (cf.hits || []).slice(1);
  if (others.length) {
    h += `<div class="chip-fw-more"><div class="chip-fw-more-title">其他相近芯片（共 ${cf.hitCount} 条匹配）</div>`;
    others.forEach((o) => {
      h += `<div class="chip-fw-more-row"><span class="chip-fw-more-name">${escHtml(o.chip)}</span><span class="chip-fw-more-fw">${escHtml(o.firmwareLabel)}</span></div>`;
    });
    h += `</div>`;
  }
  h += `<p class="chip-fw-note">来源：《${escHtml(cf.source)}》。现场升级前必须再核对芯片丝印、精确卡型、硬件版本、实际原文件和项目备份。</p></article>`;
  return h;
}

// 产品资料优先采用后端docGroups，旧分组只用于兼容。
function productDocGroups(r) {
  const groups = window.ProductResources.groups(r);
  return { groups, fwGroup: groups.find(g => g.key === "firmware") || null };
}
function productHasCat(r, cat) {
  return productDocGroups(r).groups.some(g => (CAT_GROUP_KEYS[cat] || []).includes(g.key));
}

function renderSearchResults(results, query, data) {
  const cf = data && data.chipFirmware;
  const cat = (activeCat === "software" || activeCat === "video") ? "all" : activeCat; // 软件/视频分类走独立渲染，不进本函数
  const showChip = !!cf && (cat === "all" || cat === "firmware"); // 芯片固件速查卡只在“全部/固件”下出现
  const showParams = cat === "all"; // 分类视图只给资料，不铺参数与特点，干净直接
  const shown = (cat === "all")
    ? results
    : results.filter((r) => productHasCat(r, cat, productDocGroups(r).fwGroup));
  if (!shown.length && !showChip) {
    const tip = cat === "all"
      ? `未找到与"${escHtml(query)}"相关的资料`
      : `没有找到与"${escHtml(query)}"相关的${CAT_LABEL[cat]}，可换个分类或型号试试`;
    searchResults.innerHTML = `<div class="search-empty">${tip}</div>`;
    searchResults.style.display = "block";
    return;
  }
  let html = showChip ? renderChipFirmwareCard(cf) : "";
  if (shown.length) {
    html += `<div class="search-count">${cat === "all" ? `找到 ${shown.length} 条产品结果` : `${CAT_LABEL[cat]} · ${shown.length} 个产品`}</div>`;
    // 同系列型号快捷词条（点击即换搜）
    const chips = (data && data.relatedChips) || [];
    if (chips.length) {
      html += `<div class="related-chips"><span class="related-label">相关型号：</span>`;
      chips.forEach((c) => {
        html += `<button type="button" class="related-chip" data-q="${escHtml(c.q)}">${escHtml(c.label)}</button>`;
      });
      html += `</div>`;
    }
  }
  for (const [productIndex, r] of shown.entries()) {
    const tag = '<span class="search-tag search-tag-product">产品</span>';
    html += `<div class="search-item">`;
    html += `<div class="search-item-name">${tag} ${escHtml(r.name)}</div>`;
    if (showParams && r.aliases && r.aliases.length) {
      html += `<div class="search-item-aliases">别名：${r.aliases.map(escHtml).join(" / ")}</div>`;
    }
    if (showParams) {
      const f = r.features || {};
      const featRows = [];
      if (f.series) featRows.push(["类型", f.series]);
      if (f.color) featRows.push(["系列", f.color]);
      if (f.load) featRows.push(["带载", f.load]);
      if (f.resolution) featRows.push(["分辨率", f.resolution]);
      if (f.inputs) featRows.push(["输入接口", f.inputs]);
      if (f.outputs) featRows.push(["输出接口", f.outputs]);
      if (featRows.length) {
        html += `<div class="search-item-params-grid">`;
        featRows.forEach(([label, value]) => {
          if (String(value).length > 180) {
            html += `<details class="pr-long-parameter"><summary>${label} · 展开完整参数</summary><div>${escHtml(value)}</div></details>`;
          } else {
            html += `<div class="param-row"><span class="param-label">${label}</span><span class="param-value">${escHtml(value)}</span></div>`;
          }
        });
        html += `</div>`;
      }
      // 产品特点放最后一行：只讲差异化卖点
      if (f.highlights) {
        html += `<div class="product-highlight"><span class="highlight-tag">产品特点</span><span class="highlight-text">${escHtml(f.highlights)}</span></div>`;
      }
    }
    // 按后端真实类别呈现资料元数据、预览和下载操作。
    const { groups: allGroups } = productDocGroups(r);
    const groups = (cat === "all") ? allGroups : allGroups.filter((g) => (CAT_GROUP_KEYS[cat] || []).includes(g.key));
    if (groups.length) {
      html += `<div class="product-resource-slot" data-product-index="${productIndex}"></div>`;
    } else if (cat === "all" && r.specFiles && r.specFiles.length) {
      // 兜底：旧扁平结构（无分组时）
      const pdfFiles = r.specFiles.filter((x) => /\.pdf$/i.test(x)).slice(0, 3);
      if (pdfFiles.length) {
        html += `<div class="search-spec-links">`;
        pdfFiles.forEach((fname, i) => {
          const link = r.specLinks && r.specLinks[i];
          if (link) {
            html += `<a href="${link}" target="_blank" rel="noreferrer" class="spec-link">📄 ${escHtml(fname)}</a>`;
          } else {
            html += `<span class="spec-link spec-link-nourl">📄 ${escHtml(fname)}</span>`;
          }
        });
        html += `</div>`;
      }
    }
    html += `</div>`;
  }
  searchResults.innerHTML = html;
  searchResults.querySelectorAll('.product-resource-slot').forEach(slot => {
    const product = shown[Number(slot.dataset.productIndex)];
    const groups = productDocGroups(product).groups.filter(g => cat === 'all' || (CAT_GROUP_KEYS[cat] || []).includes(g.key));
    slot.replaceWith(window.ProductResources.render(product, groups));
  });
  // 同系列词条点击：填入搜索框、回到“全部”并立即搜索（硬件型号默认看完整资料）
  searchResults.querySelectorAll(".related-chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      quickSearchInput.value = btn.dataset.q;
      setActiveCat("all");
      doSearch();
    });
  });
  searchResults.style.display = "block";
}

let quickRequestId = 0;
window.invalidateQuickRequest = () => ++quickRequestId;
async function doSearch() {
  const q = quickSearchInput.value.trim();
  if (!q) return;
  if (activeCat === "software") { await renderSoftwareCategory(q); return; } // 软件分类走独立端点
  if (activeCat === "video") { await renderVideoCategory(q); return; } // 视频分类走独立端点（按操作主题，与型号无关）
  if (["spec", "manual", "other", "pending"].includes(activeCat)) { await renderDocsCategory(activeCat, q); return; } // 规格书/说明书：分组页内展开命中大类
  const requestId = ++quickRequestId;
  quickSearchBtn.disabled = true;
  quickSearchBtn.textContent = "搜索中…";
  try {
    const resp = await fetch("/api/search?q=" + encodeURIComponent(q));
    const data = await resp.json();
    if (requestId !== quickRequestId) return;
    if (!resp.ok || data.error) throw new Error(data.error || "资料服务暂不可用");
    const hwResults = data.results || [];
    // “全部”分类下硬件无命中、也不是芯片固件速查时，兜底聚合软件与操作视频，避免搜 HDPlayer / 复位 显示空：
    // 明确软件名（isList=false 单软件命中，如 HDPlayer）直达软件卡；操作词（如 复位，软件不匹配）直达视频；都不中才显示硬件空态。
    if (activeCat === "all" && !hwResults.length && !data.chipFirmware) {
      const [swData, vdData] = await Promise.all([
        fetch("/api/software?q=" + encodeURIComponent(q)).then((r) => r.json()).catch(() => ({})),
        fetch("/api/videos?q=" + encodeURIComponent(q)).then((r) => r.json()).catch(() => ({})),
      ]);
      if (requestId !== quickRequestId) return;
      const sw = swData.software;
      if (sw && Array.isArray(sw.items) && sw.items.length && sw.isList === false) {
        setActiveCat("software");
        updateQuickExamples();
        await renderSoftwareCategory(q);
        return;
      }
      const vd = vdData.video;
      const vTotal = vd && typeof vd.total === "number"
        ? vd.total
        : (vd && Array.isArray(vd.groups) ? vd.groups.reduce((s, g) => s + ((g.videos || []).length), 0) : 0);
      if (vTotal > 0) {
        setActiveCat("video");
        updateQuickExamples();
        await renderVideoCategory(q);
        return;
      }
    }
    lastSearch = { results: hwResults, query: q, data };
    renderSearchResults(lastSearch.results, q, data);
  } catch (err) {
    if (requestId !== quickRequestId) return;
    searchResults.innerHTML = `<div class="search-empty" style="color:#c00">搜索失败：${escHtml(err.message)}</div>`;
    searchResults.style.display = "block";
  } finally {
    quickSearchBtn.disabled = false;
    quickSearchBtn.textContent = "搜索";
  }
}

// 「软件」分类：软件与型号无关，走确定性 /api/software；单软件给完整卡，全家桶给清单（点“视频/资料”原地展开卡片，不跳小灰机）
async function fetchSoftware(kw) {
  const resp = await fetch("/api/software?q=" + encodeURIComponent(kw));
  const data = await resp.json();
  if (!resp.ok || data.error) throw new Error(data.error || "资料服务暂不可用");
  return data.software || null;
}
async function renderSoftwareCategory(qArg) {
  const requestId = ++quickRequestId;
  const kw = (qArg == null ? quickSearchInput.value.trim() : String(qArg).trim());
  searchResults.innerHTML = `<div class="search-empty">软件资料加载中…</div>`;
  searchResults.style.display = "block";
  let sw = null, notFound = false;
  try {
    sw = await fetchSoftware(kw);
    if (requestId !== quickRequestId) return;
    if (!sw && kw) { sw = await fetchSoftware(""); notFound = true; } // 具体词没匹配 → 退回软件全家桶
    if (requestId !== quickRequestId) return;
  } catch (err) {
    if (requestId !== quickRequestId) return;
    searchResults.innerHTML = `<div class="search-empty" style="color:#c00">软件资料加载失败：${escHtml(err.message)}</div>`;
    return;
  }
  const items = (sw && Array.isArray(sw.items)) ? sw.items : [];
  if (!items.length) {
    searchResults.innerHTML = `<div class="search-empty">未找到相关软件，可直接输入软件名（如 HDPlayer）</div>`;
    searchResults.style.display = "block";
    return;
  }
  searchResults.innerHTML = "";
  const head = document.createElement("div");
  head.className = "search-count";
  head.textContent = notFound
    ? `未找到与"${escHtml(kw)}"相关的软件，以下是 HD 软件全家桶，点“视频/资料”查看`
    : (sw.isList ? "灰度 HD 软件全家桶（含手机 APP、云平台），点“视频/资料”看操作视频与说明书" : "软件资料");
  searchResults.appendChild(head);
  if (!sw.isList && items.length === 1) {
    searchResults.appendChild(buildSoftwareCard(items[0]));
  } else {
    const list = buildSoftwareGroupedList(items, (s) => {
      const row = document.createElement("div");
      row.className = "sw-list-item";
      const main = document.createElement("div");
      main.className = "sw-list-main";
      const title = document.createElement("div");
      title.className = "sw-list-title";
      const tname = document.createElement("span"); tname.className = "sw-name"; tname.textContent = s.name + " ";
      const ltag = document.createElement("span"); ltag.className = "sw-line-tag"; ltag.textContent = s.line || "";
      title.append(tname, ltag);
      const purpose = document.createElement("div");
      purpose.className = "sw-list-purpose"; purpose.textContent = s.purpose;
      main.append(title, purpose);
      const acts = document.createElement("div");
      acts.className = "sw-row-actions";
      const hasMedia = (s.videos && s.videos.primary) || (s.manuals && s.manuals.length);
      if (hasMedia) {
        const detail = document.createElement("button");
        detail.type = "button"; detail.className = "sw-btn-detail"; detail.textContent = "视频/资料";
        detail.addEventListener("click", () => row.replaceWith(buildSoftwareCard(s))); // 原地展开，不跳问答区
        acts.appendChild(detail);
      }
      if (s.hasDownloader && s.downloadUrl) {
        const dl = document.createElement("a");
        dl.className = "sw-btn-download sw-btn-sm"; dl.href = s.downloadUrl; dl.target = "_blank"; dl.rel = "noopener";
        dl.textContent = "下载";
        acts.appendChild(dl);
      } else if (s.mobile) {
        const mb = document.createElement("button");
        mb.type = "button"; mb.className = "sw-btn-detail";
        mb.textContent = s.mobile.webUrl ? "网页/手机版" : "手机下载";
        mb.addEventListener("click", () => row.replaceWith(buildSoftwareCard(s))); // 原地展开完整入口
        acts.appendChild(mb);
      } else {
        const nd = document.createElement("span");
        nd.className = "sw-row-nodl"; nd.textContent = "手机/云端";
        acts.appendChild(nd);
      }
      row.append(main, acts);
      return row;
    });
    searchResults.appendChild(list);
  }
  searchResults.style.display = "block";
}

// 「视频」分类：操作/教学视频按操作主题组织，与型号无关，走确定性 /api/videos；默认折叠，展开才拉流，省流量
async function fetchVideos(kw) {
  const resp = await fetch("/api/videos?q=" + encodeURIComponent(kw));
  const data = await resp.json();
  if (!resp.ok || data.error) throw new Error(data.error || "资料服务暂不可用");
  return data.video || null;
}
function videoFileName(name) {
  return /\.mp4$/i.test(name) ? name : name + ".mp4";
}
// 单条视频：折叠行（▶ 名称 + 大小），展开后内嵌播放器 + 下载
function buildVideoItem(v) {
  const det = document.createElement("details");
  det.className = "vid-item";
  const sum = document.createElement("summary");
  sum.innerHTML = `<span class="vid-ico">▶</span><span class="vid-name"></span><span class="vid-size"></span>`;
  sum.querySelector(".vid-name").textContent = v.name;
  sum.querySelector(".vid-size").textContent = v.sizeText || "";
  const body = document.createElement("div");
  body.className = "vid-body";
  const video = document.createElement("video");
  video.controls = true;
  video.preload = "none"; // 不点播放不加载视频流，省 OSS 流量
  video.setAttribute("playsinline", "");
  video.src = v.url;
  const dl = document.createElement("a");
  dl.className = "sw-link vid-dl";
  dl.href = v.url; dl.target = "_blank"; dl.rel = "noopener";
  dl.setAttribute("download", videoFileName(v.name));
  dl.textContent = "下载视频";
  body.append(video, dl);
  det.append(sum, body);
  return det;
}
async function renderVideoCategory(qArg) {
  const requestId = ++quickRequestId;
  const kw = (qArg == null ? quickSearchInput.value.trim() : String(qArg).trim());
  searchResults.innerHTML = `<div class="search-empty">操作视频加载中…</div>`;
  searchResults.style.display = "block";
  let vd = null;
  try {
    vd = await fetchVideos(kw);
    if (requestId !== quickRequestId) return;
  } catch (err) {
    if (requestId !== quickRequestId) return;
    searchResults.innerHTML = `<div class="search-empty" style="color:#c00">操作视频加载失败：${escHtml(err.message)}</div>`;
    return;
  }
  const groups = vd && Array.isArray(vd.topicGroups) ? vd.topicGroups : (vd && Array.isArray(vd.groups)) ? vd.groups : [];
  const total = (vd && typeof vd.total === "number")
    ? vd.total
    : groups.reduce((s, g) => s + (g.videos ? g.videos.length : 0), 0);
  searchResults.innerHTML = "";
  if (!total) {
    const empty = document.createElement("div");
    empty.className = "search-empty";
    empty.textContent = `没有找到与"${kw}"相关的操作视频，可换个关键词（如 复位 / WiFi / U盘 / 拼接 / 节目）`;
    const btn = document.createElement("button");
    btn.type = "button"; btn.className = "sw-btn-detail vid-all-btn"; btn.textContent = "浏览全部视频";
    btn.addEventListener("click", () => { quickSearchInput.value = ""; renderVideoCategory(""); });
    searchResults.append(empty, btn);
    searchResults.style.display = "block";
    return;
  }
  const head = document.createElement("div");
  head.className = "search-count";
  head.textContent = kw
    ? `找到 ${total} 个与"${escHtml(kw)}"相关的操作视频（点标题在线播放，也可下载）`
    : "操作视频 · 共 " + total + " 个 · 可搜索复位、WiFi、U盘等关键词";
  searchResults.appendChild(head);
  const wrap = document.createElement("div");
  wrap.className = "vid-catalog";
  let firstDetails = null;
  if (groups.length === 1) wrap.classList.add("video-catalog-flat");
  groups.forEach((g) => {
    const grp = document.createElement("details");
    grp.className = "doc-cat-group video-cat-group";
    if (kw || groups.length === 1) grp.open = true; // 搜索时命中的场景大类自动展开；全量浏览默认收起
    const sum = document.createElement("summary");
    sum.innerHTML = '<span class="vid-ico">\u25B6</span><span class="dcg-label"></span><span class="dcg-count"></span>';
    const videoLabels = {app:"手机 APP",cloud:"云平台",hdplayer:"HDPlayer",hdset:"HDSet",hdshow:"HD Show",hdsign:"HDSign"};
    sum.querySelector(".dcg-label").textContent = videoLabels[g.label] || g.label;
    sum.querySelector(".dcg-count").textContent = "（" + g.count + "）";
    const body = document.createElement("div");
    body.className = "doc-cat-group-body";
    (g.videos || []).forEach((v) => {
      const det = buildVideoItem(v);
      body.appendChild(det);
      if (!firstDetails) firstDetails = det;
    });
    grp.append(sum, body);
    wrap.appendChild(grp);
  });
  searchResults.appendChild(wrap);
  searchResults.style.display = "block";
  // 有关键词且结果不多时，自动展开第一条并定位，客户直接能看
  if (kw && total <= 6 && firstDetails) {
    firstDetails.open = true;
    setTimeout(() => firstDetails.scrollIntoView({ behavior: "smooth", block: "center" }), 80);
  }
}

// 问答区（小灰机）明确要操作视频时的回答：内嵌可播放列表，企微仍走 reply 里的快查站深链
function renderVideoAnswer(items) {
  const frag = document.createDocumentFragment();
  const intro = document.createElement("div");
  intro.className = "sw-intro";
  intro.textContent = "为你找到以下操作视频，点标题在线播放，也可下载：";
  frag.appendChild(intro);
  const wrap = document.createElement("div");
  wrap.className = "vid-catalog vid-catalog-chat";
  (items || []).forEach((v) => wrap.appendChild(buildVideoItem(v)));
  frag.appendChild(wrap);
  return frag;
}

// 实时搜索（120ms防抖，参照旧项目逻辑）；软件分类下输入走软件端点
// 「规格书/说明书/固件」分类：空词全量分组浏览（固件按卡型；规格书/说明书按产品大类、组内按型号折叠），走确定性 /api/docs
// Page-local metadata cache: show the last directory immediately while refreshing.
const docsCache = new Map();
const docsPending = new Map();
const docsViews = new Map();
async function fetchDocs(cat) {
  const cached = docsCache.get(cat);
  if (cached && Date.now() - cached.time < 30000) return cached.data;
  if (docsPending.has(cat)) return docsPending.get(cat);
  const request = (async () => {
    const resp = await fetch("/api/docs?cat=" + encodeURIComponent(cat));
    const data = await resp.json();
    if (!resp.ok || data.error) throw new Error(data.error || "资料服务暂不可用");
    const docs = data.docs || null;
    if (!docs) throw new Error("资料目录响应不完整");
    const signature = JSON.stringify(docs);
    const previous = docsCache.get(cat);
    const value = previous?.signature === signature ? previous.data : docs;
    docsCache.set(cat, { data: value, signature, time: Date.now() });
    return value;
  })();
  docsPending.set(cat, request);
  try { return await request; }
  finally { docsPending.delete(cat); }
}

function docPillEl(it, isFw) {
  const available = it.available !== false && typeof it.url === "string" && /^(https?:\/\/|\/[^/])/i.test(it.url);
  const a = document.createElement(available ? "a" : "span");
  a.className = "doc-link" + (isFw ? " fw-link" : "") + (available ? "" : " doc-link-nourl");
  if (available) a.href = it.url;
  a.target = "_blank";
  a.rel = "noreferrer";
  a.textContent = it.clean || it.name || "下载";
  const unavailableMessage = it.unavailableMessage || "暂未提供原文件链接";
  a.title = (it.name || it.clean || "") + (available ? "" : "（" + unavailableMessage + "）");
  if (!available) {
    const note = document.createElement("small");
    note.className = "doc-unavailable-reason";
    note.textContent = " · " + unavailableMessage;
    a.appendChild(note);
  }
  if (!available) a.setAttribute("aria-disabled", "true");
  if (isFw && it.name) a.setAttribute("download", it.name);
  return a;
}
function docCatSummary(text, sizeText) {
  const det = document.createElement("details");
  det.className = "vid-item doc-cat-item";
  const sum = document.createElement("summary");
  const ico = document.createElement("span"); ico.className = "vid-ico"; ico.textContent = "\u25B6";
  const nm = document.createElement("span"); nm.className = "vid-name"; nm.textContent = text;
  const sz = document.createElement("span"); sz.className = "vid-size"; sz.textContent = sizeText;
  sum.append(ico, nm, sz);
  const body = document.createElement("div");
  body.className = "vid-body doc-cat-body";
  det.append(sum, body);
  return { det, body };
}
// 资料目录：按型号展开元数据及原件操作，避免一次铺满全部文件。
function docFlatRow(model, items, cat) {
  const row = document.createElement("div");
  row.className = "doc-flat";
  const nm = document.createElement("span");
  nm.className = "doc-flat-name";
  nm.textContent = model;
  const links = document.createElement("span");
  links.className = "doc-flat-links";
  if (cat && window.ProductResources) {
    const listing = document.createElement('details');
    listing.className = 'pr-directory-files';
    const documents = window.ProductResources.unique(items || []);
    const summary = document.createElement('summary');
    summary.textContent = documents.length + ' 份资料 · 查看版本与原件';
    listing.appendChild(summary);
    let loaded = false;
    listing.dataset.docState = cat + ':model:' + model;
    listing.addEventListener('toggle', () => {
      if (!listing.open || loaded) return;
      loaded = true;
      documents.forEach(item => listing.appendChild(window.ProductResources.row(item, { key: cat, label: CAT_LABEL[cat] || '资料' })));
    });
    links.appendChild(listing);
  } else {
    (items || []).forEach(it => links.appendChild(docPillEl(it, false)));
  }
  row.append(nm, links);
  return row;
}

function docsViewKey(cat, q) { return JSON.stringify([cat, q]); }
function rememberDocsView(key, docs) {
  docsViews.delete(key);
  docsViews.set(key, { docs, nodes: [...searchResults.childNodes] });
  while (docsViews.size > 8) docsViews.delete(docsViews.keys().next().value);
}
function presentDocs(cat, query, docs) {
  const key = docsViewKey(cat, query), view = docsViews.get(key);
  searchResults.style.display = 'block';
  if (view?.docs === docs) {
    searchResults.replaceChildren(...view.nodes);
    return;
  }
  const states = new Map();
  if (view) for (const node of view.nodes) {
    if (node.querySelectorAll) node.querySelectorAll('details[data-doc-state]').forEach(d => states.set(d.dataset.docState, d.open));
    if (node.matches?.('details[data-doc-state]')) states.set(node.dataset.docState, node.open);
  }
  renderDocsView(cat, query, docs, states);
  rememberDocsView(key, docs);
}
async function renderDocsCategory(cat, qArg) {
  const requestId = ++quickRequestId;
  const query = qArg == null ? quickSearchInput.value.trim() : String(qArg).trim();
  const catLabel = CAT_LABEL[cat] || '资料';
  const cached = docsCache.get(cat);
  if (cached) presentDocs(cat, query, cached.data);
  else {
    searchResults.innerHTML = '<div class="search-empty">' + catLabel + '目录准备中…</div>';
    searchResults.style.display = 'block';
  }
  const status = document.createElement('p');
  status.className = 'docs-refresh-status'; status.setAttribute('role', 'status');
  status.textContent = cached && Date.now() - cached.time >= 30000 ? '已显示缓存目录，正在检查更新…' : '';
  searchResults.appendChild(status);
  try {
    const docs = await fetchDocs(cat);
    if (requestId !== quickRequestId) return;
    if (!cached || docs !== cached.data) presentDocs(cat, query, docs);
    status.remove();
  } catch (err) {
    if (requestId !== quickRequestId) return;
    if (cached) status.textContent = '更新失败，仍显示已缓存目录：' + err.message;
    else {
      searchResults.replaceChildren();
      const message = document.createElement('p'); message.className = 'search-empty'; message.textContent = catLabel + '目录读取失败：' + err.message;
      const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = '重试'; retry.onclick = () => renderDocsCategory(cat, query);
      searchResults.append(message, retry);
    }
  }
}
function renderDocsView(cat, qArg, docs, states = new Map()) {
  const catLabel = CAT_LABEL[cat] || '资料';
  const groups = (docs && Array.isArray(docs.groups)) ? docs.groups : [];
  if (!groups.length) {
    searchResults.innerHTML = '<div class="search-empty">暂无' + catLabel + '，可在上方输入产品型号（如 R708、C16）查询</div>';
    searchResults.style.display = "block";
    return;
  }
  searchResults.innerHTML = "";
  const head = document.createElement("div");
  head.className = "search-count";
  if (cat === "firmware") {
    head.textContent = "固件 · 共 " + (docs.modelCount || groups.length) + " 款卡；下载前核对设备型号、硬件版本和文件适用条件。";
  } else if (cat === "spec") {
    head.textContent = "规格书 · 按产品大类分类（共 " + docs.modelCount + " 款产品、" + docs.total + " 份，点链接直接打开或下载；也可在上方直接搜型号）";
  } else {
    head.textContent = "使用说明书 · 按产品大类分类（共 " + docs.modelCount + " 款产品、" + docs.total + " 份，点链接直接打开或下载；也可在上方直接搜型号）";
  }
  searchResults.appendChild(head);
  const wrap = document.createElement("div");
  wrap.className = "vid-catalog";
  if (cat === "firmware") {
    groups.forEach((g) => {
      const pack = docCatSummary(g.label, g.count + " 个固件");
      g.items.forEach((it) => pack.body.appendChild(docPillEl(it, true)));
      wrap.appendChild(pack.det);
    });
  } else {
    const kwFlat = (qArg == null ? quickSearchInput.value.trim() : String(qArg).trim());
    const kwUp = kwFlat.toUpperCase();
    const modelHit = (p) => {
      if (!kwUp) return true;
      if (String(p.model || "").toUpperCase().includes(kwUp)) return true;
      return (p.items || []).some((it) => String(it.clean || it.name || "").toUpperCase().includes(kwUp));
    };
    let shownModels = 0;
    groups.forEach((g) => {
      const prods = (g.products || []).filter(modelHit);
      if (kwUp && !prods.length) return; // 搜索时未命中的大类直接隐藏
      shownModels += prods.length;
      const det = document.createElement("details");
      det.className = "doc-cat-group";
      const groupState = cat + ':group:' + (g.key || g.label);
      det.dataset.docState = groupState;
      det.open = states.has(groupState) ? states.get(groupState) : !!kwUp || groups.length === 1;
      const sum = document.createElement("summary");
      sum.innerHTML = '<span class="vid-ico">\u25B6</span><span class="dcg-label"></span><span class="dcg-count"></span>';
      sum.querySelector(".dcg-label").textContent = g.label;
      sum.querySelector(".dcg-count").textContent = kwUp
        ? "（" + prods.length + " / " + g.count + " 项命中）"
        : "（" + g.count + " 项 / " + g.fileCount + " 条关联）";
      const body = document.createElement("div");
      body.className = "doc-cat-group-body";
      let built = false, position = 0;
      const progress = document.createElement('p'); progress.className = 'docs-list-progress'; progress.textContent = '文件列表准备中…';
      function fillList() {
        if (built) return;
        built = true;
        body.appendChild(progress);
        function chunk() {
          const fragment = document.createDocumentFragment();
          const end = Math.min(position + 8, prods.length);
          while (position < end) {
            const product = prods[position++];
            const row = docFlatRow(product.model, product.items, cat);
            const listing = row.querySelector('details[data-doc-state]');
            if (listing && states.has(listing.dataset.docState)) listing.open = states.get(listing.dataset.docState);
            fragment.appendChild(row);
          }
          body.insertBefore(fragment, progress);
          if (position < prods.length) setTimeout(chunk, 0);
          else progress.remove();
        }
        requestAnimationFrame(chunk);
      }
      det.addEventListener('toggle', () => { if (det.open) fillList(); });
      if (det.open) fillList();
      det.append(sum, body);
      wrap.appendChild(det);
    });
    if (kwUp && !shownModels) {
      searchResults.innerHTML = '<div class="search-empty">没有找到与“' + escHtml(kwFlat) + '”相关的' + catLabel + '，可换个型号（如 R708、VP210）再搜</div>';
      searchResults.style.display = "block";
      return;
    }
    head.textContent = catLabel + " · " + docs.modelCount + " 个产品/资料主题 · " + (docs.uniqueFileCount ?? docs.total) + " 份资料"
      + (kwUp ? " · 匹配 " + shownModels + " 款" : " · 可输入型号筛选");
    if (groups.length === 1) wrap.classList.add("doc-catalog-flat");
  }
  searchResults.appendChild(wrap);
  searchResults.style.display = "block";
}

let searchTimer = null;
function scheduleSearch() {
  ++quickRequestId;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    const q = quickSearchInput.value.trim();
    if (!q) {
      if (activeCat === "video") { renderVideoCategory(""); return; } // 视频分类空词=浏览全部分组
      if (activeCat === "software") { renderSoftwareCategory(""); return; } // 软件分类空词=软件全家桶
      if (["spec", "manual", "other", "pending"].includes(activeCat) || activeCat === "firmware") { renderDocsCategory(activeCat, ""); return; } // 资料分类空词=全量分组浏览
      lastSearch = null;
      searchResults.innerHTML = "";
      searchResults.style.display = "none";
      updateQuickExamples();
      return;
    }
    updateQuickExamples();
    if (activeCat === "software") renderSoftwareCategory(q);
    else if (activeCat === "video") renderVideoCategory(q);
    else if (["spec", "manual", "other", "pending"].includes(activeCat)) renderDocsCategory(activeCat, q);
    else doSearch();
  }, 120);
}

// 点分类：软件走独立端点；规格书/说明书/固件对当前产品结果本地过滤；空词先提示输入型号
function onPickCategory(cat) {
  ++quickRequestId;
  setActiveCat(cat);
  updateQuickExamples();
  const q = quickSearchInput.value.trim();
  if (cat === "software") { renderSoftwareCategory(q); return; }
  if (cat === "video") { renderVideoCategory(q); return; } // 视频与型号无关，空词也直接浏览全部分组
  if (["spec", "manual", "other", "pending"].includes(cat)) { renderDocsCategory(cat, q); return; } // 规格书/说明书：分组折叠页，带词则展开命中大类
  if (!q) {
    if (["spec", "manual", "other", "pending"].includes(cat) || cat === "firmware") { renderDocsCategory(cat, ""); return; } // 资料分类空词=全量分组浏览
    if (cat === "all") {
      searchResults.innerHTML = "";
      searchResults.style.display = "none";
    }
    return;
  }
  if (lastSearch) renderSearchResults(lastSearch.results, lastSearch.query, lastSearch.data);
  else doSearch();
}

quickSearchInput.addEventListener("input", scheduleSearch);
quickSearchBtn.addEventListener("click", doSearch);
quickSearchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.isComposing) {
    clearTimeout(searchTimer);
    doSearch();
  }
});
if (quickCats) {
  quickCats.querySelectorAll(".qc-btn").forEach((b) =>
    b.addEventListener("click", () => onPickCategory(b.dataset.cat)));
}

// 深链：/huiai?q=问题 → 小灰机直接发问；/wiki?q=词 → 快查站直接搜索；旧根路径 /?q=问题 → 落小灰机发问（补切 ai 视图，修消息渲染在隐藏区的问题）
(function bootstrapDeepLink() {
  try {
    const p = location.pathname.replace(/\/+$/, "") || "/";
    const m = /[?&]q=([^&]*)/.exec(location.search);
    const deepQ = m ? decodeURIComponent(m[1] || "").trim() : "";
    if (p === "/wiki" || p === "/quick") {
      applyView("quick", { push: false });
      setActiveCat("all"); // 初始化分类按钮态，并按屏宽设置“全部”输入提示（窄屏短版）
      const cm = /[?&]cat=([^&]*)/.exec(location.search);
      const deepCat = cm ? decodeURIComponent(cm[1] || "").trim() : "";
      if (deepCat === "video" && quickSearchInput) {
        setActiveCat("video");
        quickSearchInput.value = deepQ;
        updateQuickExamples();
        setTimeout(() => renderVideoCategory(deepQ), 60); // /wiki?cat=video&q=复位 → 直达视频分类
      } else if (deepCat === "software" && quickSearchInput) {
        setActiveCat("software");
        quickSearchInput.value = deepQ;
        updateQuickExamples();
        setTimeout(() => renderSoftwareCategory(deepQ), 60); // /wiki?cat=software&q=HDPlayer → 直达软件分类
      } else if ((deepCat === "spec" || deepCat === "manual") && quickSearchInput) {
        setActiveCat(deepCat);
        quickSearchInput.value = deepQ;
        updateQuickExamples();
        setTimeout(() => renderDocsCategory(deepCat, deepQ), 60); // /wiki?cat=spec&q=R708 → 展开命中大类
      } else if (deepCat === "firmware" && quickSearchInput) {
        setActiveCat(deepCat);
        quickSearchInput.value = deepQ;
        updateQuickExamples();
        setTimeout(() => { if (deepQ) { doSearch(); } else { renderDocsCategory(deepCat, ""); } }, 60); // /wiki?cat=firmware → 固件分组；带型号 → 产品卡
      } else if (deepQ && quickSearchInput) { quickSearchInput.value = deepQ; setTimeout(doSearch, 60); }
    } else if (p === "/huiai") {
      applyView("ai", { push: false });
      if (deepQ) { aiInput.value = deepQ; setTimeout(() => sendMessage(deepQ), 60); }
    } else if (deepQ) {
      applyView("ai", { push: false });
      aiInput.value = deepQ;
      setTimeout(() => sendMessage(deepQ), 60);
    }
  } catch (e) { /* 深链解析失败不影响正常页面 */ }
})();

// ============ 可拖拽悬浮吉祥物（仅网页；企微无悬浮控件） ============
// 快查站页放「小灰机」，点它跳小灰机问答；小灰机页放红色「闪电侠」，点它回快查站。位置记忆、可拖、周期冒泡。
(function initMascots() {
  const MOVE_TOL = 8;
  // 默认位置改版：版本不一致时，作废上一版存下的所有拖拽位置，回到统一出厂默认（CSS 右侧垂直居中）；在新版下拖动仍逐视图记忆
  const MASCOT_POS_VER = "center-v1";
  try {
    if (localStorage.getItem("xhj_mascot_pos_ver") !== MASCOT_POS_VER) {
      ["quick", "ai"].forEach((v) => localStorage.removeItem("xhj_mascot_pos_" + v));
      localStorage.setItem("xhj_mascot_pos_ver", MASCOT_POS_VER);
    }
  } catch (e) {}
  // 闪电侠卡通头像（红色头盔 + 两侧金色横闪电耳翼 + 白色上挑瞪眼 + 露下巴），纯内联 SVG、无外部资源
  // 红金机甲英雄（Q 版钢铁侠风格）圆形头像，图片资源；位于小灰机问答页，点击回快查站
  const FLASH_SVG =
    '<img class="xm-iron" src="img/mascot-iron.png" alt="快速查参数" width="60" height="60">';
  const defs = [
    { view: "quick", cls: "mascot-plane", glyph: "\u{1F916}", target: "ai", bubble: "配单、售后故障，点我问小灰机" },
    { view: "ai", cls: "mascot-bolt", svg: FLASH_SVG, target: "quick", bubble: "快速查参数、找资料，点我" },
  ];
  defs.forEach((d) => {
    const el = document.createElement("div");
    el.className = "xhj-mascot " + d.cls;
    const orbInner = d.svg ? d.svg : `<span class="xm-glyph"></span>`;
    el.innerHTML =
      `<div class="xm-bubble"><span class="xm-bubble-text"></span><span class="xm-bubble-close" title="关闭">×</span></div>` +
      `<div class="xm-orb">${orbInner}</div>`;
    const bubble = el.querySelector(".xm-bubble");
    el.querySelector(".xm-bubble-text").textContent = d.bubble;
    const glyphEl = el.querySelector(".xm-glyph");
    if (glyphEl) glyphEl.textContent = d.glyph;
    el.querySelector(".xm-bubble-close").addEventListener("click", (ev) => {
      ev.stopPropagation(); bubble.classList.remove("show");
    });
    document.body.appendChild(el);

    // 冒泡：切到本视图（含首次进入）时打个招呼，之后周期性提醒；6.5s 自动收起
    let isActive = false, hideTimer = null;
    const pop = () => {
      if (document.body.dataset.view !== d.view) return;
      bubble.classList.add("show");
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => bubble.classList.remove("show"), 6500);
    };
    const isNarrow = () => window.matchMedia("(max-width:640px)").matches;
    const syncVis = () => {
      const nowActive = document.body.dataset.view === d.view;
      el.classList.toggle("is-active", nowActive);
      // 刚切到本视图 → 冒个泡引导；窄屏(手机)首屏要让客户先读完欢迎语，跳过首次自动冒泡
      if (nowActive && !isActive && !isNarrow()) setTimeout(() => pop(), 1200);
      isActive = nowActive;
    };
    syncVis();
    new MutationObserver(syncVis).observe(document.body, { attributes: true, attributeFilter: ["data-view"] });

    // 恢复记忆位置
    const posKey = "xhj_mascot_pos_" + d.view;
    try {
      const saved = JSON.parse(localStorage.getItem(posKey) || "null");
      if (saved && typeof saved.left === "number" && typeof saved.top === "number") {
        el.style.left = saved.left + "px"; el.style.top = saved.top + "px";
        el.style.right = "auto"; el.style.bottom = "auto";
      }
    } catch (e) { /* 位置损坏用默认 */ }

    // 周期冒泡（窄屏间隔拉长到 40s，减少遮挡对话）
    setInterval(() => { if (!bubble.classList.contains("show")) setTimeout(pop, 400); }, isNarrow() ? 40000 : 22000);

    // 拖拽（pointer 事件统一鼠标/触摸）；位移小于阈值视为点击 → 互跳
    const orb = el.querySelector(".xm-orb");
    // mascotdrag-fix-20260920：禁用吉祥物(含 <img>)的原生 HTML5 拖拽与文字选中，拖动只走 pointer 自绘，
    // 不再产生拖影、不再抢走 pointer，也不会误入聊天区图片拖放(OCR)；图片点选/粘贴/拖入链路保持不变
    orb.querySelectorAll("img").forEach((im) => { try { im.draggable = false; } catch (e) {} });
    ["dragstart", "selectstart"].forEach((evName) => orb.addEventListener(evName, (e2) => e2.preventDefault()));
    let dragging = false, moved = false, jumpFired = false, startX = 0, startY = 0, baseLeft = 0, baseTop = 0;
    const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
    // 点击互跳：pointerup 与 click 双保险（部分 WebView / 自动化只派发 click），jumpFired 保证只跳一次；发生拖拽(moved)不跳
    const doJump = () => {
      if (dragging || moved || jumpFired) return;
      jumpFired = true;
      history.pushState({ view: d.target }, "", VIEW_PATHS[d.target]);
      applyView(d.target, { push: false });
    };
    orb.addEventListener("pointerdown", (ev) => {
      dragging = true; moved = false; jumpFired = false;
      startX = ev.clientX; startY = ev.clientY;
      const r = el.getBoundingClientRect();
      baseLeft = r.left; baseTop = r.top;
      el.style.right = "auto"; el.style.bottom = "auto";
      el.style.left = baseLeft + "px"; el.style.top = baseTop + "px";
      try { orb.setPointerCapture(ev.pointerId); } catch (e) {}
    });
    orb.addEventListener("pointermove", (ev) => {
      if (!dragging) return;
      const dx = ev.clientX - startX, dy = ev.clientY - startY;
      if (Math.abs(dx) > MOVE_TOL || Math.abs(dy) > MOVE_TOL) { moved = true; ev.preventDefault(); }
      if (moved) {
        el.style.left = clamp(baseLeft + dx, 4, window.innerWidth - el.offsetWidth - 4) + "px";
        el.style.top = clamp(baseTop + dy, 4, window.innerHeight - el.offsetHeight - 4) + "px";
      }
    });
    const endDrag = (ev) => {
      if (!dragging) return;
      dragging = false;
      try { orb.releasePointerCapture(ev.pointerId); } catch (e) {}
      if (moved) {
        localStorage.setItem(posKey, JSON.stringify({ left: parseFloat(el.style.left), top: parseFloat(el.style.top) }));
      } else {
        doJump();
      }
    };
    orb.addEventListener("pointerup", endDrag);
    orb.addEventListener("pointercancel", () => { dragging = false; });
    orb.addEventListener("click", doJump);  // 兜底：只派发 click 的环境（部分企微 WebView / 自动化）也能互跳
  });
})();


// Only JSON catalog metadata is warmed; no document or original-file URLs are fetched.
function preloadDocumentCatalogs() {
  const warm = () => Promise.allSettled(['spec', 'manual'].map(cat => fetchDocs(cat)));
  if ('requestIdleCallback' in window) window.requestIdleCallback(warm, { timeout: 500 });
  else setTimeout(warm, 0);
}
if (document.readyState === 'complete') preloadDocumentCatalogs();
else window.addEventListener('load', preloadDocumentCatalogs, { once: true });
