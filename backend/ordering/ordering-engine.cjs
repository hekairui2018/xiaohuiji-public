"use strict";

const ORDERING_ENGINE_COMMONJS = typeof module === "object"
  && Boolean(module?.exports)
  && typeof require === "function";
const ORDERING_ENGINE_GLOBAL = typeof globalThis === "object" ? globalThis : {};
const ORDERING_ENGINE_BROWSER_DATA = ORDERING_ENGINE_COMMONJS
  ? {}
  : (ORDERING_ENGINE_GLOBAL.HuiduOrderingData || {});
const fs = ORDERING_ENGINE_COMMONJS ? require("fs") : null;
const path = ORDERING_ENGINE_COMMONJS ? require("path") : null;
const orderingData = ORDERING_ENGINE_COMMONJS ? require("./ordering-data.cjs") : null;
const hardwareEvidence = ORDERING_ENGINE_COMMONJS
  ? require("./hardware-evidence.cjs")
  : { applyHardwareEvidenceGuard: (text) => text };

const LIMIT = 655360;
// 网线（网口）达到该数量才在结果末尾补充拼接机箱方案；少于则单台处理器即可，不显示拼接
const SPLICER_MIN_CABLES = 30;
const DEFAULT_MODULE_MM = Object.freeze({ w: 320, h: 160 });
const TRAINING_RULES_PATH = ORDERING_ENGINE_COMMONJS
  ? path.join(__dirname, "data", "09_配单选型知识库_培训选型规则索引.json")
  : "";

function loadTrainingRules() {
  if (!ORDERING_ENGINE_COMMONJS) {
    return ORDERING_ENGINE_BROWSER_DATA.trainingRules || { directControllers: [], selectionRules: {}, splicer: null };
  }
  try {
    return JSON.parse(fs.readFileSync(TRAINING_RULES_PATH, "utf8"));
  } catch {
    return { directControllers: [], selectionRules: {}, splicer: null };
  }
}

const TRAINING_RULES = loadTrainingRules();
const BASE_DIRECT_CONTROLLERS = Object.freeze(TRAINING_RULES.directControllers || []);
const DIRECT_COLOR_LABELS = Object.freeze({ single: "单色", dual: "双色", full: "全彩" });
const COMMUNICATION_LABELS = Object.freeze({ wifi: "Wi-Fi", usb: "U盘", ethernet: "网线" });
function physicalSizeDistance(row, pitch) {
  if (!row || !pitch) return Number.POSITIVE_INFINITY;
  const mmW = row.mmW || row.w * pitch;
  const mmH = row.mmH || row.h * pitch;
  return Math.abs(mmW - DEFAULT_MODULE_MM.w) + Math.abs(mmH - DEFAULT_MODULE_MM.h);
}

const LOAD_INDEX_PATH = ORDERING_ENGINE_COMMONJS
  ? path.join(__dirname, "data", "module-receiver-load-index.json")
  : "";
const VERIFIED_LOAD_PATH = ORDERING_ENGINE_COMMONJS
  ? path.join(__dirname, "data", "09_配单选型知识库_已验证带载档案.json")
  : "";
const CARD_PRIORITY = ["R716", "R712", "R708", "R732", "R500S"];
// Official conventional-chip recommended ranges. The first value is the
// short side and the second is the long side; this matters for banner screens.
const RECEIVER_RANGES = Object.freeze({
  R708: { shortSide: 128, longSide: 512, maxPoints: 65536 },
  R712: { shortSide: 128, longSide: 1024, maxPoints: 131072 },
  R716: { shortSide: 160, longSide: 1024, maxPoints: 163840 }
});
// Keep performance-mode limits separate from the formal module load table.
// They are used for risk disclosure and validation, never to silently replace
// a source-backed module/card layout.
const RECEIVER_MODE_PROFILES = Object.freeze({
  R708: {
    conventional: [{ w: 128, h: 512 }],
    pwm: [{ w: 256, h: 512 }]
  },
  R712: {
    conventional: [{ w: 128, h: 1024 }],
    pwm: [{ w: 256, h: 1024 }]
  },
  R716: {
    conventional: [{ w: 160, h: 1024 }, { w: 256, h: 640 }],
    pwm: [{ w: 320, h: 1024 }, { w: 256, h: 1280 }, { w: 512, h: 640 }]
  },
  R732: {
    conventional: [{ w: 128, h: 1024 }],
    pwm: [{ w: 256, h: 1024 }]
  }
});

const CABINET_RECEIVER_OPTIONS = Object.freeze({
  "50PIN": { primary: "R500S", candidates: ["R500S"], label: "2组50PIN通用接口" },
  "120PIN": { primary: "R5SPLUS", candidates: ["R5SPLUS", "R5S"], label: "120PIN高密接口" },
  "84PIN": { primary: "RB6", candidates: ["RB6"], label: "84PIN高密接口" },
  "26PIN": { primary: "R507T", candidates: ["R507T"], label: "4组26PIN接口" }
});
const DEFAULT_CABINET_PIN_TYPE = "120PIN";

function samePitchFamily(left, right) {
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  if (Math.abs(left - right) < 0.001) return true;
  if (left >= 1.529 && left <= 1.539 && right >= 1.529 && right <= 1.539) return true;
  return left >= 6.65 && left <= 6.68 && right >= 6.65 && right <= 6.68;
}

function parsePair(value) {
  const match = String(value || "").match(/(\d+)\s*[xX×*]\s*(\d+)/);
  return match ? [Number(match[1]), Number(match[2])] : null;
}

function parseCardLayout(value) {
  const match = String(value || "").match(/(\d+)\s*宽\s*(\d+)\s*高/);
  return match ? { w: Number(match[1]), h: Number(match[2]) } : null;
}

function loadModulePresets() {
  if (!ORDERING_ENGINE_COMMONJS) {
    return Array.isArray(ORDERING_ENGINE_BROWSER_DATA.modulePresets)
      ? ORDERING_ENGINE_BROWSER_DATA.modulePresets
      : [];
  }
  const data = JSON.parse(fs.readFileSync(LOAD_INDEX_PATH, "utf8"));
  const legacyRows = (data.rows || []).map((row, index) => {
    const pitchMatch = String(row.模组型号 || "").match(/[PQ]\s*(\d+(?:\.\d+)?)/i);
    const pixels = parsePair(row.分辨率);
    const mm = parsePair(row.模组尺寸);
    if (!pitchMatch || !pixels) return null;
    const cardLayouts = {};
    for (const cardName of CARD_PRIORITY) {
      const layout = parseCardLayout(row[cardName]);
      if (layout) cardLayouts[cardName] = layout;
    }
    const card = CARD_PRIORITY.find((name) => cardLayouts[name]) || "";
    return {
      key: `load-table-${row.行号 || index + 2}`,
      pitch: Number(pitchMatch[1]),
      label: String(row.模组型号 || `P${pitchMatch[1]}`),
      w: pixels[0], h: pixels[1],
      mmW: mm?.[0] || 0, mmH: mm?.[1] || 0,
      scan: String(row.扫描方式 || "").toUpperCase(),
      iface: String(row.接口 || "").toUpperCase(),
      color: String(row.颜色 || ""),
      card, cardW: cardLayouts[card]?.w || 1, cardH: cardLayouts[card]?.h || 1,
      cardLayouts,
      note: String(row.备注 || ""),
      sourceLine: Number(row.行号 || 0),
      sourceFile: String(row.来源文件 || data.sourcePath || ""),
      sourcePath: String(row.资料路径 || data.sourcePath || "")
    };
  }).filter(Boolean);
  return orderingData.modulePresets(legacyRows);
}

function loadVerifiedModulePresets() {
  if (!ORDERING_ENGINE_COMMONJS) return [];
  try {
    const data = JSON.parse(fs.readFileSync(VERIFIED_LOAD_PATH, "utf8"));
    return (data.profiles || []).filter((profile) => ["official", "verified"].includes(profile.status)).map((profile) => {
      const match = profile.match || {};
      const pixels = match.modulePixels || [];
      const mm = match.moduleMm || [];
      const cardLayouts = profile.receiverLayouts || {};
      const card = CARD_PRIORITY.find((name) => cardLayouts[name]) || Object.keys(cardLayouts)[0] || "";
      const environment = match.environment === "outdoor" ? " 户外" : (match.environment === "indoor" ? " 户内" : "");
      return {
        key: profile.id,
        pitch: Number(match.pitch || 0),
        label: `P${match.pitch}${environment} ${pixels[0]}×${pixels[1]}已验证配置`.trim(),
        w: Number(pixels[0] || 0),
        h: Number(pixels[1] || 0),
        mmW: Number(mm[0] || 0),
        mmH: Number(mm[1] || 0),
        scan: String(match.scan || "").toUpperCase(),
        iface: String(match.interface || "").toUpperCase(),
        color: String(match.color || ""),
        card,
        cardW: Number(cardLayouts[card]?.w || 1),
        cardH: Number(cardLayouts[card]?.h || 1),
        cardLayouts,
        note: String(profile.notes || ""),
        sourceLine: 0,
        sourceFile: String(profile.evidence?.[0]?.name || ""),
        sourcePath: "公司培训资料",
        evidenceStatus: profile.status,
        verifiedMatch: { ...match }
      };
    }).filter((row) => row.pitch && row.w && row.h && row.card);
  } catch {
    return [];
  }
}

const MODULE_PRESETS = Object.freeze([...loadModulePresets(), ...loadVerifiedModulePresets()]);

const DEVICE_CATALOG_PATH = ORDERING_ENGINE_COMMONJS
  ? path.join(__dirname, "data", "ordering-device-catalog.json")
  : "";

function loadDeviceCatalog() {
  if (!ORDERING_ENGINE_COMMONJS) {
    return ORDERING_ENGINE_BROWSER_DATA.deviceCatalog || { schemaVersion: "", sources: [], devices: [] };
  }
  try {
    return orderingData.loadCatalog();
  } catch {
    return { schemaVersion: "", sources: [], devices: [] };
  }
}

const DEVICE_CATALOG = Object.freeze(loadDeviceCatalog());
const DEVICE_CATALOG_DEVICES = Object.freeze(Array.isArray(DEVICE_CATALOG.devices) ? DEVICE_CATALOG.devices : []);

function deviceShortName(device) {
  return String(device?.name || "").replace(/^HD-/i, "").toUpperCase();
}

function featureState(value) {
  if (value === "supported" || value === "optional") return true;
  if (value === "not-supported") return false;
  return undefined;
}

function catalogCapabilities(device) {
  const features = device?.features || {};
  const cellular4g = featureState(features.cellular?.["4g"]);
  const cellular5g = featureState(features.cellular?.["5g"]);
  const capabilities = {
    inputInterfaces: Array.isArray(features.inputInterfaces) ? [...features.inputInterfaces] : undefined,
    windowCount: Number.isFinite(features.windows?.max) ? features.windows.max : undefined,
    usbPlayback: featureState(features.usbPlayback),
    wifi: featureState(features.wifi),
    ethernet: featureState(features.ethernet),
    cloudControl: featureState(features.cloud),
    cellular: cellular4g === true || cellular5g === true
      ? true
      : (cellular4g === false && cellular5g === false ? false : undefined),
    wirelessCasting: featureState(features.wirelessCasting),
    androidApps: featureState(features.androidApps),
    mixedPlayback: featureState(features.mixedPlayback),
    hdmiSyncInput: featureState(features.hdmiSyncInput)
  };
  return Object.fromEntries(Object.entries(capabilities).filter(([, value]) => value !== undefined));
}

function catalogModeProfile(mode = {}) {
  return {
    max: Number(mode.maxPixels || 0),
    ports: Number(mode.outputPorts || 0),
    maxW: Number(mode.maxW || 0),
    maxH: Number(mode.maxH || 0)
  };
}

function catalogConflictNeedsConfirmation(device) {
  return (device?.conflicts || []).some((conflict) => /provisional|version warning|until the exact/i.test(String(conflict.resolution || "")));
}

function catalogController(device, defaultMode = "async", overrides = {}) {
  const modeProfiles = {};
  if (device?.modes?.sync) modeProfiles.sync = catalogModeProfile(device.modes.sync);
  if (device?.modes?.async) modeProfiles.async = catalogModeProfile(device.modes.async);
  const selected = modeProfiles[defaultMode] || modeProfiles.sync || modeProfiles.async || {};
  return {
    name: deviceShortName(device),
    ...selected,
    modeProfiles,
    syncCapable: Boolean(device?.modes?.sync),
    capabilities: catalogCapabilities(device),
    autoEligible: device?.autoEligible === true,
    lifecycle: device?.lifecycle || "current",
    deviceClass: device?.deviceClass || "",
    catalogName: device?.name || "",
    catalogConflicts: device?.conflicts || [],
    catalogNeedsConfirmation: catalogConflictNeedsConfirmation(device),
    capabilityComplete: Boolean(selected.max && selected.ports && selected.maxW && selected.maxH),
    ...overrides
  };
}

const PROCESSORS = Object.freeze(DEVICE_CATALOG_DEVICES
  .filter((device) => device.modes?.sync && ["sync-processor", "sender"].includes(device.deviceClass))
  .map((device) => catalogController(device, "sync"))
  .sort((a, b) => a.max - b.max || a.ports - b.ports));

// 拼接器（VP8000M/E 多 U 机箱）：仅同步系统。单台处理器盖不住的超大屏，按总点/宽高取最小满足机箱档；
// 复用与处理器完全相同的网口分组、拓扑与 BOM，仅设备池不同。按总点升序，automaticController 取最小满足。
const SPLICERS = Object.freeze(DEVICE_CATALOG_DEVICES
  .filter((device) => device.deviceClass === "splicer" && device.modes?.sync)
  .map((device) => catalogController(device, "sync"))
  .sort((a, b) => a.max - b.max || a.ports - b.ports));

// Async players reuse the same receiver-card plan and port topology as the sync option.
// C16H/C16L are also present as explicit-only receiver-cascade candidates; they are
// never inserted automatically when their board-level HUB path is the safer fit.
const ASYNC_CONTROLLER_ORDER = Object.freeze([
  "A3L", "A4L", "A5L", "A6L", "H6", "A7", "H8", "A8", "H16", "H20", "C16H", "C16L"
]);
const ASYNC_CONTROLLERS = Object.freeze(DEVICE_CATALOG_DEVICES
  .filter((device) => device.modes?.async && (
    ["dual-mode-player", "async-player"].includes(device.deviceClass)
    || ["HD-C16H", "HD-C16L", "HD-A30"].includes(device.name)
  ))
  .filter((device) => Number(device.modes.async.outputPorts || 0) > 0)
  .map((device) => catalogController(device, "async", ["HD-C16H", "HD-C16L", "HD-A30"].includes(device.name) ? { autoEligible: false } : {}))
  .sort((a, b) => {
    const left = ASYNC_CONTROLLER_ORDER.indexOf(a.name);
    const right = ASYNC_CONTROLLER_ORDER.indexOf(b.name);
    return (left < 0 ? Number.MAX_SAFE_INTEGER : left) - (right < 0 ? Number.MAX_SAFE_INTEGER : right)
      || a.max - b.max
      || a.ports - b.ports;
  }));

function catalogDirectController(device) {
  const mode = device.modes?.async || {};
  const directMax = Number(device.outputs?.directMaxPixels || mode.maxPixels || 0);
  const capabilities = catalogCapabilities(device);
  // 通信方式按设备能力精确给：单双色 W=WiFi、U=USB、E=以太网；未声明 supportedColors 的全彩 C/D 卡默认带以太网（维持原行为）
  const colorDeclared = Array.isArray(device.supportedColors) && device.supportedColors.length > 0;
  const hasEthernet = capabilities.ethernet === true || !colorDeclared;
  const communications = [
    capabilities.wifi === true ? "wifi" : "",
    hasEthernet ? "ethernet" : "",
    capabilities.usbPlayback === true ? "usb" : ""
  ].filter(Boolean);
  return {
    name: deviceShortName(device),
    series: device.family,
    communications,
    // 单双色直连卡（W/U/E/G/S 与条屏 WF）通过 supportedColors 声明可带颜色；
    // 未声明的全彩 C/D 卡默认仅 full，保持原行为。
    colors: Array.isArray(device.supportedColors) && device.supportedColors.length
      ? [...device.supportedColors]
      : ["full"],
    capacity: directMax,
    maxW: Number(mode.maxW || 0),
    maxH: Number(mode.maxH || 0),
    outputs: (() => {
      const hubPorts = device.outputs?.hubPorts;
      if (hubPorts && typeof hubPorts === "object") {
        const out = { ...hubPorts };
        // HUB50 即 HUB75E 的50针排针口，可驱动HUB75信号全彩模组；仅有HUB50时补一份HUB75可用口
        if (!out.HUB75 && out.HUB50) out.HUB75 = out.HUB50;
        return out;
      }
      return { HUB75: Number(device.outputs?.hub75ePorts || 0) };
    })(),
    capabilities,
    autoEligible: device.autoEligible === true,
    lifecycle: device.lifecycle,
    catalogName: device.name,
    catalogConflicts: device.conflicts || [],
    catalogNeedsConfirmation: catalogConflictNeedsConfirmation(device)
  };
}

// 直连卡入池：全彩 C/D 看 hub75ePorts；单双色 W/U/E/G/S 只有 HUB08/HUB12/HUB50 排针口（hubPorts）。
// 二者满足其一即可，避免单双色直连卡因无 hub75ePorts 被挡在候选池外。
const deviceHasHubPort = (device) => {
  if (Number(device.outputs?.hub75ePorts || 0) > 0) return true;
  const hubPorts = device.outputs?.hubPorts;
  return Boolean(hubPorts && typeof hubPorts === "object"
    && Object.values(hubPorts).some((count) => Number(count) > 0));
};
const CATALOG_DIRECT_CONTROLLERS = DEVICE_CATALOG_DEVICES
  .filter((device) => device.deviceClass === "async-direct" && deviceHasHubPort(device))
  .map(catalogDirectController);
const CATALOG_DIRECT_NAMES = new Set(CATALOG_DIRECT_CONTROLLERS.map((controller) => controller.name));
const DIRECT_CONTROLLERS = Object.freeze([
  ...BASE_DIRECT_CONTROLLERS.filter((controller) => !CATALOG_DIRECT_NAMES.has(controller.name)),
  ...CATALOG_DIRECT_CONTROLLERS
]);
// 全部直连卡型号集合：客户点名任意系列（C/D/W/U/E/WF/G/S）都精确锁定，不靠系列首字母硬编码
const DIRECT_CONTROLLER_NAMES = new Set(DIRECT_CONTROLLERS.map((controller) => controller.name));

const ASYNC_DEVICE_ARCHITECTURES = Object.freeze({
  C16H: { kind: "hybrid", architectures: ["direct", "receiver"] },
  C16L: { kind: "hybrid", architectures: ["direct", "receiver"] },
  C08L: { kind: "direct", architectures: ["direct"] },
  D16: { kind: "direct", architectures: ["direct"] },
  D18: { kind: "direct", architectures: ["direct"] },
  B8H: { kind: "poster-special", architectures: ["special"] },
  B8L: { kind: "poster-special", architectures: ["special"] },
  B6L: { kind: "poster-special", architectures: ["special"] },
  // ②补齐官方异步直连卡：带1网口的C系列为直连+接收卡级联双模(hybrid)，纯HUB口的D/V系列为直连(direct)
  C10: { kind: "hybrid", architectures: ["direct", "receiver"] },
  C10C: { kind: "hybrid", architectures: ["direct", "receiver"] },
  C15: { kind: "hybrid", architectures: ["direct", "receiver"] },
  C15C: { kind: "hybrid", architectures: ["direct", "receiver"] },
  C16: { kind: "hybrid", architectures: ["direct", "receiver"] },
  C16C: { kind: "hybrid", architectures: ["direct", "receiver"] },
  C30: { kind: "hybrid", architectures: ["direct", "receiver"] },
  C35: { kind: "hybrid", architectures: ["direct", "receiver"] },
  C36: { kind: "hybrid", architectures: ["direct", "receiver"] },
  C36C: { kind: "hybrid", architectures: ["direct", "receiver"] },
  D10: { kind: "direct", architectures: ["direct"] },
  D15: { kind: "direct", architectures: ["direct"] },
  D30: { kind: "direct", architectures: ["direct"] },
  D35: { kind: "direct", architectures: ["direct"] },
  D36: { kind: "direct", architectures: ["direct"] },
  V10: { kind: "direct", architectures: ["direct"] },
  // A30：4网口接接收卡 + 2路HUB50板载直连的混合设备
  A30: { kind: "hybrid", architectures: ["direct", "receiver"] }
});

const PROCESSOR_ALIASES = Object.freeze({ VP210: "VP210S" });
const DEVICE_MODEL_TOKENS = Object.freeze([
  ...new Set([
    ...DEVICE_CATALOG_DEVICES.map(deviceShortName),
    "VP210"
  ].filter(Boolean))
].sort((left, right) => right.length - left.length));
const ASYNC_MODEL_NAMES = new Set(DEVICE_CATALOG_DEVICES
  .filter((device) => device.modes?.async)
  .map(deviceShortName));

