"""Local candidate browser; never imported by the default customer server."""
import argparse
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import mimetypes
import re
import os
from pathlib import Path
import shutil
from urllib.parse import parse_qs, urlsplit
import engine

PAGE='''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>小灰机 · 原始资料候选检索</title>
<style>body{font:16px system-ui;max-width:1000px;margin:32px auto;padding:0 20px;color:#173047}input,select,button{font:inherit;padding:9px}input{width:45%}article{border-bottom:1px solid #d9e1e8;padding:20px 0}pre{white-space:pre-wrap;background:#f4f7f9;padding:12px;max-height:450px;overflow:auto}small{display:block;color:#53687a;overflow-wrap:anywhere}a,button{cursor:pointer;color:#175e91}#detail{border:1px solid #c8d6e2;padding:16px;margin-top:20px}</style>
<h1>原始资料检索 · 候选版</h1><p>文件、正文和证据位置检索。型号提及不代表硬件兼容；未连接大模型。</p>
<form id="form"><input id="q" placeholder="型号、文件名或正文关键词" required><select id="mode"><option value="all">全部</option><option value="files">文件和路径</option><option value="text">正文</option></select><button>搜索</button></form>
<p id="status"></p><div id="results"></div><section id="detail" hidden></section>
<script>
const el=id=>document.getElementById(id),make=(tag,text)=>{const e=document.createElement(tag);e.textContent=text;return e};
const place=l=>{if(!l)return '文件资源';let p=[];if(l.page)p.push('第 '+l.page+' 页');if(l.slide)p.push('第 '+l.slide+' 张幻灯片');if(l.sheet)p.push('工作表：'+l.sheet);if(l.section)p.push('章节：'+l.section);if(l.paragraph)p.push('第 '+l.paragraph+' 段');if(l.table)p.push('表 '+l.table);if(l.row)p.push('原始记录第 '+l.row+' 行');if(l.line)p.push('第 '+l.line+' 行');if(l.noteParagraph)p.push('演讲备注第 '+l.noteParagraph+' 段');return p.join(' · ')||'原文片段'};
el('form').onsubmit=async e=>{e.preventDefault();el('results').replaceChildren();el('status').textContent='查询中…';try{let r=await fetch('/search?q='+encodeURIComponent(el('q').value)+'&mode='+el('mode').value).then(r=>r.json());if(r.error)throw Error(r.error);el('status').textContent=r.results.length+' 条 · '+r.elapsedMs+' ms';for(let h of r.results){let a=make('article','');a.append(make('strong',h.name));a.append(make('small',place(h.locator)+' · '+(h.versions.join(', ')||'版本未标注')));if(h.text)a.append(make('pre',h.text));for(let l of h.locations){let link=make('a',l.path);link.href='/resource?id='+l.id;link.target='_blank';a.append(make('div','').appendChild(link));}if(h.blockId){let b=make('button','阅读上下文');b.onclick=async()=>{let d=await fetch('/read?block='+h.blockId).then(r=>r.json());el('detail').hidden=false;el('detail').replaceChildren(make('h2','原文上下文'));for(let p of d.blocks||[]){el('detail').append(make('small',place(p.locator)),make('pre',p.text));}el('detail').scrollIntoView();};a.append(b);}el('results').append(a);}}catch(e){el('status').textContent='查询失败：'+e.message;}};
</script></html>'''


