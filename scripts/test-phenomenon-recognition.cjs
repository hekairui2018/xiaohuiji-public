/**
 * 现象识别回归测试（可重复运行：node scripts/test-phenomenon-recognition.cjs）
 * 口径说明：
 *  - 案例自身的现象子类来自离线构建标签 c.subCategory（准确、全量），不依赖在线识别；
 *  - 在线识别器 detectDisplaySubs 只负责读懂“客户现场输入”，所以本测试用客户口语句子做验收。
 * 用例：q=客户原话；expect=期望至少命中的子类（一句话可同时命中多个，命中 expect 中任一类即通过）；
 *       expect 为 [] 表示不应识别出任何显示子类（泛词/无关/联网负例）。
 */
const path = require("path");
const sp = require(path.join(__dirname, "..", "backend", "specialist", "aftersales-specialist.js"));

const CASES = [
  // 波纹摩尔纹
  { q: "手机拍屏幕有水波纹", expect: ["波纹摩尔纹"] },
  { q: "摄像机拍出来有扫描线", expect: ["波纹摩尔纹"] },
  { q: "拍照有摩尔纹", expect: ["波纹摩尔纹"] },
  { q: "屏幕一层网纹", expect: ["波纹摩尔纹"] },
  // 闪烁抖动
  { q: "屏幕一直闪", expect: ["闪烁抖动"] },
  { q: "画面闪烁怎么回事", expect: ["闪烁抖动"] },
  { q: "一闪一闪的", expect: ["闪烁抖动"] },
  { q: "老闪，闪个不停", expect: ["闪烁抖动"] },
  { q: "画面抖动", expect: ["闪烁抖动"] },
  { q: "坐标一直跳", expect: ["闪烁抖动"] },
  { q: "亮度忽明忽暗", expect: ["闪烁抖动"] },
  { q: "有闪白点", expect: ["闪烁抖动"] },
  { q: "6363闪", expect: ["闪烁抖动"] },
  // 花屏乱码
  { q: "花屏了", expect: ["花屏乱码"] },
  { q: "屏幕花花的", expect: ["花屏乱码"] },
  { q: "画面全是乱码", expect: ["花屏乱码"] },
  { q: "像马赛克一样", expect: ["花屏乱码"] },
  { q: "画面错位重叠了", expect: ["花屏乱码"] },
  { q: "画面有断层，没连起来", expect: ["花屏乱码"] },
  { q: "字模糊不清", expect: ["花屏乱码"] },
  { q: "屏幕糊了", expect: ["花屏乱码"] },
  { q: "画面发虚", expect: ["花屏乱码"] },
  { q: "整屏灰屏", expect: ["花屏乱码"] },
  { q: "6363花", expect: ["花屏乱码"] },
  { q: "画面像油画", expect: ["花屏乱码"] },
  { q: "播放有花纹", expect: ["花屏乱码"] },
  { q: "左右镜像反了", expect: ["花屏乱码"] },
  { q: "走点不对", expect: ["花屏乱码"] },
  { q: "行错位，标序错误", expect: ["花屏乱码"] },
  { q: "清晰度低", expect: ["花屏乱码"] },
  // 偏色缺色
  { q: "偏色，颜色不对", expect: ["偏色缺色"] },
  { q: "整体发红泛红", expect: ["偏色缺色"] },
  { q: "缺蓝色，少了一色", expect: ["偏色缺色"] },
  { q: "白色地方有色块", expect: ["偏色缺色"] },
  { q: "固定位置出现色块", expect: ["偏色缺色"] },
  { q: "屏幕很暗，亮度不够", expect: ["偏色缺色"] },
  { q: "发黑，底色不均", expect: ["偏色缺色"] },
  { q: "只显示蓝色，其他颜色不显示", expect: ["偏色缺色"] },
  { q: "高温色带", expect: ["偏色缺色"] },
  { q: "亮度有点低", expect: ["偏色缺色"] },
  { q: "一会暗一会亮，明暗不均", expect: ["偏色缺色"] },
  // 横竖线条
  { q: "有一条竖线", expect: ["横竖线条"] },
  { q: "横向有绿线", expect: ["横竖线条"] },
  { q: "一条亮线", expect: ["横竖线条"] },
  { q: "屏幕有条纹", expect: ["横竖线条"] },
  { q: "出现竖条", expect: ["横竖线条"] },
  // 鬼影拖影
  { q: "有鬼影", expect: ["鬼影拖影"] },
  { q: "文字残留拖影", expect: ["鬼影拖影"] },
  { q: "上一帧的残影还在", expect: ["鬼影拖影"] },
  { q: "有余晖拖尾", expect: ["鬼影拖影"] },
  { q: "重影", expect: ["鬼影拖影"] },
  // 显示不全异常
  { q: "有个黑块", expect: ["显示不全异常"] },
  { q: "一块不亮", expect: ["显示不全异常"] },
  { q: "最下面一行灯珠不亮", expect: ["显示不全异常"] },
  { q: "半边不亮，显示一半", expect: ["显示不全异常"] },
  { q: "缺了一块", expect: ["显示不全异常"] },
  { q: "有死灯，毛毛虫", expect: ["显示不全异常"] },
  { q: "固定位置有黑点", expect: ["显示不全异常"] },
  { q: "低灰微亮，灰度打到0灯珠还亮", expect: ["显示不全异常"] },
  { q: "第三个网口不出画面", expect: ["显示不全异常"] },
  // 整屏黑屏/白屏/点不亮归 power_boot（黑屏开机域），不出显示效果子类（旧版曾被“显示不全”错误兜底，现已放开 power_boot）
  { q: "背光亮但没画面", expect: [] },
  { q: "整屏黑屏点不亮", expect: [] },
  { q: "白屏没画面", expect: [] },
  { q: "9929黑块", expect: ["显示不全异常"] },
  // 负例：泛词/无关，不应硬判子类
  { q: "显示异常", expect: [] },
  { q: "画面有问题", expect: [] },
  { q: "你好，这个怎么弄", expect: [] },
  { q: "分辨率怎么设置", expect: [] },
  { q: "搜不到设备", expect: [] },
  { q: "设备离线了", expect: [] },
];

let pass = 0;
const failed = [];
for (const c of CASES) {
  const got = sp.detectDisplaySubs(c.q);
  const ok = c.expect.length === 0
    ? got.length === 0
    : c.expect.some((e) => got.includes(e));
  if (ok) pass++;
  else failed.push({ q: c.q, expect: c.expect, got });
}

console.log(`现象识别口语测试：${pass}/${CASES.length} 通过`);
if (failed.length) {
  console.log("未通过：");
  failed.forEach((f) => console.log(`  ✗ [${f.q}] 期望含 ${JSON.stringify(f.expect)}，实得 ${JSON.stringify(f.got)}`));
  process.exit(1);
} else {
  console.log("全部通过 ✓");
}