function regexpEscape(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findPreferredProcessor(text) {
  for (const token of DEVICE_MODEL_TOKENS) {
    const pattern = new RegExp(`(?:^|[^A-Z0-9])(?:HD[-\\s]?)?(${regexpEscape(token)})(?![A-Z0-9])`, "i");
    const match = String(text || "").match(pattern);
    if (match) {
      const normalized = String(match[1] || "").toUpperCase();
      return PROCESSOR_ALIASES[normalized] || normalized;
    }
  }
  return "";
}

// Market shorthand is not always the exact pitch used by the standard module.
// Keep this list narrow and source-backed so nearby products are not merged.
const PITCH_ALIASES = Object.freeze({
  "1.5": 1.538,
  "1.53": 1.538
});

function normalizePitch(value) {
  const raw = String(value || "").trim();
  return Object.prototype.hasOwnProperty.call(PITCH_ALIASES, raw)
    ? PITCH_ALIASES[raw]
    : Number(raw || 0);
}

function inferWholeModuleCount(total, moduleSize) {
  if (!total || !moduleSize) return { count: 0, floor: 0, ceil: 0, exact: false, raw: 0 };
  const raw = Number(total) / Number(moduleSize);
  if (!Number.isFinite(raw) || raw <= 0) return { count: 0, floor: 0, ceil: 0, exact: false, raw: 0 };
  // Ordering must not silently make a finished screen smaller than the
  // customer's requested physical/pixel envelope.  Keep the inward option for
  // comparison, but make the manufactured draft use the outward whole module.
  const count = Math.max(1, Math.ceil(raw - 1e-9));
  const nearestInteger = Math.round(raw);
  return {
    count,
    floor: Math.max(1, Math.floor(raw)),
    ceil: Math.max(1, Math.ceil(raw)),
    exact: Math.abs(raw - nearestInteger) <= 1e-9,
    raw
  };
}

function modulesForPhysicalLength(screenMm, moduleMm) {
  return inferWholeModuleCount(screenMm, moduleMm).count;
}

function numberPair(text, patterns) {
  for (const pattern of patterns) {
    const match = String(text || "").match(pattern);
    if (match) return [Number(match[1]), Number(match[2])];
  }
  return null;
}

function samePair(left, right) {
  return Boolean(left && right && left[0] === right[0] && left[1] === right[1]);
}

function pitchFromPhysicalAndPixels(mm, pixels) {
  if (!mm || !pixels || !pixels[0] || !pixels[1]) return 0;
  const horizontal = mm[0] / pixels[0];
  const vertical = mm[1] / pixels[1];
  if (Math.abs(horizontal - vertical) > Math.max(horizontal, vertical) * 0.02) return 0;
  return (horizontal + vertical) / 2;
}

function nearPair(left, right, tolerance = 0.6) {
  return Boolean(left && right
    && Math.abs(Number(left[0]) - Number(right[0])) <= tolerance
    && Math.abs(Number(left[1]) - Number(right[1])) <= tolerance);
}

function inferModuleAxisKind(pair, pitch, iface = "", scan = "") {
  if (!pair || !pitch) return "";
  let rows = MODULE_PRESETS.filter((row) => samePitchFamily(row.pitch, pitch));
  if (iface) rows = rows.filter((row) => row.iface === iface);
  const asPixels = rows.some((row) => row.w === Math.round(pair[0]) && row.h === Math.round(pair[1]));
  const derivedPixels = [Math.round(pair[0] / pitch), Math.round(pair[1] / pitch)];
  const asPhysical = rows.some((row) => nearPair([row.mmW || row.w * pitch, row.mmH || row.h * pitch], pair)
    || (row.w === derivedPixels[0] && row.h === derivedPixels[1]));
  if (asPixels !== asPhysical) return asPixels ? "pixels" : "physical";
  if (asPhysical && asPixels) {
    const physicalDistance = Math.abs(pair[0] - DEFAULT_MODULE_MM.w) + Math.abs(pair[1] - DEFAULT_MODULE_MM.h);
    const pixelPhysicalDistance = Math.abs(pair[0] * pitch - DEFAULT_MODULE_MM.w) + Math.abs(pair[1] * pitch - DEFAULT_MODULE_MM.h);
    return physicalDistance <= pixelPhysicalDistance ? "physical" : "pixels";
  }
  return pair[0] >= 280 && pair[1] >= 120 ? "physical" : "pixels";
}

function parseGridCount(text, excludedPairs = []) {
  const candidates = [];
  // 扫描前剔除“非排列数字”，避免被排列正则吞入：点间距 P5/P1.25/Q…、模组/箱体物理尺寸 320*160mm
  const blank = (m) => " ".repeat(m.length);
  const scan = String(text || "")
    .replace(/[PQ]\s*\d+(?:\.\d+)?/gi, blank)
    .replace(/\d+\.\d+/g, blank)
    .replace(/\d{1,4}\s*[xX×*]\s*\d{1,4}\s*(?:mm|毫米)/gi, blank);
  // 整屏排列：宽向词 / 高向词（长词在前，避免“横向”被“横”提前截断；“排”单字按行=高向）；量词 个/张/块/排
  const W = "(?:横向排|横着|横向|横排|横|宽着|宽方向|宽度|宽|长方向|长度|长|列)";
  const H = "(?:纵向排|竖着|竖向|纵向|纵排|纵|高着|高方向|高度|高|排|行)";
  const UNIT = "(?:个|张|块|排)";
  const TW = `(?:${UNIT}|${W})?`; // 宽向数字后的量词或同义方向词（宽10张 / 宽10列）
  const TH = `(?:${UNIT}|${H})?`;
  const SEP = "[,;xX×*]?";
  const N = "(\\d{1,3})";
  const patterns = [
    // 数字在前：10列6行 / 6行10列 / 10列6排（兼容原行为，量词与横向/纵向为新增）
    { re: new RegExp(`${N}\\s*${UNIT}?\\s*${H}\\s*${SEP}\\s*${N}\\s*${UNIT}?\\s*${W}`, "gi"), order: [2, 1] },
    { re: new RegExp(`${N}\\s*${UNIT}?\\s*${W}\\s*${SEP}\\s*${N}\\s*${UNIT}?\\s*${H}`, "gi"), order: [1, 2] },
    // 纯量词：10张×6张 / 10块*6块（默认前宽后高；排除点/像素/mm，避免误抓分辨率与尺寸）
    { re: new RegExp(`${N}\\s*${UNIT}\\s*[,;xX×*]\\s*${N}\\s*${UNIT}(?!\\s*(?:点|像素|mm|毫米))`, "gi"), order: [1, 2] },
    // 方向词在前：宽10张高6张 / 横向10纵向6 / 横10纵6 / 宽方向10张高方向6张
    { re: new RegExp(`${W}\\s*${N}\\s*${TW}\\s*${SEP}\\s*${H}\\s*${N}\\s*${TH}`, "gi"), order: [1, 2] },
    { re: new RegExp(`${H}\\s*${N}\\s*${TH}\\s*${SEP}\\s*${W}\\s*${N}\\s*${TW}`, "gi"), order: [2, 1] },
    // 每排/一排 N 张，共 M 排：一排10张一共6排（宽=N、高=M）
    { re: new RegExp(`(?:每排|一排)[^0-9]{0,6}${N}\\s*${UNIT}?[^0-9]{0,8}?(?:共|一共|总计)?\\s*(\\d{1,3})\\s*排`, "gi"), order: [1, 2] }
  ];
  for (const { re, order } of patterns) {
    for (const match of scan.matchAll(re)) {
      candidates.push([Number(match[order[0]]), Number(match[order[1]])]);
    }
  }
  return candidates.find((pair) => !excludedPairs.some((excluded) => nearPair(pair, excluded, 0.01))) || null;
}

function parseRequest(message) {
  const text = String(message || "")
    .replace(/\uff0c/g, ",")
    .replace(/\uff1b/g, ";")
    .replace(/(\d)\s*乘\s*(\d)/g, "$1×$2");
  const dimensionInferences = [];
  const pitchMatch = text.match(/(?:^|[^A-Z0-9])(?:P|Q)\s*(\d+(?:\.\d+)?)/i)
    || text.match(/(?:^|[^\d])(\d+\.\d{1,3})(?=\s|,|;|，|；|配|模|箱|\d+\s*(?:宽|列))/i);
  const statedPitch = pitchMatch ? Number(pitchMatch[1]) : 0;
  const pitch = pitchMatch ? normalizePitch(pitchMatch[1]) : 0;
  const mentionedPitches = [...new Set([...text.matchAll(/(?:^|[^A-Z0-9])(?:P|Q)\s*(\d+(?:\.\d+)?)/gi)]
    .map((match) => normalizePitch(match[1]))
    .filter(Boolean))];
  if (statedPitch && pitch !== statedPitch) {
    dimensionInferences.push(`客户写P${statedPitch}，按标准P${pitch}系列计算`);
  }
  const ifaceMatch = text.match(/HUB\s*(320|75(?:B|E)?|50|12|08|8)|(?:^|[^\d])(320|75(?:B|E)?|50|12|08|8)\s*(?:接口|口)/i);
  const ifaceValue = ifaceMatch ? (ifaceMatch[1] || ifaceMatch[2]) : "";
  let iface = ifaceValue
    ? `HUB${/^75/i.test(ifaceValue) ? "75" : (ifaceValue === "8" ? "08" : ifaceValue.toUpperCase())}`
    : "";
  if (!iface) {
    const ifaceAliasMatch = (text.match(/(?:^|[^A-Z0-9])(?:HUB\s*)?(320|75(?:B|E)?|50|12|08|8)\s*(?:接口|口|\u63a5\u53e3|\u53e3)(?![A-Z0-9])/i) || [])[1];
    if (ifaceAliasMatch) {
      iface = `HUB${/^75/i.test(ifaceAliasMatch) ? "75" : (ifaceAliasMatch === "8" ? "08" : ifaceAliasMatch.toUpperCase())}`;
    }
  }
  const bareModulePairMatch = text.match(/(?:模组|单元板)\s*(\d{1,4})\s*[xX×*]\s*(\d{1,4})(?!\d|\s*(?:mm|毫米|px|像素|点))/i);
  const bareModulePair = bareModulePairMatch
    ? [Number(bareModulePairMatch[1]), Number(bareModulePairMatch[2])]
    : null;
  const bareModulePairMatchesKnownPixels = Boolean(bareModulePair && MODULE_PRESETS.some((row) => (
    row.w === bareModulePair[0] && row.h === bareModulePair[1]
  )));
  // In ordering conversations, a bare pair immediately after "模组" normally
  // describes the module grid (for example, 模组20x10). Treat it as pixels only
  // when it is a known loading-table resolution; explicit 分辨率/像素/点数
  // wording always remains authoritative below.
  const bareModuleCount = bareModulePair
    && !bareModulePairMatchesKnownPixels
    && bareModulePair[0] <= 200
    && bareModulePair[1] <= 200
    ? bareModulePair
    : null;
  let statedModulePixels = numberPair(text, [
    /(?:模组|单元板)(?:的)?\s*(?:分辨率|像素|点数)\s*(?:为|是|[:：])?\s*(\d{2,4})\s*[xX×*]\s*(\d{2,4})(?!\d|\s*(?:mm|毫米|张|块|个))/i,
    /(?:模组|单元板)(?:(?!整屏|屏体|大屏|显示屏|屏幕)[^\n]){0,48}?(?:分辨率|像素|点数)[^\n\d]{0,8}(\d{2,4})\s*[xX×*]\s*(\d{2,4})/i,
    /(?:模组|单元板)[^\n\d]{0,16}(?:分辨率|像素|点数)[^\n\d]{0,8}(\d{2,4})\s*[xX×*]\s*(\d{2,4})/i,
    /(?:分辨率|像素|点数)[^\n\d]{0,8}(\d{2,4})\s*[xX×*]\s*(\d{2,4})[^\n]{0,12}(?:模组|单元板)/i,
    /(?:单色|双色|全彩)?[^\n\d]{0,8}(\d{2,4})\s*[xX×*]\s*(\d{2,4})\s*[,;]?\s*(?:\d{1,3}\s*(?:S|扫)\s*[,;]?\s*)?(?=HUB)/i
  ]);
  if (!statedModulePixels && bareModulePair && !bareModuleCount) statedModulePixels = bareModulePair;
  let moduleMm = numberPair(text, [
    /(?:模组|单元板)(?:尺寸)?[^\d]{0,10}(\d{2,4})\s*[xX×*]\s*(\d{2,4})\s*(?:mm|毫米)/i,
    /(\d{2,4})\s*[xX×*]\s*(\d{2,4})\s*(?:mm|毫米)[^\n]{0,12}(?:模组|单元板)/i
  ]);
  const postposedModulePairMatch = text.match(/(\d{2,4})\s*[xX×*]\s*(\d{2,4})\s*(?:的)?\s*(?:模组|单元板)(?!\s*(?:数量|排列|分辨率|像素|点数))/i);
  const postposedModulePairCandidate = postposedModulePairMatch
    ? [Number(postposedModulePairMatch[1]), Number(postposedModulePairMatch[2])]
    : null;
  const postposedModuleKind = postposedModulePairCandidate
    ? inferModuleAxisKind(postposedModulePairCandidate, pitch, iface)
    : "";
  const postposedModuleMatchesKnownPixels = Boolean(postposedModulePairCandidate && MODULE_PRESETS.some((row) => (
    row.w === postposedModulePairCandidate[0] && row.h === postposedModulePairCandidate[1]
  )));
  const postposedModulePair = postposedModulePairCandidate
    && (postposedModuleKind === "physical" || postposedModuleMatchesKnownPixels || /(?:尺寸|大小)/i.test(postposedModulePairMatch[0]))
    ? postposedModulePairCandidate
    : null;
  if (!moduleMm && !statedModulePixels && postposedModulePair) {
    const kind = postposedModuleKind;
    if (kind === "physical") moduleMm = postposedModulePair;
    else statedModulePixels = postposedModulePair;
    dimensionInferences.push(`“${postposedModulePair[0]}×${postposedModulePair[1]}模组”按${kind === "physical" ? "物理尺寸" : "像素分辨率"}识别`);
  }
  const moduleAxisMatch = text.match(/(?:模组|单元板)[^\n\d]{0,12}宽(?:度)?\s*(\d+(?:\.\d+)?)\s*(mm|毫米|px|像素|点)?[^\n\d]{0,12}高(?:度)?\s*(\d+(?:\.\d+)?)\s*(mm|毫米|px|像素|点)?/i);
  const moduleAxisPair = moduleAxisMatch ? [Number(moduleAxisMatch[1]), Number(moduleAxisMatch[3])] : null;
  if (!moduleMm && !statedModulePixels && moduleAxisPair) {
    const unitText = `${moduleAxisMatch[2] || ""}${moduleAxisMatch[4] || ""}`;
    const kind = /mm|毫米/i.test(unitText)
      ? "physical"
      : (/(?:px|像素|点)/i.test(unitText) ? "pixels" : inferModuleAxisKind(moduleAxisPair, pitch, iface));
    if (kind === "physical") moduleMm = moduleAxisPair;
    else statedModulePixels = moduleAxisPair.map((value) => Math.round(value));
    dimensionInferences.push(`“模组宽高”按${kind === "physical" ? "物理尺寸" : "像素分辨率"}识别`);
  }
  const unlabeledMm = numberPair(text, [/(\d{2,4})\s*[xX×*]\s*(\d{2,4}(?:\.\d+)?)\s*(?:mm|毫米)/i]);
  const unlabeledPointPairs = [...text.matchAll(/(\d{2,5})\s*[xX×*]\s*(\d{2,5})\s*(?:px|像素|点)(?!间距)/gi)]
    .map((match) => [Number(match[1]), Number(match[2])]);
  if (!statedModulePixels && iface && unlabeledPointPairs.length === 1 && !/(?:整屏|屏体|大屏|显示屏|屏幕)[^\n]{0,16}(?:分辨率|像素|点数)?/i.test(text)) {
    statedModulePixels = unlabeledPointPairs[0];
  }
  if (!moduleMm && unlabeledMm && statedModulePixels && !/(?:单箱|箱体|箱子)/i.test(text)) {
    const inferredPitch = pitchFromPhysicalAndPixels(unlabeledMm, statedModulePixels);
    if (!pitch || (inferredPitch && Math.abs(inferredPitch - pitch) <= Math.max(0.02, pitch * 0.01))) moduleMm = unlabeledMm;
  }
  let oversizedModulePixelsAsScreen = null;
  if (statedModulePixels && (
    statedModulePixels[0] > 1024
    || statedModulePixels[1] > 1024
    || statedModulePixels[0] * statedModulePixels[1] > 400000
  )) {
    oversizedModulePixelsAsScreen = statedModulePixels;
    statedModulePixels = null;
  }
  const pixelsFromMm = moduleMm && pitch ? [Math.round(moduleMm[0] / pitch), Math.round(moduleMm[1] / pitch)] : null;
  let modulePixels = statedModulePixels || pixelsFromMm || null;
  let moduleMmDerived = false;
  if (!statedModulePixels && pixelsFromMm) dimensionInferences.push(`按P${pitch}由模组物理尺寸换算为${pixelsFromMm[0]}×${pixelsFromMm[1]}点`);
  const explicitCabinetCount = numberPair(text, [
    /(?:箱体|箱子)(?:数量|排列)?[^\n\d]{0,8}(\d+)\s*(?:宽|列)\s*[xX×*]?\s*(\d+)\s*(?:高|行)/i,
    /(?:箱体|箱子)(?:数量|排列)[^\d]{0,8}(\d+)\s*[xX×*]\s*(\d+)/i
  ]);
  let cabinetMm = numberPair(text, [
    /(?:单箱|箱体|箱子)(?:尺寸|大小)?[^\n\d]{0,12}(\d+(?:\.\d+)?)\s*[xX×*]\s*(\d+(?:\.\d+)?)\s*(?:mm|毫米)/i,
    /(\d+(?:\.\d+)?)\s*[xX×*]\s*(\d+(?:\.\d+)?)\s*(?:mm|毫米)[^\n]{0,12}(?:单箱|箱体|箱子)/i
  ]);
  let cabinetPixels = numberPair(text, [
    /(?:单箱|箱体|箱子)(?:的)?\s*(?:分辨率|像素|点数)[^\d]{0,10}(\d{2,5})\s*[xX×*]\s*(\d{2,5})/i,
    /(?:单箱|箱体|箱子)(?:分辨率|像素|点数)?[^\d]{0,10}(\d{2,5})\s*[xX×*]\s*(\d{2,5})\s*(?:px|像素|点)/i,
    /(\d{2,5})\s*[xX×*]\s*(\d{2,5})\s*(?:px|像素|点)[^\n]{0,12}(?:单箱|箱体|箱子)/i,
    /(?:单箱|箱体|箱子)[^，,;\n]{0,48}?(\d{2,5})\s*[xX×*]\s*(\d{2,5})\s*(?:px|像素|点)/i
  ]);
  const cabinetAxisMatch = text.match(/(?:单箱|箱体|箱子)[^\n\d]{0,12}宽(?:度)?\s*(\d+(?:\.\d+)?)\s*(mm|毫米|px|像素|点)?[^\n\d]{0,12}高(?:度)?\s*(\d+(?:\.\d+)?)\s*(mm|毫米|px|像素|点)?/i);
  const cabinetAxisPair = cabinetAxisMatch ? [Number(cabinetAxisMatch[1]), Number(cabinetAxisMatch[3])] : null;
  if (!cabinetMm && !cabinetPixels && cabinetAxisPair) {
    const unitText = `${cabinetAxisMatch[2] || ""}${cabinetAxisMatch[4] || ""}`;
    if (/(?:px|像素|点)/i.test(unitText)) cabinetPixels = cabinetAxisPair.map((value) => Math.round(value));
    else cabinetMm = cabinetAxisPair;
    dimensionInferences.push(`“箱体宽高”按${cabinetPixels ? "箱体分辨率" : "箱体物理尺寸"}识别`);
  }
  let explicitModuleCount = numberPair(text, [
    /(?:模组|单元板)(?:数量|排列)[^\d]{0,8}(\d+)\s*[xX×*]\s*(\d+)\s*(?:张|块)?/i,
    /(?:模组|单元板|排列|排布)[^\n\d]{0,6}(\d{1,3})\s*[xX×*]\s*(\d{1,3})\s*(?:张|块|个模组|个单元板)/i,
    /(\d{1,3})\s*[xX×*]\s*(\d{1,3})\s*(?:张|块|个)\s*(?:的)?\s*(?:模组|单元板)?/i,
    /(\d{1,3})\s*[xX×*]\s*(\d{1,3})\s*(?:的)?\s*(?:模组|单元板)(?!\s*(?:分辨率|像素|点数|尺寸))/i
  ]) || bareModuleCount;
  if (postposedModulePair && samePair(explicitModuleCount, postposedModulePair)) explicitModuleCount = null;
  const parsedModuleCount = explicitModuleCount || parseGridCount(text, [moduleAxisPair, cabinetAxisPair]);
  let cabinetCount = explicitCabinetCount || (parsedModuleCount && /(?:一箱一卡|箱体数量|箱体排列|箱子数量|箱子排列)/i.test(text) ? parsedModuleCount : null);
  const moduleCount = cabinetCount ? null : parsedModuleCount;
  const parsedScreenPixels = oversizedModulePixelsAsScreen || numberPair(text, [
    /(?:整屏|\u5c4f\u4f53|\u5927\u5c4f|\u663e\u793a\u5c4f|\u5c4f\u5e55)(?:\u5206\u8fa8\u7387|\u50cf\u7d20|\u70b9\u6570)?[^\d]{0,12}(\d{2,6})\s*[xX\u00d7*]\s*(\d{2,6})\s*(?:px|\u50cf\u7d20|\u70b9)?(?!\s*(?:mm|毫米))/i,
    /(?:配单|配卡|方案)[^\n\d]{0,16}(?:P\s*\d+(?:\.\d+)?)?[^\n\d]{0,16}(\d{3,6})\s*[xX×*]\s*(\d{3,6})(?![\d.]|\s*(?:mm|毫米|张|块|个))/i,
    /(?:屏宽|屏体宽|屏幕宽|屏高|屏体高|屏幕高)[^\d]{0,8}(\d{2,6})\s*[xX×*]\s*(\d{2,6})(?!\s*(?:mm|毫米|张|块|个))/i,
    /(?:屏幕大小|屏幕尺寸|屏体大小|整屏分辨率|分辨率)[^\d]{0,12}(\d{2,6})\s*[xX×*]\s*(\d{2,6})/i,
    // 裸乘号 + 点间距 P几（P 在前或在后都认），如“P3 1920×1080”“1920×1080 P3”；≥3位且不接 mm/张/块/模组，避开排列与物理尺寸
    /P\s*\d+(?:\.\d+)?[^\n\d]{0,16}(\d{3,6})\s*[xX×*]\s*(\d{3,6})(?![\d.]|\s*(?:mm|毫米|张|块|个|排|列|行|组|片|模组|单元板|箱体))/i,
    /(\d{3,6})\s*[xX×*]\s*(\d{3,6})(?![\d.]|\s*(?:mm|毫米|张|块|个|排|列|行|组|片|模组|单元板|箱体))[^\n\d]{0,12}P\s*\d+(?:\.\d+)?/i,
    /(\d{2,6})\s*[xX×*]\s*(\d{2,6})\s*(?:px|像素|点)(?!间距)/i
  ]);
  const parsedScreenIsCabinet = cabinetPixels && parsedScreenPixels
    && cabinetPixels[0] === parsedScreenPixels[0] && cabinetPixels[1] === parsedScreenPixels[1];
  const parsedScreenIsModule = samePair(modulePixels, parsedScreenPixels);
  let screenPixels = parsedScreenIsCabinet || parsedScreenIsModule ? null : parsedScreenPixels;
  let screenPixelsDerived = false;
  // 汉字“宽/高”轴引导的整屏像素（没有乘号也认）：整屏等前缀可有可无；宽在前、高在前都按关键字归位。
  // 数字≥3位、末尾不得接 张/块/排/列/行/模组 或 mm（那些属于模组排列/物理尺寸），与 parseGridCount 的≤3位排列互不抢。
  const AX_TAIL = "(?!\\s*(?:mm|毫米|张|块|排|个|列|行|组|片|模组))";
  const screenAxisWH = numberPair(text, [
    new RegExp(`(?:整屏|屏体|大屏|显示屏|屏幕)?[^\\n\\d]{0,12}(?:分辨率|像素|点数)?[^\\n\\d]{0,8}宽(?:度)?[^\\d]{0,4}(\\d{3,6})(?:\\s*(?:px|像素|点))?[^\\n\\d]{0,8}高(?:度)?[^\\d]{0,4}(\\d{3,6})(?:\\s*(?:px|像素|点))?${AX_TAIL}`, "i"),
  ]);
  const axisHWM = text.match(new RegExp(`高(?:度)?[^\\d]{0,4}(\\d{3,6})(?:\\s*(?:px|像素|点))?[^\\n\\d]{0,12}宽(?:度)?[^\\d]{0,4}(\\d{3,6})(?:\\s*(?:px|像素|点))?${AX_TAIL}`, "i"));
  const screenAxisHW = axisHWM ? [Number(axisHWM[2]), Number(axisHWM[1])] : null; // 客户先说高→归位为[宽,高]
  const screenAxisPixels = screenAxisWH || screenAxisHW;
  if (!screenPixels && screenAxisPixels) screenPixels = screenAxisPixels;
  let meters = numberPair(text, [
    /(\d+(?:\.\d+)?)\s*(?:m(?!m)|\u7c73)\s*(?:\u957f(?:\u5ea6)?|\u5bbd(?:\u5ea6)?)[^\d]{0,8}(\d+(?:\.\d+)?)\s*(?:m(?!m)|\u7c73)?\s*(?:\u9ad8(?:\u5ea6)?)/i,
    /(?:整屏|屏体|大屏|显示屏|屏幕)(?:尺寸)?[^\d]{0,10}(\d+(?:\.\d+)?)\s*[xX×*]\s*(\d+(?:\.\d+)?)\s*(?:m(?!m)|米)/i,
    /(?:\u5c4f\u4f53|\u5927\u5c4f|\u663e\u793a\u5c4f|\u5c4f\u5e55)?(?:\u5c3a\u5bf8)?[^\d]{0,10}(\d+(?:\.\d+)?)\s*(?:m(?!m)|\u7c73)\s*[xX\u00d7*]\s*(\d+(?:\.\d+)?)\s*(?:m(?!m)|\u7c73)/i,
    /(?:屏体|大屏|显示屏|屏幕|屏)?[^\n\d]{0,4}(?:宽(?:度)?|长(?:度)?)[^\d]{0,4}(\d+(?:\.\d+)?)\s*(?:m(?!m)|米)[^\n\d]{0,4}高(?:度)?[^\d]{0,4}(\d+(?:\.\d+)?)\s*(?:m(?!m)|米)?/i,
    /(\d+(?:\.\d+)?)\s*(?:m(?!m)|\u7c73)\s*(?:\u5bbd(?:\u5ea6)?)[^\d]{0,8}(\d+(?:\.\d+)?)\s*(?:m(?!m)|\u7c73)?\s*(?:\u9ad8(?:\u5ea6)?)/i
  ]);
  const screenMm = numberPair(text, [
    /(?:整屏|屏体|大屏|显示屏|屏幕)(?:尺寸)?[^\n\d]{0,10}(\d+(?:\.\d+)?)\s*[xX×*]\s*(\d+(?:\.\d+)?)\s*(?:mm|毫米)/i,
    /(?:整屏|屏体|大屏|显示屏|屏幕)[^\n\d]{0,8}宽(?:度)?[^\d]{0,4}(\d+(?:\.\d+)?)\s*(?:mm|毫米)[^\n\d]{0,8}高(?:度)?[^\d]{0,4}(\d+(?:\.\d+)?)\s*(?:mm|毫米)/i
  ]);
  let screenDimensionAssumption = "";
  const unlabeledOrderingScreenPair = numberPair(text, [
    /(?:^|[,.;，；:：\s])(\d{3,6})\s*[xX×*]\s*(\d{3,6})(?=[,.;，；:：\s]*(?:配单|配卡|选型|出方案|方案|$))/i
  ]);
  if (!screenPixels && !meters && !screenMm && !moduleMm && !cabinetMm && unlabeledOrderingScreenPair) {
    const [pairW, pairH] = unlabeledOrderingScreenPair;
    const exactPhysicalRows = MODULE_PRESETS.filter((row) => {
      if (!samePitchFamily(row.pitch, pitch) || !row.mmW || !row.mmH) return false;
      const cols = pairW / row.mmW;
      const rows = pairH / row.mmH;
      return Number.isInteger(cols) && Number.isInteger(rows) && cols > 0 && rows > 0 && cols <= 200 && rows <= 200;
    });
    const physicalSizes = [...new Set(exactPhysicalRows.map((row) => `${row.mmW}x${row.mmH}`))];
    if (physicalSizes.length === 1) {
      meters = [pairW / 1000, pairH / 1000];
      screenDimensionAssumption = `客户未标单位；${pairW}×${pairH}能按配单表命中的${physicalSizes[0].replace("x", "×")}mm模组完整排布，暂按整屏毫米尺寸计算`;
    } else {
      screenPixels = [pairW, pairH];
      screenDimensionAssumption = `客户未标单位；未找到唯一可整除的模组物理规格，暂按整屏分辨率${pairW}×${pairH}点计算`;
    }
    dimensionInferences.push(screenDimensionAssumption);
  }
  if (!meters && screenMm) meters = [screenMm[0] / 1000, screenMm[1] / 1000];

  if (!screenPixels && meters && pitch) {
    screenPixels = [Math.round(meters[0] * 1000 / pitch), Math.round(meters[1] * 1000 / pitch)];
    screenPixelsDerived = true;
    dimensionInferences.push(`按P${pitch}由整屏物理尺寸换算为约${screenPixels[0]}×${screenPixels[1]}点`);
  }
  // 标准显示器分辨率（1920×1080、3840×2160 等）通常是客户说的目标输出分辨率，
  // 不要拿上一轮残留的模组排列去硬除出一个"模组像素"，否则会报"收到的是160×180"这种莫名其妙的错
  const isStandardDisplayRes = screenPixels
    && ((screenPixels[0] === 1920 && screenPixels[1] === 1080)
      || (screenPixels[0] === 3840 && screenPixels[1] === 2160)
      || (screenPixels[0] === 2560 && screenPixels[1] === 1440)
      || (screenPixels[0] === 1280 && screenPixels[1] === 1024)
      || (screenPixels[0] === 1024 && screenPixels[1] === 768));
  if (!modulePixels && moduleCount && screenPixels && !isStandardDisplayRes
    && screenPixels[0] % moduleCount[0] === 0 && screenPixels[1] % moduleCount[1] === 0) {
    modulePixels = [screenPixels[0] / moduleCount[0], screenPixels[1] / moduleCount[1]];
    dimensionInferences.push(`由整屏分辨率÷模组排列反算单模组${modulePixels[0]}×${modulePixels[1]}点`);
  }
  // 已知单模组像素与整屏模组排列（宽×高张数）时，正算整屏像素，避免信息齐全仍停在暂定
  if (!screenPixels && modulePixels && moduleCount) {
    screenPixels = [modulePixels[0] * moduleCount[0], modulePixels[1] * moduleCount[1]];
    screenPixelsDerived = true;
  }
  if (!moduleMm && modulePixels && pitch) {
    moduleMm = [Number((modulePixels[0] * pitch).toFixed(3)), Number((modulePixels[1] * pitch).toFixed(3))];
    moduleMmDerived = true;
    dimensionInferences.push(`按P${pitch}由模组分辨率换算物理尺寸约${moduleMm[0]}×${moduleMm[1]}mm`);
  }
  if (!cabinetPixels && cabinetMm && pitch) {
    cabinetPixels = [Math.round(cabinetMm[0] / pitch), Math.round(cabinetMm[1] / pitch)];
    dimensionInferences.push(`按P${pitch}由单箱尺寸换算单箱约${cabinetPixels[0]}×${cabinetPixels[1]}点`);
  }
  if (!cabinetCount && cabinetPixels && screenPixels) {
    cabinetCount = [Math.ceil(screenPixels[0] / cabinetPixels[0]), Math.ceil(screenPixels[1] / cabinetPixels[1])];
    dimensionInferences.push(`由整屏分辨率÷单箱分辨率反算${cabinetCount[0]}宽×${cabinetCount[1]}高箱体`);
  }
  if (!cabinetCount && cabinetMm && meters) {
    cabinetCount = [Math.ceil(meters[0] * 1000 / cabinetMm[0]), Math.ceil(meters[1] * 1000 / cabinetMm[1])];
    dimensionInferences.push(`由整屏尺寸÷单箱尺寸反算${cabinetCount[0]}宽×${cabinetCount[1]}高箱体`);
  }
  const modulePixelsAssumed = !modulePixels && pitch > 0;
  const scanMatch = text.match(/(?:^|[^A-Z0-9])(?:1\s*\/\s*)?(\d{1,3})\s*(?:[sS](?![A-Z0-9])|\u626b)/i);
  // 以官方选型表为准：当模组分辨率是由物理尺寸数学反算（客户未显式给分辨率）时，
  // 用同点间距+同物理尺寸+接口(+扫描方式)唯一命中的官方规格像素校正，覆盖非正方像素的特殊扫描档（如P1.86 48S=172×96）。
  // 客户显式给出的分辨率不受影响；同尺寸存在多个扫描档且客户未指明扫描时不强行改，保持原反算结果。
  const modulePixelsFromMm = !statedModulePixels && !!pixelsFromMm;
  let modulePixelsOfficial = false;
  if (modulePixelsFromMm && pitch && moduleMm) {
    const scanNow = scanMatch ? `${scanMatch[1]}S` : "";
    const officialRows = MODULE_PRESETS.filter((row) => {
      if (!samePitchFamily(row.pitch, pitch)) return false;
      if (iface && row.iface !== iface) return false;
      if (!(row.mmW && Math.abs(row.mmW - moduleMm[0]) <= 0.5 && Math.abs((row.mmH || 0) - moduleMm[1]) <= 0.5)) return false;
      if (scanNow && row.scan !== scanNow) return false;
      return true;
    });
    if (officialRows.length === 1) {
      const beforePixels = modulePixels;
      modulePixels = [officialRows[0].w, officialRows[0].h];
      // 官方选型表精确规格（允许非正方像素，如P1.86 48S=172×96），豁免后续"物理÷像素=正方点间距"一致性校验
      modulePixelsOfficial = true;
      if (beforePixels && (beforePixels[0] !== modulePixels[0] || beforePixels[1] !== modulePixels[1])) {
        dimensionInferences.push(`按官方选型表${scanNow ? `${scanNow}规格` : "标准规格"}校正模组分辨率为${modulePixels[0]}×${modulePixels[1]}点`);
      }
    }
  }
  const preferredCardMatch = (text.match(/\b(?:H[DR]?[-\s]?)?(R708|R712|R716|R732|R500S|R3210|R5S\s*PLUS|R5S|RB6|R507T)\b/i) || [])[1];
  const preferredCard = preferredCardMatch ? preferredCardMatch.toUpperCase().replace(/\s+/g, "") : "";
  const preferredProcessor = findPreferredProcessor(text);
  const explicitColorMode = /全彩/i.test(text) ? "full" : (/双色/i.test(text) ? "dual" : (/单色/i.test(text) ? "single" : ""));
  const colorModeAssumed = !explicitColorMode;
  // HUB08/HUB12 identifies the single/dual-color product family. Without a
  // stated color, calculate as dual color so the controller is not undersized.
  // Every other unstated module defaults to full color.
  const colorMode = explicitColorMode || (/^HUB(?:08|12)$/.test(iface) ? "dual" : "full");
  const communication = /(?:Wi[\s-]?Fi|无线通讯|无线通信)/i.test(text)
    ? "wifi"
    : (/(?:网口通讯|网口通信|以太网通讯|以太网通信|网口卡|用网线|网线发布|网线通讯|网线通信)/i.test(text) ? "ethernet" : (/(?:U盘通讯|U盘通信|USB通讯|USB通信|用U盘|U盘发布)/i.test(text) ? "usb" : ""));
  const grayLevelMatch = text.match(/(\d{1,3})\s*级灰度/i);
  const dualMode = /同\s*异步|异步\s*同步|双模/.test(text);
  const mentionsSync = /同步|\b(?:VP(?:6|8|10|12|210S?|410|620|820|1220|1620|2060|2430|3060|4060)|T16)\b/i.test(text);
  const mentionsAsync = /异步|播放盒/i.test(text) || ASYNC_MODEL_NAMES.has(preferredProcessor);
  const explicitlyAsyncPlan = /(?:^|[，,；;。\s])异步配单/.test(text);
  const explicitlySyncPlan = /(?:^|[，,；;。\s])同步配单/.test(text);
  const controlMode = explicitlyAsyncPlan && !explicitlySyncPlan
    ? "async"
    : (explicitlySyncPlan && !explicitlyAsyncPlan
      ? "sync"
      : (!dualMode && mentionsSync && !mentionsAsync ? "sync" : (!dualMode && mentionsAsync && !mentionsSync ? "async" : "unspecified")));
  // Three independent redundancy layers: receiving cards, output ports, and sending devices.
  const receiverCardBackup = /双卡备份|双接收卡(?:备份)?|接收卡双备份|接收卡.{0,8}(?:双备份|主备)/.test(text);
  const portBackup = /双网口备份|网口双备份|接收卡网口备份|网口环路备份|环路备份|同(?:一|台)(?:设备|发送设备|处理器).{0,12}(?:不同)?网口.{0,8}(?:备份|冗余)|单机.{0,8}网口.{0,8}(?:备份|冗余)|网口(?:成对|配对)(?:备份|冗余)|端口冗余/.test(text);
  const senderCardBackup = /双发送卡(?:备份)?|发送卡双备份|双发送设备(?:备份)?|发送(?:卡|端|设备).{0,8}(?:双备份|主备)|双机备份/.test(text);
  const shapeMode = mentionedPitches.length > 1 || /混合模组|多种模组|不同模组|不同规格模组|混装/.test(text)
    ? "mixed"
    : (/(?:异形|弧形|曲面|圆形|扇形|三角形|梯形|创意屏|不规则屏)/.test(text)
      ? "irregular"
      : (/(?:旋转箱体|横竖混装|箱体旋转|模组旋转)/.test(text) ? "rotated" : "rectangular"));
  const refreshRateMatch = text.match(/(?:刷新率|刷新)\s*(?:为|是|[:：])?\s*(\d{3,5})\s*(?:Hz|赫兹)?/i)
    || text.match(/(1920|3840|7680|9600)\s*(?:Hz|赫兹)/i);
  const bitDepthMatch = text.match(/(?:位深|灰度位深)?\s*(8|10|12|14|16)\s*(?:bit|位)/i);
  const refreshRate = refreshRateMatch ? Number(refreshRateMatch[1]) : 0;
  const bitDepth = bitDepthMatch ? Number(bitDepthMatch[1]) : 0;
  const highRefresh = /高刷/.test(text) || refreshRate >= 3840;
  const hdr = /\bHDR\b/i.test(text);
  const lowLatency = /超?低延迟|低时延/i.test(text);
  const highGray = /高灰(?:阶|度)|高位深/.test(text) || bitDepth >= 10;
  const driverMode = /PWM(?:驱动|芯片)?|PWM型/i.test(text)
    ? "pwm"
    : (/(?:常规驱动|常规芯片|非PWM)/i.test(text) ? "conventional" : "unspecified");
  const cabinetConnector = /金手指/.test(text)
    ? "gold-finger"
    : (/(?:高密接口|高密座|高密转接)/.test(text) ? "high-density" : (/(?:航空插头|航插)/.test(text) ? "aviation" : "unspecified"));
  const cabinetPinMatch = text.match(/\b(120|84|50|26)\s*PIN\b/i);
  const cabinetPinType = cabinetPinMatch ? `${cabinetPinMatch[1]}PIN` : "";
  const receiversPerCabinetMatch = text.match(/(?:每(?:个)?箱(?:体)?|一箱)\s*(\d{1,2}|一|二|两|三|四|五|六|七|八)\s*(?:张)?(?:接收)?卡/i)
    || text.match(/(?:一箱一卡|一箱两卡|一箱二卡)/i);
  const receiverCountToken = receiversPerCabinetMatch?.[1]
    || (/一箱两卡|一箱二卡/.test(receiversPerCabinetMatch?.[0] || "") ? "两" : (receiversPerCabinetMatch ? "一" : ""));
  const chineseReceiverCounts = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8 };
  const receiversPerCabinet = receiverCountToken ? (chineseReceiverCounts[receiverCountToken] || Number(receiverCountToken)) : 0;
  const explicitAsyncArchitecture = /(?:板载HUB|直带模组|直控架构|直接HUB)/i.test(text)
    ? "direct"
    : (/(?:接收卡架构|通过接收卡|级联接收卡)/i.test(text) ? "receiver" : "auto");
  const inputInterfaces = [...new Set([...text.matchAll(/\b(HDMI|DP|DVI|SDI|CVBS)\b/gi)].map((match) => match[1].toUpperCase()))];
  const windowCountMatch = text.match(/(\d{1,2})\s*(?:个|路)?(?:窗口|画面)/i);
  const windowCount = windowCountMatch ? Number(windowCountMatch[1]) : 0;
  const usbPlayback = /(?:USB|U盘).{0,8}(?:播放|节目|发布)|(?:播放|节目).{0,8}(?:USB|U盘)/i.test(text);
  const cloudControl = /云控|云平台|云管理/i.test(text);
  const cellular = /\b[45]G\b|蜂窝|手机流量/i.test(text);
  const wirelessCasting = /无线投屏|无线同屏|投屏/i.test(text);
  const androidApps = /安卓应用|Android\s*(?:应用|APP)|安装\s*APP/i.test(text);
  const mixedPlayback = /同异步混播|同步异步混播|混合播放/i.test(text);
  const asksDirectCard = /(?:配\s*控制卡|控制卡|直控卡)/i.test(text);
  const directControlMode = colorMode === "single" || colorMode === "dual"
    || (colorMode === "full" && controlMode === "unspecified" && Boolean(iface) && asksDirectCard && !preferredCard);
  const splicerRequested = /拼控|拼接器|视频墙|矩阵|多信号源|多画面|多窗口|多个\s*(?:4K|2K)\s*信号|\d+\s*个\s*(?:4K|2K)\s*信号/i.test(text);
  return {
    raw: text, pitch, statedPitch, iface,
    modulePixels, modulePixelsAssumed, modulePixelsOfficial, defaultModuleMm: null,
    moduleMm, moduleMmDerived, moduleCount, cabinetCount, cabinetMm, cabinetPixels, screenPixels, screenPixelsDerived, meters, screenDimensionAssumption,
    dimensionInferences,
    scan: scanMatch ? `${scanMatch[1]}S` : "",
    preferredCard,
    preferredProcessor,
    controlMode,
    dualModeRequested: dualMode,
    colorMode,
    colorModeAssumed,
    communication,
    grayLevel: grayLevelMatch ? Number(grayLevelMatch[1]) : 0,
    directControlMode,
    splicerRequested,
    receiverCardBackup,
    portBackup,
    senderCardBackup,
    // Keep the old field names for callers that have not migrated yet.
    dualCardBackup: receiverCardBackup,
    networkBackup: senderCardBackup,
    sameDevicePortBackup: portBackup,
    shapeMode,
    mentionedPitches,
    cabinetConnector,
    cabinetPinType,
    receiversPerCabinet,
    receiversPerCabinetExplicit: Boolean(receiversPerCabinet),
    asyncArchitecture: explicitAsyncArchitecture,
    inputInterfaces,
    windowCount,
    usbPlayback,
    cloudControl,
    cellular,
    wirelessCasting,
    androidApps,
    mixedPlayback,
    refreshRate,
    bitDepth,
    highRefresh,
    hdr,
    lowLatency,
    highGray,
    driverMode,
    outdoor: /\u6237\u5916|outdoor/i.test(text), indoor: /\u5ba4\u5185|\u6237\u5185|indoor/i.test(text)
  };
}

