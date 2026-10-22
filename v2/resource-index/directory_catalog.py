"""Registered source-directory metadata only; no scans, parsing or body reads."""
from pathlib import Path
import json
EXTENSIONS={'.pdf','.doc','.docx','.ppt','.pptx','.xls','.xlsx','.csv','.wps','.txt','.md','.bin','.img','.ssr','.ssx','.rcfg','.rcfgx','.zip','.rar','.7z','.mp4','.mov','.webm','.exe','.msi','.apk'}
DEPENDENCIES={'node_modules','__pycache__','.git','qml','qmlcache','plugins','translations','cache','caches'}
def directory_catalog(db):
    parsed={r['hash']:dict(r) for r in db.execute('SELECT hash,state,blocks FROM parses')}
    rows=[]
    for r in db.execute("SELECT * FROM locations WHERE state='present' AND kind!='sensitive-metadata-only' ORDER BY path"):
        path=Path(r['path']);parts=list(path.parts[1:-1]);ext=path.suffix.lower()
        if path.drive.upper()!='G:':continue
        if ext not in EXTENSIONS or any(p.lower() in DEPENDENCIES for p in parts):continue
        status=parsed.get(r['sha256'],{}) if r['kind']=='document' else {}
        rows.append({'name':r['name'],'locationId':r['id'],'resourceId':r['resource_id'],'versionId':r['version_id'],'sha256':r['sha256'],'sizeBytes':r['bytes'],'availabilityState':r['state'],'folders':parts,'sourceDrive':path.drive.upper(),'parseStatus':{'state':status.get('state','not-parsed'),'blockCount':status.get('blocks',0)},'searchContent':'parsed-body' if status.get('blocks',0)>0 else 'file-metadata-only'})
    return {'directoryCatalogVersion':1,'resources':rows}
