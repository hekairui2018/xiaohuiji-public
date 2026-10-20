"""Build reviewable candidates. Pending engineering hypotheses never enter SFT."""
import hashlib
import html
import json
import re
from collections import Counter
from pathlib import Path
from protocol import compact, validate

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'tmp/retrieval-lora-20261020/data'

# Every line is an independent customer-style scenario, not a quoted real customer.
# Direct requests have policy-reviewed labels; they do not assert product facts.
GROUPS = {
 '产品带载': [
  ('A5L带载多少', 'A5L', '带载'), ('C16L最多能管多少像素', 'C16L', '像素'),
  ('R712一张卡的控制范围在哪查', 'R712', '控制范围'), ('A3L最宽和最高能做到多少', 'A3L', '宽高'),
  ('VP620A有几个输出网口', 'VP620A', '网口'), ('R708的扫描方式支持范围', 'R708', '扫描方式'),
  ('A6L最大控制点数是哪个数', 'A6L', '控制点数'), ('R716能带多高的屏', 'R716', '高度'),
  ('A4L能接多少点，帮我核实参数', 'A4L', '带载'), ('VP820的输出接口有哪些', 'VP820', '输出接口')],
 '型号对比': [
  ('R512和R512S参数有什么区别', 'R512|R512S', '参数对比'), ('比较A5L与A6L的网口数量', 'A5L|A6L', '网口'),
  ('C16L、C36L控制范围对照一下', 'C16L|C36L', '控制范围'), ('R708跟R712接口差别', 'R708|R712', '接口'),
  ('VP210和VP410输入信号对比', 'VP210|VP410', '输入信号'), ('A3L与A4L通信方式区别', 'A3L|A4L', '通信方式'),
  ('R716相对R732最大高度有哪些不同', 'R716|R732', '最大高度'), ('请列H6和H8支持功能的区别', 'H6|H8', '功能'),
  ('B6L对比B8L的带载规格', 'B6L|B8L', '带载'), ('KV410与KV610输出端口怎么区分', 'KV410|KV610', '输出端口')],
 '固件查询': [
  ('找R712的ICN2038S固件', 'R712', '固件', 'ICN2038S'), ('A5L固件V1.2.3下载', 'A5L', '固件', '', 'V1.2.3'),
  ('R708配FM6126的固件文件在哪', 'R708', '固件', 'FM6126'), ('C16L升级包给一个', 'C16L', '升级包'),
  ('R512S驱动芯片LS9931的固件', 'R512S', '固件', 'LS9931'), ('VP620A的V1.50.39版本固件', 'VP620A', '固件', '', 'V1.50.39'),
  ('查R716的SM16169版本固件', 'R716', '固件', 'SM16169'), ('A6L历史固件V2.3.4我想核对', 'A6L', '固件', '', 'V2.3.4'),
  ('R732的ICN2153专用升级文件', 'R732', '固件', 'ICN2153'), ('C36L要查固件25.11.99.31', 'C36L', '固件', '', '25.11.99.31')],
 '软件使用': [
  ('HDPlayer怎么发节目', '', 'HDPlayer 发送节目'), ('HDSet在哪里导出参数', '', 'HDSet 导出参数'),
  ('HD Show如何加字幕', '', 'HD Show 字幕'), ('LedArt手机上怎么连接设备', '', 'LedArt 连接设备'),
  ('HD2020定时开关怎么设', '', 'HD2020 定时开关'), ('HDPlayer的U盘节目制作步骤', '', 'HDPlayer U盘节目'),
  ('HDSet我要读取接收卡参数', '', 'HDSet 读取参数'), ('LedArt怎么设置无线密码', '', 'LedArt 无线密码'),
  ('HD Show播放列表怎么编辑', '', 'HD Show 播放列表'), ('HDPlayer电脑换了怎样导入节目', '', 'HDPlayer 导入节目')],
 '操作资料': [
  ('A5L使用说明书发我', 'A5L', '说明书'), ('R712规格书在哪下载', 'R712', '规格书'),
  ('想看C16L接线教学视频', 'C16L', '接线视频'), ('VP620A用户手册要中文的', 'VP620A', '用户手册'),
  ('A3L的操作视频给我看看', 'A3L', '操作视频'), ('R708安装说明有吗', 'R708', '安装说明'),
  ('A6L接网线的图文操作文档', 'A6L', '接线文档'), ('R716要一份产品规格PDF', 'R716', '规格书'),
  ('B6L手机控制教程资料', 'B6L', '控制教程'), ('KV410调试教学视频入口', 'KV410', '调试视频')],
 '明确案例检索': [
  ('R712局部闪烁，先帮我找历史故障案例', 'R712', '局部闪烁'), ('A5L升级后黑屏有没有案例记录', 'A5L', '升级后黑屏'),
  ('C16L颜色异常的售后案例查一下', 'C16L', '颜色异常'), ('VP620A整屏随机闪，找公司处理记录', 'VP620A', '整屏随机闪'),
  ('R512S刚换模组局部不正常，搜类似案例', 'R512S', '换模组 局部异常'), ('R708换了网线还是花屏，先搜旧案例', 'R708', '换网线 花屏'),
  ('R716长期正常今天不亮，有没有历史处理经验', 'R716', '长期正常 突然不亮'), ('A6L节目发不出去，查案例不要猜原因', 'A6L', '节目发送失败'),
  ('R732的ICN2153芯片低灰异常有没有故障案例', 'R732', '低灰异常', 'ICN2153'), ('C36L刚改参数局部颜色不对，查历史记录', 'C36L', '改参数 局部颜色异常')],
 '信息缺失': [
  ('那个怎么弄', '', ''), ('不对了', '', ''), ('帮我查一下', '', ''), ('你看看吧', '', ''),
  ('我要文件', '', ''), ('这玩意不行', '', ''), ('还是一样', '', ''), ('你说呢', '', ''),
  ('给我一个', '', ''), ('查旧的那个', '', '')],
 '原文与文件': [
  ('按文件名找HD-A5L规格书 V1.3.pdf', 'HD-A5L', 'HD-A5L规格书 V1.3.pdf'),
  ('我要原文里关于ICN2038S低灰的技术说明，不要案例结论', '', 'ICN2038S 低灰', 'ICN2038S'),
  ('找文件HDPlayer功能介绍以及调试手册V3.1.pptx', '', 'HDPlayer功能介绍以及调试手册V3.1.pptx'),
  ('查R712资料原文中DCLK参数的定义', 'R712', 'DCLK 参数定义'),
  ('按名称搜索A4L A5L A6L使用手册V1.3.pdf', 'A4L|A5L|A6L', 'A4L A5L A6L使用手册V1.3.pdf'),
  ('我要LS9931低灰模式的原文解释', '', 'LS9931 低灰模式', 'LS9931'),
  ('文件名产品对比表V1.0.xlsx帮我定位', '', '产品对比表V1.0.xlsx'),
  ('R716刷新率与扫描方式的技术原文', 'R716', '刷新率 扫描方式'),
  ('按文件名查HD-A6L Specification V1.2.pdf', 'HD-A6L', 'HD-A6L Specification V1.2.pdf'),
  ('ICN2153扩展属性怎么定义，检索技术原文', '', 'ICN2153 扩展属性', 'ICN2153')]
}