// 网页输入防呆上限：取系统可自动选型的最大设备 = 最大拼接机箱 VP8000E-12U
// （199229440 点 / 单轴 194560）。超过它任何单机箱都盖不住，才在输入阶段拦下。
const STRUCTURED_INPUT_LIMITS = Object.freeze({
  modulePixelAxis: 4096,
  moduleAxisCount: 8192,
  totalModules: 200000,
  cabinetAxisCount: 8192,
  totalCabinets: 200000,
  receiversPerCabinet: 16,
  screenPixelAxis: 194560,
  totalPixels: 199229440,
  screenMetersAxis: 200,
  percentage: 100,
  spareReceiverQuantity: 10000,
  networkCableLength: 10000,
  windowCount: 64
});

function structuredPositiveNumber(value, label, { integer = false, max = Number.POSITIVE_INFINITY } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > max || (integer && !Number.isInteger(parsed))) {
    const kind = integer ? "正整数" : "正数";
    throw new TypeError(`${label}必须是大于0且不超过${max}的${kind}`);
  }
  return parsed;
}

function structuredOptionalPositiveNumber(values, key, label, options = {}) {
  if (!Object.prototype.hasOwnProperty.call(values, key) || values[key] === "" || values[key] == null) return undefined;
  return structuredPositiveNumber(values[key], label, options);
}

function structuredBoolean(value) {
  if (typeof value === "string") return /^(?:1|true|yes|on)$/i.test(value.trim());
  return Boolean(value);
}

function structuredInterfaces(value) {
  const raw = Array.isArray(value) ? value : String(value || "").split(/[、,;/\s]+/);
  return [...new Set(raw.map((item) => String(item || "").trim().toUpperCase()).filter(Boolean))];
}

function structuredText(value, maxLength = 120) {
  return String(value || "").trim().slice(0, maxLength);
}

function createStructuredInput(values = {}) {
  const screenType = values.screenType === "cabinet" ? "cabinet" : "module";
  const presetKey = String(values.presetKey || "").trim();
  const preset = MODULE_PRESETS.find((row) => row.key === presetKey);
  if (screenType === "module" && !preset) {
    const hasExplicitModule = values.pitch && values.moduleW && values.moduleH && values.iface;
    if (!hasExplicitModule) throw new TypeError("请选择正式带载表中的模组规格，或明确填写点间距、模组分辨率和HUB接口");
  }

  const inputMode = ["modules", "pixels", "meters"].includes(values.inputMode)
    ? values.inputMode
    : (screenType === "cabinet" ? "cabinets" : "modules");
  const cabinetHasPixels = screenType === "cabinet"
    && (values.cabinetPixelW ?? values.cabinetW)
    && (values.cabinetPixelH ?? values.cabinetH);
  const pitch = cabinetHasPixels && !values.pitch
    ? 0
    : structuredPositiveNumber(values.pitch ?? preset?.pitch, "点间距", { max: 100 });
  const iface = String(values.iface ?? preset?.iface ?? "").trim().toUpperCase();
  const scan = String(values.scan ?? preset?.scan ?? "").trim().toUpperCase();
  let moduleW = 0;
  let moduleH = 0;
  let moduleMm = null;
  let moduleCount = null;
  let cabinetCount = null;
  let cabinetPixels = null;
  let cabinetMm = null;
  let screenPixels = null;
  let meters = null;

  if (screenType === "cabinet") {
    const cabinetCols = structuredPositiveNumber(values.cabinetCols ?? values.moduleCols, "箱体宽数", {
      integer: true,
      max: STRUCTURED_INPUT_LIMITS.cabinetAxisCount
    });
    const cabinetRows = structuredPositiveNumber(values.cabinetRows ?? values.moduleRows, "箱体高数", {
      integer: true,
      max: STRUCTURED_INPUT_LIMITS.cabinetAxisCount
    });
    if (cabinetCols * cabinetRows > STRUCTURED_INPUT_LIMITS.totalCabinets) {
      throw new TypeError(`箱体总数不能超过${STRUCTURED_INPUT_LIMITS.totalCabinets}`);
    }
    cabinetCount = [cabinetCols, cabinetRows];
    const cabinetPixelWValue = values.cabinetPixelW ?? values.cabinetW;
    const cabinetPixelHValue = values.cabinetPixelH ?? values.cabinetH;
    const cabinetMmWValue = values.cabinetMmW;
    const cabinetMmHValue = values.cabinetMmH;
    if (cabinetPixelWValue && cabinetPixelHValue) {
      cabinetPixels = [
        structuredPositiveNumber(cabinetPixelWValue, "单箱分辨率宽", { integer: true, max: STRUCTURED_INPUT_LIMITS.screenPixelAxis }),
        structuredPositiveNumber(cabinetPixelHValue, "单箱分辨率高", { integer: true, max: STRUCTURED_INPUT_LIMITS.screenPixelAxis })
      ];
      if (cabinetMmWValue && cabinetMmHValue) {
        cabinetMm = [
          structuredPositiveNumber(cabinetMmWValue, "单箱物理宽度", { max: 10000 }),
          structuredPositiveNumber(cabinetMmHValue, "单箱物理高度", { max: 10000 })
        ];
      }
    } else if (cabinetMmWValue && cabinetMmHValue) {
      cabinetMm = [
        structuredPositiveNumber(cabinetMmWValue, "单箱物理宽度", { max: 10000 }),
        structuredPositiveNumber(cabinetMmHValue, "单箱物理高度", { max: 10000 })
      ];
      cabinetPixels = [Math.round(cabinetMm[0] / pitch), Math.round(cabinetMm[1] / pitch)];
    } else {
      throw new TypeError("箱体方案必须明确单箱分辨率，或单箱毫米尺寸与点间距");
    }
    screenPixels = [cabinetPixels[0] * cabinetCols, cabinetPixels[1] * cabinetRows];
    if (screenPixels[0] > STRUCTURED_INPUT_LIMITS.screenPixelAxis
      || screenPixels[1] > STRUCTURED_INPUT_LIMITS.screenPixelAxis
      || screenPixels[0] * screenPixels[1] > STRUCTURED_INPUT_LIMITS.totalPixels) {
      throw new TypeError("箱体换算后的整屏分辨率超过网页安全上限");
    }
  } else {
    moduleW = structuredPositiveNumber(values.moduleW ?? preset?.w, "模组分辨率宽", {
      integer: true,
      max: STRUCTURED_INPUT_LIMITS.modulePixelAxis
    });
    moduleH = structuredPositiveNumber(values.moduleH ?? preset?.h, "模组分辨率高", {
      integer: true,
      max: STRUCTURED_INPUT_LIMITS.modulePixelAxis
    });
    const moduleMmW = values.moduleMmW ?? preset?.mmW;
    const moduleMmH = values.moduleMmH ?? preset?.mmH;
    moduleMm = moduleMmW && moduleMmH
      ? [structuredPositiveNumber(moduleMmW, "模组物理宽度", { max: 10000 }), structuredPositiveNumber(moduleMmH, "模组物理高度", { max: 10000 })]
      : [Number((moduleW * pitch).toFixed(3)), Number((moduleH * pitch).toFixed(3))];
    if (inputMode === "modules") {
      const cols = structuredPositiveNumber(values.moduleCols, "模组宽数", {
        integer: true,
        max: STRUCTURED_INPUT_LIMITS.moduleAxisCount
      });
      const rows = structuredPositiveNumber(values.moduleRows, "模组高数", {
        integer: true,
        max: STRUCTURED_INPUT_LIMITS.moduleAxisCount
      });
      if (cols * rows > STRUCTURED_INPUT_LIMITS.totalModules) {
        throw new TypeError(`模组总数不能超过${STRUCTURED_INPUT_LIMITS.totalModules}`);
      }
      moduleCount = [cols, rows];
    } else if (inputMode === "pixels") {
      const width = structuredPositiveNumber(values.screenW, "屏宽分辨率", {
        integer: true,
        max: STRUCTURED_INPUT_LIMITS.screenPixelAxis
      });
      const height = structuredPositiveNumber(values.screenH, "屏高分辨率", {
        integer: true,
        max: STRUCTURED_INPUT_LIMITS.screenPixelAxis
      });
      if (width * height > STRUCTURED_INPUT_LIMITS.totalPixels) {
        throw new TypeError(`目标总像素不能超过${STRUCTURED_INPUT_LIMITS.totalPixels}`);
      }
      screenPixels = [width, height];
    } else {
      const width = structuredPositiveNumber(values.screenWM, "屏宽尺寸", {
        max: STRUCTURED_INPUT_LIMITS.screenMetersAxis
      });
      const height = structuredPositiveNumber(values.screenHM, "屏高尺寸", {
        max: STRUCTURED_INPUT_LIMITS.screenMetersAxis
      });
      const cols = Math.ceil(width * 1000 / moduleMm[0]);
      const rows = Math.ceil(height * 1000 / moduleMm[1]);
      if (cols > STRUCTURED_INPUT_LIMITS.moduleAxisCount
        || rows > STRUCTURED_INPUT_LIMITS.moduleAxisCount
        || cols * rows > STRUCTURED_INPUT_LIMITS.totalModules) {
        throw new TypeError(`米制目标换算后超过${STRUCTURED_INPUT_LIMITS.moduleAxisCount}宽×${STRUCTURED_INPUT_LIMITS.moduleAxisCount}高或${STRUCTURED_INPUT_LIMITS.totalModules}张模组的网页安全上限`);
      }
      meters = [width, height];
    }
  }

  if (inputMode === "pixels" && screenType === "cabinet" && values.screenW && values.screenH) {
    const width = structuredPositiveNumber(values.screenW, "屏宽分辨率", {
      integer: true,
      max: STRUCTURED_INPUT_LIMITS.screenPixelAxis
    });
    const height = structuredPositiveNumber(values.screenH, "屏高分辨率", {
      integer: true,
      max: STRUCTURED_INPUT_LIMITS.screenPixelAxis
    });
    if (width * height > STRUCTURED_INPUT_LIMITS.totalPixels) {
      throw new TypeError(`目标总像素不能超过${STRUCTURED_INPUT_LIMITS.totalPixels}`);
    }
    screenPixels = [width, height];
  }

  const base = parseRequest("");
  const controlMode = ["async", "sync", "unspecified"].includes(values.controlMode) ? values.controlMode : "sync";
  const preferredCard = String(values.preferredCard || "").trim().toUpperCase();
  const preferredProcessorRaw = String(values.preferredProcessor || "").trim().toUpperCase();
  const preferredProcessor = PROCESSOR_ALIASES[preferredProcessorRaw] || preferredProcessorRaw;
  const asyncArchitecture = ["auto", "direct", "receiver"].includes(values.asyncArchitecture)
    ? values.asyncArchitecture
    : "auto";
  const result = {
    ...base,
    raw: `网页结构化配单：${preset?.label || (screenType === "cabinet" ? "自定义箱体" : "明确模组规格")}`,
    screenType,
    pitch,
    statedPitch: pitch,
    presetKey,
    iface,
    modulePixels: screenType === "module" ? [moduleW, moduleH] : null,
    modulePixelsAssumed: false,
    moduleMm,
    moduleMmDerived: false,
    moduleCount,
    cabinetCount,
    cabinetPixels,
    cabinetMm,
    screenPixels,
    screenPixelsDerived: false,
    meters,
    scan,
    preferredCard,
    preferredProcessor,
    controlMode,
    colorMode: ["full", "dual", "single"].includes(values.colorMode) ? values.colorMode : "full",
    colorModeAssumed: !Object.prototype.hasOwnProperty.call(values, "colorMode"),
    communication: ["wifi", "ethernet", "usb"].includes(values.communication) ? values.communication : "",
    purpose: structuredText(values.purpose),
    environment: ["indoor", "outdoor"].includes(values.environment) ? values.environment : "",
    posterPlayback: structuredBoolean(values.posterPlayback),
    dimensionInferences: [],
    indoor: values.environment === "indoor" || /户内|室内/.test(preset?.label || ""),
    outdoor: values.environment === "outdoor" || /户外/.test(preset?.label || ""),
    receiverCardBackup: structuredBoolean(values.receiverCardBackup),
    portBackup: structuredBoolean(values.portBackup),
    senderCardBackup: structuredBoolean(values.senderCardBackup),
    dualCardBackup: structuredBoolean(values.receiverCardBackup),
    sameDevicePortBackup: structuredBoolean(values.portBackup),
    networkBackup: structuredBoolean(values.senderCardBackup),
    cabinetPinType: String(values.cabinetPinType || "").trim().toUpperCase(),
    receiversPerCabinet: screenType === "cabinet"
      ? (structuredOptionalPositiveNumber(values, "receiversPerCabinet", "每箱接收卡数", { integer: true, max: STRUCTURED_INPUT_LIMITS.receiversPerCabinet }) || 0)
      : 0,
    receiversPerCabinetExplicit: screenType === "cabinet" && Object.prototype.hasOwnProperty.call(values, "receiversPerCabinet"),
    asyncArchitecture,
    inputInterfaces: structuredInterfaces(values.inputInterfaces),
    windowCount: structuredOptionalPositiveNumber(values, "windowCount", "窗口数量", { integer: true, max: STRUCTURED_INPUT_LIMITS.windowCount }) || 0,
    usbPlayback: structuredBoolean(values.usbPlayback),
    cloudControl: structuredBoolean(values.cloudControl),
    cellular: structuredBoolean(values.cellular),
    wirelessCasting: structuredBoolean(values.wirelessCasting),
    androidApps: structuredBoolean(values.androidApps),
    mixedPlayback: structuredBoolean(values.mixedPlayback)
  };
  const optionalNumbers = [
    ["spareModulePercent", "备用模组比例", { max: STRUCTURED_INPUT_LIMITS.percentage }],
    ["spareModuleQuantity", "备用模组数量", { integer: true, max: STRUCTURED_INPUT_LIMITS.totalModules }],
    ["spareCabinetQuantity", "备用箱体数量", { integer: true, max: STRUCTURED_INPUT_LIMITS.totalCabinets }],
    ["spareReceiverQuantity", "备用接收卡数量", { integer: true, max: STRUCTURED_INPUT_LIMITS.spareReceiverQuantity }],
    ["spareReceiverPercent", "备用接收卡比例", { max: STRUCTURED_INPUT_LIMITS.percentage }],
    ["networkCableLength", "网线长度", { max: STRUCTURED_INPUT_LIMITS.networkCableLength }],
    ["powerSupplyQuantity", "电源数量", { integer: true, max: 100000 }]
  ];
  for (const [key, label, options] of optionalNumbers) {
    const value = structuredOptionalPositiveNumber(values, key, label, options);
    if (value !== undefined) result[key] = value;
  }
  const spareUnitCount = structuredOptionalPositiveNumber(values, "spareUnitCount", screenType === "cabinet" ? "备用箱体数量" : "备用模组数量", {
    integer: true,
    max: screenType === "cabinet" ? STRUCTURED_INPUT_LIMITS.totalCabinets : STRUCTURED_INPUT_LIMITS.totalModules
  });
  if (spareUnitCount !== undefined) {
    result[screenType === "cabinet" ? "spareCabinetQuantity" : "spareModuleQuantity"] = spareUnitCount;
  }
  return result;
}

function isNegatedOrderingRequest(message) {
  const text = String(message || "").replace(/\s+/g, "");
  return /(?:不需要|无需|不要|不用|先不|暂不|暂时不)(?:再|做|进行|给我)?(?:配单|配卡|选型|选设备)|不是(?:要|做|让你|叫你)?(?:配单|配卡|选型|选设备)/i.test(text);
}

function looksLikeOrderingRequest(message) {
  const text = String(message || "")
    .replace(/\uff0c/g, ",")
    .replace(/\uff1b/g, ";")
    .replace(/(\d)\s*乘\s*(\d)/g, "$1×$2");
  if (isNegatedOrderingRequest(text)) return false;
  const faultWording = /(?:故障|异常|不亮|黑屏|花屏|闪屏|闪烁|抖屏|偏色|色块|连接不上|搜不到|无信号|报错|升级失败|显示不正常|画面不正常)/i.test(text);
  if (faultWording) return false;
  const input = parseRequest(text);
  const hasEngineeringFacts = Boolean(
    input.pitch || input.moduleCount || input.cabinetCount || input.screenPixels || input.meters
    || input.moduleMm || input.modulePixels || input.iface || input.scan
  );
  const strongOrderingWords = /(?:配单|配卡|选型|配接收卡|配发送卡|配处理器|算接收卡|算网口|接收卡拓扑|连接拓扑|接线拓扑)/i.test(text);
  const naturalOrderingWords = /(?:配置|安排|做|给|出|设计|看看|帮忙).{0,12}(?:方案|设备|接收卡|发送卡|处理器|播放器|拓扑|接线)|(?:帮我|麻烦|请|先)?\s*(?:把|给|做|出|算).{0,12}(?:方案|接线图|拓扑图)|(?:方案|接线图|拓扑图).{0,12}(?:算|出|做|给|生成)|(?:帮我|麻烦)?\s*算(?:一下|一算)?|(?:怎么|如何).{0,10}(?:配|接|选)|(?:用|要|需要|配).{0,8}(?:几张|多少张|几个|多少个|几路|多少路).{0,6}(?:卡|网口)|(?:用什么|选什么|推荐什么).{0,8}(?:设备|卡|处理器|播放器)/i.test(text);
  return strongOrderingWords || (hasEngineeringFacts && naturalOrderingWords);
}

