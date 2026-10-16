"""Independent loopback UI/API. Does not bind 4499/4510 or change either app."""
import argparse,json,mimetypes,shutil
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs,urlsplit,quote
from common import WORK,load,sha
from conversation import Conversation
from tools import Tools,ToolError

PAGE='''<!doctype html><meta charset="utf-8"><title>小灰机 · 本地三组对照</title><style>body{font:17px/1.6 system-ui;max-width:1000px;margin:35px auto;padding:20px}textarea{width:96%;height:110px;font:inherit}button,select{font:inherit;padding:10px;margin:10px 8px 0 0}pre{white-space:pre-wrap;background:#f3f5f8;padding:18px}</style><h1>资料搜索与本地问答 · 独立测试</h1><p>不影响现有网站。工程经验未经现场验证，模型回答仅供本轮验收。</p><select id="mode"><option value="direct">直接搜资料，不用AI</option><option value="hybrid">27B查资料后回答</option><option value="bare">27B不查资料对照</option></select><button id="new">新客户会话</button><textarea id="q" placeholder="输入型号、资料名或客户问题"></textarea><button id="go">提交</button><p id="status"></p><pre id="out"></pre><div id="links"></div><script>
let session=crypto.randomUUID();document.querySelector('#new').onclick=()=>{session=crypto.randomUUID();document.querySelector('#out').textContent='已新建独立会话'};document.querySelector('#go').onclick=async()=>{const mode=document.querySelector('#mode').value,q=document.querySelector('#q').value;document.querySelector('#status').textContent='处理中…';try{let url=mode==='direct'?'/tool':'/chat',body=mode==='direct'?{name:'search_resources',arguments:{query:q}}:{question:q,session,arm:mode,runId:crypto.randomUUID()};const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),r=await response.json();document.querySelector('#out').textContent=r.answer||JSON.stringify(r,null,2);document.querySelector('#status').textContent=r.seconds!==undefined?r.seconds+' 秒':'只读检索完成';const links=document.querySelector('#links');links.replaceChildren();for(const row of r.results||[]){if(row.download){const a=document.createElement('a');a.textContent=row.sourceName;a.href=row.download;links.append(a,document.createElement('br'))}}}catch(e){document.querySelector('#status').textContent='请求未完成：'+e.message}};</script>'''

def server(port=4512):
 app=Conversation()
 class Handler(BaseHTTPRequestHandler):
  def log_message(self,*args):pass
  def send(self,status,value,kind='application/json; charset=utf-8'):
   data=value.encode() if isinstance(value,str) else json.dumps(value,ensure_ascii=False).encode();self.send_response(status);self.send_header('Content-Type',kind);self.send_header('Content-Length',str(len(data)));self.send_header('X-Content-Type-Options','nosniff');self.end_headers();self.wfile.write(data)
  def do_GET(self):
   u=urlsplit(self.path);q=parse_qs(u.query)
   if u.path=='/':return self.send(200,PAGE,'text/html; charset=utf-8')
   if u.path=='/health':return self.send(200,{'ok':True,'mode':'isolated-three-arm-trial','indexReused':True,'modelLivenessNotProbed':True})
   if u.path=='/experiment/cases':
    try:return self.send(200,{'cases':[{k:c[k] for k in ['id','question','split']} for c in load('cases.json')]})
    except OSError:return self.send(404,{'error':'experiment-not-prepared'})
   if u.path=='/download':
    rid=q.get('resourceId',[''])[0];vid=q.get('versionId',[''])[0];r=next((r for r in app.tools.policy.values() if r['resourceId']==rid and r['versionId']==vid and not r['restricted'] and r['downloadAllowed']),None)
    if not r:return self.send(404,{'error':'not-authorized-for-download'})
    try:
     loc=r['locations'][0];p=Path(loc['path']);s=p.stat()
     if s.st_size!=loc['bytes'] or s.st_mtime_ns!=loc['mtime_ns'] or sha(p)!=loc['sha256']:return self.send(409,{'error':'original-file-changed'})
     self.send_response(200);self.send_header('Content-Type',mimetypes.guess_type(p.name)[0] or 'application/octet-stream');self.send_header('Content-Length',str(s.st_size));self.send_header('Content-Disposition',"attachment; filename*=UTF-8''"+quote(p.name));self.end_headers()
     with p.open('rb') as f:shutil.copyfileobj(f,self.wfile)
     return
    except OSError:return self.send(503,{'error':'original-unavailable'})
   return self.send(404,{'error':'not-found'})
  def do_POST(self):
   if self.headers.get('Origin') not in [None,'http://127.0.0.1:'+str(self.server.server_port)]:return self.send(403,{'error':'origin-not-allowed'})
   try:
    size=int(self.headers.get('Content-Length','0'))
    if not 0<size<=12000:return self.send(400,{'error':'request-size'})
    body=json.loads(self.rfile.read(size));path=urlsplit(self.path).path
    if path=='/tool':return self.send(200,app.tools.execute(body['name'],body['arguments']))
    if path=='/chat':
     if body.get('modelDisabled'):return self.send(503,{'error':'model-disconnected-for-local-test','answer':'模型连接已关闭；仍可使用产品速查和原文检索。','modelCalls':[]})
     if body.get('evidenceCase'):
      from evidence_experiment import complete_chat
      return self.send(200,complete_chat(body['evidenceCase'],body['question'],body['session'],body['runId']))
     return self.send(200,app.chat(body['question'],body['session'],body.get('arm','hybrid'),body.get('directMode'),body.get('filters'),body.get('runId')))
    return self.send(404,{'error':'not-found'})
   except ToolError as e:return self.send(400,{'error':str(e)})
   except (ValueError,TypeError,KeyError):return self.send(400,{'error':'invalid-or-unauthorized-request'})
   except Exception:return self.send(500,{'error':'trial-request-failed'})
 return ThreadingHTTPServer(('127.0.0.1',port),Handler)

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--port',type=int,default=4512);p.add_argument('--work');a=p.parse_args()
 if a.work:
  from evidence_experiment import configure
  configure(a.work)
 s=server(a.port);print('Local tool backend http://127.0.0.1:'+str(s.server_port),flush=True);s.serve_forever()
