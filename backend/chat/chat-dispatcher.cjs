'use strict';
// Business dispatcher emits response payloads; HTTP parsing and logging stay in server.js.
function createChatDispatcher({resolveRoute,routerNlu,ordering,replayQuery,saveOrderingSsm,matchSoftware,videoCatalog,buildSoftwareAnswer,buildPresalesAnswer,linkSpecLine,injectFirmwareLine,wecomChipFwLine,noisyUnrecognized,UNRECOGNIZED_REPLY,aftersales,parseClarify,parsePyramidText}) {

async function handleOrdering({message,history,payload,emit}) {
    const orderingResult = await ordering.handleOrdering(message, history);
    // 可导入 HDSet 的连屏文件：specialist 仅对真机验证过的口数在 ordering.ssm 给 ssmXml，这里落盘换成下载地址（大 XML 不回传客户端）
    try {
      const od = orderingResult.ordering;
      if (od && od.ssm && od.ssm.ssmXml) {
        if (String(payload.source || "") === "wecom") {
          od.ssm = null; // 企微纯文本通道不提供文件下载，也不回传大 XML、不落盘
        } else {
          const ssmId = saveOrderingSsm(od.ssm.ssmXml);
          od.ssm = ssmId
            ? { available: true, url: `/api/ordering/ssm?f=${encodeURIComponent(ssmId)}`, fileName: od.ssm.fileName, ports: od.ssm.ports, cardCount: od.ssm.cardCount }
            : null;
        }
      }
    } catch (eSsm) { console.error("[ssm attach]", eSsm.message); if (orderingResult.ordering) orderingResult.ordering.ssm = null; }
    // 保留 specialist 自带 meta，并补 route 与网页复现用 q（不能整体 Object.assign，否则 meta 被覆盖丢 q）
    const orderingMeta = Object.assign({ route: "ordering" }, orderingResult.meta || {}, { q: replayQuery(message, history) });
    emit( Object.assign({}, orderingResult, { meta: orderingMeta }));
    return true;


}

async function handleSoftware({message,history,payload,emit}) {
    // 未点名具体软件、但明确要操作/教学视频（如“复位视频/怎么投屏/恢复出厂怎么操作”）→ 跨软件按操作主题给视频
    let swMatched = [];
    try { swMatched = matchSoftware(message); } catch { swMatched = []; }
    if (!swMatched.length && videoCatalog.isVideoAcquire(message)) {
      let va = null;
      try { va = videoCatalog.buildVideoAnswer(message, { source: payload.source || "" }); } catch (err) { console.error("[video error]", err.message); }
      if (va) {
        emit( {
          status: "answer",
          reply: va.reply,
          needClarify: false,
          model: "local-software",
          video: { items: va.items },
          meta: { route: "software", kind: "video", count: va.items.length }
        });
        return true;
      }
    }
    let sw = null;
    try { sw = buildSoftwareAnswer(message); } catch (err) { console.error("[software error]", err.message); }
    if (sw) {
      // reply 已是 markdown 链接（企微可点）；software.items 为结构化数据，网页端渲染下载卡片
      emit( {
        status: "answer",
        reply: sw.reply,
        needClarify: false,
        model: "local-software",
        software: { items: sw.items, isList: sw.isList },
        meta: { route: "software", count: sw.items.length }
      });
      return true;
    }

return false;
}

async function handlePresales({message,history,payload,emit}) {
    let pre = null;
    try { pre = await buildPresalesAnswer(message); } catch (err) { console.error("[presales error]", err.message); }
    if (pre) {
      let replyText = pre.reply;
      let outsideHint = "";
      if (payload.source === "quick-site") {
        // 网页：答案正文 + 相近芯片椭圆都在气泡框内，故障引导句交给前端放到框外
        outsideHint = pre.hint || "";
      } else {
        // 企微等纯文本通道：主产品规格书文件名 → 可点 markdown 链接（外网直开 PDF）；网页通道仍用纯文件名由前端渲染
        const wecomMain = (pre.products && pre.products[0]) || null;
        if (wecomMain) replyText = linkSpecLine(replyText, wecomMain.specPairs);
        replyText = injectFirmwareLine(replyText, wecomMain); // 产品卡「固件」标签在企微降级为一行可点链接（搜芯片的 chipFirmware 不受影响）
        const chipFwLine = wecomChipFwLine(pre.chipFirmware); // 搜芯片：主驱动系列固件引导回卡型号取下载，不堆链接
        if (chipFwLine) replyText += `\n${chipFwLine}`;
        // 相近芯片/近似型号不在正文平铺罗列：统一交给 attachWeCom 生成“回复数字选型 / 发完整型号”的带序号选项行
        if (pre.hint) replyText += `\n${pre.hint}`;
      }      emit( {
        status: "answer", reply: replyText, hint: outsideHint, needClarify: false, model: "local-presales",
        presales: { products: pre.products, chipFirmware: pre.chipFirmware, related: pre.related },
        meta: { route: "presales" },
      });
      return true;
    }
    // 已识别为售前、但话里没有可直接查的型号/芯片（如“有没有支持4K的处理器”“带WiFi的发送卡”）：
    // 给售前专属引导（可发型号直查、也可给需求帮筛），不再掉进与“完全听不懂”相同的通用兜底
    emit( {
      status: "answer",
      reply: "你想了解的是产品选型或参数，两种方式都可以：\n① 直接发型号或芯片丝印（如 VP2060、6363），我给参数、接口、带载、规格书和固件信息；\n② 告诉我需求我帮你筛——整屏宽高或点间距、几路 HDMI、是否 4K、要不要 WiFi、网口数量、同步还是异步。\n发其中一项就行。",
      needClarify: false,
      model: "boundary-presales-need-model",
      meta: { route: "presales", reason: "no-entity" }
    });
    return true;


}

async function handleAftersales({message,history,payload,emit}) {
  // 售后专精通道：当前启用「显示效果」「连接联网」两个问题域（仅售后路由进入，不再抢占其他意图）
  let spResult;
  try {
    spResult = aftersales.handle(message, history);
  } catch (err) {
    console.error("[specialist error]", err);
    spResult = null;
  }

  if (spResult && spResult.matched) {
    if (spResult.needClarify) {
      // 信息不足：反问
      const cl = parseClarify(spResult.reply);
      emit( {
        status: "clarify",
        clarifyQuestion: cl.clarifyQuestion,
        // 分流提问（如接收卡测试后问异步/同步）用后端给的 {label,value}，其余用默认型号快捷词
        quickOptions: spResult.options || cl.quickOptions,
        needClarify: true,
        model: "local-aftersales",
        meta: { specialist: "aftersales", domain: spResult.meta?.domain || "", stage: spResult.meta?.stage || "clarify", sourceGrade: "C", confidence: "中" }
      });
    } else {
      // 直接回答：纯文本 → 结构化 pyramid
      const pyramid = parsePyramidText(spResult.reply);
      emit( {
        status: "answer",
        pyramid,
        bestId: spResult.bestId || "",
        candidates: spResult.candidates || [],
        followUp: spResult.followUp || null,
        needClarify: false,
        model: "local-aftersales",
        sources: spResult.sources || [],
        meta: { specialist: "aftersales", domain: spResult.meta?.domain || "", stage: spResult.meta?.stage || "answer", categories: spResult.meta?.categories || [], products: spResult.meta?.products || [], chips: spResult.meta?.chips || [], hitCount: spResult.meta?.hitCount || 0, sourceGrade: "A", confidence: "高" }
      });
    }
    return true;
  }

          // 售后路由但专精未匹配到案例（无芯片/无已知域）：给售后补料反问，引导客户发芯片型号+现象
            emit( {
              status: "clarify",
              reply: "方便把【设备背面完整型号】和接收卡上的【芯片丝印】发我吗？再一句话说下现场现象（比如黑屏、花屏、连不上、颜色异常），我按对应芯片给你最高频的解决案例。",
              clarifyQuestion: "请提供设备型号或芯片丝印，并描述现场现象",
              quickOptions: [
                { label: "我发芯片型号", value: "芯片丝印在接收卡上，常见如 FM6363、ICN2065、SM16380" },
                { label: "我描述现象", value: "现象是" }
              ],
              needClarify: true,
              model: "local-aftersales",
              meta: { specialist: "aftersales", domain: spResult && spResult.meta ? spResult.meta.domain : "", stage: "clarify", sourceGrade: "C", confidence: "低", route: "aftersales-noentity" }
            });
            return true;


}

async function handleUnknown({message,history,payload,emit}) {
          const isGreeting = /^\s*(你好|您好|嗨|哈喽|hi|hello|在吗|在不在|早上好|上午好|中午好|下午好|晚上好)\s*[!！。.，,~～?？]*$/i.test(message);
          emit( {
            status: "answer",
            reply: isGreeting
              ? "你好，我是灰度科技的小灰机，可以这样找我：① 发设备型号或芯片丝印（如 R708、6363），查参数、规格书和固件；② 直接发整屏尺寸和点间距（如 1920×1080 P3 同步），我给配单、接收卡数量和网线拓扑；③ 描述现场故障现象加型号（如 C16L 花屏一直闪），我给已解决的售后案例。"
              : "这个问题我没完全看懂。你可以直接发【设备型号或芯片丝印】，我给你参数和固件；也可以描述【现场现象+型号】，我给你对应的售后解决案例。",
            needClarify: false,
            model: "boundary-placeholder",
            meta: { route: "unknown" }
          });

}

return async function dispatchChat(message,history,payload,emit) {
 const {intent:route,detail:routeDetail}=await resolveRoute(message,history);
 const ctx={message,history,payload,emit};
 if(routeDetail?.boundary?.escalate){const bk=routeDetail.boundary.kind;emit({status:"answer",reply:routerNlu.buildBoundaryReply(bk),needClarify:false,model:"boundary-"+bk,meta:{route:routerNlu.BOUNDARY_INTENT[bk]||"presales",escalate:bk}});return;}
 if(route==="ordering")return handleOrdering(ctx);
 if(route==="software" && await handleSoftware(ctx))return;
 if(route==="presales")return handlePresales(ctx);
 if(route==="unknown" && noisyUnrecognized(message)){emit({status:"answer",reply:UNRECOGNIZED_REPLY,needClarify:false,model:"boundary-unrecognized",meta:{route:"unrecognized"}});return;}
 if(route==="aftersales")return handleAftersales(ctx);
 return handleUnknown(ctx);
};
}
module.exports={createChatDispatcher};