function isOrderingContinuationMessage(message) {
  const text = String(message || "").trim();
  if (!text || isNegatedOrderingRequest(text)) return false;
  return /(?:按|改|改成|改用|换|换成|用|使用|重新|再).{0,24}(?:算|配|接口|HUB|口|接收卡|处理器|同步|异步|扫描|扫|模组|箱体|宽|高)|(?:HUB\s*(?:320|75|12|08)|(?:320|75|12|08)\s*口|R(?:708|712|716|732|500S)|\d{1,3}\s*扫)/i.test(text);
}

function explicitOrderingFacts(message) {
  const text = String(message || "").trim();
  const input = parseRequest(text);
  const modulePixelsDerivedFromMm = input.dimensionInferences.some((item) => /由模组物理尺寸换算/.test(item));
  return {
    statedPitch: input.statedPitch || 0,
    iface: input.iface || "",
    modulePixels: input.modulePixels && !modulePixelsDerivedFromMm ? input.modulePixels : null,
    moduleMm: input.moduleMm && !input.moduleMmDerived ? input.moduleMm : null,
    moduleCount: input.moduleCount || null,
    cabinetCount: /(?:箱体|箱子).{0,12}(?:数量|排列|\d+\s*(?:宽|列).{0,8}\d+\s*(?:高|行))|一箱一卡/i.test(text) ? input.cabinetCount : null,
    cabinetMm: input.cabinetMm || null,
    cabinetPixels: input.cabinetPixels || null,
    screenPixels: input.screenPixels && !input.screenPixelsDerived ? input.screenPixels : null,
    meters: input.meters || null,
    scan: input.scan || "",
    preferredCard: input.preferredCard || "",
    preferredProcessor: input.preferredProcessor || "",
    asyncArchitecture: /(?:板载HUB|直带模组|直控架构|直接HUB|接收卡架构|通过接收卡|级联接收卡)/i.test(text) ? input.asyncArchitecture : "",
    inputInterfaces: input.inputInterfaces,
    windowCount: input.windowCount || 0,
    usbPlayback: input.usbPlayback ? true : null,
    cloudControl: input.cloudControl ? true : null,
    cellular: input.cellular ? true : null,
    wirelessCasting: input.wirelessCasting ? true : null,
    androidApps: input.androidApps ? true : null,
    mixedPlayback: input.mixedPlayback ? true : null,
    controlMode: /同\s*异步|异步\s*同步|双模/.test(text)
      ? "unspecified"
      : (/异步|播放盒/i.test(text) ? "async" : (/同步/i.test(text) ? "sync" : "")),
    colorMode: /全彩/i.test(text) ? "full" : (/双色/i.test(text) ? "dual" : (/单色/i.test(text) ? "single" : "")),
    communication: input.communication || "",
    receiverCardBackup: input.receiverCardBackup ? true : null,
    portBackup: input.portBackup ? true : null,
    senderCardBackup: input.senderCardBackup ? true : null,
    shapeMode: input.shapeMode !== "rectangular" ? input.shapeMode : "",
    refreshRate: input.refreshRate || 0,
    bitDepth: input.bitDepth || 0,
    highRefresh: input.highRefresh ? true : null,
    hdr: input.hdr ? true : null,
    lowLatency: input.lowLatency ? true : null,
    highGray: input.highGray ? true : null,
    driverMode: input.driverMode !== "unspecified" ? input.driverMode : "",
    outdoor: /户外|outdoor/i.test(text) ? true : null,
    indoor: /室内|户内|indoor/i.test(text) ? true : null,
    oneCardPerCabinet: /一箱一卡/i.test(text) ? true : null,
    receiversPerCabinet: input.receiversPerCabinetExplicit ? input.receiversPerCabinet : 0,
    splicerRequested: /拼控|拼接器|视频墙|矩阵|多信号源|多画面|多窗口/i.test(text) ? true : null
  };
}

function buildContextualOrderingMessage(messages) {
  const rows = (Array.isArray(messages) ? messages : [messages]).map((item) => String(item || "").trim()).filter(Boolean);
  const state = {};
  for (const row of rows) {
    const facts = explicitOrderingFacts(row);
    for (const [key, value] of Object.entries(facts)) {
      if (Array.isArray(value) || value === true || (value !== null && value !== "" && value !== 0)) state[key] = value;
    }
  }
  const parts = ["配单"];
  if (state.statedPitch) parts.push(`P${state.statedPitch}`);
  if (state.moduleMm) parts.push(`模组尺寸${state.moduleMm[0]}×${state.moduleMm[1]}mm`);
  if (state.modulePixels) parts.push(`模组分辨率${state.modulePixels[0]}×${state.modulePixels[1]}点`);
  if (state.moduleCount) parts.push(`模组排列${state.moduleCount[0]}宽×${state.moduleCount[1]}高`);
  if (state.cabinetMm) parts.push(`箱体尺寸${state.cabinetMm[0]}×${state.cabinetMm[1]}mm`);
  if (state.cabinetPixels) parts.push(`箱体分辨率${state.cabinetPixels[0]}×${state.cabinetPixels[1]}像素`);
  if (state.cabinetCount) parts.push(`箱体数量${state.cabinetCount[0]}宽×${state.cabinetCount[1]}高`);
  if (state.screenPixels) parts.push(`整屏分辨率${state.screenPixels[0]}×${state.screenPixels[1]}像素`);
  if (state.meters) parts.push(`整屏尺寸${state.meters[0]}m×${state.meters[1]}m`);
  if (state.iface) parts.push(`${state.iface}接口`);
  if (state.scan) parts.push(`${state.scan.replace(/S$/i, "")}扫`);
  if (state.preferredCard) parts.push(`指定接收卡${state.preferredCard}`);
  if (state.preferredProcessor) parts.push(`指定设备${state.preferredProcessor}`);
  if (state.asyncArchitecture === "direct") parts.push("板载HUB直控架构");
  else if (state.asyncArchitecture === "receiver") parts.push("接收卡架构");
  if (state.inputInterfaces?.length) parts.push(`输入接口${state.inputInterfaces.join("+")}`);
  if (state.windowCount) parts.push(`${state.windowCount}个窗口`);
  if (state.usbPlayback) parts.push("U盘播放");
  if (state.cloudControl) parts.push("云控");
  if (state.cellular) parts.push("4G");
  if (state.wirelessCasting) parts.push("无线投屏");
  if (state.androidApps) parts.push("安卓应用");
  if (state.mixedPlayback) parts.push("同异步混播");
  if (state.controlMode) parts.push({ sync: "同步", async: "异步", unspecified: "同异步" }[state.controlMode]);
  if (state.colorMode) parts.push({ full: "全彩", dual: "双色", single: "单色" }[state.colorMode]);
  if (state.communication) parts.push({ wifi: "Wi-Fi通信", ethernet: "网口通信", usb: "U盘通信" }[state.communication]);
  if (state.receiverCardBackup) parts.push("双接收卡备份");
  if (state.portBackup) parts.push("双网口备份");
  if (state.senderCardBackup) parts.push("双发送卡备份");
  if (state.shapeMode === "mixed") parts.push("混合模组");
  else if (state.shapeMode === "irregular") parts.push("异形屏");
  else if (state.shapeMode === "rotated") parts.push("旋转箱体");
  if (state.refreshRate) parts.push(`刷新率${state.refreshRate}Hz`);
  if (state.bitDepth) parts.push(`${state.bitDepth}bit位深`);
  if (state.highRefresh && !state.refreshRate) parts.push("高刷");
  if (state.hdr) parts.push("HDR");
  if (state.lowLatency) parts.push("低延迟");
  if (state.highGray && !state.bitDepth) parts.push("高灰阶");
  if (state.driverMode === "pwm") parts.push("PWM驱动芯片");
  else if (state.driverMode === "conventional") parts.push("常规驱动芯片");
  if (state.receiversPerCabinet) parts.push(`每箱${state.receiversPerCabinet}张接收卡`);
  else if (state.oneCardPerCabinet) parts.push("一箱一卡");
  if (state.splicerRequested) parts.push("需要拼控");
  if (state.outdoor) parts.push("户外");
  else if (state.indoor) parts.push("室内");
  return parts.join("，");
}

function validateInputConsistency(input) {
  const conflicts = [];
  const warnings = [];
  const exactGridCheck = (label, unit, expected, actual) => {
    if (!expected || !actual) return;
    if (expected[0] !== actual[0] || expected[1] !== actual[1]) {
      conflicts.push(`${label}应为${expected[0]}×${expected[1]}${unit}，但输入为${actual[0]}×${actual[1]}${unit}`);
    }
  };
  const checkPitch = (label, mm, pixels) => {
    if (!mm || !pixels) return;
    const actual = pitchFromPhysicalAndPixels(mm, pixels);
    if (!actual) {
      conflicts.push(`${label}的物理宽高与像素宽高无法得到一致点间距`);
      return;
    }
    if (input.pitch) {
      const ratio = Math.abs(actual - input.pitch) / input.pitch;
      if (ratio > 0.05) conflicts.push(`${label}实算约P${actual.toFixed(4)}，与输入P${input.pitch}冲突`);
      else if (ratio > 0.01) warnings.push(`${label}标称P${input.pitch}，按尺寸与像素实算约P${actual.toFixed(4)}`);
    }
  };
  // 模组像素来自官方选型表精确规格时（可能为官方非正方像素，如P1.86 48S=172×96），不再用正方点间距假设判冲突
  if (!input.modulePixelsOfficial) checkPitch("模组", input.moduleMm, input.modulePixels);
  checkPitch("箱体", input.cabinetMm, input.cabinetPixels);
  if (input.meters && input.screenPixels && input.pitch) {
    checkPitch("整屏", [input.meters[0] * 1000, input.meters[1] * 1000], input.screenPixels);
  }
  if (input.cabinetCount && input.cabinetPixels && input.screenPixels && !input.screenPixelsDerived) {
    exactGridCheck(
      "按单箱分辨率×箱体数量计算的整屏分辨率",
      "点",
      [input.cabinetPixels[0] * input.cabinetCount[0], input.cabinetPixels[1] * input.cabinetCount[1]],
      input.screenPixels
    );
  }
  if (input.moduleCount && input.modulePixels && input.screenPixels && !input.screenPixelsDerived) {
    exactGridCheck(
      "按模组分辨率×模组数量计算的整屏分辨率",
      "点",
      [input.modulePixels[0] * input.moduleCount[0], input.modulePixels[1] * input.moduleCount[1]],
      input.screenPixels
    );
  }
  return { conflicts, warnings };
}

function choosePreset(input) {
  let rows = MODULE_PRESETS.filter((row) => !input.pitch || samePitchFamily(row.pitch, input.pitch));
  input.verifiedProfileGaps = [];
  rows = rows.filter(row => {
    if (!row.verifiedMatch) return true;
    const m = row.verifiedMatch, gaps = [];
    if (!input.pitch || !samePitchFamily(row.pitch, input.pitch)) gaps.push("点间距");
    if (!input.modulePixels || input.modulePixels[0] !== m.modulePixels[0] || input.modulePixels[1] !== m.modulePixels[1]) gaps.push("单块模组分辨率");
    if (m.scan && input.scan !== String(m.scan).toUpperCase()) gaps.push(`扫描方式（档案为${m.scan}，当前${input.scan || "未提供"}）`);
    if (m.interface && input.iface !== String(m.interface).toUpperCase().replace(/^HUB75[BE]$/, "HUB75")) gaps.push(`接口（档案为${m.interface}）`);
    if (m.color === "1R1G1B" && (input.colorMode !== "full" || input.colorModeAssumed)) gaps.push("全彩颜色类型");
    if (m.environment === "indoor" && !input.indoor) gaps.push("室内使用环境");
    if (m.environment === "outdoor" && !input.outdoor) gaps.push("户外使用环境");
    if (gaps.length) input.verifiedProfileGaps.push({ key: row.key, pixels: [row.w, row.h], gaps });
    return gaps.length === 0;
  });
  if (input.presetKey) rows = rows.filter((row) => row.key === input.presetKey || (row.legacyKeys || []).includes(input.presetKey));
  // The official table states colors explicitly. Do not mix full-color and HUB12 modules.
  rows = rows.filter(row => !row.colorComponents || (input.colorMode === "full"
    ? Boolean(row.colorComponents.R && row.colorComponents.G && row.colorComponents.B)
    : input.colorMode === "dual" ? Boolean(row.colorComponents.R && row.colorComponents.G && !row.colorComponents.B)
      : Boolean(row.colorComponents.R && !row.colorComponents.G && !row.colorComponents.B)));
  if (input.iface) rows = rows.filter((row) => row.iface === input.iface);
  if (input.outdoor) { const outdoorRows = rows.filter((row) => /户外/.test(row.label)); if (outdoorRows.length) rows = outdoorRows; }
  // 室内/户外为软偏好：多规格时缩小范围；若会把候选清空（如同点间距仅一条且标注环境相反），回退保留，交给像素/尺寸硬匹配
  if (input.indoor) { const indoorRows = rows.filter((row) => /户内|室内/.test(row.label)); if (indoorRows.length) rows = indoorRows; }
  if (input.moduleMm && !input.moduleMmDerived) {
    rows = rows.filter((row) => {
      const rowMmW = row.mmW || (row.w && row.pitch ? row.w * row.pitch : 0);
      const rowMmH = row.mmH || (row.h && row.pitch ? row.h * row.pitch : 0);
      return rowMmW && rowMmH
        && Math.abs(rowMmW - input.moduleMm[0]) <= 0.5
        && Math.abs(rowMmH - input.moduleMm[1]) <= 0.5;
    });
  }
  if (input.modulePixels) {
    const exact = rows.filter((row) => row.w === input.modulePixels[0] && row.h === input.modulePixels[1]);
    if (exact.length) rows = exact;
    else rows = [];
  } else if (!input.moduleMm || input.moduleMmDerived) {
    // Pitch rows in the load table are the conventional module resolutions
    // used for ordering. Prefer the standard physical module before uncommon
    // sizes; scan count is not a receiver-card ordering gate.
    const ranked = rows.map((row) => ({ row, distance: physicalSizeDistance(row, input.pitch) }));
    const bestDistance = Math.min(...ranked.map((item) => item.distance));
    if (Number.isFinite(bestDistance)) {
      rows = ranked
        .filter((item) => Math.abs(item.distance - bestDistance) < 0.001)
        .map((item) => item.row);
    }
  }
  if (!input.iface) {
    const statedPitch = Number(input.statedPitch || input.pitch || 0);
    const preferredInterface = Math.abs(statedPitch - 1.25) < 0.001
      ? "HUB320"
      : ([1.5, 1.53].some((value) => Math.abs(statedPitch - value) < 0.001) ? "HUB75" : "");
    if (preferredInterface) {
      const preferredRows = rows.filter((row) => row.iface === preferredInterface);
      if (preferredRows.length) {
        rows = preferredRows;
        input.interfaceAssumed = preferredInterface;
      }
    }
  }
  // Explicit module facts win. Only use indoor as the common fallback after
  // resolution/interface/size matching, so a verified special profile is not
  // discarded merely because its label has no environment word. When the user
  // states a scan method (which often implies an outdoor/indoor load row), do
  // not pre-filter to indoor — let the explicit scan match below decide.
  if (!input.outdoor && !input.indoor && !input.scan) {
    const indoorRows = rows.filter((row) => /户内|室内/.test(row.label));
    if (indoorRows.length) {
      rows = indoorRows;
      input.environmentAssumed = true;
    }
  }
  const scanSensitiveGroups = new Map();
  for (const row of rows) {
    const key = presetConditionKey(row);
    if (!scanSensitiveGroups.has(key)) scanSensitiveGroups.set(key, []);
    scanSensitiveGroups.get(key).push(row);
  }
  const scanSensitiveRows = [...scanSensitiveGroups.values()].filter((group) =>
    new Set(group.map((row) => row.scan).filter(Boolean)).size > 1
    && new Set(group.map(presetCapacityKey)).size > 1
  ).flat();
  input.scanAffectsCapacity = scanSensitiveRows.length > 0;
  input.scanOptions = [...new Set(scanSensitiveRows.map((row) => row.scan).filter(Boolean))];
  input.scanMatched = false;
  if (input.scan) {
    const exactScanRows = rows.filter((row) => row.scan === input.scan);
    if (exactScanRows.length) {
      rows = exactScanRows;
      input.scanMatched = true;
    }
  }
  return rows.sort((a, b) => physicalSizeDistance(a, input.pitch) - physicalSizeDistance(b, input.pitch));
}

function presetConditionKey(row) {
  const environment = /户外/.test(row.label) ? "outdoor" : (/户内|室内/.test(row.label) ? "indoor" : "");
  return [row.pitch, row.mmW, row.mmH, row.w, row.h, row.iface, row.color, environment].join("|");
}

function presetIdentityKey(row) {
  return [row.pitch, row.mmW, row.mmH, row.w, row.h, row.iface, row.color].join("|");
}

function presetCapacityKey(row) {
  return Object.entries(row.cardLayouts || {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, layout]) => `${name}:${layout.w}x${layout.h}`)
    .join("|");
}

function presetCapacityPoints(row) {
  const values = Object.values(row.cardLayouts || {}).map((layout) => layout.w * layout.h * row.w * row.h);
  return values.length ? Math.max(...values) : Number.POSITIVE_INFINITY;
}

function summarizePreset(row) {
  return {
    key: row.key,
    pitch: row.pitch,
    label: row.label,
    mm: row.mmW && row.mmH ? [row.mmW, row.mmH] : null,
    pixels: [row.w, row.h],
    scan: row.scan,
    iface: row.iface,
    color: row.color,
    cardLayouts: row.cardLayouts,
    sourceLine: row.sourceLine
  };
}

function calculateProvisionalCandidate(input, candidate) {
  if (!candidate?.pixels?.[0] || !candidate?.pixels?.[1]) return null;
  const provisionalInput = {
    ...input,
    pitch: candidate.pitch || input.pitch,
    modulePixels: [...candidate.pixels],
    modulePixelsAssumed: false,
    presetAssumed: true,
    moduleMm: candidate.mm ? [...candidate.mm] : input.moduleMm,
    scan: candidate.scan || input.scan,
    iface: candidate.iface || input.iface,
    presetKey: candidate.key || ""
  };
  return calculate(provisionalInput);
}

function mostUsefulPresetFact(rows) {
  const distinct = (pick) => new Set(rows.map(pick).filter(Boolean)).size;
  if (distinct((row) => `${row.w}x${row.h}`) > 1) return "模组分辨率";
  if (distinct((row) => row.iface) > 1) return "HUB接口";
  if (distinct((row) => `${row.mmW}x${row.mmH}`) > 1) return "模组物理尺寸";
  if (distinct((row) => /户外/.test(row.label) ? "户外" : "户内") > 1) return "户内还是户外";
  return "模组完整型号或配置文件名";
}

function resolvePresetMatches(matches) {
  const identities = new Map();
  for (const row of matches) {
    const key = presetIdentityKey(row);
    if (!identities.has(key)) identities.set(key, []);
    identities.get(key).push(row);
  }
  if (identities.size === 1) {
    const rows = [...identities.values()][0];
    const sorted = [...rows].sort((a, b) => {
      const evidenceRank = (row) => ["official", "verified"].includes(row.evidenceStatus) ? 0 : 1;
      return evidenceRank(a) - evidenceRank(b)
        || presetCapacityPoints(a) - presetCapacityPoints(b)
        || Number(a.sourceLine || 0) - Number(b.sourceLine || 0);
    });
    const distinctCapacities = new Set(rows.map(presetCapacityKey));
    return {
      ok: true,
      preset: distinctCapacities.size > 1
        ? {
            ...sorted[0],
            conflictResolution: "conservative",
            conflictVariants: sorted.map(summarizePreset)
          }
        : sorted[0]
    };
  }
  const conditions = new Map();
  for (const row of matches) {
    const key = presetConditionKey(row);
    if (!conditions.has(key)) conditions.set(key, []);
    conditions.get(key).push(row);
  }
  if (conditions.size > 1) {
    return {
      ok: false,
      candidates: [...conditions.values()].map((rows) => summarizePreset(rows[0])),
      missingFact: mostUsefulPresetFact(matches)
    };
  }
  const rows = [...conditions.values()][0] || [];
  const capacities = new Set(rows.map(presetCapacityKey));
  if (capacities.size <= 1) return { ok: true, preset: rows[0] };
  const sorted = [...rows].sort((a, b) => presetCapacityPoints(a) - presetCapacityPoints(b) || a.sourceLine - b.sourceLine);
  return {
    ok: true,
    preset: {
      ...sorted[0],
      conflictResolution: "conservative",
      conflictVariants: sorted.map(summarizePreset)
    }
  };
}

function splitEven(total, parts, maxEach) {
  const base = Math.floor(total / parts), out = [];
  let remainder = total % parts;
  for (let i = 0; i < parts; i++) out.push(base + (remainder-- > 0 ? 1 : 0));
  if (Math.max(...out) > maxEach) throw new Error("分配超出单卡能力");
  return out;
}

function buildPorts(cols, rows, moduleW, moduleH, cardW, cardH) {
  const rowGroups = Math.ceil(rows / cardH), colGroups = Math.ceil(cols / cardW);
  const rowHeights = splitEven(rows, rowGroups, cardH), colWidths = splitEven(cols, colGroups, cardW);
  const cells = [];
  for (let row = 0; row < rowGroups; row++) {
    const columns = Array.from({ length: colGroups }, (_, col) => col);
    if (row % 2 === 1) columns.reverse();
    for (const col of columns) {
      const pxW = colWidths[col] * moduleW, pxH = rowHeights[row] * moduleH;
      cells.push({ row, col, pxW, pxH, points: pxW * pxH });
    }
  }

  const dp = Array(cells.length + 1).fill(null);
  dp[cells.length] = { count: 0, maxPoints: 0, squaredLoad: 0, groups: [] };
  for (let start = cells.length - 1; start >= 0; start--) {
    let best = null, actualPoints = 0;
    for (let end = start; end < cells.length; end++) {
      actualPoints += cells[end].points;
      if (actualPoints > LIMIT) break;
      const groupCells = cells.slice(start, end + 1);
      const groupRows = [...new Set(groupCells.map((cell) => cell.row))];
      const groupCols = [...new Set(groupCells.map((cell) => cell.col))];
      const boundingModW = groupCols.reduce((sum, col) => sum + colWidths[col], 0);
      const boundingModH = groupRows.reduce((sum, row) => sum + rowHeights[row], 0);
      const boundingPoints = boundingModW * moduleW * boundingModH * moduleH;
      // The processor is selected after the topology is built.  Until an
      // explicit non-rectangular capability is attached to that processor,
      // every L-shaped group must therefore pass the legacy bounding-rectangle
      // load rule.  This avoids counting blank cells as free capacity.
      if (boundingPoints > LIMIT) continue;
      const next = dp[end + 1];
      if (!next) continue;
      const loadPoints = boundingPoints;
      const group = { cells: groupCells, actualPoints, boundingPoints, loadPoints };
      const candidate = {
        count: next.count + 1,
        maxPoints: Math.max(loadPoints, next.maxPoints),
        squaredLoad: loadPoints * loadPoints + next.squaredLoad,
        groups: [group, ...next.groups]
      };
      const candidateFirstLoad = candidate.groups[0]?.loadPoints || 0;
      const bestFirstLoad = best?.groups[0]?.loadPoints || 0;
      if (
        !best
        || candidate.count < best.count
        || (candidate.count === best.count && candidate.maxPoints < best.maxPoints)
        || (candidate.count === best.count && candidate.maxPoints === best.maxPoints && candidate.squaredLoad < best.squaredLoad)
        || (candidate.count === best.count && candidate.maxPoints === best.maxPoints && candidate.squaredLoad === best.squaredLoad && candidateFirstLoad > bestFirstLoad)
      ) best = candidate;
    }
    dp[start] = best;
  }

  const groups = dp[0]?.groups || [];
  const ports = groups.map((group) => {
    const rowsUsed = [...new Set(group.cells.map((cell) => cell.row))].sort((a, b) => a - b);
    const colsUsed = [...new Set(group.cells.map((cell) => cell.col))].sort((a, b) => a - b);
    const occupied = new Set(group.cells.map((cell) => `${cell.row}:${cell.col}`));
    const rectangular = rowsUsed.every((row) => colsUsed.every((col) => occupied.has(`${row}:${col}`)));
    const modW = colsUsed.reduce((sum, col) => sum + colWidths[col], 0);
    const modH = rowsUsed.reduce((sum, row) => sum + rowHeights[row], 0);
    return {
      row: rowsUsed[0],
      rowCount: rowsUsed.length,
      start: group.cells[0].col,
      count: group.cells.length,
      modW,
      modH,
      pxW: modW * moduleW,
      pxH: modH * moduleH,
      actualPoints: group.actualPoints,
      boundingPoints: group.boundingPoints,
      points: group.loadPoints,
      rectangular,
      cells: group.cells
    };
  });
  return {
    rowGroups,
    colGroups,
    rowHeights,
    colWidths,
    cardCount: cells.length,
    ports,
    actualCoveredPoints: cells.reduce((sum, cell) => sum + cell.points, 0),
    maxPortPoints: ports.length ? Math.max(...ports.map((port) => port.points)) : Infinity
  };
}

// 官网选型工具 Ex() onlyHeight 纯按高算：每口沿整高取 P 宽竖条（全高竖条），网口数/拓扑图与官网一致。
// 仅在能落单台处理器（C<=16）时返回；O<1 或 C>16（多处理器/拼接）返回 null，交回旧打包/拼接路径。
function buildPortsOfficial(cols, rows, moduleW, moduleH, cardW, cardH) {
  if (!cardW || !cardH || cols < 1 || rows < 1) return null;
  const modPx = moduleW * moduleH;
  const hcap = Math.floor(LIMIT / modPx);
  if (!(hcap >= 1)) return null;
  const vcapMods = Math.floor(4096 / moduleW);
  const colGroups = Math.ceil(cols / cardW);
  const rowGroups = Math.ceil(rows / cardH);
  let O = Math.floor(hcap / (rows * cardW));
  if (cols * rows <= hcap) O = colGroups;
  const OByWidth = Math.floor(vcapMods / cardW);
  if (OByWidth < O) O = OByWidth;
  if (!O || O < 1) return null;
  const C = Math.ceil(colGroups / O);
  if (C > 16) return null;
  const colWidths = splitEven(cols, colGroups, cardW);
  const b = Math.ceil(rows / rowGroups), rem = rows % rowGroups, hf = Math.floor(rows / rowGroups);
  const rowHeights = Array.from({ length: rowGroups }, (_, r) => (r < rem ? b : hf));
  const cellMap = new Map();
  for (let row = 0; row < rowGroups; row++) {
    for (let col = 0; col < colGroups; col++) {
      cellMap.set(`${row}:${col}`, { row, col, pxW: colWidths[col] * moduleW, pxH: rowHeights[row] * moduleH, points: colWidths[col] * moduleW * rowHeights[row] * moduleH });
    }
  }
  const cells = [...cellMap.values()];
  const ports = [];
  for (let i = 0; i < C; i++) {
    const c0 = i * O, c1 = Math.min(colGroups, c0 + O);
    const stripCells = [];
    for (let row = 0; row < rowGroups; row++) {
      const rowCells = [];
      for (let col = c0; col < c1; col++) rowCells.push(cellMap.get(`${row}:${col}`));
      if (row % 2 === 1) rowCells.reverse(); // 蛇形：奇数行反向，行尾同列垂直下折，级联全程直角无斜线
      stripCells.push(...rowCells);
    }
    let modW = 0;
    for (let col = c0; col < c1; col++) modW += colWidths[col];
    const modH = rows, pxW = modW * moduleW, pxH = modH * moduleH;
    if (pxW > 4096 || pxW * pxH > LIMIT) return null;
    ports.push({ row: 0, rowCount: rowGroups, start: c0, count: stripCells.length, modW, modH, pxW, pxH, actualPoints: pxW * pxH, boundingPoints: pxW * pxH, points: pxW * pxH, rectangular: true, cells: stripCells });
  }
  return { rowGroups, colGroups, rowHeights, colWidths, cardCount: cells.length, ports,
    actualCoveredPoints: cells.reduce((sum, cell) => sum + cell.points, 0),
    maxPortPoints: ports.length ? Math.max(...ports.map((port) => port.points)) : Infinity,
    packing: "onlyHeight", widthInterval: O };
}

