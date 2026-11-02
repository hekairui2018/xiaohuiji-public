(() => {
'use strict';
// 展示层：快查站前端逻辑
// 职责：页面交互、调用后端 API、按契约渲染响应
// 禁止：意图分类、型号识别、知识检索（这些在后端）

const VIDEO_EYE='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>';
const VIDEO_EYE_OFF='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 3l18 18M10.6 5.1A10.7 10.7 0 0 1 12 5c6.5 0 10 7 10 7a15 15 0 0 1-3.2 3.9M6.4 6.5C3.5 8.3 2 12 2 12s3.5 7 10 7a11.6 11.6 0 0 0 3.8-.6"/></svg>';
let activeMediaVideo=null;
function releaseMediaVideo(video){video.pause();video.removeAttribute('src');for(const source of video.querySelectorAll('source'))source.removeAttribute('src');video.load();if(activeMediaVideo===video)activeMediaVideo=null;}
function playMediaVideo(video,url){
 if(activeMediaVideo&&activeMediaVideo!==video){const previous=activeMediaVideo;releaseMediaVideo(previous);const details=previous.closest('details.vid-item');if(details)details.open=false;}
 activeMediaVideo=video;video.src=url;video.play().catch(()=>{});
}
function stopMediaVideos(){for(const video of document.querySelectorAll('video[src]')){releaseMediaVideo(video);const details=video.closest('details.vid-item');if(details)details.open=false;}}
new MutationObserver(records=>{for(const record of records)for(const node of record.removedNodes){if(node.nodeType!==1)continue;for(const video of [...(node.tagName==='VIDEO'?[node]:[]),...node.querySelectorAll('video')])if(!video.isConnected)releaseMediaVideo(video);}}).observe(document.body,{childList:true,subtree:true});
document.addEventListener('toggle',event=>{if(event.target.tagName==='DETAILS'&&!event.target.open)for(const video of event.target.querySelectorAll('video[src]')){releaseMediaVideo(video);const item=video.closest('details.vid-item');if(item&&item!==event.target)item.open=false;}},true);
document.querySelector('.view-switch')?.addEventListener('click',stopMediaVideos);
const FrontendApp = { events: new EventTarget(), channel: null };
const aiInput = document.getElementById("aiInput");
const aiSendBtn = document.getElementById("aiSendBtn");
const aiMessages = document.getElementById("aiMessages");
// Chat scrolling and composer sizing share one presentation-only owner.
const nearChatBottom=()=>aiMessages.scrollHeight-aiMessages.clientHeight-aiMessages.scrollTop<=40;
let followChat=true,chatScrollFrame=0,readingReply=null,manualChatScroll=false;
function replyStart(){return readingReply?.isConnected?Math.max(0,Math.min(aiMessages.scrollHeight-aiMessages.clientHeight,aiMessages.scrollTop+readingReply.getBoundingClientRect().top-aiMessages.getBoundingClientRect().top-12)):aiMessages.scrollHeight;}
function followChatUpdates(){
  cancelAnimationFrame(chatScrollFrame);
  chatScrollFrame=requestAnimationFrame(()=>{if(followChat)aiMessages.scrollTop=replyStart();});
}
aiMessages.addEventListener('scroll',()=>{followChat=!manualChatScroll&&(nearChatBottom()||!!(readingReply?.isConnected&&Math.abs(aiMessages.scrollTop-replyStart())<2));},{passive:true});
const stopChatFollowing=()=>{manualChatScroll=true;followChat=false;};
aiMessages.addEventListener('wheel',stopChatFollowing,{passive:true});
aiMessages.addEventListener('pointerdown',stopChatFollowing,{passive:true});
aiMessages.addEventListener('keydown',event=>{if(['PageUp','PageDown','Home','End','ArrowUp','ArrowDown'].includes(event.key))stopChatFollowing();});
function appendChatMessage(node){
  const user=node.classList.contains('ai-msg-user'),follow=user||!manualChatScroll&&(followChat||nearChatBottom());if(user)manualChatScroll=false;aiMessages.appendChild(node);readingReply=node.classList.contains('ai-msg-assistant')?node:null;followChat=follow;if(followChat)aiMessages.scrollTop=replyStart();
}
function scrollChatToBottom(){manualChatScroll=false;followChat=true;readingReply=document.getElementById('aiLoading');aiMessages.scrollTop=replyStart();followChatUpdates();}
function resizeAiInput(){
  if(!aiInput.getClientRects().length)return;
  const follow=followChat,top=aiMessages.scrollTop,style=getComputedStyle(aiInput);
  aiInput.style.height='auto';
  const border=parseFloat(style.borderTopWidth)+parseFloat(style.borderBottomWidth);
  const height=Math.max(parseFloat(style.minHeight)||0,Math.min(aiInput.scrollHeight+border,parseFloat(style.maxHeight)||180));
  aiInput.style.height=height+'px';aiInput.style.overflowY=aiInput.scrollHeight+border>height+1?'auto':'hidden';
  if(follow)followChatUpdates();else{followChat=false;aiMessages.scrollTop=top;}
}
aiInput.addEventListener('input',resizeAiInput);
new MutationObserver(followChatUpdates).observe(aiMessages,{childList:true,subtree:true,characterData:true});
const chatContentResize=new ResizeObserver(followChatUpdates);
new MutationObserver(()=>{chatContentResize.disconnect();for(const child of aiMessages.children)chatContentResize.observe(child);}).observe(aiMessages,{childList:true});
function resizeChatViewport(){
  document.documentElement.style.setProperty('--chat-viewport-height',(window.visualViewport?.height||window.innerHeight)+'px');
  resizeAiInput();
}
window.addEventListener('resize',resizeChatViewport);window.visualViewport?.addEventListener('resize',resizeChatViewport);
resizeChatViewport();

// V2资料搜索使用/wiki；旧资料页面已移除，客服问答保持/huiai。
const VIEW_PATHS = { quick: "/wiki", ai: "/huiai" };
function viewFromPath() {
  const p = location.pathname.replace(/\/+$/, "") || "/";
  if (p === "/huiai") return "ai";
  if (p === "/wiki") return "quick";
  return localStorage.getItem("xhj_view") === "ai" ? "ai" : "quick";
}
// 统一视图切换：改 body 标记 + 记住偏好 + 同步顶部按钮 + 用 pushState 更新地址（opts.push=false 时只切不改地址，供初始化/ popstate / 吉祥物复用）
function applyView(view, opts) {
  const push = !opts || opts.push !== false;
  document.body.dataset.view = view;
  requestAnimationFrame(resizeChatViewport);
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
let activeSessionId;
function getSid() {
  if (activeSessionId) return activeSessionId;
  let s = localStorage.getItem("xhj_sid");
  if (!s) { s = "w-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); localStorage.setItem("xhj_sid", s); }
  activeSessionId = s;
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
    return data.reply || "";
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
  appendChatMessage(div);
  FrontendApp.events.dispatchEvent(new CustomEvent("user-message", {detail:{text,imageDataUrl}}));
}

function addAssistantLoading(label) {
  const div = document.createElement("div");
  div.className = "ai-msg ai-msg-assistant";
  div.id = "aiLoading";
  const lb0 = document.createElement("div");
  lb0.className = "ai-msg-bubble";
  lb0.textContent = label || "思考中…";
  div.appendChild(lb0);
  appendChatMessage(div);
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
  if (FrontendApp.channel?.render?.(data)) {
    FrontendApp.events.dispatchEvent(new CustomEvent("assistant-message", {detail:data}));
    return;
  }
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

  if ((data.result?.operation === "ordering" && data.result?.bom) || data.result?.previewBom || data.result?.nativeOrdering) {
    bubble.appendChild(renderV2Ordering(data.result));
  } else if (data.status === "answer" && data.pyramid) {
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
  appendChatMessage(div);
  FrontendApp.events.dispatchEvent(new CustomEvent("assistant-message", {detail:data}));
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
    ? "灰度软件与应用，也可以直接回复软件名："
    : "为你找到以下相关软件：";
  frag.appendChild(intro);
  frag.appendChild(buildSoftwareGroupedList(items, buildSoftwareRow));
  return frag;
}

// 手机 APP / 云平台入口（无 PC 下载器时）：网页版、App Store、安卓落地页 + 商店搜索提示
function buildMobileActions(s) {
  if (s.access) return buildSoftwareAccessButton(s);
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

  // 复用视频目录条目，所有视频平级且默认收起。
  const videos = window.VideoGroups.softwareVideos(s);
  if (videos.length) {
    const section = document.createElement("div");
    section.className = "sw-video-list";
    const label = document.createElement("div");
    label.className = "sw-sec-label"; label.textContent = `视频 · ${videos.length}`;
    section.appendChild(label);
    videos.forEach(v => section.appendChild(buildVideoItem(v)));
    card.appendChild(section);
  }

  // ② 中文使用说明书：可点胶囊（OSS 上 PDF，点开下载/查看）
  if (s.manuals && s.manuals.length) {
    const mwrap = document.createElement("div");
    mwrap.className = "sw-manuals";
    const lab = document.createElement("div");
    lab.className = "sw-sec-label"; lab.textContent = "说明书";
    const row = document.createElement("div");
    row.className = "sw-doc-row";
    s.manuals.forEach((m) => {
      const a = document.createElement("a");
      a.className = "sw-doc-link"; a.href = m.previewUrl || m.url; a.target = "_blank"; a.rel = "noopener";
      a.textContent = m.label;
      const file=document.createElement('div');file.className='software-manual-file';file.append(a,window.ProductResources.fileActions({...m,name:m.name||m.label},{compact:true}));row.appendChild(file);
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
    dl.textContent = "下载软件";
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
  styleSoftwareActions(actions, s);
  card.appendChild(actions);
  return card;
}

// 软件列表沿用文件区的蓝色图标操作，保留原按钮及事件。
function styleSoftwareActions(actions, software) {
  // Copy only explicit public destinations; never turn a local QR image into a download URL.
  actions.querySelectorAll('a.sw-btn-download').forEach(link=>{
    if(link.nextElementSibling?.classList.contains('software-copy'))return;
    const url=link.getAttribute('href');
    if(!/^https?:\/\//i.test(url||''))return;
    const hostname=new URL(url).hostname;
    if(/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(hostname))return;
    const copy=window.ProductResources.copyButton({downloadUrl:url});
    copy.classList.add('software-copy');copy.title='复制链接：'+software.name+' · '+link.textContent;
    copy.setAttribute('aria-label',copy.title);link.after(copy);
  });
  actions.querySelectorAll('.sw-btn-detail, .sw-btn-download').forEach(action => {
    const download=action.classList.contains('sw-btn-download');
    // 扫码和地区访问入口保留原文字，只有实际安装包使用下载图标。
    if(download && !(software.hasDownloader && software.downloadUrl && action.getAttribute('href')===software.downloadUrl))return;
    if(!download && action.textContent !== '资料')return;
    action.classList.add('sw-icon-action',download?'sw-icon-download':'sw-icon-preview');
    const label=(download?'下载软件：':'查看视频与说明书：')+software.name;
    action.title=label;action.setAttribute('aria-label',label);
  });
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
  const hasMedia = window.VideoGroups.softwareVideos(s).length || (s.manuals && s.manuals.length);
  if (hasMedia) {
    const detail = document.createElement("button");
    detail.type = "button"; detail.className = "sw-btn-detail";
    detail.textContent = "资料";
    detail.addEventListener("click", () => sendMessage(s.name));
    acts.appendChild(detail);
  }
  if (s.hasDownloader && s.downloadUrl) {
    const dl = document.createElement("a");
    dl.className = "sw-btn-download sw-btn-sm"; dl.href = s.downloadUrl; dl.target = "_blank"; dl.rel = "noopener";
    dl.textContent = "下载";
    acts.appendChild(dl);
  } else if (s.access) {
    acts.appendChild(buildSoftwareAccessButton(s));
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
  styleSoftwareActions(acts, s);
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
function prepareLegacyMessage(text, forceText) {
  if (forceText === undefined) {
    // 手动输入：若是“裸序号”且上一轮刚给过选项，等价于点对应按钮（1 / 1) / 1. / ①）；多位型号 410/6363 不拦截
    let _idx = -1;
    const _plain = text.match(/^(\d{1,2})[.、)）]?$/);
    const _circ = text.match(/^[①②③④⑤⑥⑦⑧⑨⑩]$/);
    if (_circ) _idx = "①②③④⑤⑥⑦⑧⑨⑩".indexOf(_circ[0]);
    else if (_plain) _idx = parseInt(_plain[1], 10) - 1;
    const _opt = (_idx >= 0 && lastNumericOptions && Date.now() - lastNumericOptions.at < 15 * 60000)
      ? lastNumericOptions.options[_idx] : null;
    if (_opt) { sendOption(_opt); return false; }
    triagePath = null;  // 手动输入=开启新问题，清空累计路径
    lastNumericOptions = null;  // 新问题开始，上一轮序号选项失效
  }
  return true;
}
function sendMessage(forceText, displayOverride) { return FrontendApp.chat.send(forceText, displayOverride); }

aiSendBtn.addEventListener("click", () => sendMessage());
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
  if(aiImgBtn?.hidden)return;
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
function sendImageMessage(dataUrl) { return FrontendApp.chat.sendImage(dataUrl); }

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
  if(aiImgBtn?.hidden)return;
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
      if(!aiImgBtn?.hidden)el.classList.add("drag-over");
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
const CAT_LABEL = { all: "全部", spec: "规格书", manual: "说明书", software: "软件", video: "视频", firmware: "固件", 'module-config': '模组配置文件', other: "🔒 内部资料" };
const CAT_GROUP_KEYS = { spec: ["spec"], manual: ["manual"], firmware: ["firmware"], other: ["other"], pending: ["pending"] }; // 各分类在产品资料组里保留的 key
const CAT_PLACEHOLDER = {
  all: "如 R708规格书、6363固件、A5说明书、HDPlayer软件、复位视频",
  allNarrow: "R708/6363/A5/HDSet/复位",
  spec: "输入产品型号查规格书，如 R708、VP410",
  manual: "输入产品或软件名查说明书，如 A5、HDPlayer",
  software: "输入软件名，如 HDSet、HDPlayer",
  video: "输入操作 / 故障关键词，如 复位、WiFi、接线",
  firmware: "输入接收卡型号或芯片数字，如 R708、6363",
  other: "搜索目录、文件名…",
  'module-config': '输入模组型号、芯片或配置文件名…',
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
  stopMediaVideos();
  document.getElementById('catalogExpandAction')?.remove();
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
    h += `<summary>📥 接收卡固件（${escHtml(cf.firmwareSeriesLabel || "对应系列")} · ${fwItems.length} 份固件）</summary>`;
    h += `<p class="chip-fw-dl-tip">固件必须按手上接收卡的型号刷（看卡上丝印，如 R708），刷错会黑屏/花屏；列表里没有你的卡型、或拿不准，直接把接收卡型号发我。</p>`;
    h += `<div class="search-docs"><div class="doc-group doc-group-firmware">`;
    for(const it of [...fwItems].sort((a,b)=>String(a.name).localeCompare(String(b.name),'zh-Hans-CN'))){
      const name=String(it.name||''),parts=name.split('_FPGA_'),card=parts[0].replaceAll('_','/'),version=parts[1]?.match(/^V[0-9.]+/)?.[0]||'';
      const label=card+(version?' · '+version.replace(/\.$/,''):'');
      h+=`<a class="doc-link fw-link" href="${escHtml(it.url)}" title="${escHtml(name)}" target="_blank" rel="noreferrer" download="${escHtml(name)}">${escHtml(label)}</a>`;
    }
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

function hasRenderableRegistryFirmware(product) {
  const items=product.firmwareGroup?.items||[];
  return items.length>0&&items.every(item=>item.category==='接收卡'&&
    item.associationStatus==='curated-official-firmware-registry'&&/^[a-f0-9]{64}$/.test(item.sha256||'')&&
    String(item.url||'').startsWith('/v2/curated-firmware/'+item.sha256+'/'));
}

function hasConcreteProductResult(r) {
  return !!(r.features?.comparisonFields?.length||r.firmwareGroup?.items?.length||r.specFiles?.length||productDocGroups(r).groups.some(g=>g.items?.length));
}

function renderSearchResults(results, query, data) {
  if(!showOtherWikiModels)results=results.filter(r=>isOfficialWikiModel(r.modelId||r.name)||hasRenderableRegistryFirmware(r)||(wikiModelKey(r.modelId||r.name)===wikiModelKey(query)&&hasConcreteProductResult(r)));
  const cf = data && data.chipFirmware;
  const cat = (activeCat === "software" || activeCat === "video") ? "all" : activeCat; // 软件/视频分类走独立渲染，不进本函数
  const showChip = !!cf && (cat === "all" || cat === "firmware"); // 芯片固件速查卡只在“全部/固件”下出现
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
    if(data?.approximateMatch){const match=data.approximateMatch;html+=`<div class="search-count">已按 ${escHtml(match.selected)} 查询；${match.candidates.length>1?'还有其他匹配型号，请核对型号。':'请核对型号。'}</div>`;if(match.candidates.length>1){html+='<div class="related-chips"><span class="related-label">其他匹配型号：</span>';for(const model of match.candidates.filter(m=>m!==match.selected))html+=`<button type="button" class="related-chip" data-q="${escHtml(model)}">${escHtml(model)}</button>`;html+='</div>';}}
    html += `<div class="search-count">${cat === "all" ? `找到 ${shown.length} 条产品结果` : `${CAT_LABEL[cat]} · ${shown.length} 个产品`}</div>`;
    // 同系列型号快捷词条（点击即换搜）
    const chips = ((data && data.relatedChips) || []).filter(c=>showOtherWikiModels||isOfficialWikiModel(c.q));
    if (chips.length) {
      html += `<div class="related-chips"><span class="related-label">相关型号：</span>`;
      chips.forEach((c) => {
        html += `<button type="button" class="related-chip" data-q="${escHtml(c.q)}">${escHtml(c.label)}</button>`;
      });
      html += `</div>`;
    }
  }
  for (const [productIndex, r] of shown.entries()) {
    html += `<div class="search-item product-quick-card">`;
    if (window.ProductCard) html += window.ProductCard.render(r);
    else html += `<div class="search-item-name">${escHtml(r.name)}</div>`;
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
    slot.replaceWith(window.ProductResources.render(product, groups, { compact: true }));
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
let quickSearchController = null;
let mascotLastModel=null,mascotLastModelAt=0;
function mascotRemember(model){mascotLastModel=model;mascotLastModelAt=Date.now();}
function mascotGuide(event,query='',extra={}){
 const advice=window.MascotAdvice?.guide({event,query,models:officialWikiCategories.map(x=>x.model),category:activeCat,previousModel:Date.now()-mascotLastModelAt<600000?mascotLastModel:null,...extra});
 if(advice)window.dispatchEvent(new CustomEvent('v2-mascot-advice',{detail:{...advice,view:document.body.dataset.view}}));
 return advice;
}
function mascotAction(action){
 stopMediaVideos();
 if(action.type==='category'){applyView('quick');quickSearchInput.value=action.query||'';onPickCategory(action.category);}
 else if(action.type==='navigate'){applyView(action.view);}
 else if(action.type==='ask'||action.type==='confirm-model'){
  applyView('ai');if(aiInput.disabled||aiInput.value.trim()){window.dispatchEvent(new CustomEvent('v2-mascot-advice',{detail:{kind:'guide',view:'ai',title:'小灰机 · 提醒',message:'输入框已有内容或正在回答，请先处理当前问题，我没有覆盖它。'}}));return;}
  aiInput.value=action.message;resizeAiInput();aiInput.focus();if(action.type==='confirm-model')mascotRemember(action.model);
 }
}
FrontendApp.events.addEventListener('session-change',()=>{mascotLastModel=null;mascotLastModelAt=0;window.dispatchEvent(new Event('v2-mascot-reset'));});
FrontendApp.events.addEventListener('user-message',event=>mascotGuide('search',event.detail?.text||''));
window.addEventListener('v2-mascot-context',event=>mascotGuide('search',event.detail?.query||'',{chip:!!event.detail?.chip}));
FrontendApp.events.addEventListener('assistant-message',event=>{const data=event.detail;if(data?.result?.bom||data?.ordering?.bom||data?.result?.previewBom)mascotGuide('ordered');});
// Download links keep their native navigation; this only adds optional guidance.
document.addEventListener('click',event=>{const link=event.target.closest?.('a[download]');if(!link)return;const href=link.getAttribute('href')||'';if(/\/v2\/curated-firmware\//.test(href)||/\.bin(?:[?#]|$)/i.test(href)||/\.bin$/i.test(link.download))mascotGuide('firmware-download');else if(/\.ssr(?:[?#]|$)/i.test(link.download||href))mascotGuide('module-config');});
async function doSearch() {
  clearTimeout(searchTimer); // Explicit submission replaces the pending automatic search.
  const q = quickSearchInput.value.trim();
  window.dispatchEvent(new Event('v2-mascot-reset'));
  const taskAdvice=mascotGuide('search',q);
  if (activeCat === 'module-config') { await renderModuleConfigurations(q); return; }
  if (!q) return;
  updateQuickExamples(); // Preserve the final empty-state presentation previously applied by the timer.
  if (activeCat === "software") { await renderSoftwareCategory(q); return; } // 软件分类走独立端点
  if (activeCat === "video") { await renderVideoCategory(q); return; } // 视频分类走独立端点（按操作主题，与型号无关）
  if (["spec", "manual", "other", "pending"].includes(activeCat)) { await renderDocsCategory(activeCat, q); return; } // 规格书/说明书：分组页内展开命中大类
  const requestId = ++quickRequestId;
  if(quickSearchController)quickSearchController.abort();
  const controller=new AbortController();quickSearchController=controller;
  quickSearchBtn.disabled = true;
  quickSearchBtn.textContent = "搜索中…";
  try {
    const resp = await fetch("/api/search?q=" + encodeURIComponent(q),{signal:controller.signal});
    const data = await resp.json();
    if (requestId !== quickRequestId) return;
    if (!resp.ok || data.error) throw new Error(data.error || "资料服务暂不可用");
    let hwResults = data.results || [];
    // One catalogue-based resolver handles incomplete, mistyped and ambiguous identifiers.
    // Actual exact results remain authoritative; tied candidates require customer selection.
    const knownModels=officialWikiCategories.map(x=>x.model);
    const usableProducts=hwResults.filter(r=>isOfficialWikiModel(r.modelId||r.name)||hasConcreteProductResult(r));
    const resolution=window.MascotAdvice?.resolve(q,knownModels,{resultModels:usableProducts.map(r=>r.modelId||r.name)});
    if(activeCat==='all'&&!data.chipFirmware&&resolution?.autoSelect){
      const selected=resolution.autoSelect,fallbackResp=await fetch('/api/search?q='+encodeURIComponent(selected),{signal:controller.signal});
      const fallback=await fallbackResp.json();if(requestId!==quickRequestId)return;
      const match=(fallback.results||[]).filter(r=>wikiModelKey(r.modelId||r.name)===wikiModelKey(selected));
      if(fallbackResp.ok&&match.length){hwResults=match;data.results=match;data.approximateMatch={input:q,selected,candidates:resolution.candidates};}
    }
    // “全部”分类下硬件无命中、也不是芯片固件速查时，兜底聚合软件与操作视频，避免搜 HDPlayer / 复位 显示空：
    // 明确软件名（isList=false 单软件命中，如 HDPlayer）直达软件卡；操作词（如 复位，软件不匹配）直达视频；都不中才显示硬件空态。
    if (activeCat === "all" && !hwResults.length && !data.chipFirmware) {
      const [sw, vd] = await Promise.all([
        fetchSoftware(q).catch(() => null),
        fetchVideos(q).catch(() => null),
      ]);
      if (requestId !== quickRequestId) return;
      if (sw && Array.isArray(sw.items) && sw.items.length && sw.isList === false) {
        setActiveCat("software");
        updateQuickExamples();
        await renderSoftwareCategory(q);
        return;
      }
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
    const advice=window.MascotAdvice?.plan({query:q,results:hwResults.filter(r=>isOfficialWikiModel(r.modelId||r.name)||hasConcreteProductResult(r)),models:knownModels,approximateMatch:data.approximateMatch});
    const exact=hwResults.find(r=>wikiModelKey(r.modelId||r.name)===wikiModelKey(q)&&hasConcreteProductResult(r));if(exact)mascotRemember(exact.modelId||exact.name);
    if(data.chipFirmware)mascotGuide('search',q,{chip:true});
    else if(advice)window.dispatchEvent(new CustomEvent('v2-mascot-advice',{detail:{...advice,actions:advice.kind==='advantage'?taskAdvice?.actions:[]}}));
    lastSearch = { results: hwResults, query: q, data };
    renderSearchResults(lastSearch.results, q, data);
  } catch (err) {
    if (requestId !== quickRequestId || err.name==='AbortError') return;
    searchResults.innerHTML = `<div class="search-empty" style="color:#c00">搜索失败：${escHtml(err.message)}</div>`;
    searchResults.style.display = "block";
  } finally {
    if(quickSearchController===controller){quickSearchController=null;quickSearchBtn.disabled = false;quickSearchBtn.textContent = "搜索";}
  }
}

// 「软件」分类：软件与型号无关，走确定性 /api/software；单软件给完整卡，全家桶给清单（点“视频/资料”原地展开卡片，不跳小灰机）
const mediaMetadataCache = new Map();
const mediaMetadataPending = new Map();
async function fetchMediaMetadata(kind, kw = '') {
  const key = JSON.stringify([kind, kw]);
  const cached = mediaMetadataCache.get(key);
  if (cached && Date.now() - cached.time < 30000) return cached.data;
  if (mediaMetadataPending.has(key)) return mediaMetadataPending.get(key);
  const request = (async () => {
    const resp = await fetch('/api/' + (kind === 'software' ? 'software' : 'videos') + '?q=' + encodeURIComponent(kw));
    const data = await resp.json();
    if (!resp.ok || data.error) throw new Error(data.error || '资料服务暂不可用');
    const result = data[kind === 'software' ? 'software' : 'video'] || null;
    mediaMetadataCache.set(key, { data: result, time: Date.now() });
    if (mediaMetadataCache.size > 32) mediaMetadataCache.delete(mediaMetadataCache.keys().next().value);
    return result;
  })();
  mediaMetadataPending.set(key, request);
  try { return await request; } finally { mediaMetadataPending.delete(key); }
}
async function fetchSoftware(kw) { return fetchMediaMetadata('software', kw); }

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
    ? `未找到与"${escHtml(kw)}"相关的软件，以下是 HD 软件全家桶，点“资料”查看`
    : (sw.isList ? "灰度软件与应用" : "软件资料");
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
      if(!window.VideoGroups.softwareVideos(s).length){const note=document.createElement('small');note.className='software-no-video';note.textContent='暂未收录该软件的专用教学视频';main.append(note);}
      const acts = document.createElement("div");
      acts.className = "sw-row-actions";
      let expandedCard=null;
      const toggleDetails=(button)=>{
        if(expandedCard){
          expandedCard.querySelectorAll('video').forEach(releaseMediaVideo);
          expandedCard.remove();expandedCard=null;
          button.textContent=button.dataset.collapsedLabel;button.setAttribute('aria-expanded','false');
          button.title='查看视频与说明书：'+s.name;button.setAttribute('aria-label',button.title);
        }else{
          button.dataset.collapsedLabel=button.textContent;expandedCard=buildSoftwareCard(s);
          expandedCard.classList.add('software-inline-details');
          expandedCard.querySelector('.sw-head')?.remove();expandedCard.querySelector('.sw-purpose')?.remove();
          const actions=expandedCard.querySelector('.sw-actions');
          actions.querySelectorAll('.sw-btn-download,.software-copy').forEach(e=>e.remove());
          if(!actions.childElementCount)actions.remove();
          row.append(expandedCard);
          button.textContent='收起';button.setAttribute('aria-expanded','true');
          button.title='收起资料：'+s.name;button.setAttribute('aria-label',button.title);
        }
        button.focus({preventScroll:true});
        if(!expandedCard){
          const bounds=row.getBoundingClientRect();
          if(bounds.top<0||bounds.bottom>window.innerHeight)row.scrollIntoView({block:'nearest'});
        }
      };
      const hasMedia = window.VideoGroups.softwareVideos(s).length || (s.manuals && s.manuals.length) || s.manualUrl;
      if (hasMedia) {
        const detail = document.createElement("button");
        detail.type = "button"; detail.className = "sw-btn-detail"; detail.textContent = "资料";
        detail.setAttribute("aria-expanded","false");detail.addEventListener("click", () => toggleDetails(detail)); // 原地展开，不跳问答区
        acts.appendChild(detail);
      }
      if (s.hasDownloader && s.downloadUrl) {
        const dl = document.createElement("a");
        dl.className = "sw-btn-download sw-btn-sm"; dl.href = s.downloadUrl; dl.target = "_blank"; dl.rel = "noopener";
        dl.textContent = "下载";
        acts.appendChild(dl);
      } else if (s.access) {
    acts.appendChild(buildSoftwareAccessButton(s));
  } else if (s.mobile) {
        const mb = document.createElement("button");
        mb.type = "button"; mb.className = "sw-btn-detail";
        mb.textContent = s.mobile.webUrl ? "网页/手机版" : "手机下载";
        mb.setAttribute("aria-expanded","false");mb.addEventListener("click", () => toggleDetails(mb)); // 原地展开完整入口
        acts.appendChild(mb);
      } else {
        const nd = document.createElement("span");
        nd.className = "sw-row-nodl"; nd.textContent = "手机/云端";
        acts.appendChild(nd);
      }
      styleSoftwareActions(acts, s);
      row.append(main, acts);
      return row;
    });
    searchResults.appendChild(list);
  }
  searchResults.style.display = "block";
}

// 「视频」分类：操作/教学视频按操作主题组织，与型号无关，走确定性 /api/videos；默认折叠，展开才拉流，省流量
async function fetchVideos(kw) { return fetchMediaMetadata('video', kw); }

function videoFileName(name) {
  return /\.mp4$/i.test(name) ? name : name + ".mp4";
}
// 单条视频：折叠行（▶ 名称 + 大小），展开后内嵌播放器 + 下载
function buildVideoItem(v) {
 const det=document.createElement('details');det.className='vid-item';
 const sum=document.createElement('summary'),name=document.createElement('span'),size=document.createElement('span'),eye=document.createElement('span');
 name.className='vid-name';name.textContent=v.name;size.className='vid-size';size.textContent=v.sizeText||'';eye.className='vid-ico';eye.setAttribute('aria-hidden','true');
 const dl=document.createElement('a');dl.className='sw-link vid-dl';dl.href=v.url+(v.url.includes('?')?'&':'?')+'download=1';dl.download=videoFileName(v.name);dl.setAttribute('aria-label','下载视频：'+v.name);dl.innerHTML='<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3v12m-5-5 5 5 5-5M5 17v3h14v-3"/></svg>';dl.onclick=e=>e.stopPropagation();
 sum.append(name,size,eye,dl);
 const body=document.createElement('div');body.className='vid-body';const video=document.createElement('video');video.controls=true;video.preload='none';video.playsInline=true;
 const close=document.createElement('button');close.type='button';close.className='vid-close';close.textContent='收起';close.onclick=()=>{det.open=false;sum.focus({preventScroll:true});};
 function sync(){eye.innerHTML=det.open?VIDEO_EYE_OFF:VIDEO_EYE;sum.setAttribute('aria-label',(det.open?'关闭视频：':'播放视频：')+v.name);if(det.open)playMediaVideo(video,v.url);else releaseMediaVideo(video);}
 det.addEventListener('toggle',sync);eye.innerHTML=VIDEO_EYE;sum.setAttribute('aria-label','播放视频：'+v.name);body.append(video,close);det.append(sum,body);return det;
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
  const sourceGroups = vd && Array.isArray(vd.topicGroups) ? vd.topicGroups : (vd && Array.isArray(vd.groups)) ? vd.groups : [];
  const groups = window.VideoGroups.organize(sourceGroups);
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
  if(vd?.localCurated){
    renderCuratedVideoWorkspace(groups,kw);
    searchResults.style.display='block';
    return;
  }
  const wrap = document.createElement("div");
  wrap.className = vd?.localCurated ? "vid-catalog official-video-catalog" : "vid-catalog";
  if(vd?.localCurated&&groups.length===1)wrap.classList.add('single-group');
  // Always retain the product category heading, including a single search category.
  groups.forEach((g) => {
    const grp = document.createElement("details");
    grp.className = "doc-cat-group video-cat-group";
    if (kw || groups.length === 1) grp.open = true; // 搜索时命中的场景大类自动展开；全量浏览默认收起
    const sum = document.createElement("summary");
    sum.innerHTML = '<span class="vid-ico">\u25B6</span><span class="dcg-label"></span><span class="dcg-count"></span>';

    sum.querySelector(".dcg-label").textContent = g.label;
    sum.querySelector(".dcg-count").textContent = "（" + g.count + "）";
    const body = document.createElement("div");
    body.className = "doc-cat-group-body";
    const sections=g.sections||[{label:g.label,videos:g.videos||[]}];
    sections.forEach(section=>{
      const nested=true; // Product category → operation topic → video file.
      const container=document.createElement(nested?'details':'div');
      container.className=nested?'video-topic':'video-topic-files';
      let list=container;
      if(nested){
        container.open=!!kw;
        const heading=document.createElement('summary');heading.textContent=section.label+' · '+section.videos.length;
        list=document.createElement('div');list.className='video-topic-files';container.append(heading,list);
      }
      section.videos.forEach(v=>{
        const det=buildVideoItem(v);list.appendChild(det);
      });
      body.appendChild(container);
    });
    grp.append(sum, body);
    wrap.appendChild(grp);
  });
  searchResults.appendChild(wrap);
  searchResults.style.display = "block";
  // Videos stay closed until the user explicitly clicks the eye action.
  // Avoid unexpectedly starting/expanding previews when a search is submitted.
}

function renderCuratedVideoWorkspace(groups,query){
 const layout=document.createElement('div');layout.className='video-workspace';
 const navigation=document.createElement('div');navigation.className='video-workspace-nav';navigation.setAttribute('aria-label','视频分类与列表');
 const playerPane=document.createElement('section');playerPane.className='video-workspace-player';playerPane.setAttribute('aria-label','视频播放');
 const hint=document.createElement('p');hint.className='video-workspace-empty';hint.textContent='从左侧选择视频，在这里播放';playerPane.append(hint);
 let selected=null,currentVideo=null;
 function mark(button,playing){if(!button)return;button.setAttribute('aria-pressed',String(playing));const eye=button.closest('.video-workspace-card')?.querySelector('.video-card-preview');if(eye){eye.innerHTML=playing?VIDEO_EYE_OFF:VIDEO_EYE;eye.setAttribute('aria-label',(playing?'关闭视频：':'播放视频：')+button.textContent);}}
 function close(){if(currentVideo)releaseMediaVideo(currentVideo);currentVideo=null;mark(selected,false);selected=null;playerPane.replaceChildren(hint);}
 function choose(item,button){
  if(selected===button&&currentVideo){close();return;}
  close();selected=button;mark(button,true);
  const title=document.createElement('h3');title.className='video-workspace-title';title.textContent=item.name;
  const player=document.createElement('video');player.controls=true;player.preload='none';player.playsInline=true;currentVideo=player;
  const header=document.createElement('div');header.className='video-workspace-header';const actions=document.createElement('div');actions.className='video-workspace-actions';
  const download=document.createElement('a');download.href=item.url+(item.url.includes('?')?'&':'?')+'download=1';download.download=videoFileName(item.name);download.className='video-workspace-icon';download.setAttribute('aria-label','下载视频：'+item.name);download.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M5 17v3h14v-3"/></svg>';
  const stop=document.createElement('button');stop.type='button';stop.className='video-workspace-icon';stop.setAttribute('aria-label','关闭视频');stop.innerHTML=VIDEO_EYE_OFF;stop.onclick=close;
  actions.append(download,stop);header.append(title,actions);playerPane.replaceChildren(header,player);playMediaVideo(player,item.url);
  if(window.matchMedia('(max-width:760px)').matches)playerPane.scrollIntoView({block:'nearest',behavior:'smooth'});
 }
 layout.addEventListener('toggle',event=>{if(!event.target.open&&selected&&event.target.contains(selected))close();},true);
 for(const group of groups){
  const category=document.createElement('details');category.className='video-workspace-category';category.open=!!query;
  const heading=document.createElement('summary');heading.textContent=group.label+'（'+group.count+'）';category.append(heading);
  const sections=(group.sections||[]).filter(s=>s.videos&&s.videos.length);
  function addItem(item,parent){
   const card=document.createElement('div');card.className='video-workspace-card';
   const button=document.createElement('button');button.type='button';button.className='video-workspace-item';button.textContent=item.name;button.setAttribute('aria-pressed','false');button.onclick=()=>choose(item,button);
   const info=document.createElement('div');info.className='video-card-info';info.append(button);if(item.language){const language=document.createElement('small');language.className='video-card-language';language.textContent=item.language;info.append(language);}
   const eye=document.createElement('button');eye.type='button';eye.className='video-workspace-icon video-card-preview';eye.innerHTML=VIDEO_EYE;eye.setAttribute('aria-label','播放视频：'+item.name);eye.onclick=()=>choose(item,button);
   const download=document.createElement('a');download.className='video-workspace-icon video-card-download';download.href=item.url+(item.url.includes('?')?'&':'?')+'download=1';download.download=videoFileName(item.name);download.setAttribute('aria-label','下载视频：'+item.name);download.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M5 17v3h14v-3"/></svg>';
   card.append(info,eye,download);parent.append(card);
  }
  const flat=sections.length===1&&sections[0].label===group.label;
  if(flat)for(const item of sections[0].videos)addItem(item,category);
  else for(const section of sections){const sub=document.createElement('details');sub.className='video-workspace-section';sub.open=!!query;const title=document.createElement('summary');title.textContent=section.label+'（'+section.videos.length+'）';sub.append(title);for(const item of section.videos)addItem(item,sub);category.append(sub);}
  navigation.append(category);
 }
 layout.append(navigation,playerPane);searchResults.append(layout);
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
// Port counts come from the pinned official selection dataset, for display order only.
const wikiCascadePorts = {"D10":0,"D30":0,"V10":0,"D15":0,"D16":1,"D35":0,"D36":0,"C10":1,"C10C":1,"C30":1,"C15":1,"C15C":1,"C16":1,"C16C":1,"C35":1,"C36":1,"C36C":1,"C08L":1,"C16L":1,"C16H":1,"A30":4,"A30+":1,"A601":2,"A602":2,"A603":2,"A3":1,"A3L":1,"A4":1,"A4L":1,"A5":2,"A5L":2,"A6":4,"B6":2,"B6L":2,"A6L":4,"H6":6,"A7":8,"H8":8,"B8L":8,"A8":16,"VP210":2,"VP210A":2,"VP210C":2,"VP210S":2,"KV210":2,"VP210H":2,"VP410":4,"VP410A":4,"VP410C":4,"VP410S":4,"KV410":4,"VP410H":4,"VP620":6,"VP620A":6,"VP630":6,"VP630TP":6,"VP820":8,"VP820A":8,"VP830":8,"VP830TP":8,"VP1220":12,"VP1240":12,"VP1220C":12,"VP10":10,"VP1220S":12,"VP12":12,"VP1240A":12,"VP1620":16,"VP1640":16,"VP1620C":16,"VP1620S":16,"VP1620S_{OPTIONAL}":16,"VP1640A":16,"VP1640A_{OPTIONAL}":16,"VP2060":20,"VP2430":24,"VP3060":30,"VP4060":40};
const docsCache = new Map();
const docsPending = new Map();
const docsViews = new Map();
const officialWikiModels=new Set(["40S","133MC","133TE","352C","723D","S40","S70","S90","S107","S108","SN1","Y1","PS08","MS1000","MS2000","MS4000","MS4000PRO","DCS4000","DCS4000PRO","VS0102","VS0104","VS0108","VS0116","3399F","3576V","3588H","3588V","FT01","FT08","B6L","B8H","B8L","K08","K12","R5S","R5SPLUS","R8S","R500S","R708","R712","R716","R732","R3210","RB6","KV210","KV410","VP6","VP8","VP10","VP12","VP210H","VP210S","VP410H","VP410S","VP620A","VP630","VP820A","VP830","VP1220S","VP1240A","VP1620S","VP1640A","VP2060","VP2430","VP3060","VP4060","VM0404","VM0808","VM1616","VM8000","VP8000M","A4L","A5L","A6L","A7","A8","H6","H8","H16","H20","T08","T08F","T16","T901","T902X1","T902X2","S1C","K524","A3L","H4K","C08L","C16H","C16L","D16","D18","733V","982V","3566MV","3568V","3568VC","40S-BOX","527S-BOX","3288S-BOX","3399F-BOX","3566S-BOX","3568S-BOX","3576V-BOX","3588V-BOX","527S","972S","3288S","3566P","3566S","3568S","3568SC","CT800","E62","E63","E64","HT01","HT02","U6A","U60","U62","W3A","W4A","W60","W62","W63","W64A","W66","WF1","WF2","WF4"]);
let showOtherWikiModels=false;
const isOfficialWikiModel=value=>officialWikiModels.has(String(value||'').toUpperCase().replace(/^HD[-_ ]?/,'').replace(/\s/g,''));
const officialWikiCategories=[{"model":"HD-40S","category":"1080P数字标牌主板"},{"model":"HD-133MC","category":"1080P数字标牌主板"},{"model":"HD-133TE","category":"1080P数字标牌主板"},{"model":"HD-352C","category":"1080P数字标牌主板"},{"model":"HD-723D","category":"1080P数字标牌主板"},{"model":"HD-S40","category":"传感器"},{"model":"HD-S70","category":"传感器"},{"model":"HD-S90","category":"传感器"},{"model":"HD-S107","category":"传感器"},{"model":"HD-S108","category":"传感器"},{"model":"HD-SN1","category":"传感器"},{"model":"HD-Y1","category":"多功能卡"},{"model":"HD-PS08","category":"多功能时序电源"},{"model":"HD-MS1000","category":"多媒体服务器"},{"model":"HD-MS2000","category":"多媒体服务器"},{"model":"HD-MS4000","category":"多媒体服务器"},{"model":"HD-MS4000PRO","category":"多媒体服务器"},{"model":"HD-DCS4000","category":"分布式系统"},{"model":"HD-DCS4000PRO","category":"分布式系统"},{"model":"HD-VS0102","category":"分配器"},{"model":"HD-VS0104","category":"分配器"},{"model":"HD-VS0108","category":"分配器"},{"model":"HD-VS0116","category":"分配器"},{"model":"HD-3399F","category":"高性能终端主板"},{"model":"HD-3576V","category":"高性能终端主板"},{"model":"HD-3588H","category":"高性能终端主板"},{"model":"HD-3588V","category":"高性能终端主板"},{"model":"HD-FT01","category":"光纤收发器"},{"model":"HD-FT08","category":"光纤收发器"},{"model":"HD-B6L","category":"海报拼接屏控制卡"},{"model":"HD-B8H","category":"海报拼接屏控制卡"},{"model":"HD-B8L","category":"海报拼接屏控制卡"},{"model":"HD-K08","category":"接收卡"},{"model":"HD-K12","category":"接收卡"},{"model":"HD-R5S","category":"接收卡"},{"model":"HD-R5SPLUS","category":"接收卡"},{"model":"HD-R8S","category":"接收卡"},{"model":"HD-R500S","category":"接收卡"},{"model":"HD-R708","category":"接收卡"},{"model":"HD-R712","category":"接收卡"},{"model":"HD-R716","category":"接收卡"},{"model":"HD-R732","category":"接收卡"},{"model":"HD-R3210","category":"接收卡"},{"model":"HD-RB6","category":"接收卡"},{"model":"HD-KV210","category":"视频处理器"},{"model":"HD-KV410","category":"视频处理器"},{"model":"HD-VP6","category":"视频处理器"},{"model":"HD-VP8","category":"视频处理器"},{"model":"HD-VP10","category":"视频处理器"},{"model":"HD-VP12","category":"视频处理器"},{"model":"HD-VP210H","category":"视频处理器"},{"model":"HD-VP210S","category":"视频处理器"},{"model":"HD-VP410H","category":"视频处理器"},{"model":"HD-VP410S","category":"视频处理器"},{"model":"HD-VP620A","category":"视频处理器"},{"model":"HD-VP630","category":"视频处理器"},{"model":"HD-VP820A","category":"视频处理器"},{"model":"HD-VP830","category":"视频处理器"},{"model":"HD-VP1220S","category":"视频处理器"},{"model":"HD-VP1240A","category":"视频处理器"},{"model":"HD-VP1620S","category":"视频处理器"},{"model":"HD-VP1640A","category":"视频处理器"},{"model":"HD-VP2060","category":"视频处理器"},{"model":"HD-VP2430","category":"视频处理器"},{"model":"HD-VP3060","category":"视频处理器"},{"model":"HD-VP4060","category":"视频处理器"},{"model":"HD-VM0404","category":"视频矩阵"},{"model":"HD-VM0808","category":"视频矩阵"},{"model":"HD-VM1616","category":"视频矩阵"},{"model":"HD-VM8000","category":"视频矩阵"},{"model":"HD-VP8000M","category":"视频拼接处理器"},{"model":"HD-A4L","category":"双模多媒体播放器"},{"model":"HD-A5L","category":"双模多媒体播放器"},{"model":"HD-A6L","category":"双模多媒体播放器"},{"model":"HD-A7","category":"双模多媒体播放器"},{"model":"HD-A8","category":"双模多媒体播放器"},{"model":"HD-H6","category":"双模多媒体播放器"},{"model":"HD-H8","category":"双模多媒体播放器"},{"model":"HD-H16","category":"双模多媒体播放器"},{"model":"HD-H20","category":"双模多媒体播放器"},{"model":"HD-T08","category":"同步控制系统"},{"model":"HD-T08F","category":"同步控制系统"},{"model":"HD-T16","category":"同步控制系统"},{"model":"HD-T901","category":"同步控制系统"},{"model":"HD-T902X1","category":"同步控制系统"},{"model":"HD-T902X2","category":"同步控制系统"},{"model":"HD-S1C","category":"小灰云星空"},{"model":"HD-K524","category":"异步继电器"},{"model":"HD-A3L","category":"异步全彩播放盒"},{"model":"HD-H4K","category":"异步全彩播放盒"},{"model":"HD-C08L","category":"异步全彩控制卡"},{"model":"HD-C16H","category":"异步全彩控制卡"},{"model":"HD-C16L","category":"异步全彩控制卡"},{"model":"HD-D16","category":"异步全彩控制卡"},{"model":"HD-D18","category":"异步全彩控制卡"},{"model":"HD-733V","category":"真4K终端主板"},{"model":"HD-982V","category":"真4K终端主板"},{"model":"HD-3566MV","category":"真4K终端主板"},{"model":"HD-3568V","category":"真4K终端主板"},{"model":"HD-3568VC","category":"真4K终端主板"},{"model":"HD-40S-BOX","category":"智慧终端播放盒"},{"model":"HD-527S-BOX","category":"智慧终端播放盒"},{"model":"HD-3288S-BOX","category":"智慧终端播放盒"},{"model":"HD-3399F-BOX","category":"智慧终端播放盒"},{"model":"HD-3566S-BOX","category":"智慧终端播放盒"},{"model":"HD-3568S-BOX","category":"智慧终端播放盒"},{"model":"HD-3576V-BOX","category":"智慧终端播放盒"},{"model":"HD-3588V-BOX","category":"智慧终端播放盒"},{"model":"HD-527S","category":"智慧终端主板"},{"model":"HD-972S","category":"智慧终端主板"},{"model":"HD-3288S","category":"智慧终端主板"},{"model":"HD-3566P","category":"智慧终端主板"},{"model":"HD-3566S","category":"智慧终端主板"},{"model":"HD-3568S","category":"智慧终端主板"},{"model":"HD-3568SC","category":"智慧终端主板"},{"model":"HD-CT800","category":"智能中控"},{"model":"HD-E62","category":"E系列"},{"model":"HD-E63","category":"E系列"},{"model":"HD-E64","category":"E系列"},{"model":"HD-HT01","category":"HDMI传输器"},{"model":"HD-HT02","category":"HDMI传输器"},{"model":"HD-U6A","category":"U系列"},{"model":"HD-U60","category":"U系列"},{"model":"HD-U62","category":"U系列"},{"model":"HD-W3A","category":"W系列"},{"model":"HD-W4A","category":"W系列"},{"model":"HD-W60","category":"W系列"},{"model":"HD-W62","category":"W系列"},{"model":"HD-W63","category":"W系列"},{"model":"HD-W64A","category":"W系列"},{"model":"HD-W66","category":"W系列"},{"model":"HD-WF1","category":"W系列"},{"model":"HD-WF2","category":"W系列"},{"model":"HD-WF4","category":"W系列"}];
const receiverOrder=['R712','R716','R732','R708','RB6','R516T','R320T','R516','R320','R512T','R508T','R512S','R512','R508','R507T','R500S','R612','K08','K12','R5S','R3210','R5SPLUS'];
const wikiModelKey=s=>String(s||'').replace(/^HD[-_ ]?/i,'').replace(/\s+/g,'').toUpperCase();
function wikiModelCompare(a,b,category){
 const x=wikiModelKey(a),y=wikiModelKey(b),numeric=(u,v)=>u.localeCompare(v,'zh-Hans-CN',{numeric:true});
 if(category==='receiver') {const rank=m=>{const i=receiverOrder.indexOf(m);return i<0?receiverOrder.length:i;};return rank(x)-rank(y)||numeric(x,y);}
 if(category==='player')return numeric(x,y);
 const xp=wikiCascadePorts[x],yp=wikiCascadePorts[y];
 if(Number.isInteger(xp)&&Number.isInteger(yp))return xp-yp||numeric(x,y);
 if(Number.isInteger(xp)!==Number.isInteger(yp))return Number.isInteger(xp)?-1:1;
 return numeric(x,y);
}
function orderWikiCatalog(docs,cat){
 if(!['spec','manual','firmware'].includes(cat))return docs;
 for(const group of docs.groups||[])if(group.products)group.products.sort((a,b)=>wikiModelCompare(a.model,b.model,group.key));
 for(const group of docs.firmwareCategories||[])group.models.sort((a,b)=>wikiModelCompare(a,b,group.key));
 return docs;
}
async function fetchDocs(cat, history = "current", query = "") {
  if(cat==='other')return fetchDirectoryPage({query});
  const cacheKey = cat + ":" + history;
  const cached = docsCache.get(cacheKey);
  if (cached && Date.now() - cached.time < 30000) return cached.data;
  if (docsPending.has(cacheKey)) return docsPending.get(cacheKey);
  const request = (async () => {
    const resp = await fetch("/api/docs?cat=" + encodeURIComponent(cat) + "&list=1&history=" + encodeURIComponent(history));
    const data = await resp.json();
    if (!resp.ok || data.error) throw new Error(data.error || "资料服务暂不可用");
    const docs = data.docs ? orderWikiCatalog(data.docs,cat) : null;
    if (!docs) throw new Error("资料目录响应不完整");
    const signature = JSON.stringify(docs);
    const previous = docsCache.get(cacheKey);
    const value = previous?.signature === signature ? previous.data : docs;
    docsCache.set(cacheKey, { data: value, signature, time: Date.now() });
    return value;
  })();
  docsPending.set(cacheKey, request);
  try { return await request; }
  finally { docsPending.delete(cacheKey); }
}

function docPillEl(it, isFw) {
  const available = it.available !== false && typeof it.url === "string" && /^(https?:\/\/|\/[^/])/i.test(it.url);
  const preview = window.ProductResources.previewTarget(it);
  const a = document.createElement(isFw ? 'span' : available ? (preview.url ? 'a' : 'button') : 'span');
  a.className = "doc-link" + (isFw ? " fw-link" : "") + (available ? "" : " doc-link-nourl");
  if (!isFw && available && preview.url) a.href = preview.url;
  if (!isFw && available && !preview.url) { a.type = 'button'; a.onclick = () => window.alert(preview.reason); }
  a.target = "_blank";
  a.rel = "noopener noreferrer";
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
  if (available && !isFw) {
    a.title = preview.url ? '在线预览：' + (it.name || it.clean || '文件') : preview.reason;
    a.setAttribute('aria-label', preview.url ? '在线预览 ' + (it.name || it.clean || '文件') : '预览 ' + (it.name || it.clean || '文件') + '：' + preview.reason);
  }
  const label = document.createElement('span'); label.className = 'doc-link-label';
  label.append(...a.childNodes); a.appendChild(label);
  if(isFw){const info=window.FirmwareLabels?.describe(it.name||it.file||'');if(info){const badge=document.createElement('small');badge.className='fw-series-badge';badge.textContent=info.label;label.prepend(badge);a.dataset.firmwareSeries=info.series;}}
  if(it.documentEdition==='neutral'||it.brand==='中性版'){const tag=document.createElement('small');tag.className='doc-neutral-tag';tag.textContent='中性版';label.appendChild(tag);}
  return a;
}
function docFileActions(item, isFw = false) {
  const actions = document.createElement('span'); actions.className = 'doc-file-actions';
  const preview = docPillEl(item, isFw); if (item.documentDate) preview.title += ' · 原文日期 ' + item.documentDate;
  if(item.materialProperty){
    const kind={spec:'规格书',manual:'说明书',other:'参考资料'}[item.baseDocumentKind];
    const notes=[item.materialPropertyLabel,kind,item.historyStatus==='archived-not-automatically-invalid'?'来源归档，不代表已失效':null].filter(Boolean);
    preview.title+=' · '+notes.join(' · ');
  }
  actions.appendChild(preview);
  const url = window.ProductResources.downloadTarget(item);
  if (url) {
    if(isFw)actions.appendChild(window.ProductResources.copyButton(item));
    const download = document.createElement('a'); download.className = 'doc-download'; download.href = url;
    download.download = item.originalName || item.name || ''; download.textContent = '下载';
    download.title = '下载原文件：' + (item.originalName || item.name || '文件');
    download.setAttribute('aria-label', '下载原文件 ' + (item.originalName || item.name || '文件'));
    actions.appendChild(download);
  }
  return actions;
}
const catalogPreviewHint=document.createElement('small');
catalogPreviewHint.className='catalog-preview-hint';catalogPreviewHint.id='catalogPreviewHint';catalogPreviewHint.textContent='停留预览，点击固定';catalogPreviewHint.hidden=true;
document.getElementById('quickCats').after(catalogPreviewHint);
let catalogHintFrame=0;
function updateCatalogPreviewHint(){
 cancelAnimationFrame(catalogHintFrame);
 catalogHintFrame=requestAnimationFrame(()=>{
  catalogPreviewHint.hidden=!Array.from(searchResults.querySelectorAll('.spec-workspace,.firmware-browser')).some(node=>{for(let parent=node.parentElement;parent&&parent!==searchResults;parent=parent.parentElement)if(parent.tagName==='DETAILS'&&!parent.open)return false;return node.getClientRects().length>0;});
 });
}
searchResults.addEventListener('toggle',updateCatalogPreviewHint,true);
new MutationObserver(updateCatalogPreviewHint).observe(searchResults,{childList:true});
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
  sum.addEventListener('click',()=>{
   const opening=!det.open,viewport=document.getElementById('searchResults'),before=viewport.scrollTop;
   requestAnimationFrame(()=>{
    if(!det.isConnected)return;
    if(opening){const offset=sum.getBoundingClientRect().top-viewport.getBoundingClientRect().top;viewport.scrollTo({top:Math.max(0,viewport.scrollTop+offset),behavior:'instant'});}
    else viewport.scrollTop=before;
   });
  });
  return { det, body };
}
// 型号后直接显示文件链接，只有产品大类保留折叠。
function docFlatRow(model, items, cat, deviceName) {
  const row = document.createElement("div");
  row.className = "doc-flat";
  const nm = document.createElement("span");
  nm.className = "doc-flat-name";
  nm.textContent = model;
  if (deviceName) {
    const description = document.createElement('small');
    description.className = 'doc-device-name'; description.textContent = deviceName;
    nm.appendChild(description); nm.title = model + ' · ' + deviceName;
  }
  const links = document.createElement("span");
  links.className = "doc-flat-links";
  const documents = window.ProductResources ? window.ProductResources.unique(items || []) : (items || []);
  const fileButton = item => docFileActions({...item, deviceName: item.deviceName || deviceName});
  const present = documents.filter(item => item.available !== false);
  const missing = documents.filter(item => item.available === false);
  const line = document.createElement('span'); line.className = 'doc-document-pair doc-three-columns';
  const buckets={zh:[],en:[],neutral:[]};
  for(const item of present){const language=String(item.documentLanguage||'').toLowerCase();const key=item.documentEdition==='neutral'||item.brand==='中性版'?'neutral':language==='en'||language.includes('英文')||/specification|manual|instruction/i.test(item.name||'')&&!/[\u4e00-\u9fff]/.test(item.name||'')?'en':'zh';buckets[key].push(item);}
  for(const [key,title] of [['neutral','中性版'],['zh','中文'],['en','英文']]){
    if(!buckets[key].length)continue;
    const cell=document.createElement('span');cell.className='doc-pair-cell';cell.dataset.language=key;
    const heading=document.createElement('small');heading.className='doc-column-title';heading.textContent=title;cell.appendChild(heading);
    for(const item of buckets[key])cell.appendChild(fileButton(item));
    if(!buckets[key].length){const empty=document.createElement('span');empty.className='doc-column-empty';empty.textContent='—';cell.appendChild(empty);}
    line.appendChild(cell);
  }
  links.appendChild(line);
  if (missing.length) {
    const records = document.createElement('details'); records.className = 'doc-missing-records';
    const summary = document.createElement('summary'); summary.textContent = '原件缺失记录（' + missing.length + '）'; records.appendChild(summary);
    const message = document.createElement('p'); message.textContent = '以下是已有旧引用，当前未找到对应原件，不能下载；不代表上方可用版本缺失。'; records.appendChild(message);
    for (const item of missing) records.appendChild(fileButton(item)); links.appendChild(records);
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
  const cached = docsCache.get(cat+":current");
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
    const docs = await fetchDocs(cat,"current",query);
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
const directoryPageCache=new Map(),directoryPagePending=new Map();
async function fetchDirectoryPage({directory='root',offset=0,query='',sort='name'}={}){
 const key=JSON.stringify([directory,offset,query,sort]),cached=directoryPageCache.get(key);
 if(cached&&Date.now()-cached.time<30000)return cached.docs;
 if(directoryPagePending.has(key))return directoryPagePending.get(key);
 const pending=(async()=>{const params=new URLSearchParams({cat:'other',directory,offset:String(offset),limit:'50',q:query,sort});const response=await fetch('/api/docs?'+params);const body=await response.json();if(!response.ok||!body.docs?.directoryPage)throw Error(body.error||'此目录读取失败');if(directoryPageCache.size>=200)directoryPageCache.delete(directoryPageCache.keys().next().value);directoryPageCache.set(key,{time:Date.now(),docs:body.docs});return body.docs;})();
 directoryPagePending.set(key,pending);try{return await pending;}finally{directoryPagePending.delete(key);}
}
function renderSourceDirectory(docs,query=''){
 window.SourceDirectoryBrowser.mount({container:searchResults,docs,fileActions:docFileActions,load:async options=>(await fetchDirectoryPage(options)).directoryPage,onLocate:item=>{quickSearchInput.value=item.name;renderDocsCategory('other',item.name);}});
}

// A focused view of the two existing registered directories, using the same
// authorized directory and download endpoints as the internal Wiki browser.
const moduleConfigurationFolders = ['模组配置文件', '2026年新调试  LED模组配置文件'];
const moduleConfigurationNodes=new Map();
const moduleConfigurationViews=new Map();
async function mergedConfigurationEntries(sources,{manufacturerLevel=false,year2026=[]}={}) {
 const pages=await Promise.all(sources.map(async source=>{const entries=[];let offset=0;do{const page=(await fetchDirectoryPage({directory:source.id,offset})).directoryPage;entries.push(...page.entries.map(entry=>({...entry,configuration2026:source.is2026||entry.folders?.[0]===moduleConfigurationFolders[1]})));offset=page.pagination.nextOffset;}while(offset!==null);return entries;}));
 const folders=new Map(),files=new Map();
 for(const entry of pages.flat()){
  if(entry.type==='directory'){const newFolder=manufacturerLevel&&entry.label.endsWith('新调试配置文件');const label=newFolder?entry.label.replace(/新调试配置文件$/,''):entry.label;if(!folders.has(label))folders.set(label,{...entry,label,sources:[],year2026:[],count:0});const group=folders.get(label);(manufacturerLevel&&(entry.configuration2026||newFolder)?group.year2026:group.sources).push({id:entry.id,is2026:!!entry.configuration2026,count:entry.count});group.count+=entry.count;}
  else {const key=entry.sha256||entry.resourceVersionId||entry.locationId;if(!files.has(key))files.set(key,entry);else if(entry.configuration2026)files.get(key).configuration2026=true;}
 }
 if(year2026.length){folders.set('2026年新调试',{type:'directory',label:'2026年新调试',sources:year2026,year2026:[],count:year2026.reduce((n,s)=>n+s.count,0)});}
 const directories=[...folders.values()].map(group=>{const id='merged:'+[...group.sources,...group.year2026].map(s=>s.id).sort().join(',');moduleConfigurationNodes.set(id,{sources:group.sources,year2026:group.year2026});return {...group,id};});
 return [...directories.sort((a,b)=>a.label.localeCompare(b.label,'zh-Hans-CN')),...[...files.values()].sort((a,b)=>a.name.localeCompare(b.name,'zh-Hans-CN',{numeric:true}))];
}
const modulePageCache=window.DirectoryPageCache.create({load:async options=>{
 const params=new URLSearchParams({q:options.query||'',directory:options.directory||'root',offset:String(options.offset||0),sort:options.sort||'name'});
 const response=await fetch('/v2/configuration-search?'+params);
 if(!response.ok)throw Error('配置文件检索暂不可用');
 return (await response.json()).directoryPage;
}});
const moduleConfigurationPage=options=>modulePageCache.get(options);
let modulePrefetchGeneration=0;
async function prefetchModuleDirectories(page){
 const generation=++modulePrefetchGeneration,queue=[...page.entries.filter(e=>e.type==='directory').map(e=>({directory:e.id})),...(page.pagination.nextOffset!==null?[{directory:'root',offset:page.pagination.nextOffset}]:[])];
 let budget=120;
 while(queue.length&&budget>0&&generation===modulePrefetchGeneration&&activeCat==='module-config'){
  const batch=queue.splice(0,2);budget-=batch.length;
  const loaded=await Promise.all(batch.map(options=>moduleConfigurationPage(options).catch(()=>null)));
  for(let i=0;i<loaded.length;i++){const next=loaded[i];if(!next)continue;queue.push(...next.entries.filter(e=>e.type==='directory').map(e=>({directory:e.id})));if(next.pagination.nextOffset!==null)queue.push({...batch[i],offset:next.pagination.nextOffset});}
  await new Promise(resolve=>setTimeout(resolve,50));
 }
}

async function renderModuleConfigurations(query='') {
 const requestId=++quickRequestId;searchResults.style.display='block';searchResults.textContent='正在读取模组配置文件…';
 try {
  const page=await moduleConfigurationPage({query});if(requestId!==quickRequestId)return;
  window.SourceDirectoryBrowser.mount({container:searchResults,title:'模组配置文件',treeLabel:'模组配置文件目录',countLabel:'份配置文件',docs:{total:page.sourceTotal,directoryPage:page},load:moduleConfigurationPage,fileActions:docFileActions});
  mascotGuide('module-config',query);
  if(!query.trim())setTimeout(()=>prefetchModuleDirectories(page),150);
 }catch(error){if(requestId===quickRequestId)searchResults.textContent='模组配置目录读取失败：'+error.message;}
}

const officialSpecHierarchy=[
 ['R、K系列接收卡',['接收卡']],
 ['A、B、C、D、H系列异步卡',['双模多媒体播放器','异步全彩播放盒','异步全彩控制卡','海报拼接屏控制卡']],
 ['视频处理',['同步控制系统','视频处理器','视频拼接处理器','多媒体服务器','分布式系统','智能中控','视频矩阵']],
 ['单色控制卡',['W系列','E系列','U系列']],
 ['LCD控制系统',['高性能终端主板','真4K终端主板','智慧终端主板','1080P数字标牌主板','智慧终端播放盒','小灰云星空']],
 ['配件产品',['光纤收发器','HDMI传输器','分配器','多功能时序电源','传感器','多功能卡','异步继电器']]
];
const officialSpecFallback={T902X1:'https://www.huidu.cn/CnProduct/index61.html',T902X2:'https://www.huidu.cn/CnProduct/index61.html',VM0404:'https://www.huidu.cn/CnProduct/index89.html',VM0808:'https://www.huidu.cn/CnProduct/index89.html',VM1616:'https://www.huidu.cn/CnProduct/index89.html',VS0102:'https://www.huidu.cn/CnProduct/index124.html',VS0104:'https://www.huidu.cn/CnProduct/index124.html',VS0108:'https://www.huidu.cn/CnProduct/index124.html',VS0116:'https://www.huidu.cn/CnProduct/index124.html',PS08:'https://www.huidu.cn/CnProduct/index121.html',HT01:'https://www.huidu.cn/CnProduct/index122.html',HT02:'https://www.huidu.cn/CnProduct/index122.html',K524:'https://www.huidu.cn/CnProduct/index82.html'};
const officialCategoryNames={'海报拼接屏控制卡':'海报拼接屏专用控制卡','视频矩阵':'视频矩阵系列','1080P数字标牌主板':'1080P高清数字标牌主板','异步继电器':'异步全彩继电器'};
function specificationWorkspace(models,byModel,cat='spec'){
 const kindLabel=cat==='manual'?'说明书':'规格书';
 const el=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;};
 const layout=el('div','firmware-browser spec-workspace'),navigation=el('div','firmware-models spec-models'),panel=el('section','firmware-panel spec-panel');
 navigation.setAttribute('aria-label',kindLabel+'型号');
 const header=el('div','firmware-panel-header'),title=el('strong',null,'请选择左侧型号'),close=el('button','firmware-panel-close','×'),files=el('div','spec-files');
 title.setAttribute('aria-live','polite');close.type='button';close.setAttribute('aria-label','关闭'+kindLabel+'详情');close.hidden=true;files.setAttribute('aria-label',kindLabel+'文件列表');
 let active=null,pinned=false,timer;
 const cancel=()=>clearTimeout(timer);
 function choose(button,model,pin=false){
  cancel();if(pinned&&!pin)return;if(active){active.setAttribute('aria-pressed','false');delete active.dataset.preview;}active=button;pinned=pin;button.setAttribute('aria-pressed',String(pin));if(!pin)button.dataset.preview='true';
  const product=byModel.get(wikiModelKey(model.model)),items=(product?.items||[]).filter(i=>i.available!==false);
  if(pin){mascotGuide('search',model.model);mascotRemember(model.model);}
  title.textContent=(model.subjectType==='software'?model.label:wikiModelKey(model.model))+' · '+items.length+' 份'+kindLabel;close.hidden=false;files.replaceChildren();files.scrollTop=0;
  const buckets={neutral:[],zh:[],en:[]};
  for(const item of items){const lang=String(item.documentLanguage||'').toLowerCase();const key=item.documentEdition==='neutral'||item.brand==='中性版'?'neutral':lang==='en'||lang.includes('英文')?'en':'zh';buckets[key].push(item);}
  for(const [key,label] of [['neutral','中性版'],['zh','中文'],['en','英文']]){if(!buckets[key].length)continue;const group=el('div','spec-language-group');group.dataset.language=key;group.append(el('small','doc-column-title',label));for(const item of buckets[key])group.append(docFileActions(item));files.append(group);}
  if(!items.length)files.append(el('p','spec-empty','当前资料目录尚未关联该型号'+kindLabel+'。'));
 }
 close.onclick=()=>{cancel();const previous=active;if(active){active.setAttribute('aria-pressed','false');delete active.dataset.preview;}active=null;pinned=false;title.textContent='请选择左侧型号';files.replaceChildren();close.hidden=true;previous?.focus({preventScroll:true});};
 panel.onpointerenter=cancel;panel.onkeydown=event=>{if(event.key==='Escape')close.click();};header.append(title,close);panel.append(header,files);
 let first;
 for(const model of models){const button=el('button','firmware-model spec-model',model.subjectType==='software'?model.label:wikiModelKey(model.model));button.type='button';button.setAttribute('aria-pressed','false');button.onclick=()=>choose(button,model,true);button.onpointerenter=event=>{cancel();if(event.pointerType==='mouse'&&!pinned)timer=setTimeout(()=>choose(button,model),200);};button.onpointerleave=cancel;navigation.append(button);first??={button,model};}
 layout.append(navigation,panel);if(first)choose(first.button,first.model,false);return layout;
}
function placeCatalogExpand(button,owner){
 document.getElementById('catalogExpandAction')?.remove();
 button.id='catalogExpandAction';button.classList.add('catalog-expand-action');button.style.marginLeft='';
 quickCats.append(button);
 const observer=new MutationObserver(()=>{if(!owner.isConnected){button.remove();observer.disconnect();}});
 observer.observe(searchResults,{childList:true,subtree:false});
}
function renderOfficialSpecifications(docs,query,states,cat='spec'){
 const byModel=new Map();for(const group of docs.groups||[])for(const product of group.products||[]){const key=wikiModelKey(product.model);if(!byModel.has(key))byModel.set(key,{...product,items:[...(product.items||[])]});else byModel.get(key).items.push(...product.items||[]);}
 const term=String(query||'').trim().toUpperCase(),matches=x=>!term||String(x.model).toUpperCase().includes(term)||(byModel.get(wikiModelKey(x.model))?.items||[]).some(i=>String(i.name||'').toUpperCase().includes(term));
 const rows=officialWikiCategories.filter(x=>matches(x)&&(cat==='spec'||byModel.has(wikiModelKey(x.model)))),counts={models:rows.length,linked:rows.filter(x=>byModel.has(wikiModelKey(x.model))).length};
 searchResults.replaceChildren();searchResults.style.display='block';const head=document.createElement('div');head.className='search-count';const expand=document.createElement('button');expand.type='button';expand.className='sw-btn-detail';expand.textContent='全部展开';head.append(expand);searchResults.append(head);
 const wrap=document.createElement('div');wrap.className='vid-catalog official-spec-hierarchy';searchResults.append(wrap);
 let shown=0;
 for(const [groupName,children] of officialSpecHierarchy){
  if(cat==='manual'&&groupName==='配件产品'){
   const software=(docs.groups||[]).filter(g=>g.key==='software-manuals').flatMap(g=>g.products||[]).filter(p=>!term||p.model.toUpperCase().includes(term)||p.items.some(i=>i.name.toUpperCase().includes(term)));
   if(software.length){const node=docCatSummary('软件使用说明',software.length+' 款');node.det.className='doc-cat-group official-main';node.det.dataset.docState='software-manuals';node.det.open=states.get('software-manuals')??!!term;const map=new Map(software.map(p=>[wikiModelKey(p.model),p]));node.body.append(specificationWorkspace(software,map,cat));wrap.append(node.det);shown+=software.length;}
  }
  const main=cat==='manual'&&groupName==='A、B、C、D、H系列异步卡'?'异步全彩':groupName;const subset=rows.filter(r=>children.includes(r.category));if(!subset.length)continue;const mainNode=docCatSummary(main,subset.length+' 款');mainNode.det.className='doc-cat-group official-main';mainNode.body.className='doc-cat-group-body';mainNode.det.dataset.docState='official-main:'+main;mainNode.det.open=states.get(mainNode.det.dataset.docState)??(!!term||cat==='spec'&&main===officialSpecHierarchy[0][0]);
  for(const child of (main==='A、B、C、D、H系列异步卡'?['async-all']:children)){const models=child==='async-all'?subset:subset.filter(r=>r.category===child);if(!models.length)continue;const sub=(child==='接收卡'||main==='A、B、C、D、H系列异步卡')?mainNode:docCatSummary(officialCategoryNames[child]||child,models.length+' 款');if(sub!==mainNode){sub.det.className='doc-cat-group official-sub';sub.body.className='doc-cat-group-body';sub.det.dataset.docState='official-sub:'+child;sub.det.open=states.get(sub.det.dataset.docState)??!!term;}
   const sorted=models.slice().sort((a,b)=>wikiModelCompare(a.model,b.model,child==='接收卡'?'receiver':child==='async-all'||child.includes('播放')?'player':''));
   shown+=sorted.length;sub.body.append(specificationWorkspace(sorted,byModel,cat));
   // Native details opens only on click, touch, or keyboard activation.
   if(sub.det!==mainNode.det)mainNode.body.append(sub.det);
  }
  wrap.append(mainNode.det);
 }
 if(!shown){const empty=document.createElement('p');empty.textContent='没有找到对应的官网型号或规格书。';wrap.append(empty);}
 expand.onclick=()=>{const all=[...wrap.querySelectorAll('details')],open=all.some(x=>!x.open);for(const el of all)el.open=open;expand.textContent=open?'全部收起':'全部展开';};
 placeCatalogExpand(expand,wrap);head.remove();
}
function renderDocsView(cat, qArg, docs, states = new Map()) {
  if(docs?.directoryGrouping==='lazy-source-directories'){renderSourceDirectory(docs,qArg);return;}
  if(cat==='spec'||cat==='manual'&&docs?.localCurated){renderOfficialSpecifications(docs,qArg,states,cat);return;}
  const catLabel = CAT_LABEL[cat] || '资料';
  const groups = (docs && Array.isArray(docs.groups)) ? docs.groups : [];
  if (!groups.length) {
    searchResults.innerHTML = '<div class="search-empty">暂无' + catLabel + '，可在上方输入产品型号（如 R708、C16）查询</div>';
    searchResults.style.display = "block";
    if(cat==='firmware')window.ChipBrowser?.mount(searchResults,qArg||'');
    return;
  }
  searchResults.innerHTML = "";
  const head = document.createElement("div");
  head.className = "search-count";
  const firmwareListing=cat==="firmware"&&docs?.officialFirmware===true;
  // Firmware follows the HDPlayer/HDSet library, not the Wiki product list: the
  // catalogue is rendered exactly as registered, without a Wiki-model gate.
  const visibleProducts=groups.flatMap(g=>g.products||[g]).filter(p=>p.model&&(firmwareListing||showOtherWikiModels||isOfficialWikiModel(p.model)));
  const modelCount=new Set(visibleProducts.map(p=>p.model)).size,fileCount=visibleProducts.reduce((n,p)=>n+(p.items||[]).length,0);
  if (cat === "firmware") {
    head.textContent = "固件 · 共 " + modelCount + " 款型号、" + fileCount + " 份正式固件；下载前核对设备型号、硬件版本和文件适用条件。";
  } else if (cat === "spec") {
    head.textContent = "规格书 · 按产品大类分类（共 " + modelCount + " 款产品、" + fileCount + " 条资料关联，点链接直接打开或下载；也可在上方直接搜型号）";
  } else {
    head.textContent = "使用说明书 · 按产品大类分类（共 " + modelCount + " 款产品、" + fileCount + " 条资料关联，点链接直接打开或下载；也可在上方直接搜型号）";
  }
  searchResults.appendChild(head);
  const wrap = document.createElement("div");
  wrap.className = "vid-catalog";
  if (cat === "firmware") {
    const categories=docs.firmwareCategories||[{key:'other',label:'其他',models:groups.map(g=>g.model)}];
    const byModel=new Map(groups.map(g=>[g.model,g]));
    categories.forEach(category=>{
      if(category.key==='lcd')return;
      const products=category.models.map(model=>byModel.get(model)).filter(p=>p&&(firmwareListing||showOtherWikiModels||isOfficialWikiModel(p.model)));
      const term=String(qArg||'').trim().toUpperCase(),matches=products.filter(p=>!term||p.model.toUpperCase().includes(term)||p.items.some(i=>i.name.toUpperCase().includes(term)));if(!matches.length)return;
      const pack=docCatSummary(category.label,matches.length+' 款型号');pack.det.className='doc-cat-group firmware-category';
      pack.det.dataset.docState='firmware:group:'+category.key;pack.det.open=states.get(pack.det.dataset.docState)??!!term;
      pack.body.className='doc-cat-group-body firmware-browser';
      const models=document.createElement('div');models.className='firmware-models';models.setAttribute('role','group');models.setAttribute('aria-label',category.label+'型号');
      const panel=document.createElement('section');panel.className='firmware-panel';panel.id='firmware-files-'+category.key;
      const header=document.createElement('div');header.className='firmware-panel-header';
      const title=document.createElement('strong');title.textContent='请选择左侧型号';title.setAttribute('aria-live','polite');
      const close=document.createElement('button');close.type='button';close.className='firmware-panel-close';close.textContent='×';close.title='关闭固件资料';close.setAttribute('aria-label','关闭固件资料');close.hidden=true;
      const files=document.createElement('div');files.className='firmware-panel-files';files.tabIndex=0;files.setAttribute('role','region');files.setAttribute('aria-label','固件文件列表');
      let active=null,pinned=false,hoverTimer;
      function cancelPreview(){clearTimeout(hoverTimer);}
      function clearSelection(restoreFocus=false){cancelPreview();const previous=active;if(active){active.setAttribute('aria-pressed','false');delete active.dataset.preview;}active=null;pinned=false;files.replaceChildren();title.textContent='请选择型号查看固件';close.hidden=true;if(restoreFocus)previous?.focus({preventScroll:true});}
      function showFiles(button,product,pin=false){cancelPreview();if(pinned&&!pin)return;if(active){active.setAttribute('aria-pressed','false');delete active.dataset.preview;}active=button;pinned=pin;button.setAttribute('aria-pressed',String(pin));button.dataset.preview=String(!pin);title.textContent=product.label+' · '+product.count+' 个固件';close.hidden=false;files.replaceChildren(...product.items.map(item=>docFileActions(item,true)));files.scrollTop=0;if(pin){mascotGuide('search',product.model);mascotRemember(product.model);}}
      panel.addEventListener('pointerenter',cancelPreview);
      close.onclick=()=>clearSelection(true);
      panel.addEventListener('keydown',event=>{if(event.key==='Escape')clearSelection(true);});
      header.append(title,close);panel.append(header,files);
      matches.forEach(product=>{
        const button=document.createElement('button');button.type='button';button.className='firmware-model';button.textContent=product.model;button.setAttribute('aria-controls',panel.id);button.setAttribute('aria-pressed','false');
        button.addEventListener('pointerenter',event=>{
          cancelPreview();if(event.pointerType==='mouse'&&!pinned)hoverTimer=setTimeout(()=>showFiles(button,product),200);
        });
        button.addEventListener('pointerleave',cancelPreview);
        button.onclick=()=>showFiles(button,product,true);
        models.append(button);
      });
      pack.body.append(models,panel);wrap.append(pack.det);
    });
    window.ChipBrowser?.mount(wrap,qArg||'');
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
      const prods = (g.products || []).filter(p=>(showOtherWikiModels||isOfficialWikiModel(p.model))&&modelHit(p));
      if(!prods.length)return;
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
      sum.querySelector(".dcg-count").textContent = docs.materialGrouping
        ? '（'+prods.reduce((n,p)=>n+p.items.length,0)+' 份）'
        : kwUp
        ? "（" + prods.length + " / " + g.count + " 项命中）"
        : "（" + prods.length + " 项 / " + prods.reduce((n,p)=>n+(p.items||[]).length,0) + " 条关联）";
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
            const row = docFlatRow(product.model, product.items, cat, product.deviceName);
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
    head.textContent = docs.materialGrouping
      ? catLabel+' · 按资料性质分类 · '+docs.total+' 个独立原件'+(kwUp?' · 已筛选':' · 可搜索名称、型号或来源')
      : catLabel + " · " + modelCount + " 个产品/资料主题 · " + fileCount + " 条资料关联"
      + (kwUp ? " · 匹配 " + shownModels + " 款" : " · 可输入型号筛选");
    if (groups.length === 1) wrap.classList.add("doc-catalog-flat");
  }
  const toggleAll = document.createElement('button');
  toggleAll.type = 'button'; toggleAll.className = 'sw-btn-detail'; toggleAll.style.marginLeft = '12px';
  const categories = () => [...wrap.children].filter(node => node.matches('details.doc-cat-group'));
  const updateToggle = () => {
    const rows = categories(), allOpen = rows.length > 0 && rows.every(node => node.open);
    toggleAll.textContent = allOpen ? '全部收起' : '全部展开';
    toggleAll.title = (allOpen ? '收起' : '展开') + '当前' + catLabel + '的全部分类';
    toggleAll.setAttribute('aria-expanded', String(allOpen));
  };
  toggleAll.onclick = () => { const rows = categories(), open = !rows.every(node => node.open); for (const node of rows) node.open = open; updateToggle(); };
  wrap.addEventListener('toggle', updateToggle, true); updateToggle(); placeCatalogExpand(toggleAll,wrap);
  searchResults.appendChild(wrap);
  searchResults.style.display = "block";
}

let searchTimer = null;
function scheduleSearch() {
  ++quickRequestId;
  clearTimeout(searchTimer);
  if(quickSearchController){quickSearchController.abort();quickSearchController=null;quickSearchBtn.disabled=false;quickSearchBtn.textContent='搜索';}
  searchTimer = setTimeout(() => {
    const q = quickSearchInput.value.trim();
    if(activeCat==='module-config'){renderModuleConfigurations(q);return;}
    if(q.length===1&&['all','firmware'].includes(activeCat)){lastSearch=null;searchResults.replaceChildren();searchResults.style.display='none';return;}
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
  }, 350);
}

// 点分类：软件走独立端点；规格书/说明书/固件对当前产品结果本地过滤；空词先提示输入型号
function onPickCategory(cat) {
  clearTimeout(searchTimer);
  ++quickRequestId;
  setActiveCat(cat);
  updateQuickExamples();
  const q = quickSearchInput.value.trim();
  window.dispatchEvent(new Event('v2-mascot-reset'));mascotGuide('search',q);
  if(cat==='module-config'){renderModuleConfigurations(q);return;}
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
    if (p === "/wiki") {
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
      } else if (["spec","manual","other","pending"].includes(deepCat) && quickSearchInput) {
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
// Clicks interact; page navigation is an explicit action. Dragging never submits a question.
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
  // Wiki uses the fast armored mascot; the question-and-answer view uses the robot.
  const IRON_AVATAR =
    '<img class="xm-iron" src="img/mascot-iron.png" alt="Wiki资料速查吉祥物" width="60" height="60">';
  const defs = [
    { view: "quick", cls: "mascot-plane", svg: IRON_AVATAR, target: "ai", label: "Wiki速查吉祥物", bubble: "快速查参数、找资料，我来帮你" },
    { view: "ai", cls: "mascot-bolt", glyph: "\u{1F916}", target: "quick", label: "客服问答吉祥物", bubble: "配单、售后故障，问小灰机" },
  ];
  const shownSuggestions=new Set();
  defs.forEach((d) => {
    const el = document.createElement("div");
    el.className = "xhj-mascot " + d.cls;
    const orbInner = d.svg ? d.svg : `<span class="xm-glyph"></span>`;
    el.innerHTML =
      `<div class="xm-bubble" role="status" aria-live="polite"><span class="xm-bubble-text"></span><button type="button" class="xm-bubble-close" title="关闭" aria-label="关闭小灰机提示">×</button></div>` +
      `<div class="xm-orb">${orbInner}</div>`;
    const bubble = el.querySelector(".xm-bubble");
    el.querySelector(".xm-bubble-text").textContent = d.bubble;
    const glyphEl = el.querySelector(".xm-glyph");
    if (glyphEl) glyphEl.textContent = d.glyph;
    el.querySelector(".xm-bubble-close").addEventListener("click", (ev) => {
      ev.stopPropagation(); bubble.classList.remove("show");
    });
    document.body.appendChild(el);
    let adviceTimer=null,lastAdvice=null,quietUntil=0;
    function fitBubble(){
      if(!el.classList.contains('is-active'))return;
      const orbBox=el.getBoundingClientRect();if(orbBox.left<4||orbBox.right>innerWidth-4||orbBox.top<4||orbBox.bottom>innerHeight-4){el.style.right='auto';el.style.bottom='auto';el.style.left=Math.max(4,Math.min(orbBox.left,innerWidth-el.offsetWidth-4))+'px';el.style.top=Math.max(4,Math.min(orbBox.top,innerHeight-el.offsetHeight-4))+'px';}
      bubble.style.transform='';bubble.style.top='';bubble.style.bottom='';
      if(!bubble.classList.contains('show'))return;
      let box=bubble.getBoundingClientRect();if(box.top<8){bubble.style.bottom='auto';bubble.style.top='calc(100% + 12px)';box=bubble.getBoundingClientRect();}
      const dx=box.left<8?8-box.left:box.right>innerWidth-8?innerWidth-8-box.right:0;
      const dy=box.bottom>innerHeight-8?innerHeight-8-box.bottom:0;
      bubble.style.transform=`translate(${dx}px,${dy}px)`;
    }
    function showAdvice(advice,interaction=false){
      if(!advice?.message||(!interaction&&Date.now()<quietUntil))return;
      if(!interaction){lastAdvice=advice;delete el.dataset.mood;}
      clearTimeout(adviceTimer);
      const text=el.querySelector('.xm-bubble-text');text.replaceChildren();
      const heading=document.createElement('strong');heading.className='xm-advice-heading';heading.textContent=advice.title||'小灰机 · 型号提醒';text.append(heading);
      if(advice.highlights?.length){const list=document.createElement('ul');list.className='xm-advice-highlights';for(const value of advice.highlights){const item=document.createElement('li');item.textContent=value;list.append(item);}text.append(list);}
      else {const message=document.createElement('span');message.textContent=advice.message;text.append(message);}
      for(const model of advice.models||[]){const button=document.createElement('button');button.type='button';button.textContent='查 '+model;button.addEventListener('click',ev=>{ev.stopPropagation();quickSearchInput.value=model;bubble.classList.remove('show');doSearch();});text.append(document.createTextNode(' '),button);}
      for(const action of advice.actions||[]){const button=document.createElement('button');button.type='button';button.textContent=action.label;button.onclick=ev=>{ev.stopPropagation();bubble.classList.remove('show');mascotAction(action);};text.append(document.createTextNode(' '),button);}
      bubble.classList.add('show');
      fitBubble();
      // Customer controls dismissal. A useful result must not vanish while they read the product card.
    }
    window.addEventListener('resize',fitBubble);
    window.addEventListener('v2-mascot-reset',()=>{clearTimeout(adviceTimer);lastAdvice=null;bubble.classList.remove('show');});
    window.addEventListener('v2-mascot-advice',event=>{
      if((event.detail?.view||'quick')!==d.view||document.body.dataset.view!==d.view)return;
      showAdvice(event.detail);
    });
    window.addEventListener('v2-model-suggestion',event=>{
      const suggestion=event.detail,key=suggestion?.input+'|'+suggestion?.model;
      if(suggestion?.view!==d.view||shownSuggestions.has(key)||document.body.dataset.view!==d.view)return;
      if(shownSuggestions.size>=50)shownSuggestions.delete(shownSuggestions.values().next().value);shownSuggestions.add(key);
      const text=el.querySelector('.xm-bubble-text');text.replaceChildren(document.createTextNode(suggestion.message+' '));
      const button=document.createElement('button');button.type='button';button.textContent='填入型号';button.onclick=ev=>{ev.stopPropagation();const input=document.getElementById(d.view==='ai'?'aiInput':'quickSearchInput');if(input&&!input.disabled){input.value=suggestion.model;input.focus();bubble.classList.remove('show');}};text.append(button);bubble.classList.add('show');
    });

    // Only execution-backed optional hints show bubbles; view changes update visibility.
    const syncVis = () => {
      const nowActive = document.body.dataset.view === d.view;
      el.classList.toggle("is-active", nowActive);
      if(nowActive)requestAnimationFrame(fitBubble);
      // Keep hints passive; navigation never schedules a repeated suggestion.
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
    // Optional model hints are shown once; no periodic replay.

    // 拖拽（pointer 事件统一鼠标/触摸）；位移小于阈值视为点击 → 互跳
    const orb = el.querySelector(".xm-orb");
    // mascotdrag-fix-20260920：禁用吉祥物(含 <img>)的原生 HTML5 拖拽与文字选中，拖动只走 pointer 自绘，
    // 不再产生拖影、不再抢走 pointer，也不会误入聊天区图片拖放(OCR)；图片点选/粘贴/拖入链路保持不变
    orb.querySelectorAll("img").forEach((im) => { try { im.draggable = false; } catch (e) {} });
    ["dragstart", "selectstart"].forEach((evName) => orb.addEventListener(evName, (e2) => e2.preventDefault()));
    let dragging = false, moved = false, startX = 0, startY = 0, baseLeft = 0, baseTop = 0;
    const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
    let tapCount=0,lastTap=0,coolUntil=0,motion=null;
    orb.setAttribute('role','button');orb.tabIndex=0;orb.setAttribute('aria-label',d.label+'，点击互动，按住可拖动');
    function react(){
      if(dragging||moved)return;
      const now=Date.now();if(now<coolUntil)return;
      tapCount=now-lastTap<1500?tapCount+1:1;lastTap=now;
      const stage=tapCount>=10?'rest':tapCount>=6?'dizzy':tapCount>=3?'bounce':'wave';el.dataset.mood=stage;
      motion?.cancel();if(!matchMedia('(prefers-reduced-motion: reduce)').matches){
        const frames=stage==='dizzy'?[{transform:'rotate(-14deg)'},{transform:'rotate(14deg)'},{transform:'rotate(0)'}]:stage==='bounce'?[{transform:'translateY(0)'},{transform:'translateY(-14px) scale(1.08)'},{transform:'translateY(0)'}]:[{transform:'rotate(0)'},{transform:'rotate(-10deg)'},{transform:'rotate(10deg)'},{transform:'rotate(0)'}];
        motion=orb.animate(frames,{duration:450,iterations:1});
      }
      if(stage==='rest')coolUntil=now+6000;
      const message=stage==='rest'?'收到十连击！让我缓六秒，再陪你玩。':stage==='dizzy'?'转晕啦，按钮在下面，正事我也没忘。':stage==='bounce'?'我在我在！这么有精神，要不要一起解决个问题？':'我在！轻点找我，拖动可以给我挪个位置。';
      const actions=[{label:d.view==='quick'?'去客服问答':'去资料搜索',type:'navigate',view:d.target}];
      showAdvice({title:'小灰机 · '+({wave:'收到啦',bounce:'精神满满',dizzy:'有点晕',rest:'休息一下'}[stage]),message,actions},true);
      const text=el.querySelector('.xm-bubble-text');
      if(lastAdvice){const back=document.createElement('button');back.type='button';back.textContent='查看刚才提示';back.onclick=()=>showAdvice(lastAdvice,true);text.append(' ',back);}
      const quiet=document.createElement('button');quiet.type='button';quiet.textContent='先安静一会';quiet.onclick=()=>{quietUntil=Date.now()+30000;bubble.classList.remove('show');motion?.cancel();};text.append(' ',quiet);fitBubble();
    }
    orb.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();moved=false;react();}});
    orb.addEventListener("pointerdown", (ev) => {
      if(ev.button!==0)return;
      dragging = true; moved = false;
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
        bubble.classList.remove('show');motion?.cancel();
        el.style.left = clamp(baseLeft + dx, 4, window.innerWidth - el.offsetWidth - 4) + "px";
        el.style.top = clamp(baseTop + dy, 4, window.innerHeight - el.offsetHeight - 4) + "px";
      }
    });
    const endDrag = (ev) => {
      if (!dragging) return;
      dragging = false;
      try { orb.releasePointerCapture(ev.pointerId); } catch (e) {}
      if (moved) {
        try{localStorage.setItem(posKey, JSON.stringify({ left: parseFloat(el.style.left), top: parseFloat(el.style.top) }));}catch{}
        tapCount=0;showAdvice({title:'小灰机 · 搬家啦',message:'这个位置也不错，我就在这里陪你。'},true);
      }
    };
    orb.addEventListener("pointerup", endDrag);
    orb.addEventListener("pointercancel", () => { dragging = false;moved=true; });
    orb.addEventListener("click", react);
  });
})();


// Only JSON catalog metadata is warmed; no document or original-file URLs are fetched.
function preloadDocumentCatalogs() {
  if(document.body.dataset.audience!=='public'&&new URLSearchParams(location.search).get('cat')==='other')return;
  const tasks = ['spec', 'manual', 'firmware', 'software', 'video'];
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const cat = tasks[next++];
      try {
        if (cat === 'software') await fetchSoftware('');
        else if (cat === 'video') await fetchVideos('');
        else await fetchDocs(cat);
      } catch (_) { /* Failed preloads are retried by the normal click path. */ }
    }
  }
  const warm = () => Promise.allSettled([worker(), worker()]);
  if ('requestIdleCallback' in window) window.requestIdleCallback(warm, { timeout: 100 });
  else setTimeout(warm, 0);
}
if (document.readyState !== 'loading') preloadDocumentCatalogs();
else window.addEventListener('DOMContentLoaded', preloadDocumentCatalogs, { once: true });

function buildSoftwareAccessButton(s) {
  if(s.access.type==='links'){
    const links=document.createDocumentFragment();
    for(const item of s.access.links||[]){const a=document.createElement('a');a.href=item.url;a.target='_blank';a.rel='noopener noreferrer';a.className='sw-btn-download sw-btn-sm';a.textContent=s.access.links.length===1?'访问入口':item.label+'入口';a.title=s.name+' · '+item.label+'（新标签页打开）';links.append(a);}
    return links;
  }
  const button=document.createElement('button');button.type='button';button.className='sw-btn-download sw-btn-sm';button.textContent=s.access.type==='qr'?'扫码下载':'访问入口';
  button.onclick=()=>{
    const dialog=document.createElement('dialog');dialog.style.cssText='max-width:600px;width:calc(100% - 48px);border:0;border-radius:14px;padding:24px;box-sizing:border-box;margin:auto;max-height:calc(100dvh - 48px);overflow:auto';
    const heading=document.createElement('h3');heading.textContent=s.name;dialog.append(heading);
    if(s.access.imageUrl){const image=document.createElement('img');image.src=s.access.imageUrl;image.alt='屏掌控下载二维码与安装说明';image.style.cssText='max-width:100%;height:auto';dialog.append(image);}
    for(const item of s.access.links||[]){const line=document.createElement('p'),a=document.createElement('a');a.href=item.url;a.target='_blank';a.rel='noopener noreferrer';a.textContent=item.label;a.className='sw-btn-download sw-btn-sm';line.append(a);if(item.note)line.append('：'+item.note);dialog.append(line);}
    if(s.access.note){const note=document.createElement('p');note.textContent=s.access.note;dialog.append(note);}
    const close=document.createElement('button');close.type='button';close.textContent='关闭';close.onclick=()=>dialog.close();dialog.append(close);dialog.addEventListener('close',()=>dialog.remove(),{once:true});document.body.append(dialog);dialog.showModal();
  };
  return button;
}

// Explicit dependencies shared by the selected channel and browser-local conversation store.
Object.assign(FrontendApp, {
 input:aiInput,sendButton:aiSendBtn,messages:aiMessages,resizeInput:resizeAiInput,appendChatMessage,scrollChatToBottom,followChatUpdates,
 state:{get history(){return chatHistory;},set history(v){chatHistory=v;},get triage(){return triagePath;},set triage(v){triagePath=v;},get numeric(){return lastNumericOptions;},set numeric(v){lastNumericOptions=v;}},
 getSessionId:getSid,setSessionId(id){activeSessionId=id;window.__v2SessionId=id;FrontendApp.events.dispatchEvent(new Event("session-change"));},
 resetState(){chatHistory=[];triagePath=null;lastNumericOptions=null;window.__v2LastReply=null;},
 clearImage:clearOcrImage,setImageState(v){ocrState=v;},addUserMessage,addAssistantMessage,addLoading:addAssistantLoading,removeLoading,assistantTextOf,prepareLegacyMessage,isSelftestEnv,
 catalog:{invalidate(){clearTimeout(searchTimer);++quickRequestId;},setActiveCat,updateQuickExamples,onPickCategory,get activeCat(){return activeCat;}}
});

window.FrontendApp = FrontendApp;
if(document.body.dataset.audience!=='public')document.querySelector('#quickCats [data-cat="module-config"]').hidden=false;
})();

// Public catalogue has no authorized customer model boundary yet. Keep internal
// search and chat controls closed while preserving approved product resources.
if(document.body.dataset.audience==='public'){
 const more=document.getElementById('quickMoreDocsBtn');if(more)more.hidden=true;
 document.querySelectorAll('#quickCats [data-cat=other],#quickCats [data-cat=pending]').forEach(button=>button.hidden=true);
 const hint=document.querySelector('.ai-hint');if(hint)hint.textContent='根据已批准公开的资料回答；内部资料与全文检索不对公网开放。';
}