def create_server(work, port=0):
    work=Path(work).resolve()
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args):pass
        def send(self,code,value,content_type='application/json; charset=utf-8'):
            b=value.encode('utf8') if isinstance(value,str) else json.dumps(value,ensure_ascii=False).encode('utf8')
            self.send_response(code);self.send_header('Content-Type',content_type);self.send_header('Content-Length',str(len(b)));self.send_header('X-Content-Type-Options','nosniff');self.end_headers();self.wfile.write(b)
        def do_POST(self):
            route=urlsplit(self.path).path
            if route not in ('/resolve-documents','/resolve-assets'):return self.send(404,{'error':'not-found'})
            try:
                length=int(self.headers.get('Content-Length','0'))
                if length<1 or length>512*1024:return self.send(413,{'error':'invalid-body-size'})
                body=json.loads(self.rfile.read(length))
                if not isinstance(body,dict):raise ValueError('invalid-request')
                return self.send(200,(engine.resolve_assets if route=='/resolve-assets' else engine.resolve_documents)(work,body.get('items')))
            except (ValueError,KeyError):return self.send(400,{'error':'invalid-request'})
            except Exception:return self.send(503,{'error':'resource-resolution-unavailable'})
        def do_GET(self):
            u=urlsplit(self.path);q=parse_qs(u.query);first=lambda k,d='':q.get(k,[d])[0]
            try:
                if u.path=='/':return self.send(200,PAGE,'text/html; charset=utf-8')
                if u.path=='/health':return self.send(200,{'ok':True,'mode':'isolated-resource-candidate','aiEnabled':False,'pid':os.getpid()})
                if u.path=='/catalog':
                    db=engine.connect(work,True)
                    try:
                        from catalog_metadata import catalog
                        rows=catalog(db,work)
                    finally:db.close()
                    return self.send(200,{'resources':rows})
                if u.path=='/search':return self.send(200,engine.query(work,first('q'),first('mode','all'),first('model') or None,int(first('limit','10')),first('version') or None,group_documents=first('group_documents')=='1'))
                if u.path=='/proximity/search':
                    import proximity
                    return self.send(200,proximity.search(work,first('q'),first('scope','text'),json.loads(first('concepts','null')),json.loads(first('models','[]')),first('version') or None,json.loads(first('chips','[]')),int(first('limit','4')),json.loads(first('documents','null'))))
                if u.path=='/proximity/read':
                    import proximity
                    return self.send(200,proximity.read(work,int(first('block')),int(first('anchor','0')),int(first('offset','0'))))
                if u.path=='/read':return self.send(200,engine.read_block(work,int(first('block'))))
                if u.path in ('/resource','/preview-document') or u.path.startswith('/v2/resources/original/'):
                    db=engine.connect(work,True)
                    if u.path in ('/resource','/preview-document'):row=db.execute("SELECT * FROM locations WHERE id=? AND state='present'",(int(first('id')),)).fetchone()
                    else:row=db.execute("SELECT * FROM locations WHERE sha256=? AND state='present' LIMIT 1",(u.path.rsplit('/',1)[-1],)).fetchone()
                    roots=[Path(r[0]).resolve() for r in db.execute('SELECT DISTINCT root FROM scans WHERE finished IS NOT NULL')];db.close()
                    if not row or row['kind']=='sensitive-metadata-only':return self.send(404,{'error':'resource-not-found'})
                    p=Path(row['path']).resolve()
                    if not any(p==root or root in p.parents for root in roots):return self.send(403,{'error':'outside-source-root'})
                    s=p.stat()
                    if (s.st_size,s.st_mtime_ns)!=(row['bytes'],row['mtime_ns']):return self.send(409,{'error':'resource-changed-rescan-required'})
                    if row['sha256'] and engine.digest(p)!=row['sha256']:return self.send(409,{'error':'resource-hash-mismatch'})
                    if u.path=='/preview-document':
                        offset=int(first('offset','0'))
                        if offset<0 or offset>100000:return self.send(400,{'error':'invalid-offset'})
                        db=engine.connect(work,True)
                        try:
                            blocks=db.execute('SELECT id,ordinal,locator,text FROM blocks WHERE hash=? ORDER BY ordinal LIMIT 51 OFFSET ?',(row['sha256'],offset)).fetchall()
                        finally:db.close()
                        return self.send(200,{'name':p.name,'sha256':row['sha256'],'offset':offset,'nextOffset':offset+50 if len(blocks)>50 else None,'blocks':[{'id':b['id'],'locator':json.loads(b['locator']),'text':b['text']} for b in blocks[:50]]})
                    start,end=0,s.st_size-1;partial=False
                    header=self.headers.get('Range')
                    if header:
                        match=re.fullmatch(r'bytes=(\d*)-(\d*)',header)
                        if not match or not any(match.groups()):return self.send(416,{'error':'invalid-range'})
                        if match[1]:start=int(match[1]);end=min(int(match[2]) if match[2] else end,end)
                        else:start=max(0,s.st_size-int(match[2]))
                        if start>end or start>=s.st_size:
                            self.send_response(416);self.send_header('Content-Range',f'bytes */{s.st_size}');self.end_headers();return
                        partial=True
                    self.send_response(206 if partial else 200);self.send_header('Content-Type',mimetypes.guess_type(p.name)[0] or 'application/octet-stream');self.send_header('Content-Length',str(end-start+1));self.send_header('X-Content-Type-Options','nosniff');self.send_header('Accept-Ranges','bytes')
                    if partial:self.send_header('Content-Range',f'bytes {start}-{end}/{s.st_size}')
                    # Never execute local HTML/JS when accessed as a resource.
                    from urllib.parse import quote
                    self.send_header('Content-Disposition',"attachment; filename*=UTF-8''"+quote(p.name));self.end_headers()
                    with p.open('rb') as f:
                        f.seek(start);remaining=end-start+1
                        while remaining:
                            chunk=f.read(min(1024*1024,remaining))
                            if not chunk:break
                            self.wfile.write(chunk);remaining-=len(chunk)
                    return
                return self.send(404,{'error':'not-found'})
            except (KeyError,ValueError):return self.send(400,{'error':'invalid-request'})
            except (BrokenPipeError,ConnectionResetError,ConnectionAbortedError):return
            except OSError:return self.send(503,{'error':'resource-unavailable'})
            except Exception:return self.send(500,{'error':'query-failed'})
    return ThreadingHTTPServer(('127.0.0.1',port),Handler)


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--work',default=str(engine.DEFAULT_WORK));p.add_argument('--port',type=int,default=4510);a=p.parse_args()
    server=create_server(a.work,a.port);print('Local candidate: http://127.0.0.1:'+str(server.server_port),flush=True);server.serve_forever()