// 常规矩形网格优先官网 onlyHeight；长条/异形/多处理器不适用时回退原二维打包。
function buildPortsAligned(cols, rows, moduleW, moduleH, cardW, cardH, allowOfficial) {
  if (allowOfficial) { const official = buildPortsOfficial(cols, rows, moduleW, moduleH, cardW, cardH); if (official) return official; }
  return buildPorts(cols, rows, moduleW, moduleH, cardW, cardH);
}
function receiverQualityWidthPx(preset, moduleW, moduleH) {
  const rules = TRAINING_RULES.selectionRules?.receiverQualityWidthPx || {};
  if ((moduleW === 160 && moduleH === 80) || (moduleW === 80 && moduleH === 40)) {
    return Number(rules.module160x80Or80x40 || 160);
  }
  if (moduleW === 40 && moduleH === 20) return Number(rules.module40x20 || 240);
  if (/\u6237\u5916/.test(String(preset?.label || ""))) return Number(rules.outdoorCommon || 256);
  return Number(rules.indoorCommon || 128);
}

function actualCardModuleLoad(plan, fallbackW, fallbackH) {
  const cw = (Array.isArray(plan && plan.colWidths) && plan.colWidths.length) ? Math.max.apply(null, plan.colWidths) : 0;
  const rh = (Array.isArray(plan && plan.rowHeights) && plan.rowHeights.length) ? Math.max.apply(null, plan.rowHeights) : 0;
  return { w: cw || fallbackW, h: rh || fallbackH };
}

function qualityReceiverCandidate(name, preset, cols, rows, moduleW, moduleH) {
  const layout = preset.cardLayouts?.[name];
  const range = RECEIVER_RANGES[name];
  if (!layout || !range || preset.iface !== "HUB75") return null;
  const widthLimit = receiverQualityWidthPx(preset, moduleW, moduleH);
  const qualityW = Math.max(1, Math.floor(widthLimit / moduleW));
  // 官方带载表是权威档：有明确卡档时以官方宽度为准；质量宽度经验值仅在官方表缺该卡档时兜底估算。
  let w = Number(layout.w) >= 1 ? Number(layout.w) : qualityW;
  const h = Math.max(1, Number(layout.h || 1));
  // 下面两条是接收卡硬件物理极限（总点数 / 长边），任何来源的宽度都不得突破。
  while (w > 1 && w * moduleW * h * moduleH > range.maxPoints) w--;
  while (w > 1 && w * moduleW > range.longSide) w--;
  const plan = buildPortsAligned(cols, rows, moduleW, moduleH, w, h, true);
  return plan.maxPortPoints <= LIMIT
    ? { name, w, h, source: Number(layout.w) >= 1 ? "official-load-table" : "training-quality-width", qualityWidthPx: widthLimit, plan }
    : null;
}

function receiverModelPreference(name, preset) {
  // official C() tie order fixed R708->R712->R716; no indoor/outdoor split, no port tie-break
  void preset;
  const order = ["R708", "R712", "R716"];
  const index = order.indexOf(name);
  return index < 0 ? order.length : index;
}

function chooseCard(input, preset, cols, rows, moduleW, moduleH) {
  const stripLayout = (name) => {
    const range = RECEIVER_RANGES[name];
    if (!range || rows < 1 || rows * moduleH > range.shortSide) return null;
    const byLongSide = Math.floor(range.longSide / moduleW);
    const byPoints = Math.floor(range.maxPoints / (moduleW * moduleH * rows));
    const w = Math.min(cols, byLongSide, byPoints);
    return w >= 1 ? { name, w, h: rows, source: "official-strip-range" } : null;
  };
  if (input.preferredCard) {
    const layout = preset.cardLayouts?.[input.preferredCard];
    if (!layout) return null;
    if (rows > 1) {
      const quality = qualityReceiverCandidate(input.preferredCard, preset, cols, rows, moduleW, moduleH);
      if (quality) {
        const { plan, ...selected } = quality;
        return selected;
      }
    }
    const strip = stripLayout(input.preferredCard);
    if (strip && Math.ceil(cols / strip.w) < Math.ceil(cols / layout.w) * Math.ceil(rows / layout.h)) {
      return strip;
    }
    return { name: input.preferredCard, ...layout };
  }
  if (rows > 1 && preset.iface === "HUB75") {
    const qualityCandidates = ["R708", "R712", "R716"]
      .map((name) => qualityReceiverCandidate(name, preset, cols, rows, moduleW, moduleH))
      .filter(Boolean);
    qualityCandidates.sort((a, b) =>
      a.plan.cardCount - b.plan.cardCount
      || receiverModelPreference(a.name, preset) - receiverModelPreference(b.name, preset)
    );
    if (qualityCandidates.length) {
      const { plan, ...selected } = qualityCandidates[0];
      return selected;
    }
  }
  const layout = preset.cardLayouts?.[preset.card] || { w: preset.cardW, h: preset.cardH };
  if (preset.card === "R716" && layout.w === 1 && layout.h === 16) {
    const candidates = [
      { name: "R716", w: 1, h: 16 },
      { name: "R712", w: 1, h: 12 },
      stripLayout("R716"),
      stripLayout("R712")
    ].filter(Boolean)
      .filter((item, index, all) =>
        all.findIndex((other) => other.name === item.name && other.w === item.w && other.h === item.h) === index
      )
      .map((item) => ({ ...item, plan: buildPorts(cols, rows, moduleW, moduleH, item.w, item.h) }))
      .filter((item) => item.plan.maxPortPoints <= LIMIT);
    const preference = (item) => {
      if (rows * moduleH <= RECEIVER_RANGES.R712.shortSide) {
        return item.name === "R712" && item.source === "official-strip-range" ? 0 : 2;
      }
      if (rows <= 12) return item.name === "R712" && item.w === 1 ? 0 : 2;
      return item.name === "R716" ? 2 : 3;
    };
    candidates.sort((a, b) =>
      a.plan.ports.length - b.plan.ports.length
      || a.plan.cardCount - b.plan.cardCount
      || preference(a) - preference(b)
      || b.w - a.w
    );
    if (candidates.length) {
      const { plan, ...selected } = candidates[0];
      return selected;
    }
  }
  return { name: preset.card, ...layout };
}

function controllerProfile(item, mode = "async") {
  if (!item) return null;
  const modeProfile = item.modeProfiles?.[mode];
  return modeProfile ? { ...item, ...modeProfile, capabilities: item.capabilities || {} } : item;
}

function controllerSupportsRequestedFeatures(item, input = null) {
  if (!input) return true;
  const requestedInterfaces = Array.isArray(input.inputInterfaces) ? input.inputInterfaces : [];
  const capabilities = item?.capabilities || {};
  if (requestedInterfaces.length && Array.isArray(capabilities.inputInterfaces)) {
    const available = new Set((capabilities.inputInterfaces || []).flatMap((value) => {
      const normalized = String(value).toUpperCase();
      const tokens = ["HDMI", "DP", "DVI", "SDI", "CVBS", "VGA", "USB"]
        .filter((token) => normalized.includes(token));
      return [normalized, ...tokens];
    }));
    if (!requestedInterfaces.every((value) => available.has(String(value).toUpperCase()))) return false;
  }
  if (input.windowCount && Number.isFinite(capabilities.windowCount) && input.windowCount > capabilities.windowCount) return false;
  for (const field of ["usbPlayback", "cloudControl", "cellular", "wirelessCasting", "androidApps", "mixedPlayback", "posterPlayback"]) {
    if (input[field] && capabilities[field] === false) return false;
  }
  return true;
}

function controllerCapabilityGaps(item, input = null) {
  if (!item || !input) return [];
  const gaps = [];
  const capabilities = item.capabilities || {};
  if (input.inputInterfaces?.length && !Array.isArray(capabilities.inputInterfaces)) gaps.push("输入接口");
  if (input.windowCount && !Number.isFinite(capabilities.windowCount)) gaps.push("窗口数量");
  const labels = {
    usbPlayback: "U盘播放", cloudControl: "云控", cellular: "蜂窝网络",
    wirelessCasting: "无线投屏", androidApps: "安卓应用", mixedPlayback: "同异步混播", posterPlayback: "海报播放"
  };
  for (const [field, label] of Object.entries(labels)) {
    if (field === "usbPlayback" && item.communications?.includes("usb")) continue;
    if (input[field] && capabilities[field] === undefined) gaps.push(label);
  }
  return gaps;
}

function controllerFits(item, totalPx, portCount, screenW, screenH, input = null, mode = "async") {
  const profile = controllerProfile(item, mode);
  // HDSet defines same-device port backup as paired output ports and halves the
  // available device load range. Port count alone is not enough for products
  // whose rated total is lower than ports * per-port capacity.
  const effectiveMax = input?.portBackup ? profile?.max / 2 : profile?.max;
  return Boolean(
    profile
    && profile.capabilityComplete !== false
    && totalPx <= effectiveMax
    && portCount <= profile.ports
    && (!profile.maxW || screenW <= profile.maxW)
    && (!profile.maxH || screenH <= profile.maxH)
    && controllerSupportsRequestedFeatures(profile, input)
  );
}

// 同数字系列里的“版本新旧分”（与快查站 suffixRecency 同一口径，越大越新）：
// C最新 > H高配 > S次新 > T > A改款 > L低配 > 其它衍生 > 无后缀裸款最早。
// 只取数字主体后的第一个字母；A5L 这类整体落在 L，同档之间再靠能力区分。
function controllerSuffixRecency(name) {
  const bare = String(name || "").replace(/^HD[\s-]?/i, "").toUpperCase();
  const head = bare.match(/^[A-Z]+\d+([A-Z])/)?.[1] || "";
  if (head === "C") return 40;
  if (head === "H") return 30;
  if (head === "S") return 20;
  if (head === "T") return 18;
  if (head === "A") return 16;
  if (head === "L") return 14;
  if (head) return 10;
  return 0;
}

// 数字系列键（与快查站 seriesKeyOf 同口径）：VP210H/VP210S -> VP210；A3L/A4L -> A3/A4（不同系列）
function controllerSeriesKey(name) {
  const nm = String(name || "").replace(/^HD[\s-]?/i, "").toUpperCase();
  const m = nm.match(/^([A-Z]+)[\s-]?(\d+)/);
  if (!m) return "";
  const digits = m[2];
  return m[1] + digits.slice(0, digits.length >= 3 ? 3 : digits.length);
}

function automaticController(list, totalPx, portCount, screenW, screenH, input, mode = "async") {
  return list
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.autoEligible !== false && controllerFits(item, totalPx, portCount, screenW, screenH, input, mode))
    .sort((left, right) => {
      // 1) 客户额外要求（接口/窗口等）满足得更全的优先
      const gapDiff = controllerCapabilityGaps(controllerProfile(left.item, mode), input).length
        - controllerCapabilityGaps(controllerProfile(right.item, mode), input).length;
      if (gapDiff) return gapDiff;
      // 2) 仅同一数字系列的不同后缀款（VP210S/VP210H、VP410S/VP410H）才比新旧，最新优先；
      //    不同系列（VP210 vs VP410、A3L vs A4L）维持列表既定能力档顺序，做到不越级、不打乱异步档序
      if (controllerSeriesKey(left.item.name) === controllerSeriesKey(right.item.name)) {
        return (controllerSuffixRecency(right.item.name) - controllerSuffixRecency(left.item.name)) || left.index - right.index;
      }
      return left.index - right.index;
    })[0]?.item;
}

function planCoverageMatches(plan, totalPx) {
  return Boolean(plan && Number.isFinite(plan.actualCoveredPoints) && plan.actualCoveredPoints === totalPx);
}

function requiredControllerPorts(input, plan) {
  const primaryPorts = Number(plan?.ports?.length || 0);
  return input?.portBackup ? primaryPorts * 2 : primaryPorts;
}

function orderingRiskFlags(input) {
  const flags = [];
  if (input?.shapeMode && input.shapeMode !== "rectangular") flags.push("creative_mapping");
  if (input?.highRefresh || input?.hdr || input?.lowLatency || input?.highGray || input?.bitDepth >= 10) flags.push("performance_mode");
  if (input?.driverMode === "pwm") flags.push("pwm_load_mode");
  return flags;
}

function directOutputOption(controller, iface) {
  const directPorts = Number(controller?.outputs?.[iface] || 0);
  if (directPorts > 0) return { ports: directPorts, adapter: null };
  const adapter = controller?.adapters?.[iface];
  if (!adapter) return null;
  return { ports: Number(adapter.ports || 0), adapter };
}

function directSeriesRank(controller, communication, colorMode) {
  const currentPenalty = controller.current === false ? 10 : 0;
  if (colorMode === "full") return currentPenalty + (controller.series === "WF" ? 0 : 1);
  if (communication === "usb") return currentPenalty + (controller.series === "U" ? 0 : (controller.series === "W" ? 1 : 2));
  if (communication === "ethernet") return currentPenalty + (controller.series === "E" ? 0 : 1);
  if (communication === "wifi") return currentPenalty + (controller.series === "W" ? 0 : 1);
  return currentPenalty + (controller.series === "W" ? 0 : (controller.series === "U" ? 1 : 2));
}

function directEffectivePoints(controller, totalPx, colorMode) {
  // 单色/双色：官方 points 即物理点数上限，不再按颜色加倍（否则同档卡被低估一档，与官方选型结果不一致）
  if (colorMode !== "full") return totalPx;
  // 全彩：WF/C/D 系列 points 已按全彩口径；其余系列按 RGB 三倍数据量折算
  return ["WF", "C", "D"].includes(controller.series) ? totalPx : totalPx * 3;
}

function calculateDirectController(input) {
  let moduleW = input.modulePixels?.[0] || 0;
  let moduleH = input.modulePixels?.[1] || 0;
  let assumedModulePreset = null;
  if ((!moduleW || !moduleH) && input.pitch) {
    const colorRows = choosePreset(input).filter((row) => {
      const label = String(row.label || "");
      if (input.colorMode === "single") return /单色/.test(label);
      if (input.colorMode === "dual") return /双色/.test(label);
      return /全彩/.test(label);
    });
    const pixelKeys = [...new Set(colorRows.map((row) => `${row.w}x${row.h}`))];
    if (colorRows.length && pixelKeys.length === 1) {
      assumedModulePreset = colorRows[0];
      moduleW = assumedModulePreset.w;
      moduleH = assumedModulePreset.h;
    }
  }
  let screenW = input.screenPixels?.[0] || 0;
  let screenH = input.screenPixels?.[1] || 0;
  let cols = input.moduleCount?.[0] || 0;
  let rows = input.moduleCount?.[1] || 0;
  if ((!screenW || !screenH) && cols && rows && moduleW && moduleH) {
    screenW = cols * moduleW;
    screenH = rows * moduleH;
  }
  if ((!screenW || !screenH) && input.meters && input.pitch) {
    screenW = Math.round(input.meters[0] * 1000 / input.pitch);
    screenH = Math.round(input.meters[1] * 1000 / input.pitch);
  }
  if ((!cols || !rows) && screenW && screenH && moduleW && moduleH) {
    cols = Math.ceil(screenW / moduleW);
    rows = Math.ceil(screenH / moduleH);
  }
  const missing = [];
  if (!screenW || !screenH) missing.push("整屏分辨率或模组排列");
  if (!input.iface) missing.push("HUB接口");
  if (!moduleH) missing.push("单元板分辨率");
  if (missing.length) return { ok: false, directControllerMode: true, input, missing, screenW, screenH, moduleW, moduleH, cols, rows, assumedModulePreset };

  const totalPx = screenW * screenH;
  const requiredOutputs = Math.max(1, rows || Math.ceil(screenH / moduleH));
  const featureFields = ["usbPlayback", "cloudControl", "cellular", "wirelessCasting", "androidApps", "mixedPlayback", "posterPlayback"];
  const hasUnsupportedFeatureRequest = (controller) => {
    const capabilities = controller.capabilities || {};
    if (input.inputInterfaces?.length) {
      const available = new Set((capabilities.inputInterfaces || []).map((value) => String(value).toUpperCase()));
      if (!input.inputInterfaces.every((value) => available.has(String(value).toUpperCase()))) return true;
    }
    if (input.windowCount && (!capabilities.windowCount || input.windowCount > capabilities.windowCount)) return true;
    return featureFields.some((field) => {
      if (!input[field]) return false;
      if (field === "usbPlayback" && controller.communications?.includes("usb")) return false;
      return capabilities[field] !== true;
    });
  };
  // 点名任意直连卡（含单双色 W/U/E/WF/G/S）都精确锁定该型号，不再只认 C/D 前缀
  const preferredDirectModel = DIRECT_CONTROLLER_NAMES.has(input.preferredProcessor || "") ? input.preferredProcessor : "";
  const evaluated = DIRECT_CONTROLLERS
    .filter((controller) => preferredDirectModel
      ? controller.name === preferredDirectModel
      : controller.autoEligible !== false && controller.current !== false)
    .map((controller) => {
    const output = directOutputOption(controller, input.iface);
    const effectivePoints = directEffectivePoints(controller, totalPx, input.colorMode);
    const communicationFits = !input.communication || controller.communications.includes(input.communication);
    const colorFits = controller.colors.includes(input.colorMode);
    // HUB50 为50针高密度排针口，经转接板分接多排，物理口数不等于屏高排线数（带载由点数/最大宽高保证，有口即可）；
    // HUB08/HUB12/HUB75 仍按屏高方向排线数逐口匹配。
    const portFits = !output ? false
      : (input.iface === "HUB50" ? output.ports >= 1 : output.ports >= requiredOutputs);
    const hardwareFits = Boolean(
      output
      && portFits
      && colorFits
      && effectivePoints <= controller.capacity
      && screenW <= controller.maxW
      && screenH <= controller.maxH
      && !hasUnsupportedFeatureRequest(controller)
    );
    return { controller, output, effectivePoints, hardwareFits, communicationFits };
  });
  const candidates = evaluated.filter((row) => row.hardwareFits && row.communicationFits);
  candidates.sort((a, b) =>
    directSeriesRank(a.controller, input.communication, input.colorMode) - directSeriesRank(b.controller, input.communication, input.colorMode)
    || a.controller.capacity - b.controller.capacity
    || a.output.ports - b.output.ports
  );
  if (!candidates.length) {
    return {
      ok: false, directControllerMode: true, input, missing: ["现有直控卡没有同时满足等效点数、最大宽高、通信方式和HUB输出数量"],
      screenW, screenH, moduleW, moduleH, cols, rows, totalPx, requiredOutputs, assumedModulePreset
    };
  }
  const selected = candidates[0];
  const alternatives = candidates.slice(1, 3).map((row) => ({ name: row.controller.name, adapter: row.output.adapter || null }));
  const communicationOptions = !input.communication && input.colorMode !== "full"
    ? ["wifi", "ethernet", "usb"].flatMap((communication) => {
      const options = evaluated
        .filter((row) => row.hardwareFits && row.controller.communications.includes(communication))
        .sort((a, b) =>
          directSeriesRank(a.controller, communication, input.colorMode) - directSeriesRank(b.controller, communication, input.colorMode)
          || a.controller.capacity - b.controller.capacity
          || a.output.ports - b.output.ports
        );
      if (!options.length) return [];
      const option = options[0];
      return [{ communication, name: option.controller.name, adapter: option.output.adapter || null }];
    })
    : [];
  return {
    ok: true,
    directControllerMode: true,
    input,
    screenW,
    screenH,
    moduleW,
    moduleH,
    cols,
    rows,
    totalPx,
    effectivePoints: selected.effectivePoints,
    requiredOutputs,
    controller: selected.controller,
    output: selected.output,
    alternatives,
    communicationOptions,
    assumedModulePreset
  };
}

function buildSplicerPlan(input, plan, totalPx, screenW, screenH) {
  const rule = TRAINING_RULES.splicer;
  if (!input.splicerRequested || !rule) return null;
  const outputGroups = Math.max(
    1,
    Math.ceil(totalPx / rule.maxPointsPerGroup),
    Math.ceil(screenW / rule.maxWPerGroup),
    Math.ceil(screenH / rule.maxHPerGroup),
    Math.ceil(plan.ports.length / rule.outputPortsPerGroup)
  );
  const signalCount = (pattern) => {
    const match = String(input.raw || "").match(pattern);
    return match ? Number(match[1]) : 0;
  };
  const signalCounts = {
    "4K": signalCount(/(\d+)\s*(?:个|路)?\s*4K\s*信号/i),
    "2K": signalCount(/(\d+)\s*(?:个|路)?\s*2K\s*信号/i),
    camera: signalCount(/(\d+)\s*(?:个|路)?\s*摄像头(?:信号)?/i)
  };
  const inputBoards = Object.entries(signalCounts).flatMap(([key, count]) => {
    const board = rule.inputBoardRules?.[key];
    if (!count || !board) return [];
    return [{ name: board.name, quantity: Math.ceil(count / board.signalsPerBoard) }];
  });
  const outputBoardQuantity = rule.outputBoardRule
    ? Math.ceil(outputGroups * rule.outputPortsPerGroup / rule.outputBoardRule.portsPerBoard)
    : 0;
  const sourceExampleSize = inputBoards.reduce((sum, item) => sum + item.quantity, 0) <= 3 && outputBoardQuantity <= 1;
  return {
    ...rule,
    outputGroups,
    signalCounts,
    inputBoards,
    outputBoardQuantity,
    chassis: sourceExampleSize ? rule.defaultChassis : "按板卡总数选择机箱"
  };
}

