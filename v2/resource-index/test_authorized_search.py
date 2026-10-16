"""Synthetic scope/candidate tests; no company records or model required."""
import tempfile,unittest
from pathlib import Path
from unittest.mock import patch
import engine


class AuthorizedSearchTests(unittest.TestCase):
 def setUp(self):
  (engine.PROJECT/'tmp').mkdir(parents=True,exist_ok=True)
  self.models=patch('engine.known_product_models',return_value={'Z9','Z9L'})
  self.models.start();self.addCleanup(self.models.stop)
  self.tmp=tempfile.TemporaryDirectory(dir=engine.PROJECT/'tmp')
  self.root=Path(self.tmp.name)/'original';self.root.mkdir()
  self.work=Path(self.tmp.name)/'index'
  for name,text in [('Z9.txt','Z9 测试参数\n测试动作'),('Z9L.txt','Z9L 测试参数\n测试动作')]:
   (self.root/name).write_text(text,encoding='utf8')
  engine.scan(self.root,self.work);engine.index_documents(self.work)
  self.allowed=engine.digest(self.root/'Z9.txt')
 def tearDown(self):self.tmp.cleanup()
 def test_empty_scope_returns_nothing(self):
  self.assertEqual(engine.query(self.work,'测试',authorized_keys=[])['results'],[])
 def test_scoped_text_and_files_never_include_other_hash(self):
  for mode in ['files','text','all']:
   result=engine.query(self.work,'Z9' if mode=='files' else '测试',mode,authorized_keys=[self.allowed])
   self.assertTrue(result['results'])
   self.assertEqual({r['sha256'] for r in result['results']},{self.allowed})
 def test_model_suffix_cannot_be_widened_by_scope(self):
  self.assertEqual(engine.query(self.work,'测试',model='Z9L',authorized_keys=[self.allowed])['results'],[])
 def test_scope_precedes_candidate_truncation(self):
  db=engine.connect(self.work)
  other=engine.digest(self.root/'Z9L.txt')
  # More than the 600 passage candidate limit. These can never crowd out an
  # authorized record when scope is applied before that limit.
  for i in range(700):
   text='测试动作 '*5
   cur=db.execute('insert into blocks(hash,ordinal,locator,text,text_hash,models) values(?,?,?,?,?,?)',(other,i+100,'{}',text,str(i),'[]'))
   db.execute('insert into block_fts(rowid,tokens) values(?,?)',(cur.lastrowid,engine.fts_tokens(text)))
  db.commit();db.close()
  r=engine.query(self.work,'测试动作','text',limit=1,authorized_keys=[self.allowed])
  self.assertEqual(len(r['results']),1);self.assertEqual(r['results'][0]['sha256'],self.allowed)
 def test_metadata_only_resource_scope(self):
  (self.root/'binary.exe').write_bytes(b'synthetic binary, not executable')
  engine.scan(self.root,self.work);db=engine.connect(self.work,True)
  rid=db.execute("select resource_id from locations where name='binary.exe'").fetchone()[0];db.close()
  r=engine.query(self.work,'binary','files',authorized_keys=['metadata:'+rid])
  self.assertEqual([x['name'] for x in r['results']],['binary.exe'])

if __name__=='__main__':unittest.main()
