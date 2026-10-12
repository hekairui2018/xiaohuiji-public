# -*- coding: utf-8 -*-
"""把《异步全彩问题经验分享.docx》确定性解析为 sources 标准案例索引。
结构：Title=章(系列) / Heading2=型号(通用章里是问题名) / Normal=现象段，遇到“解决方法：”即产出一条。
不做语义猜测，只按样式与“解决方法”锚点切分；每条保留原文与段落定位。
"""
import docx, re, json, sys, io, os
from datetime import datetime
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

SRC = r"C:\Users\HD\Downloads\异步全彩问题经验分享.docx"
OUT = r"D:\xiaohuiji\data\aftersales\sources\03_售后案例库_异步全彩docx重提取_20260911.json"

d = docx.Document(SRC)
ps = d.paragraphs

MEDIA = re.compile(r"\.(mp4|mov|avi|jpg|jpeg|png|gif|bmp|wmv|mkv)$", re.I)
PURE_NOISE = re.compile(r"^[\s\d.、)）]*$")
SOL = re.compile(r"^[。.\s]*(?:临时)?解决(?:方法|方案)\s*[:：]?\s*(.*)$", re.S)
CHIP = re.compile(r"(?<![A-Za-z])(?:(?:SM|HX|ICND?|DP|FM|LS|CNS|MBI|TC|RUC|RUL|LYD|GC|MY|TL|RT|CFD|SUM)\d{1,5}|3[23]6\d{1,3})[A-Z]{0,3}", re.I)
PITCH = re.compile(r"P\d(?:\.\d{1,2})?")
SCAN = re.compile(r"\b\d{1,3}S\b")
VER = re.compile(r"[Vv]?\d{1,2}\.\d{1,2}(?:\.\d{1,2}){0,2}")
MODELISH = re.compile(r"^[A-Z]{1,3}\d{0,4}[A-Z]{0,2}$")

def uniq(seq):
    out, seen = [], set()
    for x in seq:
        k = x.upper()
        if x and k not in seen:
            seen.add(k); out.append(x)
    return out

cases = []
chapter = ""; generic = False; model = ""; topic = ""; phen = []
seq = 0
start_para = 0

def flush(solution, end_i):
    global seq
    sol = re.sub(r"\s+", " ", solution).strip()
    if len(sol) < 4:
        return
    phen_text = re.sub(r"\s+", " ", " ".join(phen)).strip()
    if not phen_text:
        phen_text = topic if generic and topic else (f"{model}相关问题" if model else "异步全彩问题")
    seq += 1
    blob = f"{phen_text} {sol}"
    chips = [m.group(0).upper() for m in CHIP.finditer(blob)]
    pitches = [m.group(0).upper() for m in PITCH.finditer(blob)]
    scans = [m.group(0) for m in SCAN.finditer(blob)]
    vers = [m.group(0) for m in VER.finditer(blob)]
    products = [model] if (model and MODELISH.match(model.upper())) else []
    title_core = (topic if generic else phen_text)[:24]
    title = f"{model+' ' if model else ''}{title_core}".strip()
    excerpt = f"{phen_text} 解决方法：{sol}"
    cases.append({
        "id": f"ASYNC-DOCX-{seq:03d}",
        "title": title,
        "entryType": "case",
        "caseStatus": "closed_loop",
        "sourceType": "真实售后经验原文结构化-异步全彩docx",
        "confidence": "B-原文有明确解决方法",
        "reviewStatus": "docx样式确定性切分",
        "customerWording": phen_text,
        "category": ["异步全彩"],
        "deviceInfo": {
            "series": chapter,
            "products": products,
            "chips": uniq(chips),
            "pitches": uniq(pitches),
            "scans": uniq(scans),
            "softwareVersions": [],
            "firmwareVersions": uniq(vers),
        },
        "phenomenon": phen_text,
        "phenomenonTags": [],
        "phenomenonTerms": [],
        "troubleshooting": "【原文未单列排查过程】",
        "engineeringReasoning": "【原文未单列原因分析】",
        "finalCause": "【原文未单列最终原因】",
        "solution": sol,
        "applicability": "按原文设备与现象匹配；相似现象仅作排查参考。",
        "keywords": uniq(products + chips + pitches),
        "source": {
            "fileName": "异步全彩问题经验分享.docx",
            "chapter": chapter,
            "model": model or topic,
            "paraRange": [start_para, end_i],
            "fullPath": SRC,
        },
        "sourceExcerpt": excerpt[:600],
    })

for i, p in enumerate(ps):
    t = p.text.strip()
    style = p.style.name
    if not t:
        continue
    if style == "Title":
        if "异步全彩问题经验分享" == t:
            continue
        chapter = t.replace("第.", "").strip()
        generic = "通用" in t
        model = ""; topic = ""; phen = []
        start_para = i
        continue
    if style == "Heading 2":
        phen = []
        if generic:
            topic = t; model = ""
        else:
            model = t; topic = ""
        start_para = i
        continue
    # Normal
    if MEDIA.search(t) or PURE_NOISE.match(t):
        continue
    ms = SOL.match(t)
    if ms:
        flush(ms.group(1), i)
        phen = []
    else:
        phen.append(t)

out = {
    "sourceFile": "异步全彩问题经验分享.docx",
    "generatedAt": datetime.now().isoformat(timespec="seconds"),
    "extractRule": "Title=章/Heading2=型号(通用章为问题名)/Normal现象+解决方法成对",
    "count": len(cases),
    "cases": cases,
}
os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, indent=1)

# 统计与抽样
from collections import Counter
print("产出案例:", len(cases))
print("章分布:", dict(Counter(c["deviceInfo"]["series"][:6] for c in cases)))
print("带型号:", sum(1 for c in cases if c["deviceInfo"]["products"]))
print("带芯片:", sum(1 for c in cases if c["deviceInfo"]["chips"]))
for c in cases[:3] + cases[-2:]:
    print("---", c["id"], c["deviceInfo"]["products"], c["deviceInfo"]["chips"])
    print("  现象:", c["phenomenon"][:60])
    print("  解法:", c["solution"][:60])
print("输出:", OUT)