function calculateCore(input) {
  const consistency = validateInputConsistency(input);
  if (consistency.conflicts.length) {
    return {
      ok: false,
      partialType: "input_conflict",
      input,
      conflicts: consistency.conflicts,
      missing: ["请核对冲突项中的一个原始规格"]
    };
  }
  input.consistencyWarnings = consistency.warnings;
  const architecture = ["auto", "direct", "receiver"].includes(input.asyncArchitecture)
    ? input.asyncArchitecture
    : "auto";
  const preferredDirect = /^(?:C|D)/.test(input.preferredProcessor || "");
  const preferredReceiverFamily = /^(?:A|H)/.test(input.preferredProcessor || "");
  const preferredPosterController = /^B/.test(input.preferredProcessor || "");
  const preferredArchitectureProfile = ASYNC_DEVICE_ARCHITECTURES[input.preferredProcessor] || null;
  if (preferredPosterController) {
    return {
      ok: false,
      partialType: "special_controller_catalog",
      input,
      missing: [`${input.preferredProcessor}属于海报拼接屏专用控制卡，当前正式设备目录未提供可用于本屏自动选型的完整输出、场景和带载证据`]
    };
  }
  if (architecture === "direct" && input.preferredProcessor
    && (preferredReceiverFamily || preferredPosterController)) {
    return {
      ok: false,
      partialType: "input_conflict",
      input,
      conflicts: [`已指定板载HUB直控架构，但${input.preferredProcessor}不属于C/D板载HUB直控系列`],
      missing: ["请核对控制器系列或改为接收卡架构"]
    };
  }
  if (architecture === "receiver" && preferredDirect
    && !preferredArchitectureProfile?.architectures.includes("receiver")) {
    return {
      ok: false,
      partialType: "input_conflict",
      input,
      conflicts: [`已指定接收卡架构，但控制器${input.preferredProcessor}属于板载HUB直控系列；如为C16H级联接收卡场景，仍需设备目录中的级联能力记录`],
      missing: ["请确认采用板载HUB直控，还是接收卡级联架构"]
    };
  }
  const preferredDirectOnly = preferredDirect && !preferredArchitectureProfile?.architectures.includes("receiver");
  const shouldTryDirect = input.directControlMode
    || architecture === "direct"
    || (preferredDirect && architecture !== "receiver")
    || (architecture === "auto"
      && input.controlMode === "async"
      && !preferredReceiverFamily
      && !input.preferredCard
      && input.colorMode === "full"
      && input.iface === "HUB75");
  if (shouldTryDirect) {
    const directResult = calculateDirectController(input);
    directResult.asyncArchitecture = "direct";
    if (architecture === "auto" && !input.directControlMode && !preferredDirect) {
      directResult.input.asyncArchitectureAssumed = true;
    }
    if (directResult.ok || architecture === "direct" || preferredDirectOnly || input.directControlMode) return directResult;
  }
  if (!input.pitch && !input.modulePixels && !input.cabinetPixels) {
    return { ok: false, input, missing: ["LED点间距（如P1.25、P2、P2.5）"] };
  }
  const matches = input.cabinetCount ? [] : choosePreset(input);
  if (!input.pitch && !input.cabinetCount && (input.verifiedProfileGaps || []).some(p =>
    input.modulePixels && p.pixels[0] === input.modulePixels[0] && p.pixels[1] === input.modulePixels[1] && p.gaps.includes("点间距"))) {
    return { ok: false, input, missing: ["请补充点间距；相同像素模组可能属于不同带载档案"] };
  }
  if (!matches.length && !input.cabinetCount) {
    const verified = (input.verifiedProfileGaps || []).filter(p => input.modulePixels && p.pixels[0] === input.modulePixels[0] && p.pixels[1] === input.modulePixels[1]);
    if (verified.length) return { ok: false, input, missing: [...new Set(verified.flatMap(p => p.gaps))].map(s => `请核对已验证模组的${s}`) };
    const samePitch = MODULE_PRESETS.filter((row) => input.pitch && samePitchFamily(row.pitch, input.pitch));
    const availableSizes = [...new Set(samePitch.map((row) => `${row.w}×${row.h}`))];
    const detail = input.pitch && input.modulePixels && availableSizes.length ? `P${input.pitch} 我这边没对上这个分辨率的模组规格。请补充：单块模组像素是多少（如 128×64），或者告诉我点间距和模组尺寸，我重新配。` : "模组分辨率、接口或点间距与现有带载表不匹配";
    return { ok: false, input, missing: [detail] };
  }
  if (!input.cabinetCount && input.preferredCard && matches.length
    && !matches.some((row) => row.cardLayouts?.[input.preferredCard])) {
    const supportedCards = [...new Set(matches.flatMap((row) => Object.keys(row.cardLayouts || {})))];
    return {
      ok: false,
      partialType: "unsupported_receiver",
      input,
      preset: matches[0],
      supportedCards,
      missing: [`正式带载表未记录 ${input.preferredCard} 对当前模组的带载方式`]
    };
  }
  const identityCount = new Set(matches.map(presetIdentityKey)).size;
  const canUseUniquePresetAssumption = identityCount === 1
    && input.modulePixelsAssumed
    && Boolean(input.moduleCount || input.screenPixels || input.meters);
  if (canUseUniquePresetAssumption) input.presetAssumed = true;
  const missingIdentityFact = identityCount > 1
    ? mostUsefulPresetFact(matches)
    : "";
  if (!input.cabinetCount && missingIdentityFact && matches.length && !canUseUniquePresetAssumption) {
    const conditions = new Map();
    for (const row of matches) {
      const key = presetConditionKey(row);
      if (!conditions.has(key)) conditions.set(key, summarizePreset(row));
    }
    const candidates = [...conditions.values()];
    return {
      ok: false,
      partialType: "module_candidates",
      input,
      candidates,
      provisional: calculateProvisionalCandidate(input, candidates[0]),
      missingFact: missingIdentityFact,
      missing: [`请确认${missingIdentityFact}`]
    };
  }
  const resolvedPreset = matches.length ? resolvePresetMatches(matches) : null;
  if (!input.cabinetCount && resolvedPreset && !resolvedPreset.ok) {
    return {
      ok: false,
      partialType: "module_candidates",
      input,
      candidates: resolvedPreset.candidates,
      provisional: calculateProvisionalCandidate(input, resolvedPreset.candidates[0]),
      missingFact: resolvedPreset.missingFact,
      missing: [`请确认${resolvedPreset.missingFact}`]
    };
  }
  const preset = resolvedPreset?.preset || { label: input.pitch ? `P${input.pitch} 箱体` : "箱体方案", scan: "", iface: "", note: "" };

  if (input.cabinetCount) {
    const cabinetCols = input.cabinetCount[0], cabinetRows = input.cabinetCount[1];
    const cabinetCount = cabinetCols * cabinetRows;
    const receiversPerCabinet = Number(input.receiversPerCabinet || 1);
    if (!input.receiversPerCabinetExplicit) input.receiversPerCabinetAssumed = 1;
    if (!input.cabinetPinType) {
      input.cabinetPinType = DEFAULT_CABINET_PIN_TYPE;
      input.cabinetPinAssumed = DEFAULT_CABINET_PIN_TYPE;
    }
    const measuredCabinetPixels = input.cabinetPixels || (input.cabinetMm && input.pitch
      ? [Math.round(input.cabinetMm[0] / input.pitch), Math.round(input.cabinetMm[1] / input.pitch)]
      : null);
    let screenW = input.screenPixels?.[0] || 0, screenH = input.screenPixels?.[1] || 0;
    if ((!screenW || !screenH) && measuredCabinetPixels) {
      screenW = measuredCabinetPixels[0] * cabinetCols;
      screenH = measuredCabinetPixels[1] * cabinetRows;
    }
    if ((!screenW || !screenH) && input.meters && input.pitch) {
      screenW = Math.round(input.meters[0] * 1000 / input.pitch);
      screenH = Math.round(input.meters[1] * 1000 / input.pitch);
    }
    if (!screenW || !screenH) {
      return {
        ok: false, partialType: "cabinet", input, preset, cabinetCols, cabinetRows, cabinetCount,
        receiverQuantity: cabinetCount * receiversPerCabinet * (input.receiverCardBackup ? 2 : 1),
        missing: ["整屏分辨率、屏体物理尺寸，或单箱体分辨率"]
      };
    }
    const cabinetPxW = measuredCabinetPixels?.[0] || Math.ceil(screenW / cabinetCols);
    const cabinetPxH = measuredCabinetPixels?.[1] || Math.ceil(screenH / cabinetRows);
    const plan = buildPorts(cabinetCols, cabinetRows, cabinetPxW, cabinetPxH, 1, 1);
    plan.cabinetCount = cabinetCount;
    plan.receiversPerCabinet = receiversPerCabinet;
    plan.cardCount = cabinetCount * receiversPerCabinet;
    const totalPx = screenW * screenH;
    if (!planCoverageMatches(plan, totalPx)) {
      return {
        ok: false,
        partialType: "input_conflict",
        input,
        conflicts: [`箱体拓扑实际覆盖${plan.actualCoveredPoints}点，与整屏${totalPx}点不一致`],
        missing: ["请核对整屏分辨率、单箱分辨率和箱体数量"]
      };
    }
    const physicalPortCount = requiredControllerPorts(input, plan);
    const requestedDualModeSync = ASYNC_CONTROLLERS.find((item) => item.name === input.preferredProcessor && item.syncCapable);
    const syncProcessor = requestedDualModeSync
      ? (controllerFits(requestedDualModeSync, totalPx, physicalPortCount, screenW, screenH, input, "sync")
        ? { ...controllerProfile(requestedDualModeSync, "sync"), selectedMode: "sync" }
        : null)
      : (automaticController(PROCESSORS, totalPx, physicalPortCount, screenW, screenH, input, "sync")
        || (input.controlMode === "async" ? null : automaticController(SPLICERS, totalPx, physicalPortCount, screenW, screenH, input, "sync")));
    const isSplicer = Boolean(syncProcessor && syncProcessor.deviceClass === "splicer");
    const asyncProcessor = automaticController(ASYNC_CONTROLLERS, totalPx, physicalPortCount, screenW, screenH, input, "async");
    if (!syncProcessor && input.controlMode !== "async") return { ok: false, input, preset, missing: [`本屏需要 ${plan.ports.length} 路主用网口${input.portBackup ? `、双网口备份共占${physicalPortCount}口` : ""}，已超出单台同步处理器及最大拼接机箱的带载范围，请拆分系统。`] };
    const cabinetOption = input.cabinetPinType ? CABINET_RECEIVER_OPTIONS[input.cabinetPinType] : null;
    if (cabinetOption && input.preferredCard && !cabinetOption.candidates.includes(input.preferredCard)) {
      return {
        ok: false,
        partialType: "input_conflict",
        input,
        conflicts: [`${input.cabinetPinType}箱体接口的已核验候选为${cabinetOption.candidates.join("/")}，与指定${input.preferredCard}不一致`],
        missing: ["请核对箱体接口或接收卡型号"]
      };
    }
    const card = {
      name: cabinetOption ? (input.preferredCard || cabinetOption.primary) : "箱体接收卡型号待确认",
      w: 1,
      h: 1,
      candidates: cabinetOption?.candidates || [],
      confirmed: Boolean(cabinetOption) && !input.cabinetPinAssumed
    };
    const meters = input.cabinetMm
      ? [input.cabinetMm[0] * cabinetCols / 1000, input.cabinetMm[1] * cabinetRows / 1000]
      : (input.pitch ? [screenW * input.pitch / 1000, screenH * input.pitch / 1000] : input.meters);
    const splicer = buildSplicerPlan(input, plan, totalPx, screenW, screenH);
    return {
      ok: true, cabinetMode: true, input, preset, moduleW: cabinetPxW, moduleH: cabinetPxH,
      cols: cabinetCols, rows: cabinetRows, cabinetCols, cabinetRows, cabinetCount,
      screenW, screenH, totalPx, card, plan,
      receiversPerCabinet,
      receiverQuantity: plan.cardCount * (input.receiverCardBackup ? 2 : 1),
      controllerQuantity: input.senderCardBackup ? 2 : 1,
      physicalPortCount,
      riskFlags: orderingRiskFlags(input),
      processor: input.controlMode === "async" ? (asyncProcessor || syncProcessor) : syncProcessor,
      processorValid: true, syncProcessor, syncValid: Boolean(syncProcessor), isSplicer,
      asyncProcessor, asyncValid: Boolean(asyncProcessor), meters,
      cabinetMm: input.cabinetMm,
      cabinetPixels: [cabinetPxW, cabinetPxH],
      splicer
    };
  }

  if (!input.moduleCount && !input.screenPixels && !input.meters) {
    return { ok: false, input, preset, missing: ["屏体模组排列、屏体像素宽高或屏体物理尺寸"] };
  }
  const moduleW = input.modulePixels?.[0] || preset.w, moduleH = input.modulePixels?.[1] || preset.h;
  const presetModuleMm = [
    Number(preset.mmW || 0) || (preset.w && preset.pitch ? preset.w * preset.pitch : 0),
    Number(preset.mmH || 0) || (preset.h && preset.pitch ? preset.h * preset.pitch : 0)
  ];
  const modulePhysicalW = (!input.moduleMmDerived && input.moduleMm?.[0])
    || presetModuleMm[0]
    || input.moduleMm?.[0]
    || (moduleW * input.pitch);
  const modulePhysicalH = (!input.moduleMmDerived && input.moduleMm?.[1])
    || presetModuleMm[1]
    || input.moduleMm?.[1]
    || (moduleH * input.pitch);
  let cols = input.moduleCount?.[0] || 0, rows = input.moduleCount?.[1] || 0;
  let moduleCountBasis = input.moduleCount
    ? { source: "explicit", requested: [...input.moduleCount], counts: [...input.moduleCount], rounded: false }
    : null;
  if ((!cols || !rows) && input.meters && modulePhysicalW && modulePhysicalH
    && (!input.screenPixels || input.screenPixelsDerived)) {
    const colInference = inferWholeModuleCount(input.meters[0] * 1000, modulePhysicalW);
    const rowInference = inferWholeModuleCount(input.meters[1] * 1000, modulePhysicalH);
    cols = colInference.count;
    rows = rowInference.count;
    const actualMm = [cols * modulePhysicalW, rows * modulePhysicalH];
    moduleCountBasis = {
      source: "screen_physical",
      requested: [input.meters[0] * 1000, input.meters[1] * 1000],
      counts: [cols, rows],
      actual: actualMm,
      alternatives: {
        inward: [colInference.floor, rowInference.floor],
        outward: [colInference.ceil, rowInference.ceil]
      },
      rounded: !colInference.exact || !rowInference.exact
    };
    input.dimensionInferences = input.dimensionInferences || [];
    input.dimensionInferences.push(moduleCountBasis.rounded
      ? `整屏尺寸按完整模组向外上取整为${cols}宽×${rows}高，成屏约${Number(actualMm[0].toFixed(3))}×${Number(actualMm[1].toFixed(3))}mm`
      : `整屏尺寸÷标准模组${Number(modulePhysicalW.toFixed(3))}×${Number(modulePhysicalH.toFixed(3))}mm，得到${cols}宽×${rows}高`);
  }
  if ((!cols || !rows) && input.screenPixels) {
    const colInference = inferWholeModuleCount(input.screenPixels[0], moduleW);
    const rowInference = inferWholeModuleCount(input.screenPixels[1], moduleH);
    cols = colInference.count;
    rows = rowInference.count;
    const actualPixels = [cols * moduleW, rows * moduleH];
    moduleCountBasis = {
      source: "screen_pixels",
      requested: [...input.screenPixels],
      counts: [cols, rows],
      actual: actualPixels,
      alternatives: {
        inward: [colInference.floor, rowInference.floor],
        outward: [colInference.ceil, rowInference.ceil]
      },
      rounded: !colInference.exact || !rowInference.exact
    };
    input.dimensionInferences = input.dimensionInferences || [];
    input.dimensionInferences.push(moduleCountBasis.rounded
      ? `整屏分辨率按完整模组向外上取整为${cols}宽×${rows}高，成屏${actualPixels[0]}×${actualPixels[1]}点`
      : `整屏分辨率÷单模组${moduleW}×${moduleH}点，得到${cols}宽×${rows}高`);
  }
  if ((!cols || !rows) && input.meters && input.pitch) {
    const colInference = inferWholeModuleCount(input.meters[0] * 1000 / input.pitch, moduleW);
    const rowInference = inferWholeModuleCount(input.meters[1] * 1000 / input.pitch, moduleH);
    cols = colInference.count;
    rows = rowInference.count;
    moduleCountBasis = {
      source: "screen_physical_pitch",
      requested: [input.meters[0] * 1000, input.meters[1] * 1000],
      counts: [cols, rows],
      actual: [cols * moduleW * input.pitch, rows * moduleH * input.pitch],
      alternatives: {
        inward: [colInference.floor, rowInference.floor],
        outward: [colInference.ceil, rowInference.ceil]
      },
      rounded: !colInference.exact || !rowInference.exact
    };
  }
  if (!cols || !rows) return { ok: false, input, preset, missing: ["屏体模组排列、屏体像素宽高或屏体物理尺寸"] };
  const screenW = cols * moduleW, screenH = rows * moduleH, totalPx = screenW * screenH;
  const card = chooseCard(input, preset, cols, rows, moduleW, moduleH);
  if (!card) return { ok: false, input, preset, missing: [`正式带载表未记录 ${input.preferredCard} 对当前 ${preset.label}（${preset.scan}、${preset.iface}）的带载方式，请改用表内接收卡或补充项目依据。`] };
  const allowOfficialPorts = card.source !== "official-strip-range";
  const plan = buildPortsAligned(cols, rows, moduleW, moduleH, card.w, card.h, allowOfficialPorts);
  if (!planCoverageMatches(plan, totalPx)) {
    return {
      ok: false,
      partialType: "input_conflict",
      input,
      conflicts: [`接收卡拓扑实际覆盖${plan.actualCoveredPoints}点，与整屏${totalPx}点不一致`],
      missing: ["请核对整屏分辨率、模组分辨率和模组数量"]
    };
  }
  const physicalPortCount = requiredControllerPorts(input, plan);
  const fittingSyncProcessor = automaticController(PROCESSORS, totalPx, physicalPortCount, screenW, screenH, input, "sync");
  // 处理器池盖不住（超大屏）时，升拼接机箱池取最小满足档；仅同步系统、且非客户显式指定型号时自动升档
  const fittingSplicer = (fittingSyncProcessor || input.controlMode === "async")
    ? null
    : automaticController(SPLICERS, totalPx, physicalPortCount, screenW, screenH, input, "sync");
  const requestedSync = PROCESSORS.find((item) => item.name === input.preferredProcessor);
  const requestedDualModeSync = ASYNC_CONTROLLERS.find((item) => item.name === input.preferredProcessor && item.syncCapable);
  const requestedSyncValid = controllerFits(requestedSync, totalPx, physicalPortCount, screenW, screenH, input, "sync");
  const requestedDualModeSyncValid = controllerFits(requestedDualModeSync, totalPx, physicalPortCount, screenW, screenH, input, "sync");
  let syncProcessor = requestedDualModeSync
    ? (requestedDualModeSyncValid ? { ...controllerProfile(requestedDualModeSync, "sync"), selectedMode: "sync" } : null)
    : (requestedSyncValid ? requestedSync : (fittingSyncProcessor || fittingSplicer));
  const syncValid = Boolean(syncProcessor);
  const isSplicer = Boolean(syncProcessor && syncProcessor.deviceClass === "splicer");
  if (!syncProcessor && input.controlMode !== "async") return { ok: false, input, preset, missing: [`本屏需要 ${plan.ports.length} 路主用网口${input.portBackup ? `、双网口备份共占${physicalPortCount}口` : ""}、${(totalPx / 10000).toFixed(4)} 万点，已超出单台同步处理器及最大拼接机箱的带载范围，请拆分系统或人工确认设备组合。`] };
  let asyncProcessor = automaticController(ASYNC_CONTROLLERS, totalPx, physicalPortCount, screenW, screenH, input, "async");
  const requestedAsync = ASYNC_CONTROLLERS.find((item) => item.name === input.preferredProcessor);
  if (requestedAsync) asyncProcessor = controllerFits(requestedAsync, totalPx, physicalPortCount, screenW, screenH, input, "async") ? requestedAsync : null;
  const asyncValid = controllerFits(asyncProcessor, totalPx, physicalPortCount, screenW, screenH, input, "async");
  const processor = input.controlMode === "async"
    ? (asyncProcessor || { name: "异步播放器待确认", provisional: true })
    : syncProcessor;
  const processorValid = input.controlMode === "async" ? asyncValid : syncValid;
  const meters = modulePhysicalW && modulePhysicalH
    ? [cols * modulePhysicalW / 1000, rows * modulePhysicalH / 1000]
    : (input.pitch ? [screenW * input.pitch / 1000, screenH * input.pitch / 1000] : null);
  const splicer = buildSplicerPlan(input, plan, totalPx, screenW, screenH);
  return {
    ok: true, input, preset, moduleW, moduleH, cols, rows, screenW, screenH, totalPx, card, plan,
    modulePhysicalW, modulePhysicalH, moduleCountBasis,
    receiverQuantity: plan.cardCount * (input.receiverCardBackup ? 2 : 1),
    controllerQuantity: input.senderCardBackup ? 2 : 1,
    physicalPortCount,
    riskFlags: orderingRiskFlags(input),
    processor, processorValid, syncProcessor, syncValid, isSplicer, asyncProcessor, asyncValid, meters, splicer
  };
}

function resultAssumptions(result) {
  const input = result.input || {};
  const assumptions = [];
  const add = (condition, text) => { if (condition && !assumptions.includes(text)) assumptions.push(text); };
  add(input.presetAssumed || input.modulePixelsAssumed, "模组完整规格未唯一确认，采用最可能的已验证记录暂算");
  add(input.interfaceAssumed, `HUB接口未明确，暂按${input.interfaceAssumed}计算`);
  add(input.environmentAssumed && !result.cabinetMode, "使用环境未明确，暂按常见户内记录匹配");
  add(input.scanAffectsCapacity && !input.scanMatched, `扫描方式未命中，已在${(input.scanOptions || []).join("/") || "已验证记录"}中采用较保守带载`);
  add(result.preset?.conflictResolution === "conservative", "同规格资料存在多种带载，采用已验证记录中的保守值");
  add(input.screenDimensionAssumption, input.screenDimensionAssumption);
  add(result.moduleCountBasis?.rounded, "目标尺寸不能整除模组，按不小于目标的完整模组向外上取整");
  add(input.cabinetPinAssumed, `箱体PIN未确认，暂按${input.cabinetPinAssumed}接口预配`);
  add(input.receiversPerCabinetAssumed, `每箱接收卡数量未确认，暂按每箱${input.receiversPerCabinetAssumed}卡`);
  add(input.asyncArchitectureAssumed, `异步架构未明确，暂按${result.asyncArchitecture === "direct" ? "板载HUB直控" : "接收卡架构"}分流`);
  add(result.assumedModulePreset, "直控方案的单元板记录为暂定匹配");
  add(result.communicationOptions?.length, "节目发布方式未确认，控制器系列仍为暂定");
  add(result.processor?.provisional || (result.ok && !result.directControllerMode && result.input?.controlMode === "async" && !result.asyncValid), "异步控制设备能力尚未完整满足或确认");
  const selectedController = result.directControllerMode ? result.controller : result.processor;
  add(selectedController?.lifecycle === "legacy" || selectedController?.current === false, `${selectedController?.name || "所选设备"}属于旧型号，仅按客户明确指定暂配，需核对现场实物与库存版本`);
  add(selectedController?.catalogNeedsConfirmation, `${selectedController?.name || "所选设备"}采用当前官网规格计算，但旧资料存在参数或版本差异，现场型号仍需确认`);
  const capabilityGaps = controllerCapabilityGaps(selectedController, input);
  add(capabilityGaps.length, `设备目录尚未核实当前型号的${capabilityGaps.join("、")}能力，硬带载先按总点、宽高和网口完成`);
  return assumptions;
}

function confirmationForResult(result, assumptions) {
  const input = result.input || {};
  if (result.partialType === "input_conflict") return result.missing?.[0] || "请核对冲突的原始规格。";
  if (input.scanAffectsCapacity && !input.scanMatched) return `请确认模组实际扫描方式是${(input.scanOptions || []).join("还是") || "多少扫"}？`;
  if (input.cabinetPinAssumed) return `请确认箱体实物PIN定义是否为${input.cabinetPinAssumed}？`;
  if (input.receiversPerCabinetAssumed) return `请确认每个箱体实际安装几张接收卡？`;
  if (input.presetAssumed || input.modulePixelsAssumed) return "请补充模组完整型号或配置文件名，以锁定正式带载记录。";
  if (input.interfaceAssumed) return `请确认模组实际接口是否为${input.interfaceAssumed}？`;
  if (input.asyncArchitectureAssumed) return "请确认异步系统采用板载HUB直控，还是通过接收卡带屏？";
  const selectedController = result.directControllerMode ? result.controller : result.processor;
  if (selectedController?.lifecycle === "legacy" || selectedController?.current === false) return `请确认现场实物和库存确为旧型号${selectedController.name}？`;
  if (selectedController?.catalogNeedsConfirmation) return `请确认现场设备确为${selectedController.name}当前官网对应版本？`;
  const capabilityGaps = controllerCapabilityGaps(selectedController, input);
  if (capabilityGaps.length) return `请确认目标设备是否具备${capabilityGaps.join("、")}能力？`;
  if (result.communicationOptions?.length) return "请确认节目发布使用Wi-Fi、网线还是U盘？";
  if (!result.ok) return result.missing?.[0] || "请补充当前方案缺少的关键规格。";
  return assumptions.length ? "请确认上述暂定条件是否与现场实物一致？" : "";
}

// 客户未说明同步/异步时，异步候选与所选同步处理器“对位”：
// 输出网口数相同、带载不低于同步档（VP210H 130万/2口 ↔ A5L 130万/2口；VP410H 260万/4口 ↔ A6L 262万/4口；VP630 ↔ H6），
// 让二选一的两台主控接线拓扑与能力档一致；无完全对位时逐级放宽，绝不写死某一款。
function unspecifiedAsyncCandidate(r) {
  if (!r || r.input?.controlMode !== "unspecified") return null;
  const sync = r.syncProcessor;
  if (!sync) return null;
  const syncPorts = Number(sync.ports || 0);
  const syncMax = Number(sync.max || 0);
  // 对位基准口数=本屏实际占用的物理网口数。同步处理器最小档就是2口(VP210)，单口小屏同步侧也只能给2口，
  // 但播放盒有1口A4L；按实际口数对位才能让单口(≤65万)小屏下沉到最省的A4L（官网：取盖得住的最小档），
  // 2口及以上仍对位到同档播放盒(A5L/A6L/H6…)，接线拓扑与接收卡数量不变。
  const alignPorts = Math.max(1, Number(r.physicalPortCount || syncPorts || 1));
  const asyncProfile = (c) => controllerProfile(c, "async");
  // 仅同异步播放盒(A4L/A5L/A6L/H6/A7/H8/A8…)参与“与同步对位、一句话轻带”：文案称“异步播放盒”，
  // 且双模可同异步切换、与官网 playBox 大类一致；A30+/A3L 等纯异步控制卡不在此列（明确要异步时另走 automaticController）。
  const fits = ASYNC_CONTROLLERS.filter((c) =>
    c.autoEligible !== false
    && c.deviceClass === "dual-mode-player"
    && controllerFits(c, r.totalPx, r.physicalPortCount, r.screenW, r.screenH, r.input, "async"));
  if (!fits.length) return null;
  const orderRank = (n) => { const i = ASYNC_CONTROLLER_ORDER.indexOf(n); return i < 0 ? 999 : i; };
  const byCloseness = (a, b) =>
    (Number(asyncProfile(a).max || 0) - Number(asyncProfile(b).max || 0)) || orderRank(a.name) - orderRank(b.name);
  // 1) 口数=实际口数且带载不低于同步档：真正对位款（多口屏仍取与处理器同档的播放盒）
  let pool = fits.filter((c) => { const p = asyncProfile(c); return Number(p.ports) === alignPorts && Number(p.max) >= syncMax; });
  // 2) 口数=实际口数、至少带得动本屏（fits 已保证 max≥总点、口数≥物理口数）；单口小屏在此取到1口A4L
  if (!pool.length) pool = fits.filter((c) => Number(asyncProfile(c).ports) === alignPorts);
  // 3) 异步无同口数档时向上兼容（如同步10/12口、异步只有16口，则取16口，口数不少于实际口数）
  if (!pool.length) pool = fits.filter((c) => Number(asyncProfile(c).ports) >= alignPorts);
  if (!pool.length) pool = fits;
  if (!pool.length) return null;
  return [...pool].sort(byCloseness)[0];
}

function buildBom(result) {
  const input = result.input || {};
  const items = [];
  const optionalMaterials = [];
  if (result.ok && result.directControllerMode) {
    if (result.cols && result.rows) {
      const moduleModel = result.assumedModulePreset?.label
        || (input.pitch ? `P${input.pitch} ${result.moduleW}×${result.moduleH}点模组` : "LED模组");
      items.push({ category: "module", model: moduleModel, quantity: result.cols * result.rows, unit: "张", status: result.assumedModulePreset ? "provisional" : "calculated" });
    }
    items.push({ category: "controller", model: directControllerName(result), quantity: 1, unit: "台", status: result.controller?.catalogNeedsConfirmation || result.controller?.lifecycle === "legacy" ? "provisional" : "calculated" });
  } else if (result.ok) {
    if (result.cabinetMode) {
      items.push({ category: "cabinet", model: result.preset?.label || "自定义箱体", quantity: result.cabinetCount, unit: "个", status: "calculated" });
    } else {
      items.push({ category: "module", model: result.preset?.label || "LED模组", quantity: result.cols * result.rows, unit: "张", status: "calculated" });
    }
    if (result.card?.name) {
      items.push({ category: "receiver", model: result.card.name, quantity: result.receiverQuantity, unit: "张", status: result.card.confirmed === false ? "provisional" : "calculated" });
    }
    if (result.processor?.name) {
      // 未说明同步/异步时，主控二选一：同步名/异步主推名（如 VP210S/A5L），数量仍按 1 套
      const asyncCand = unspecifiedAsyncCandidate(result);
      const controllerModel = asyncCand && asyncCand.name !== result.processor.name
        ? `${result.processor.name}/${asyncCand.name}`
        : result.processor.name;
      items.push({ category: "controller", model: controllerModel, quantity: result.controllerQuantity || 1, unit: "台", status: result.processor.provisional || result.processor.catalogNeedsConfirmation || result.processor.lifecycle === "legacy" ? "provisional" : "calculated" });
    }
  }
  if (result.cabinetMode) {
    if (input.spareCabinetQuantity) {
      optionalMaterials.push({ category: "spare_cabinet", label: "备用箱体", quantity: input.spareCabinetQuantity, unit: "个", status: "calculated" });
    } else {
      optionalMaterials.push({ category: "spare_cabinet", label: "备用箱体", status: "pending", note: "待项目确认" });
    }
  } else {
    if (input.spareModuleQuantity) {
      optionalMaterials.push({ category: "spare_module", label: "备用模组", quantity: input.spareModuleQuantity, unit: "张", status: "calculated" });
    } else if (input.spareModulePercent) {
      const baseQuantity = result.ok ? result.cols * result.rows : 0;
      optionalMaterials.push({ category: "spare_module", label: "备用模组", quantity: Math.ceil(baseQuantity * input.spareModulePercent / 100), unit: "张", percent: input.spareModulePercent, status: "calculated" });
    } else {
      optionalMaterials.push({ category: "spare_module", label: "备用模组", status: "pending", note: "待项目确认" });
    }
  }
  if (!result.directControllerMode) {
    if (input.spareReceiverQuantity) {
      optionalMaterials.push({ category: "spare_receiver", label: "备用接收卡", quantity: input.spareReceiverQuantity, unit: "张", status: "calculated" });
    } else if (input.spareReceiverPercent) {
      const baseQuantity = result.ok ? Number(result.plan?.cardCount || 0) : 0;
      optionalMaterials.push({ category: "spare_receiver", label: "备用接收卡", quantity: Math.ceil(baseQuantity * input.spareReceiverPercent / 100), unit: "张", percent: input.spareReceiverPercent, status: "calculated" });
    } else {
      optionalMaterials.push({ category: "spare_receiver", label: "备用接收卡", status: "pending", note: "待项目确认" });
    }
  }
  if (input.networkCableLength) {
    const runs = result.directControllerMode ? 0 : Number(result.physicalPortCount || result.plan?.ports?.length || 0);
    optionalMaterials.push({ category: "network_cable", label: "网线", runs, lengthPerRunMeters: input.networkCableLength, totalLengthMeters: runs * input.networkCableLength, unit: "米", status: "calculated" });
  } else {
    optionalMaterials.push({ category: "network_cable", label: "网线长度", requiredRuns: result.directControllerMode ? 0 : Number(result.physicalPortCount || result.plan?.ports?.length || 0), status: "pending", note: "待项目确认" });
  }
  if (input.powerSupplyQuantity) {
    optionalMaterials.push({ category: "power_supply", label: "电源", quantity: input.powerSupplyQuantity, unit: "台", status: "calculated" });
  } else {
    optionalMaterials.push({ category: "power_supply", label: "电源数量", status: "pending", note: "待项目确认" });
  }
  return { items, optionalMaterials };
}

