"""Two explicitly separate post-baseline trials; never replace the frozen 40."""
import threading,time
from common import WORK,load,save,sha
import trial_http,run

def main():
 before={p.name:sha(p) for p in (WORK/'results').glob('*.json')}
 s=trial_http.server(0);threading.Thread(target=s.serve_forever,daemon=True).start();run.BASE='http://127.0.0.1:'+str(s.server_port)
 rows=[]
 try:
  for q in load('questions.json'):
   if q['id'] not in ['P01','P02']:continue
   out=run.request('/chat',{'question':q['question'],'session':'date-fix-'+q['id'],'arm':'hybrid','runId':'date-fix-'+q['id']})
   rows.append({'question':q,'result':out,'comparison':'post-baseline metadata-date fix only; original 40 and their scores untouched'})
   print(q['id'],out.get('answer'),flush=True)
 finally:s.shutdown();s.server_close()
 assert before=={p.name:sha(p) for p in (WORK/'results').glob('*.json')}
 save(WORK/'post-baseline-date-fix.json',{'baselineResultsUnchanged':True,'rows':rows})

if __name__=='__main__':main()
