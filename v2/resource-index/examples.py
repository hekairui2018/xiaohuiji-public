"""Three literal independent records and a non-diagnostic cross-case grouping."""
import csv
import hashlib
import io
import json
from pathlib import Path
import engine as e


def build(work):
    db=e.connect(work,True)
    target='常见问题解答FQA表_异步全彩产品问题.csv'
    loc=db.execute("SELECT * FROM locations WHERE name=? AND state='present'",(target,)).fetchone()
    raw=list(csv.reader(io.StringIO(e.decode(Path(loc['path']).read_bytes()))))
    cases=[]
    for row_number in [2,3,4]:
        row=raw[row_number-1]
        block=db.execute('SELECT id,text,locator FROM blocks WHERE hash=? AND ordinal=?',(loc['sha256'],row_number-1)).fetchone()
        cases.append({'caseId':e.identifier('example-case-',loc['resource_id']+'|'+str(row_number)),
            'phenomenon':row[1],'reportedAction':row[2],'checks':[],
            'scope':{'literalCustomerCondition':row[1],'unrecordedFields':'No hardware/chip/version applicability is invented'},
            'result':'not-explicitly-recorded','sourceType':'manual-record-origin-unverified',
            'sourceReference':{'sha256':loc['sha256'],'resourceId':loc['resource_id'],'blockId':block['id'],'locator':json.loads(block['locator']),'path':loc['path']},
            'rawFields':{'date':row[0],'question':row[1],'reportedSolution':row[2],'keywords':row[3]},
            'recordKind':'short-experience-no-invented-diagnostic-process'})
    combined={'experienceId':'example-hdplayer-preview','subject':'HDPlayer文本预览异常相关记录',
        'groupingOnly':True,'notAnEngineeringConclusion':True,'caseIds':[c['caseId'] for c in cases[:2]],
        'differences':[{'caseId':cases[0]['caseId'],'sourceAction':cases[0]['reportedAction']},{'caseId':cases[1]['caseId'],'sourceAction':cases[1]['reportedAction']}],
        'sharedProcedure':None,'inference':'Only a retrieval grouping by software and observed display symptom. Different source actions remain separate, not a universal remedy.',
        'sourceReferences':[c['sourceReference'] for c in cases[:2]]}
    result={'status':'small-candidate-demonstration-not-active-knowledge','cases':cases,'combinedExperiences':[combined]}
    (Path(work)/'aftersales-dual-track-examples.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8');db.close();return {'independentCases':len(cases),'experienceGroups':1,'inventedChecks':0,'resultConfirmed':0}


if __name__=='__main__':print(e.J(build(e.DEFAULT_WORK)))