def build():
    OUT.mkdir(parents=True, exist_ok=True)
    rows = []
    for category, examples in GROUPS.items():
        for i, parts in enumerate(examples):
            question, models, keywords, *extra = parts
            kind = {'产品带载':'products', '型号对比':'products', '固件查询':'firmware', '软件使用':'faq', '操作资料':'resources', '明确案例检索':'cases'}.get(category)
            if category == '原文与文件':
                kind = 'files' if i % 2 == 0 else 'text'
            if category == '信息缺失':
                target = dict(action='clarify', question='请说明要查询的设备或软件，以及具体问题。')
                groups = []
            else:
                concepts = keywords.split(' ') if ' ' in keywords and kind not in ('files',) else [keywords]
                target = dict(action='search', query=(' '.join(models.split('|')) + ' ' + keywords).strip(), kind=kind,
                              goals=[keywords], concepts=concepts[:6], models=models.split('|') if models else [], chips=[extra[0]] if extra and extra[0] else [])
                if len(extra) > 1 and extra[1]:
                    target['version'] = extra[1]
                # Alternatives express semantic equivalents, not exact JSON string matching.
                aliases = {'宽高':['宽高','最宽','最高'], '带载':['带载','像素','控制范围'], '像素':['像素','带载'],
                           '参数对比':['参数','区别','对比'], '发送节目':['发送','发节目','节目'], '升级包':['升级','固件'],
                           '接线视频':['接线'], '规格书':['规格','specification'], '局部闪烁':['局部','闪烁'],
                           '输出端口':['输出端口','输出接口','网口','端口'], '控制范围':['控制范围','带载','像素'],
                           '固件':['固件','升级'], '控制教程':['教程','手机控制'], '低灰异常':['低灰'],
                           '改参数':['改参数','参数修改','参数变更'], '局部颜色异常':['局部颜色','颜色异常','颜色不对']}
                groups = [aliases.get(keywords, [keywords])] if kind != 'files' else [[keywords]]
                if category == '软件使用':
                    software = next(n for n in ['HDPlayer','HDSet','HD Show','LedArt','HD2020'] if n in question)
                    groups = [[software,software.replace(' ','')]]
                if category == '明确案例检索':
                    groups = [aliases.get(t,[t]) for t in re.split(r'\s+', keywords)]
            validate(target)
            split = 'train' if i < 6 else 'validation' if i < 8 else 'test'
            rows.append(dict(id=f'route-{len(rows)+1:03}', category=category, group_id=f'{category}-{i}', split=split,
                             customer=question, target=target, keyword_groups=groups, status='policy_reviewed',
                             reviewer='local_agent_direct_intent_audit', human_reviewed=False,
                             basis='用户明确检索意图 + 现有工具协议/资料分类；未标注诊断原因',
                             source={'type':'synthetic_customer_style', 'reference':'v2/model-adapter/retrieval-scope-map.cjs'}))
    # Real case phenomenon text only. Never expose historicalSolution/checks to model.
    knowledge_path = ROOT / 'v2/data/knowledge-next/knowledge-fc9f11a1e72de750/index.json'
    knowledge = json.loads(knowledge_path.read_text(encoding='utf-8-sig'))
    cases = [c for c in knowledge['cases'] if c.get('modelIds') and '原表未填写' not in c.get('phenomenon','')]
    seen = set()
    for case in cases:
        lines = list(dict.fromkeys(x.strip() for x in case['phenomenon'].splitlines() if x.strip()))
        phenomenon = lines[0][:180]
        if phenomenon in seen:
            continue
        seen.add(phenomenon)
        index = len(rows)-80
        if index == 20:
            break
        models = case['modelIds'][:4]
        chips = case.get('scope',{}).get('chips',[])[:4]
        # Do not add a chip/model to the input unless present in that source's phenomenon.
        customer = ' '.join([*models, phenomenon])
        chips = [x for x in chips if x in customer]
        target = dict(action='search', query=customer[:240], kind='cases', goals=['核对相似现象和适用条件'], concepts=[phenomenon[:32]], models=models, chips=chips)
        validate(target)
        rows.append(dict(id=f'route-{len(rows)+1:03}', category='真实故障待审核', group_id=case['stableId'],
                         split='train' if index<12 else 'validation' if index<16 else 'test', customer=customer,
                         target=target, keyword_groups=[], status='pending_engineer_review', human_reviewed=False,
                         reviewer=None, basis='案例中有此现象，但先搜案例是否最优尚未经工程师确认；候选动作不代表诊断结论',
                         source={'type':'case_phenomenon_only', 'reference':str(knowledge_path.relative_to(ROOT)), 'case_id':case['stableId'],
                                 'input_composition':'案例元数据中的型号 + 归档现象；不是客户逐字会话原文', 'original_phenomenon':phenomenon}))
    assert len(rows) == 100
    assert len({r['customer'].strip().casefold() for r in rows}) == 100
    assert len({r['group_id'] for r in rows}) == 100
    for row in rows:
        validate(row['target'])
    (OUT/'candidates.jsonl').write_text('\n'.join(compact(r) for r in rows)+'\n',encoding='utf-8')
    for split in ['train','validation','test']:
        selected = [r for r in rows if r['split']==split and r['status']=='policy_reviewed']
        (OUT/f'{split}.jsonl').write_text('\n'.join(compact(r) for r in selected)+'\n',encoding='utf-8')
    summary = {'total':len(rows),'statuses':dict(Counter(r['status'] for r in rows)), 'splits':{s:dict(Counter(r['status'] for r in rows if r['split']==s)) for s in ['train','validation','test']},
               'candidate_sha256':hashlib.sha256((OUT/'candidates.jsonl').read_bytes()).hexdigest(),
               'limitations':['policy_reviewed表示自动审计明确查询意图，不等于工程师审核','80条明确查询为合成客户表达；20条真实案例现象为待审核候选','仅字面/案例组去重，小样本仍不能证明跨场景工程能力']}
    (OUT/'manifest.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
    table = ''.join('<tr class="'+('pending' if r['status']=='pending_engineer_review' else '')+'">'+''.join('<td>'+html.escape(str(v))+'</td>' for v in [r['id'],r['split'],r['status'],r['category'],r['customer'],compact(r['target']),r['basis']])+'</tr>' for r in rows)
    page = '''<!doctype html><meta charset="utf-8"><title>小灰机第一步检索：100条候选审核</title><style>body{font:15px system-ui;margin:24px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:8px;text-align:left;vertical-align:top}th{position:sticky;top:0;background:#e7f4ee}td:nth-child(6){font:12px monospace;max-width:430px;overflow-wrap:anywhere}input{padding:10px;width:70%}tr.pending{background:#fff7de}</style><h1>第一步检索样本审核</h1><p>80条明确意图经本地规则/代码审核，未冒充人工审核；20条真实案例现象的第一步动作待工程师确认，已排除出训练和主评分。训练48、验证16、独立测试16。所有标签只决定查什么，不包含产品参数或维修答案。</p><p>检索不足/资料冲突不由本模型裁决。测试标签不会进入训练提示词。</p><input placeholder="筛选型号、类别、待审核或编号" oninput="for(const r of document.querySelectorAll('tbody tr'))r.hidden=!r.innerText.toLowerCase().includes(this.value.toLowerCase())"><table><thead><tr>'''+''.join('<th>'+x+'</th>' for x in ['编号','划分','审核状态','类别','客户原话/候选表达','首步JSON','标签依据'])+'</tr></thead><tbody>'+table+'</tbody></table>'
    (OUT/'review.html').write_text(page,encoding='utf-8')
    print(json.dumps(summary,ensure_ascii=False))


if __name__ == '__main__':
    build()
