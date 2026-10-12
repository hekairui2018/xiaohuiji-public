const fs = require("fs");
const path = require("path");

const RULE_FILE = path.join(__dirname, "data", "hardware-evidence-rules.json");

let cachedRules = null;
let cachedMtime = 0;

function loadRules() {
  try {
    const stat = fs.statSync(RULE_FILE);
    if (cachedRules && cachedMtime === stat.mtimeMs) return cachedRules;
    cachedRules = JSON.parse(fs.readFileSync(RULE_FILE, "utf8").replace(/^\uFEFF/, ""));
    cachedMtime = stat.mtimeMs;
    return cachedRules;
  } catch {
    return { evidencePriority: [], knownConflicts: [] };
  }
}

function canonical(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[×＊*]/g, "X")
    .replace(/[^A-Z0-9\u4e00-\u9fff]/g, "");
}

function containsAny(text, values) {
  return values.some((value) => text.includes(canonical(value)));
}

function isHardwareDecisionRequest(rawText) {
  return /(?:芯片|驱动|译码|丝印|智能设置|配置文件|模组配置|固件|升级|HDSet|调试|配单|配卡|接收卡)/i.test(String(rawText || ""));
}

function isHighRiskHardwareRequest(rawText) {
  const raw = String(rawText || "");
  const fault = /(?:异常|不正常|花屏|黑屏|不亮|暗影|残影|重影|闪烁|闪屏|色块|偏色|乱码|错行|水波纹|连接不上|连不上|无法|失败|报错|发热|烧|损坏)/i.test(raw);
  const firmwareWrite = /(?:固件|升级|刷机|FPGA)/i.test(raw);
  return fault || firmwareWrite;
}

function analyzeHardwareEvidence(rawText) {
  const text = canonical(rawText);
  const raw = String(rawText || "");
  const rules = loadRules();
  const conflicts = Array.isArray(rules.knownConflicts) ? rules.knownConflicts : [];
  const exactConflict = conflicts.find((row) => {
    const ids = row.identifiers || {};
    return containsAny(text, [ids.productionOrder, ids.productCode, row.verifiedActual?.pcbLabel, row.verifiedActual?.debugCode].filter(Boolean));
  }) || null;
  const packagePair = text.includes("FM6353E") && text.includes("TC7559KC");
  const actualPair = text.includes("DP5135") && text.includes("TC7559KC");
  const packageSource = /(?:外箱|包装|箱贴|包装标签|外包装|纸箱|箱子标签)/i.test(raw);
  const actualSource = /(?:模组背面|PCB|实际芯片|芯片丝印|板上丝印|实物芯片|拆开|背板)/i.test(raw);
  const decisionRequest = isHardwareDecisionRequest(raw);
  const highRiskDecisionRequest = isHighRiskHardwareRequest(raw);

  const needsGenericPackageWarning = Boolean(packageSource && highRiskDecisionRequest && !actualSource && !exactConflict && !packagePair);
  return {
    exactConflict,
    packagePair,
    actualPair,
    packageSource,
    actualSource,
    decisionRequest,
    highRiskDecisionRequest,
    knownRisk: Boolean(exactConflict || packagePair),
    blockAutomaticChipSelection: Boolean(highRiskDecisionRequest && (exactConflict || (packagePair && !actualPair) || needsGenericPackageWarning)),
    needsGenericPackageWarning
  };
}

function verifiedHardwareQuery(rawText) {
  const state = analyzeHardwareEvidence(rawText);
  if (!state.highRiskDecisionRequest) return String(rawText || "");
  if (!state.exactConflict) return state.blockAutomaticChipSelection ? "" : String(rawText || "");
  const packageDriver = state.exactConflict.packageClaim?.driverIc;
  const actualDriver = state.exactConflict.verifiedActual?.driverIc;
  const actualDecoder = state.exactConflict.verifiedActual?.decoderIc;
  let adjusted = String(rawText || "");
  if (packageDriver && actualDriver) adjusted = adjusted.replace(new RegExp(packageDriver, "ig"), actualDriver);
  return `${adjusted} ${actualDriver || ""} ${actualDecoder || ""}`.trim();
}

function buildHardwareEvidenceNotice(rawText) {
  const state = analyzeHardwareEvidence(rawText);
  if (!state.highRiskDecisionRequest) return "";
  if (state.exactConflict) {
    const row = state.exactConflict;
    return [
      "这批现场记录已确认标签与实物不一致：",
      `- 外箱标签：${row.packageClaim.text}`,
      `- 模组背面实物：${row.verifiedActual.driverIc}+${row.verifiedActual.decoderIc}`,
      `HDSet智能设置、模组配置和固件匹配以实物 ${row.verifiedActual.driverIc}+${row.verifiedActual.decoderIc} 为准。`,
      `不能按外箱 ${row.packageClaim.driverIc} 套用；该信息只用于批次追溯。`
    ].join("\n");
  }
  if (state.packagePair && !state.actualPair) {
    return "FM6353E+TC7559KC 这一外箱组合已有标签与模组实物不一致记录。当前信息只能作包装线索；选择HDSet智能设置、配置文件或固件前，请核对模组背面PCB上的实际驱动芯片和译码芯片。";
  }
  if (state.needsGenericPackageWarning) {
    return "当前芯片信息来自外箱或包装标签，只作参考；HDSet智能设置、配置文件和固件匹配以模组背面PCB/芯片实际丝印为准。";
  }
  return "";
}

function buildHardwareFaultReply(rawText) {
  const state = analyzeHardwareEvidence(rawText);
  if (!state.knownRisk && !state.needsGenericPackageWarning) return "";
  const notice = buildHardwareEvidenceNotice(rawText);
  if (state.exactConflict) {
    const actual = state.exactConflict.verifiedActual;
    return [
      notice,
      "这类标签冲突会让后续智能设置和参数判断从一开始就走错，先处理证据不一致，不先尝试其他芯片参数或扫描数值。",
      "1. 先备份当前接收卡参数和工程。",
      `2. 在模组背面核对实际驱动/译码丝印，并检查HDSet当前选择是否为 ${actual.driverIc}+${actual.decoderIc}。`,
      `3. 若当前选择不一致，备份后按 ${actual.driverIc}+${actual.decoderIc} 重新完成智能设置并发送参数，再观察原故障是否消失。`,
      "若丝印与HDSet选择已经一致但故障仍在，再按整屏、单箱或单块模组的异常范围继续分流，不能回头套用外箱芯片参数。"
    ].join("\n");
  }
  return [
    notice,
    "先保留当前参数，不直接升级固件或套用包装标签对应的智能设置。",
    "请在模组背面核对实际驱动芯片、译码芯片及后缀，再检查HDSet当前选择是否一致；确认实物后才能继续调试。"
  ].join("\n");
}

function applyHardwareEvidenceGuard(reply, rawText) {
  const value = String(reply || "").trim();
  const notice = buildHardwareEvidenceNotice(rawText);
  if (!notice) return value;
  if (value.includes("标签与实物不一致") || value.includes("外箱或包装标签，只作参考") || value.includes("这一外箱组合已有")) return value;
  return [value, notice].filter(Boolean).join("\n\n");
}

module.exports = {
  RULE_FILE,
  loadRules,
  analyzeHardwareEvidence,
  verifiedHardwareQuery,
  buildHardwareEvidenceNotice,
  buildHardwareFaultReply,
  applyHardwareEvidenceGuard
};