function finalizeResultState(result) {
  const resolved = result.partialType === "module_candidates" && result.provisional?.ok
    ? { ...result.provisional, candidateSelection: result }
    : result;
  resolved.asyncArchitecture = resolved.asyncArchitecture || (resolved.directControllerMode ? "direct" : "receiver");
  const assumptions = resultAssumptions(resolved);
  const resultState = resolved.partialType === "input_conflict"
    ? "conflict"
    : (resolved.ok && assumptions.length === 0 ? "formal" : "provisional");
  return {
    ...resolved,
    resultState,
    status: resultState,
    assumptions,
    confirmationQuestion: confirmationForResult(resolved, assumptions),
    bom: buildBom(resolved)
  };
}

function calculate(input) {
  return finalizeResultState(calculateCore(input));
}

// 接收卡 R 序号 = 从显示屏正面看的物理位置号（每行从左到右、逐行向下），与 HDSet 一致。
// 蛇形只体现在走线方向：奇数行沿走线从右往左，故该口 R 范围会自然递减（如 口3 R30→R23）。
function positionRNumber(plan, row, col) {
  return row * plan.colGroups + col + 1; // 1 基位置号
}

function portCardLabels(result, port) {
  const expandCabinetReceivers = (cabinetIndex) => {
    const count = result.cabinetMode ? Number(result.receiversPerCabinet || 1) : 1;
    if (count === 1) return [`R${cabinetIndex + 1}`];
    return Array.from({ length: count }, (_, index) => `R${cabinetIndex * count + index + 1}`);
  };
  if (Array.isArray(port.cells)) {
    // port.cells 已按蛇形走线顺序排列；每格取物理位置号，首尾即沿走线方向的 R 范围（可能递减）
    return port.cells.flatMap((cell) => expandCabinetReceivers(positionRNumber(result.plan, cell.row, cell.col) - 1));
  }
  const labels = [];
  for (let row = port.row; row < port.row + port.rowCount; row++) {
    const forward = (row - port.row) % 2 === 0;
    const cols = Array.from({ length: port.count }, (_, i) => port.start + i);
    if (!forward) cols.reverse();
    for (const col of cols) labels.push(...expandCabinetReceivers(positionRNumber(result.plan, row, col) - 1));
  }
  return labels;
}

function formatBasis(input, preset) {
  if (!preset) return "";
  const mmW = input?.moduleMm?.[0] || preset.mmW || 0;
  const mmH = input?.moduleMm?.[1] || preset.mmH || 0;
  const pixels = input?.modulePixels || [preset.w, preset.h];
  const inferredPitch = !input?.pitch && input?.moduleMm && input?.modulePixels
    ? ((input.moduleMm[0] / input.modulePixels[0]) + (input.moduleMm[1] / input.modulePixels[1])) / 2
    : 0;
  const displayLabel = inferredPitch
    ? `实算点距约P${inferredPitch.toFixed(3)}（带载暂按${preset.label}相近记录）`
    : (preset.label || `P${input?.pitch || ""}`);
  const parts = [displayLabel];
  if (mmW && mmH) parts.push(`${mmW}×${mmH} mm`);
  if (pixels?.[0] && pixels?.[1]) parts.push(`${pixels[0]}×${pixels[1]}点`);
  if (preset.iface || input?.iface) parts.push(preset.iface || input.iface);
  if (input?.scan && input.scanMatched) parts.push(`${input.scan}扫描`);
  const lines = [`模组规格：${parts.join("、")}。`];
  const assumptions = [];
  if (input?.statedPitch && input.pitch && input.statedPitch !== input.pitch) {
    assumptions.push(`客户提供P${input.statedPitch}，本次暂按P${input.pitch}系列计算`);
  }
  if (input?.modulePixelsAssumed) {
    const assumed = [
      pixels?.[0] && pixels?.[1] ? `${pixels[0]}×${pixels[1]}点` : "",
      input?.interfaceAssumed ? "" : (preset.iface || input?.iface || "")
    ].filter(Boolean).join("、");
    assumptions.push(`你未提供完整模组规格，本次按${assumed}常规模组预配`);
  }
  if (input?.interfaceAssumed) {
    assumptions.push(`接口未说明，本次按${input.interfaceAssumed}预配`);
  }
  if (assumptions.length) lines.push(`规格说明：${assumptions.join("；")}；现场模组不同请发我实际规格重算。`);
  return lines.join("\n");
}

function orderedCardLayouts(preset, preferredCard = "") {
  const layouts = preset?.cardLayouts || {};
  const names = [preferredCard, "R712", "R716", "R708", "R732", "R500S", ...Object.keys(layouts)]
    .filter(Boolean);
  const seen = new Set();
  return names.filter((name) => layouts[name] && !seen.has(name) && seen.add(name))
    .map((name) => ({ name, ...layouts[name] }));
}

function formatCardLayoutSummary(preset, preferredCard = "", limit = 3) {
  return orderedCardLayouts(preset, preferredCard)
    .slice(0, limit)
    .map((item) => `${item.name}（每张带 ${item.w}×${item.h} 块模组）`)
    .join("；");
}

function formatPresetReference(preset, input, closingFact = "整屏宽×高") {
  if (!preset) return "";
  const mmW = preset.mmW || (preset.w && preset.pitch ? Number((preset.w * preset.pitch).toFixed(3)) : 0);
  const mmH = preset.mmH || (preset.h && preset.pitch ? Number((preset.h * preset.pitch).toFixed(3)) : 0);
  const moduleParts = [
    preset.label,
    mmW && mmH ? `${mmW}×${mmH}mm` : "",
    preset.w && preset.h ? `${preset.w}×${preset.h}点` : "",
    preset.scan && !String(preset.label || "").toUpperCase().includes(preset.scan) ? `${preset.scan}扫描` : "",
    preset.iface
  ].filter(Boolean);
  const lines = [`模组：${moduleParts.join("，")}。`];
  const layoutText = formatCardLayoutSummary(preset, input?.preferredCard);
  if (layoutText) lines.push(`接收卡：${layoutText}。`);
  lines.push(`把${closingFact}发我（几米、总像素或宽几张×高几张都行），就能给出设备型号、接收卡数量、网口和接线图。`);
  return lines.filter(Boolean).join("\n");
}

function formatCandidateReference(result) {
  const candidates = result.candidates || [];
  const primary = candidates[0];
  if (!primary) return "";
  const primaryPreset = {
    ...primary,
    w: primary.pixels?.[0] || 0,
    h: primary.pixels?.[1] || 0,
    mmW: primary.mm?.[0] || 0,
    mmH: primary.mm?.[1] || 0
  };
  const lines = formatPresetReference(primaryPreset, result.input).split("\n");
  const alternatives = candidates.slice(1, 3).map((candidate) => {
    const preset = {
      ...candidate,
      w: candidate.pixels?.[0] || 0,
      h: candidate.pixels?.[1] || 0,
      mmW: candidate.mm?.[0] || 0,
      mmH: candidate.mm?.[1] || 0
    };
    const details = [candidate.iface, formatCardLayoutSummary(preset, result.input?.preferredCard, 3)]
      .filter(Boolean).join("，");
    return `${candidate.label}${details ? `：${details}` : ""}`;
  });
  if (alternatives.length) lines.splice(Math.max(0, lines.length - 1), 0, `其他候选规格：${alternatives.join("；")}。`);
  return lines.filter(Boolean).join("\n");
}

function directControllerName(result, item = null) {
  const controller = item?.controller || result.controller;
  const output = item?.output || result.output;
  if (!controller) return "";
  if (!output?.adapter) return controller.name;
  const quantity = Number(output.adapter.quantity || 1);
  return `${controller.name} + ${output.adapter.name}${quantity > 1 ? `×${quantity}` : ""}`;
}

function formatDirectControllerReply(result) {
  const input = result.input || {};
  const colorLabel = DIRECT_COLOR_LABELS[input.colorMode] || "直控屏";
  const communicationLabel = COMMUNICATION_LABELS[input.communication]
    || (input.colorMode === "full" ? "按控制卡现有通信方式" : "Wi-Fi（未说明时主推）");
  if (!result.ok) {
    if (result.partialType === "input_conflict") {
      return [
        "已保留你给出的规格，但其中有一组数据不能同时成立，先不生成可能误导现场的数量。",
        ...result.conflicts.map((item, index) => `${index + 1}. ${item}`),
        "请只核对最关键的一项：铭牌/规格书上的点间距、物理尺寸和像素分辨率，哪一组是最终值？"
      ].join("\n");
    }
    const known = result.screenW && result.screenH
      ? `已先按${result.screenW}×${result.screenH}、${colorLabel}${input.iface ? `、${input.iface}` : ""}核算。`
      : `已识别为${colorLabel}直控卡选型。`;
    return [
      known,
      result.requiredOutputs ? `屏高需要约${result.requiredOutputs}个${input.iface}输出。` : "",
      `当前还不能给出可靠型号：${result.missing.join("、")}。`,
      "请核对整屏分辨率、单元板分辨率和HUB接口；补充后会直接给卡型，不会改走接收卡固件。"
    ].filter(Boolean).join("\n");
  }
  const lines = [
    `推荐控制卡：${directControllerName(result)}`,
    `屏体：${result.screenW}×${result.screenH}，${colorLabel}，实际${(result.totalPx / 10000).toFixed(4)}万点${result.effectivePoints !== result.totalPx ? `，按${(result.effectivePoints / 10000).toFixed(4)}万等效点校验` : ""}`,
    `接口：${input.iface}，屏高${result.rows}张单元板，需${result.requiredOutputs}个输出；通信：${communicationLabel}`
  ];
  if (result.assumedModulePreset) {
    lines.push(`单元板未写明时，先按带载表中的${result.assumedModulePreset.label}（${result.moduleW}×${result.moduleH}点）预配；现场不同再重算。`);
  }
  if (input.colorModeAssumed && /^HUB(?:08|12)$/.test(input.iface)) {
    lines.push("颜色未说明，因接口为HUB08/HUB12，本次按双色带载保守计算。");
  }
  if (result.communicationOptions?.length) {
    const optionText = result.communicationOptions.map((item) => {
      const output = item.adapter ? { adapter: item.adapter } : null;
      return `${COMMUNICATION_LABELS[item.communication]}：${directControllerName(result, { controller: { name: item.name }, output })}`;
    });
    lines.push(`按发布方式：${optionText.join("；")}`);
    lines.push("本次先按Wi-Fi主推。请确认发布节目使用Wi-Fi、网线还是U盘；确认后按对应系列定型。");
  } else if (result.alternatives.length) {
    const alternativeNames = result.alternatives.map((item) => {
      const output = item.adapter ? { adapter: item.adapter } : null;
      return directControllerName(result, { controller: { name: item.name }, output });
    });
    lines.push(`其他可用：${alternativeNames.join("、")}`);
  }
  lines.push("依据：《单双色产品介绍与选型V3.1》控制范围、最大宽高、通信方式及HUB接口表。");
  if (input.modulePixelsAssumed) lines.push(`本次按带载表命中的${input.pitch ? `P${input.pitch}` : ""}单元板记录（${result.moduleW}×${result.moduleH}点）暂算；现场规格不同再重算。`);
  return lines.join("\n");
}

function formatReplyCore(result) {
  if (result.directControllerMode) return formatDirectControllerReply(result);
  const basis = result.cabinetMode || result.partialType === "cabinet" ? "" : formatBasis(result.input, result.preset);
  if (!result.ok) {
    if (result.partialType === "input_conflict") {
      return [
        "已保留你给出的规格，但其中有一组数据不能同时成立，先不生成可能误导现场的数量。",
        ...result.conflicts.map((item, index) => `${index + 1}. ${item}`),
        "请只核对最关键的一项：铭牌/规格书上的点间距、物理尺寸和像素分辨率，哪一组是最终值？"
      ].join("\n");
    }
    if (result.partialType === "cabinet") {
      const backup = result.input.receiverCardBackup ? `，双接收卡备份共${result.receiverQuantity}张` : "";
      return [
        `先按箱体方案：箱体接收卡×${result.cabinetCount}，一箱一卡${backup}。`,
        `要完成发送设备、网口数和接线拓扑，还需要：${result.missing.join("、")}。`,
        basis
      ].filter(Boolean).join("\n");
    }
    if (result.partialType === "unsupported_receiver") {
      return [
        `已识别指定接收卡 ${result.input.preferredCard}，但正式带载表未记录 ${result.input.preferredCard} 对当前 ${result.preset?.label || "模组"} 的带载方式，不能自动换成其他接收卡。`,
        result.supportedCards?.length ? `当前表内有依据的卡型：${result.supportedCards.join("、")}。` : "",
        "如继续使用该卡，请以对应规格书或项目带载表补充每卡可带模组宽×高。"
      ].filter(Boolean).join("\n");
    }
    if (result.partialType === "module_candidates") {
      const provisionalForReply = result.provisional?.ok
        ? {
            ...result.provisional,
            input: {
              ...result.provisional.input,
              modulePixelsAssumed: Boolean(result.input?.modulePixelsAssumed || result.provisional.input?.modulePixelsAssumed)
            }
          }
        : null;
      const provisionalReply = provisionalForReply
        ? formatReply(provisionalForReply)
        : "";
      const alternativeCount = Math.max(0, Number(result.candidates?.length || 0) - 1);
      return [
        provisionalReply ? `先按正式带载表中最匹配的一条给出暂定方案：\n${provisionalReply}` : "",
        !provisionalReply ? formatCandidateReference(result) : "",
        provisionalReply && alternativeCount ? `同点间距另有${alternativeCount}种其他规格，暂不展开。` : "",
        provisionalReply && !result.input?.modulePixelsAssumed ? `若现场规格与上述暂定记录不同，最后补充${result.missingFact}即可重算。` : ""
      ].filter(Boolean).join("\n");
    }
    if (result.input?.modulePixelsAssumed) {
      return formatPresetReference(result.preset, result.input);
    }
    if (result.preset) {
      const layout = result.preset.cardLayouts?.[result.preset.card] || { w: result.preset.cardW, h: result.preset.cardH };
      return [
        `先给可用参考：${result.preset.label}，${result.preset.card} 按${layout.w}宽×${layout.h}高带载。`,
        `要完成整屏数量和接线拓扑，还需要：${result.missing.join("、")}。`,
        basis
      ].filter(Boolean).join("\n");
    }
    return [
      "先按当前已知条件准备配单；得到点间距后即可匹配正式带载表，再出接收卡、设备和拓扑方案。",
      `最后补充点间距和整屏宽×高（米、像素或模组排数任选一种）即可；当前已识别信息：${result.missing.join("、")}。`
    ].join("\n");
  }
  const r = result;
  const lines = [];
  const wantsAsyncRecommendation = r.input.controlMode === "async"
    || r.input.dualModeRequested
    || ASYNC_MODEL_NAMES.has(r.input.preferredProcessor);
  if (r.input.consistencyWarnings?.length) {
    lines.push(`规格提示：${r.input.consistencyWarnings.join("；")}。本次计算保留实算点间距，不把标称简称当精确值。`);
  }
  const controllerSuffix = r.controllerQuantity > 1 ? `×${r.controllerQuantity}（主备各1台）` : "";
  const receiverText = r.cabinetMode && r.card.confirmed === false
    ? `${r.card.name}（数量暂按${r.receiverQuantity}张，接口确认后定型）`
    : (r.input.receiverCardBackup
      ? `${r.card.name}×${r.receiverQuantity}（${r.plan.cardCount}张主用+${r.plan.cardCount}张备份）`
      : `${r.card.name}×${r.receiverQuantity}`);
  // 网线（网口）总数：主用网口数，双网口备份时按实际占用口数（与物料表网线口径一致）
  const cableRuns = Number(r.physicalPortCount || r.plan.ports?.length || 0);
  // 拼接机箱方案：只在网线≥30根时，于网口分配之后补充；小屏单台处理器即可，不在前面顶替推荐
  const buildSplicerLines = () => {
    if (!r.splicer || cableRuns < SPLICER_MIN_CABLES) return [];
    const inputBoardText = r.splicer.inputBoards.length
      ? r.splicer.inputBoards.map((item) => `${item.name}×${item.quantity}`).join("、")
      : "输入板卡按现场信号接口配置";
    const outputBoardText = r.splicer.outputBoardQuantity
      ? `${r.splicer.outputBoardRule.name}×${r.splicer.outputBoardQuantity}`
      : "网口输出板卡按输出组配置";
    return [
      `拼接方案：${r.splicer.model} ${r.splicer.chassis}，${r.splicer.outputGroups}路输出组（每组4网口）。`,
      `板卡：${inputBoardText}、${r.splicer.controlBoard}×1、${outputBoardText}。`
    ];
  };
  const unspecifiedAsync = unspecifiedAsyncCandidate(r);
  // 处理器推荐始终正常给出（不再因有拼接方案而被顶替）。客户没指定同/异步时只主推同步一套，
  // 异步在下面用一句话轻带，不把两套完整清单并排丢给客户自己选。
  if (r.input.controlMode !== "async" && r.syncProcessor) {
    const syncTag = r.input.controlMode === "unspecified"
      ? "推荐方案（同步·视频处理器）"
      : (r.isSplicer ? "拼接方案（超大屏）" : "同步方案");
    lines.push(`${syncTag}：${r.syncProcessor.name}${controllerSuffix} + ${receiverText}`);
  }
  if (r.input.preferredProcessor && !r.input.preferredProcessor.startsWith("A") && r.input.controlMode !== "async" && r.input.preferredProcessor !== r.syncProcessor.name) lines.push(`说明：指定的 ${r.input.preferredProcessor} 带载或网口数不足，已按当前屏体改用 ${r.syncProcessor.name}。`);
  if ((wantsAsyncRecommendation && r.asyncProcessor && r.asyncValid)
      || (r.input.controlMode === "unspecified" && unspecifiedAsync)) {
    if (r.input.controlMode === "unspecified") {
      // 未指定同/异步：异步只作一句可选项轻带（接收卡数量与同步方案相同），不并列完整 BOM
      if (unspecifiedAsync) lines.push(`若不需电脑实时同步、只用 U盘/WiFi/网络下发节目，也可改用异步播放盒 ${unspecifiedAsync.name}${controllerSuffix}（接收卡数量同上，通常更省）。`);
    } else {
      const asyncPick = r.asyncProcessor;
      const note = asyncPick.syncCapable ? "（支持同异步切换）" : "";
      lines.push(`异步方案：${asyncPick.name}${controllerSuffix} + ${receiverText}${note}`);
    }
  }
  if (r.input.controlMode === "async" && (!r.asyncProcessor || !r.asyncValid)) lines.push("当前没有宽度、高度、总点数和网口资料均完整且满足本屏的异步播放器，不能自动定型；请补充目标设备规格或拆分系统。");

  lines.push(`屏体：${r.screenW}×${r.screenH}，约${(r.totalPx / 10000).toFixed(2)}万点${r.meters ? `，约${r.meters[0].toFixed(3)}m×${r.meters[1].toFixed(3)}m` : ""}`);
  if (r.input.screenDimensionAssumption) lines.push(`尺寸口径：${r.input.screenDimensionAssumption}。`);
  if (r.cabinetMode) {
    const cabinetPhysical = r.cabinetMm ? `，${r.cabinetMm[0]}×${r.cabinetMm[1]}mm` : "";
    const cabinetPoints = r.moduleW * r.moduleH;
    lines.push(
      `箱体：${r.cabinetCols}宽×${r.cabinetRows}高，共${r.cabinetCount}个；单箱${r.moduleW}×${r.moduleH}点，${(cabinetPoints / 10000).toFixed(4)}万点${cabinetPhysical}；每箱${r.receiversPerCabinet || 1}卡`,
      `接收卡：主用${r.plan.cardCount}张${r.input.receiverCardBackup ? `，备份${r.plan.cardCount}张` : ""}`
    );
    const connectorLabel = { "gold-finger": "金手指", "high-density": "高密接口", aviation: "航插" }[r.input.cabinetConnector];
    const cabinetPinType = r.input.cabinetPinType;
    const cabinetOption = cabinetPinType ? CABINET_RECEIVER_OPTIONS[cabinetPinType] : null;
    if (cabinetOption) {
      const alternatives = cabinetOption.candidates.length > 1 ? `（可选${cabinetOption.candidates.join("/")}，优先当前款${cabinetOption.primary}）` : "";
      const assumption = r.input.cabinetPinAssumed ? "（暂定，未按实物确认）" : "";
      lines.push(`箱体接口：${cabinetPinType}${assumption}，${cabinetOption.label}，接收卡${r.card.name}${alternatives}；箱内转接板和跳线按箱体实物核对。`);
    } else {
      lines.push(`箱体接口：未确认PIN定义，接收卡数量只按一箱一卡预估；具体卡型、${connectorLabel ? `${connectorLabel}转接板` : "转接板"}和箱内跳线必须按箱体实物核对，当前不自动推荐型号。`);
    }
  } else {
    const inferredPitch = !r.input.pitch && r.input.moduleMm && r.input.modulePixels
      ? ((r.input.moduleMm[0] / r.input.modulePixels[0]) + (r.input.moduleMm[1] / r.input.modulePixels[1])) / 2
      : 0;
    const moduleLabel = inferredPitch
      ? `实算点距约P${inferredPitch.toFixed(3)}（带载暂按${r.preset.label}相近记录）`
      : r.preset.label;
    const moduleDetails = [
      moduleLabel,
      `单块${r.moduleW}×${r.moduleH}点`,
      r.preset.iface
    ].filter(Boolean).join("、");
    const modsPerCardRaw = (r.cols * r.rows) / r.plan.cardCount;
    const modsPerCard = Number.isInteger(modsPerCardRaw) ? String(modsPerCardRaw) : `约${modsPerCardRaw.toFixed(1)}`;
    const cardQtyText = r.input.receiverCardBackup
      ? `${r.plan.cardCount}张主卡、另备${r.plan.cardCount}张`
      : `${r.plan.cardCount}张`;
    lines.push(
      `模组：${moduleDetails}；整屏${r.cols}宽×${r.rows}高，共${r.cols * r.rows}块`,
      `接收卡：${r.card.name} ${cardQtyText}，每张平均带${modsPerCard}块模组`
    );
    if (r.moduleCountBasis?.rounded) {
      const isPixels = r.moduleCountBasis.source === "screen_pixels";
      const unit = isPixels ? "点" : "mm";
      const inward = r.moduleCountBasis.alternatives?.inward;
      const outward = r.moduleCountBasis.alternatives?.outward;
      const inwardSize = inward
        ? (isPixels
          ? [inward[0] * r.moduleW, inward[1] * r.moduleH]
          : [inward[0] * r.modulePhysicalW, inward[1] * r.modulePhysicalH])
        : null;
      const outwardSize = outward
        ? (isPixels
          ? [outward[0] * r.moduleW, outward[1] * r.moduleH]
          : [outward[0] * r.modulePhysicalW, outward[1] * r.modulePhysicalH])
        : null;
      const overage = [
        Math.max(0, r.moduleCountBasis.actual[0] - r.moduleCountBasis.requested[0]),
        Math.max(0, r.moduleCountBasis.actual[1] - r.moduleCountBasis.requested[1])
      ];
      lines.push(`尺寸说明：客户目标${Number(r.moduleCountBasis.requested[0].toFixed(3))}×${Number(r.moduleCountBasis.requested[1].toFixed(3))}${unit}不能整除模组，本方案默认向外上取整为${r.cols}宽×${r.rows}高，成屏${Number(r.moduleCountBasis.actual[0].toFixed(3))}×${Number(r.moduleCountBasis.actual[1].toFixed(3))}${unit}，宽/高余量${Number(overage[0].toFixed(3))}/${Number(overage[1].toFixed(3))}${unit}。`);
      if (inward && outward && (inward[0] !== outward[0] || inward[1] !== outward[1])) {
        lines.push(`取整选择：内缩为${inward[0]}宽×${inward[1]}高（约${Number(inwardSize[0].toFixed(3))}×${Number(inwardSize[1].toFixed(3))}${unit}）；成品不得小于客户尺寸时用外扩${outward[0]}宽×${outward[1]}高（约${Number(outwardSize[0].toFixed(3))}×${Number(outwardSize[1].toFixed(3))}${unit}）。`);
      }
      lines.push("最终请以现场实际模组排数复核。");
    }
    if (r.preset.conflictVariants?.length && !r.input.scanAffectsCapacity) {
      const alternatives = r.preset.conflictVariants
        .map((item) => Object.entries(item.cardLayouts || {}).map(([name, layout]) => `${name} ${layout.w}宽×${layout.h}高`).join("、"))
        .filter(Boolean);
      lines.push(`带载冲突提示：同条件资料存在${alternatives.join("；")}两组记录，本次采用较保守方案，较高带载继续隔离，未作为自动推荐。`);
    }
  }
  const maxWanPts = Number((r.plan.maxPortPoints / 10000).toFixed(3));
  const maxPortDesc = r.plan.maxPortPoints >= 655360
    ? "最满一口已达单口上限（65.536万点·满载）"
    : `本屏最满一口约${maxWanPts}万点`;
  lines.push(`网口：共${r.plan.ports.length}路千兆网口（单口上限65.536万点），${maxPortDesc}${r.input.portBackup ? `；双网口备份共占${r.physicalPortCount}口` : ""}${r.input.senderCardBackup ? "；主、备发送设备各使用同样的端口和映射" : ""}`);
  r.plan.ports.forEach((port, index) => {
    const labs = portCardLabels(r, port);
    const range = labs.length > 1 ? `${labs[0]}–${labs[labs.length - 1]}` : (labs[0] || "");
    const coverage = port.rectangular === false ? `${port.pxW}×${port.pxH}（异形按外接矩形保守计点）` : `${port.pxW}×${port.pxH}`;
    const actual = port.rectangular === false && port.actualPoints !== port.points
      ? `，实际有效约${Number((port.actualPoints / 10000).toFixed(3))}万点`
      : "";
    lines.push(`- 网口${index + 1}：${range}（${port.count}张），覆盖${coverage}，约${Number((port.points / 10000).toFixed(3))}万点${actual}`);
  });
  // 网线达到阈值（≥30根）才在网口分配之后补充拼接机箱方案，否则不显示
  lines.push(...buildSplicerLines());
  if (r.input.receiverCardBackup) {
    lines.push(`双接收卡备份：每个接收单元1张主卡+1张备份卡，共${r.receiverQuantity}张；箱体/转接板须支持双卡备份连接。`);
  }
  if (r.input.portBackup) {
    lines.push(`双网口备份：${r.plan.ports.map((_, index) => `主口${index + 1}↔备口${index + 1 + r.plan.ports.length}`).join("，")}`);
  }
  if (r.input.senderCardBackup) {
    lines.push(`双发送卡备份：主发送设备1台+备发送设备1台，设备型号、输入信号、端口接线和屏体映射保持一致。`);
  }
  if (r.riskFlags?.includes("creative_mapping")) {
    const label = { mixed: "混合模组", irregular: "异形结构", rotated: "旋转箱体" }[r.input.shapeMode] || "特殊结构";
    lines.push(`结构校核：已识别${label}，当前数量按外接矩形范围预配；最终接线必须按每个实际区域在HDSet重新映射，不能直接把矩形拓扑当成最终施工图。`);
    if (r.input.mentionedPitches?.length > 1) lines.push(`混合点间距：当前先按P${r.input.pitch}区域计算；${r.input.mentionedPitches.map((item) => `P${item}`).join("、")}各区域须分别计算接收卡和网口后再合并设备。`);
  }
  if (r.riskFlags?.includes("performance_mode")) {
    const modes = [
      r.input.refreshRate ? `${r.input.refreshRate}Hz` : (r.input.highRefresh ? "高刷新" : ""),
      r.input.bitDepth ? `${r.input.bitDepth}bit` : (r.input.highGray ? "高灰阶" : ""),
      r.input.hdr ? "HDR" : "",
      r.input.lowLatency ? "低延迟" : ""
    ].filter(Boolean);
    lines.push(`性能校核：已识别${modes.join("、")}模式；位深、刷新率和低延迟会改变真实带载能力，当前方案可作硬件预配，最终须按目标模式发送参数并实测复核。`);
  }
  if (r.riskFlags?.includes("pwm_load_mode")) {
    const profiles = RECEIVER_MODE_PROFILES[r.card.name]?.pwm || [];
    const profileText = profiles.length ? `；${r.card.name}官方PWM推荐范围含${profiles.map((item) => `${item.w}×${item.h}`).join("、")}` : "";
    lines.push(`驱动模式：已识别PWM芯片，本次卡数仍以正式模组带载表为准${profileText}，最终按实际接口数和模组分辨率复核。`);
  }
  if (r.preset.note) lines.push(`带载表备注：${r.preset.note}`);
  if (basis) {
    if (r.cabinetMode) {
      lines.push(basis);
    } else {
      // 正式方案正文已有“模组”行（型号/点数/接口/排列），这里只补正文没有的物理尺寸与扫描，避免重复罗列
      const basisMmW = r.input.moduleMm?.[0] || r.preset.mmW || 0;
      const basisMmH = r.input.moduleMm?.[1] || r.preset.mmH || 0;
      const extra = [];
      if (basisMmW && basisMmH) extra.push(`${basisMmW}×${basisMmH}mm`);
      if (r.input.scan && r.input.scanMatched) extra.push(`${r.input.scan}扫描`);
      if (extra.length) lines.push(`模组尺寸：${extra.join("、")}。`);
      const assumptionLine = basis.split("\n").find((line) => line.startsWith("规格说明："));
      if (assumptionLine) lines.push(assumptionLine);
    }
  }
  if (r.input.scanAffectsCapacity && !r.input.scanMatched) {
    const options = r.input.scanOptions.join("或");
    const provided = r.input.scan ? `客户写的${r.input.scan}未在该规格带载表中直接命中；` : "";
    lines.push(`扫描确认：${provided}该模组在${options}下的接收卡带载不同，本次已按较保守记录先完成方案；确认实际扫描后可立即重算。`);
  }
  if (!r.processorValid && r.input.preferredProcessor) lines.push(`提醒：客户指定的${r.input.preferredProcessor}不满足当前总带载、宽高或网口数，需要更换设备或拆分系统。`);
  return lines.join("\n");
}

function formatReply(result) {
  // 客户可见正文只给结果与行动；方案状态/暂定条件/确认问题等内部判断保留在 result 上供流程按钮使用，不写进正文
  return formatReplyCore(result);
}

function escapeXml(value) { return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c])); }

// 网口分区配色：同一网口覆盖的接收卡区域同色，相邻网口颜色区分；循环使用
const PORT_COLORS = ["#f59e0b", "#2563eb", "#059669", "#dc2626", "#7c3aed", "#db2777", "#0891b2", "#ea580c", "#4f46e5", "#65a30d", "#0d9488", "#9333ea", "#c026d3", "#b45309", "#475569", "#e11d48", "#0284c7", "#16a34a", "#a16207", "#6d28d9"];
const portColor = (i) => PORT_COLORS[i % PORT_COLORS.length];
const svgNum = (n) => Math.round(n * 10) / 10;

// 拓扑图标题/副标题（整屏物理图与兜底卡片共用，口径与 BOM 一致）
function topoHeader(result, ports) {
  const topologyModes = [
    result.input.receiverCardBackup ? `双接收卡 主${result.plan.cardCount}+备${result.plan.cardCount}` : "",
    result.input.portBackup ? `双网口 主${ports.length}口/共占${result.physicalPortCount}口` : "",
    result.input.senderCardBackup ? "双发送卡 主1+备1" : ""
  ].filter(Boolean);
  const topologyMode = topologyModes.length ? ` · ${topologyModes.join(" · ")}` : "";
  const _acl = actualCardModuleLoad(result.plan, result.card.w, result.card.h);
  const perCardLoad = (result.card.w && result.card.h) ? `（每卡${_acl.w}宽×${_acl.h}高）` : "";
  const receiverSummary = result.input.receiverCardBackup
    ? `${result.card.name} 主${result.plan.cardCount}+备${result.plan.cardCount}${perCardLoad}`
    : `${result.card.name}×${result.plan.cardCount}${perCardLoad}`;
  const unspec = unspecifiedAsyncCandidate(result);
  const topoController = (unspec && unspec.name !== result.processor.name)
    ? `${result.processor.name}/${unspec.name}` : result.processor.name;
  return {
    title: "接收卡连接拓扑图",
    subtitle: `${result.preset.label} · ${result.screenW}×${result.screenH} · ${receiverSummary} · ${topoController}${topologyMode}`
  };
}

function renderTopologySvg(result) {
  if (!result.ok || result.directControllerMode) return "";
  const plan = result.plan;
  const ports = plan?.ports || [];
  if (!ports.length) return "";
  // 物理网格坐标齐全才画整屏分区图；数据异常（理论不发生）时回退卡片式，保证不空白、不报错
  const gridReady = Number.isFinite(plan.rowGroups) && Number.isFinite(plan.colGroups)
    && Array.isArray(plan.colWidths) && Array.isArray(plan.rowHeights)
    && Number.isFinite(result.moduleW) && Number.isFinite(result.moduleH)
    && ports.every((p) => Array.isArray(p.cells) && p.cells.length);
  if (!gridReady) return renderTopologyCards(result);
  // 优先 HDSet 标准模式原生画风（结构化几何内核，图与配单分组严格一致）；任何异常回退旧整屏分区图，客户无感
  try {
    const hdsetSvg = require("./topo-hdset.cjs").renderHdsetFromResult(result);
    if (hdsetSvg) return hdsetSvg;
  } catch (e) { /* 回退到 renderTopologyPanel */ }
  return renderTopologyPanel(result);
}

// 兜底：每网口一张文字卡片（旧样式，仅在缺少物理网格数据时使用）
function renderTopologyCards(result) {
  const ports = result.plan.ports;
  const header = topoHeader(result, ports);
  const cardW = 172, cardH = 158, gap = 14, left = 24, top = 112;
  const perRow = Math.min(ports.length, 6);
  const rowCount = Math.ceil(ports.length / perRow);
  const width = Math.max(720, left * 2 + perRow * cardW + (perRow - 1) * gap);
  const height = top + rowCount * cardH + (rowCount - 1) * gap + 24;
  const border = "#f59e0b";
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect width="100%" height="100%" fill="#f7f9fc"/>`,
    `<text x="${left}" y="42" font-size="26" font-family="Microsoft YaHei,Arial" font-weight="700" fill="#111827">${escapeXml(header.title)}</text>`,
    `<text x="${left}" y="76" font-size="16" font-family="Microsoft YaHei,Arial" fill="#475569">${escapeXml(header.subtitle)}</text>`
  ];
  ports.forEach((port, index) => {
    const row = Math.floor(index / perRow), col = index % perRow;
    const x = left + col * (cardW + gap), y = top + row * (cardH + gap);
    const head = result.input.portBackup ? `主口：${index + 1}` : `网口：${index + 1}`;
    const detailLines = [
      `接收卡：${port.count}`,
      `宽度：${port.pxW}`,
      `高度：${port.pxH}`,
      `模组数量：${port.modW}*${port.modH}`
    ];
    parts.push(`<rect x="${x}" y="${y}" width="${cardW}" height="${cardH}" rx="3" fill="#ffffff" stroke="${border}" stroke-width="2.5"/>`);
    parts.push(`<text x="${x + 14}" y="${y + 32}" font-size="18" font-family="Microsoft YaHei,Arial" font-weight="700" fill="${border}">${head}</text>`);
    detailLines.forEach((txt, lineIndex) => {
      parts.push(`<text x="${x + 14}" y="${y + 64 + lineIndex * 26}" font-size="16" font-family="Microsoft YaHei,Arial" fill="#111827">${escapeXml(txt)}</text>`);
    });
  });
  parts.push("</svg>");
  return parts.join("");
}

// 主样式：按真实屏体比例画一整块屏，每网口区域同色 + 粗彩边分界；格内 R 序号沿蛇形级联，区中心标网口号。
// 密度自适应：少卡时 R 号水平、区中心胶囊写"网口N"；几十口竖带时标签降级为小方块数字、R 号竖排只标每口首尾，保证不重叠。
function renderTopologyPanel(result) {
  const plan = result.plan, ports = plan.ports, header = topoHeader(result, ports);
  const cg = plan.colGroups, rg = plan.rowGroups;
  const modW = result.moduleW, modH = result.moduleH;
  // —— 几何：列/行像素宽高与累计偏移，整屏等比、不失真 ——
  const colPx = plan.colWidths.map((n) => n * modW);
  const rowPx = plan.rowHeights.map((n) => n * modH);
  const cumX = [0]; colPx.forEach((v, i) => cumX.push(cumX[i] + v));
  const cumY = [0]; rowPx.forEach((v, i) => cumY.push(cumY[i] + v));
  const W = cumX[cumX.length - 1], H = cumY[cumY.length - 1];
  // cell(row:col) -> 网口序号
  const cellPort = new Map();
  ports.forEach((p, pi) => p.cells.forEach((c) => cellPort.set(`${c.row}:${c.col}`, pi)));
  // —— 绘图区等比缩放（顶部预留控制器端子排空间）——
  const left = 24, top = 150, maxW = 860, maxH = 396;
  const scale = Math.min(maxW / W, maxH / H);
  const panelW = W * scale, panelH = H * scale;
  const x0 = left + Math.max(0, (maxW - panelW) / 2);
  const width = Math.max(720, left * 2 + maxW);
  const cellRect = (r, c) => ({ x: x0 + cumX[c] * scale, y: top + cumY[r] * scale, w: colPx[c] * scale, h: rowPx[r] * scale });
  const cellCenter = (cell) => { const b = cellRect(cell.row, cell.col); return { x: b.x + b.w / 2, y: b.y + b.h / 2 }; };
  // —— 密度等级：依据平均每格宽与网口数 ——
  const avgCellW = panelW / cg;
  const density = (ports.length >= 24 || avgCellW < 20) ? "micro"
    : (ports.length >= 8 || avgCellW < 40) ? "compact" : "cozy";
  const D = {
    cozy: { fill: 0.22, edge: 3, grid: 1.4, zoneFs: 14 },
    compact: { fill: 0.2, edge: 2.6, grid: 1.1, zoneFs: 12 },
    micro: { fill: 0.16, edge: 1.8, grid: 0.7, zoneFs: 8 }
  }[density];
  // —— 图例：多网口自动多列，避免几十口把图拉得过长 ——
  const legendCols = density === "micro" ? 4 : 2;
  const legendRowH = density === "micro" ? 19 : 26;
  const legendFs = density === "micro" ? 11 : 14;
  const legendRows = Math.ceil(ports.length / legendCols);
  const legendTop = top + panelH + 30;
  const height = legendTop + 22 + legendRows * legendRowH + 14;
  // —— 控制器端子排（整屏正上方），每网口一个同色端子 ——
  const ctrlY = 102, ctrlH = 24;
  const _unspec = unspecifiedAsyncCandidate(result);
  const ctrlName = result.processor?.name
    ? ((_unspec && _unspec.name !== result.processor.name) ? `${result.processor.name}/${_unspec.name}` : result.processor.name)
    : "";
  const arrowDefs = PORT_COLORS.map((color, i) =>
    `<marker id="ta${i}" markerWidth="11" markerHeight="11" refX="7" refY="5" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L10,5 L0,10 Z" fill="${color}"/></marker>`).join("");
  const FONT = "Microsoft YaHei,Arial";
  // 屏特别窄（竖长屏）时控制器名挪到端子条右侧，避免压住端子序号
  const ctrlLabel = ctrlName ? `${ctrlName} · 网口出线端` : "控制器 / 处理器 · 网口出线端";
  const narrowCtrl = panelW < 170;
  const ctrlTextX = narrowCtrl ? x0 + panelW + 8 : x0 + 10;
  const ctrlTextFill = narrowCtrl ? "#334155" : "#e5e7eb";
  const P = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<defs>${arrowDefs}</defs>`,
    `<rect width="100%" height="100%" fill="#f7f9fc"/>`,
    `<text x="${left}" y="42" font-size="26" font-family="${FONT}" font-weight="700" fill="#111827">${escapeXml(header.title)}</text>`,
    `<text x="${left}" y="70" font-size="16" font-family="${FONT}" fill="#475569">${escapeXml(header.subtitle)}</text>`,
    `<text x="${left}" y="${top - 58}" font-size="14" font-family="${FONT}" fill="#94a3b8">每种颜色一根网线：从上方控制器对应网口出线，箭头方向为接收卡逐级级联（蛇形走线）</text>`,
    `<rect x="${svgNum(x0)}" y="${ctrlY}" width="${svgNum(panelW)}" height="${ctrlH}" rx="6" fill="#1f2937"/>`,
    `<text x="${svgNum(ctrlTextX)}" y="${svgNum(ctrlY + 16)}" font-size="13" font-family="${FONT}" fill="${ctrlTextFill}">${escapeXml(ctrlLabel)}</text>`
  ];
  // 1) 每个接收卡单元按所属网口填同色
  for (let r = 0; r < rg; r++) for (let c = 0; c < cg; c++) {
    const pi = cellPort.get(`${r}:${c}`); if (pi == null) continue;
    const b = cellRect(r, c);
    P.push(`<rect x="${svgNum(b.x)}" y="${svgNum(b.y)}" width="${svgNum(b.w)}" height="${svgNum(b.h)}" fill="${portColor(pi)}" fill-opacity="${D.fill}"/>`);
  }
  // 2) 白色细网格分隔每张接收卡
  for (let r = 0; r < rg; r++) for (let c = 0; c < cg; c++) {
    if (!cellPort.has(`${r}:${c}`)) continue;
    const b = cellRect(r, c);
    P.push(`<rect x="${svgNum(b.x)}" y="${svgNum(b.y)}" width="${svgNum(b.w)}" height="${svgNum(b.h)}" fill="none" stroke="#ffffff" stroke-width="${D.grid}"/>`);
  }
  // 3) 网口粗彩边：单元某边邻居非同口（或贴整屏外缘）即描该口彩色粗边，L 形分组也能精确分界
  const sideEdge = (b, side) => {
    switch (side) {
      case 0: return [b.x, b.y, b.x + b.w, b.y];             // 上
      case 1: return [b.x + b.w, b.y, b.x + b.w, b.y + b.h]; // 右
      case 2: return [b.x, b.y + b.h, b.x + b.w, b.y + b.h]; // 下
      default: return [b.x, b.y, b.x, b.y + b.h];            // 左
    }
  };
  const neighbor = [[-1, 0], [0, 1], [1, 0], [0, -1]];
  for (let r = 0; r < rg; r++) for (let c = 0; c < cg; c++) {
    const pi = cellPort.get(`${r}:${c}`); if (pi == null) continue;
    const b = cellRect(r, c);
    neighbor.forEach((d, side) => {
      const other = cellPort.get(`${r + d[0]}:${c + d[1]}`);
      if (other !== pi) {
        const [x1, y1, x2, y2] = sideEdge(b, side);
        P.push(`<line x1="${svgNum(x1)}" y1="${svgNum(y1)}" x2="${svgNum(x2)}" y2="${svgNum(y2)}" stroke="${portColor(pi)}" stroke-width="${D.edge}" stroke-linecap="round"/>`);
      }
    });
  }
  // 整屏外框：一整块真实比例矩形
  P.push(`<rect x="${svgNum(x0)}" y="${svgNum(top)}" width="${svgNum(panelW)}" height="${svgNum(panelH)}" fill="none" stroke="#334155" stroke-width="1.4"/>`);
  // 4) 走线：控制器同色端子 → 该口第一张卡 → 沿蛇形逐卡级联（micro 竖带过密，卡间不画箭头以免糊成一团）
  const termGap = ports.length ? panelW / ports.length : 14;
  ports.forEach((p, pi) => {
    const color = portColor(pi);
    const pts = p.cells.map(cellCenter);
    if (!pts.length) return;
    const tx = pts[0].x;
    const tw = Math.max(3, Math.min(14, termGap - 1)); // 端子随网口数自适应变窄不重叠
    // 端子只保留同色色块作为出线锚点；网口序号已在屏内分区标签和图例中标出，不再重复写数字
    P.push(`<rect x="${svgNum(tx - tw / 2)}" y="${svgNum(ctrlY + ctrlH - 2)}" width="${svgNum(tw)}" height="11" rx="2" fill="${color}"/>`);
    // 控制器端子 → 第一张卡（网线出线）
    P.push(`<line x1="${svgNum(tx)}" y1="${svgNum(ctrlY + ctrlH + 9)}" x2="${svgNum(pts[0].x)}" y2="${svgNum(pts[0].y - (density === "micro" ? 6 : 11))}" stroke="${color}" stroke-width="${density === "micro" ? 1.3 : 2.2}" stroke-linecap="round"/>`);
    if (density === "micro") return;
    // 卡间逐级箭头（p.cells 已按蛇形顺序），两端缩进让箭头落在两格之间、不压 R 号
    for (let k = 0; k < pts.length - 1; k++) {
      const a = pts[k], b = pts[k + 1];
      const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
      const back = L > 26 ? { s: 9, e: 14 } : { s: 1, e: 2 };
      const sx = a.x + ux * back.s, sy = a.y + uy * back.s, ex = b.x - ux * back.e, ey = b.y - uy * back.e;
      P.push(`<line x1="${svgNum(sx)}" y1="${svgNum(sy)}" x2="${svgNum(ex)}" y2="${svgNum(ey)}" stroke="${color}" stroke-width="2.6" stroke-linecap="round" marker-end="url(#ta${pi})"/>`);
    }
  });
  // 5) 分区标签：cozy/compact 在分区"锚格"中心放胶囊"网口N"（锚格不再画 R 号，避免跨格压字）；micro 竖带降级为顶部小方块数字
  const zoneAnchorKeys = new Set();
  const portBounds = ports.map((p, pi) => {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    p.cells.forEach((c) => { const b = cellRect(c.row, c.col); x1 = Math.min(x1, b.x); y1 = Math.min(y1, b.y); x2 = Math.max(x2, b.x + b.w); y2 = Math.max(y2, b.y + b.h); });
    const mcx = (x1 + x2) / 2, mcy = (y1 + y2) / 2;
    // 锚格：中心最靠近分区包围盒中心的那张卡，胶囊对齐它的中心、该格不再标 R
    let anchor = null, bestD = Infinity;
    p.cells.forEach((c) => { const cc = cellCenter(c); const d = (cc.x - mcx) ** 2 + (cc.y - mcy) ** 2; if (d < bestD) { bestD = d; anchor = c; } });
    const ac = anchor ? cellCenter(anchor) : { x: mcx, y: mcy };
    const pillW = `网口${pi + 1}`.length * D.zoneFs * 0.95 + 22;
    const fitPill = density !== "micro" && (x2 - x1) >= pillW;
    if (anchor && fitPill) zoneAnchorKeys.add(`${anchor.row}:${anchor.col}`);
    return { cx: ac.x, cy: ac.y, w: x2 - x1, h: y2 - y1, top: y1, fitPill };
  });
  portBounds.forEach((bd, pi) => {
    const color = portColor(pi);
    if (density === "micro") {
      if (bd.w < 11) return;
      const s = 12, x = bd.cx - s / 2, y = bd.top + 3;
      P.push(`<rect x="${svgNum(x)}" y="${svgNum(y)}" width="${s}" height="${s}" rx="2" fill="${color}" fill-opacity="0.92"/>`);
      P.push(`<text x="${svgNum(bd.cx)}" y="${svgNum(y + s - 3)}" font-size="8" font-family="Arial" font-weight="700" text-anchor="middle" fill="#ffffff">${pi + 1}</text>`);
    } else if (bd.fitPill && bd.w >= 44 && bd.h >= 26) {
      const txt = `网口${pi + 1}`, fs = D.zoneFs;
      const pw = txt.length * fs * 0.95 + 16, ph = fs + 9;
      P.push(`<rect x="${svgNum(bd.cx - pw / 2)}" y="${svgNum(bd.cy - ph / 2)}" width="${svgNum(pw)}" height="${ph}" rx="${ph / 2}" fill="${color}" fill-opacity="0.92"/>`);
      P.push(`<text x="${svgNum(bd.cx)}" y="${svgNum(bd.cy + fs * 0.36)}" font-size="${fs}" font-family="${FONT}" font-weight="700" text-anchor="middle" fill="#ffffff">${txt}</text>`);
    } else if (bd.w >= 12) {
      // 窄全高竖条：顶部小方块仅标网口序号（明细看图例），不与 R 号、相邻口重叠
      const s = 15, lx = bd.cx - s / 2, ly = bd.top + 3;
      P.push(`<rect x="${svgNum(lx)}" y="${svgNum(ly)}" width="${s}" height="${s}" rx="3" fill="${color}" fill-opacity="0.95"/>`);
      P.push(`<text x="${svgNum(bd.cx)}" y="${svgNum(ly + s - 4)}" font-size="9" font-family="Arial" font-weight="700" text-anchor="middle" fill="#ffffff">${pi + 1}</text>`);
    }
  });
  // 6) 接收卡 R 序号（统一蛇形编号；少卡一律水平，micro 竖带竖排且只标每口首尾避免重叠）
  if (!result.cabinetMode) {
    const halo = 'stroke="#f7f9fc" stroke-width="3" paint-order="stroke"';
    const putR = (cell, vertical) => {
      const b = cellRect(cell.row, cell.col), cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      const label = `R${cell.row * cg + cell.col + 1}`; // 物理位置号（每行从左到右），蛇形由走线箭头体现
      if (vertical) {
        P.push(`<text transform="rotate(-90 ${svgNum(cx)} ${svgNum(cy)})" x="${svgNum(cx)}" y="${svgNum(cy)}" font-size="9" font-family="Arial" text-anchor="middle" dominant-baseline="central" fill="#475569" ${halo}>${label}</text>`);
      } else {
        const fs = Math.max(9, Math.min(density === "cozy" ? 15 : 13, Math.min(b.w, b.h) * 0.3));
        P.push(`<text x="${svgNum(cx)}" y="${svgNum(cy + fs * 0.35)}" font-size="${svgNum(fs)}" font-family="Arial" text-anchor="middle" fill="#475569" ${halo}>${label}</text>`);
      }
    };
    if (density === "micro") {
      ports.forEach((p) => {
        if (!p.cells.length) return;
        putR(p.cells[0], true);
        if (p.cells.length > 1) putR(p.cells[p.cells.length - 1], true);
      });
    } else {
      for (let r = 0; r < rg; r++) for (let c = 0; c < cg; c++) {
        const key = `${r}:${c}`;
        if (!cellPort.has(key) || zoneAnchorKeys.has(key)) continue;       // 锚格让位给"网口N"胶囊
        const b = cellRect(r, c);
        if (b.w >= 14 && b.h >= 12) putR({ row: r, col: c }, false);      // 少卡：始终水平
        else if (b.h >= 20 && b.w >= 8) putR({ row: r, col: c }, true);    // 极个别窄格才竖排兜底
      }
    }
  }
  // 7) 图例明细：每网口 R 范围（沿走线方向）/ 像素 / 万点 / 张数
  P.push(`<text x="${left}" y="${legendTop}" font-size="15" font-family="${FONT}" font-weight="700" fill="#111827">网口分布明细${density === "micro" ? "（每口：R范围 · 像素 · 万点 · 张数）" : ""}</text>`);
  const legendColW = (width - left * 2) / legendCols;
  ports.forEach((p, pi) => {
    const col = pi % legendCols, row = Math.floor(pi / legendCols);
    const x = left + col * legendColW, y = legendTop + 22 + row * legendRowH;
    const labels = portCardLabels(result, p);
    const range = labels.length ? `${labels[0]}→${labels[labels.length - 1]}` : "";
    const wan = density === "micro" ? (p.points / 10000).toFixed(2) : (p.points / 10000).toFixed(4);
    const txt = density === "micro"
      ? `${pi + 1} ${range} ${p.pxW}×${p.pxH} ${wan}万 ${p.count}张`
      : `网口${pi + 1}：${range} · ${p.pxW}×${p.pxH} · ${wan}万点 · ${p.count}张`;
    P.push(`<circle cx="${x + 6}" cy="${y - 5}" r="${density === "micro" ? 5 : 6}" fill="${portColor(pi)}"/>`);
    P.push(`<text x="${x + (density === "micro" ? 16 : 20)}" y="${y}" font-size="${legendFs}" font-family="${FONT}" fill="#334155">${escapeXml(txt)}</text>`);
  });
  P.push("</svg>");
  return P.join("");
}

function answer(message) {
  const input = parseRequest(message), result = calculate(input);
  const topologyResult = result.ok ? result : (result.provisional?.ok ? result.provisional : result);
  return {
    input,
    result,
    reply: hardwareEvidence.applyHardwareEvidenceGuard(formatReply(result), message),
    topologySvg: renderTopologySvg(topologyResult)
  };
}

function answerWithContext(messages) {
  return answer(buildContextualOrderingMessage(messages));
}

const ORDERING_ENGINE_API = Object.freeze({
  LIMIT,
  DEFAULT_MODULE_MM,
  STRUCTURED_INPUT_LIMITS,
  MODULE_PRESETS,
  DEVICE_CATALOG,
  RECEIVER_RANGES,
  RECEIVER_MODE_PROFILES,
  PROCESSORS,
  SPLICERS,
  ASYNC_CONTROLLERS,
  ASYNC_DEVICE_ARCHITECTURES,
  DIRECT_CONTROLLERS,
  DIRECT_CONTROLLER_NAMES,
  TRAINING_RULES,
  PITCH_ALIASES,
  normalizePitch,
  controllerProfile,
  controllerFits,
  controllerSupportsRequestedFeatures,
  controllerCapabilityGaps,
  parseGridCount,
  parseRequest,
  createStructuredInput,
  isNegatedOrderingRequest,
  looksLikeOrderingRequest,
  isOrderingContinuationMessage,
  buildContextualOrderingMessage,
  calculate,
  formatReply,
  renderTopologySvg,
  answer,
  answerWithContext
});

if (ORDERING_ENGINE_COMMONJS) module.exports = ORDERING_ENGINE_API;
else ORDERING_ENGINE_GLOBAL.HuiduOrderingEngine = ORDERING_ENGINE_API;
