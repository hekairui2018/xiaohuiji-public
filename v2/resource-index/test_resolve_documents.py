import unittest,tempfile,hashlib
from unittest.mock import patch
from pathlib import Path
import engine

class ResolveDocumentsTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory(dir=engine.PROJECT/'tmp');self.root=Path(self.tmp.name)/'originals';self.root.mkdir();self.work=Path(self.tmp.name)/'index'
  for folder,text in [('one','R712 V1 original'),('copy','R712 V1 original'),('conflict','different version same filename')]:
   (self.root/folder).mkdir();(self.root/folder/'R712 V1.txt').write_text(text,encoding='utf8')
  (self.root/'A3L V1.txt').write_text('A3L original',encoding='utf8');engine.scan(self.root,self.work)
 def tearDown(self):self.tmp.cleanup()
 def test_ambiguous_names_are_not_linked_and_known_hash_selects_exact_content(self):
  sha=engine.digest(self.root/'one'/'R712 V1.txt')
  result=engine.resolve_documents(self.work,[{'name':'R712 V1.txt'},{'name':'R712 V1.txt','sha256':sha},{'name':'R712 V1.txt','sha256':'0'*64}])['results']
  self.assertEqual(result[0]['reason'],'same-name-content-conflict');self.assertTrue(result[1]['available']);self.assertEqual(result[1]['sha256'],sha);self.assertEqual(result[2]['reason'],'registered-content-does-not-match-source')
 def test_model_suffixes_versions_paths_and_changed_files_never_substitute(self):
  result=engine.resolve_documents(self.work,[{'name':'A3 V1.txt'},{'name':'A3L V2.txt'},{'name':'../A3L V1.txt'},{'name':'A3L V1.txt'}])['results']
  self.assertEqual([r['available'] for r in result],[False,False,False,True])
  (self.root/'A3L V1.txt').write_text('changed after inventory',encoding='utf8')
  self.assertEqual(engine.resolve_documents(self.work,[{'name':'A3L V1.txt'}])['results'][0]['reason'],'registered-original-unavailable-or-changed')
 def test_resolution_does_not_modify_database_or_originals(self):
  db=self.work/'resources.db';before=engine.digest(db);original=engine.digest(self.root/'A3L V1.txt')
  engine.resolve_documents(self.work,[{'name':'A3L V1.txt'}])
  self.assertEqual(engine.digest(db),before);self.assertEqual(engine.digest(self.root/'A3L V1.txt'),original)
 def test_brand_and_multi_model_separators_are_formatting_not_fuzzy_identity(self):
  (self.root/'X4 X5 X6操作说明 V1.0.txt').write_text('X4 X5 X6 原文',encoding='utf8');engine.scan(self.root,self.work)
  rows=engine.resolve_documents(self.work,[{'name':'HD-X4 & X5 & X6操作说明 V1.0.txt'},{'name':'HD-X4L & X5 & X6操作说明 V1.0.txt'},{'name':'HD-X4 & X5 & X6操作说明 V1.1.txt'},{'name':'HD-X4 & X5 & X6操作说明 V1.0.pdf'}])['results']
  self.assertEqual([r['available'] for r in rows],[True,False,False,False]);self.assertEqual(rows[0]['originalName'],'X4 X5 X6操作说明 V1.0.txt')
 def test_format_equivalent_names_with_different_contents_remain_conflicts(self):
  (self.root/'X1 X2.txt').write_text('one',encoding='utf8');(self.root/'HD-X1 X2.txt').write_text('two',encoding='utf8');engine.scan(self.root,self.work)
  row=engine.resolve_documents(self.work,[{'name':'HD-X1 & X2.txt'}])['results'][0]
  self.assertFalse(row['available']);self.assertEqual(row['reason'],'same-name-content-conflict')
 def test_display_brand_prefix_resolves_the_original_without_crossing_suffix_version_or_language(self):
  (self.root/'HDX123规格书V1.2.txt').write_text('original bytes',encoding='utf8');engine.scan(self.root,self.work)
  rows=engine.resolve_documents(self.work,[{'name':'HD-X123规格书V1.2.txt'},{'name':'HD-X123A规格书V1.2.txt'},{'name':'HD-X123规格书V1.1.txt'},{'name':'HD-X123 Specification V1.2.txt'}])['results']
  self.assertTrue(rows[0]['available']);self.assertEqual(rows[0]['originalName'],'HDX123规格书V1.2.txt');self.assertTrue(all(not r['available'] for r in rows[1:]))
 def test_bulk_resolution_preserves_order_duplicates_invalid_rows_and_checks_changes_again(self):
  items=[{'name':'A3L V1.txt'},{'name':'missing.txt'},{'name':'../A3L V1.txt'},{'name':'A3L V1.txt'},{'name':'R712 V1.txt'}]
  rows=engine.resolve_documents(self.work,items)['results']
  self.assertTrue(rows[0]['available']);self.assertEqual(rows[0],rows[3]);self.assertEqual(rows[1]['reason'],'original-not-registered');self.assertEqual(rows[2]['reason'],'invalid-document-identity');self.assertEqual(rows[4]['reason'],'same-name-content-conflict')
  (self.root/'A3L V1.txt').unlink()
  self.assertEqual(engine.resolve_documents(self.work,items)['results'][0]['reason'],'registered-original-unavailable-or-changed')
 def test_large_catalogue_request_does_not_query_once_per_item(self):
  real_connect=engine.connect;statements=[]
  class TrackedConnection:
   def __init__(self,db):self.db=db
   def execute(self,sql,*args):statements.append(sql);return self.db.execute(sql,*args)
   def close(self):return self.db.close()
  items=[{'name':f'unregistered-{i}.txt'} for i in range(1024)]
  with patch.object(engine,'connect',side_effect=lambda *a,**kw:TrackedConnection(real_connect(*a,**kw))):
   rows=engine.resolve_documents(self.work,items)['results']
  self.assertEqual(len(rows),1024);self.assertTrue(all(r['reason']=='original-not-registered' for r in rows));self.assertLessEqual(len(statements),5)

 def test_signed_and_neutral_editions_do_not_block_standard_but_real_conflicts_still_do(self):
  for folder,text in [('签章规格书','signed'),('中性规格书','neutral'),('产品规格书','standard')]:
   (self.root/folder).mkdir();(self.root/folder/'X9 V1.txt').write_text(text,encoding='utf8')
  engine.scan(self.root,self.work)
  rows=engine.resolve_documents(self.work,[{'name':'X9 V1.txt'},{'name':'X9 V1.txt','sha256':engine.digest(self.root/'签章规格书'/'X9 V1.txt')},{'name':'X9 V1.txt','sha256':engine.digest(self.root/'中性规格书'/'X9 V1.txt')}])['results']
  self.assertEqual(rows[0]['sha256'],engine.digest(self.root/'产品规格书'/'X9 V1.txt'));self.assertEqual(rows[0]['documentEdition'],'standard')
  self.assertFalse(rows[1]['available']);self.assertEqual(rows[2]['documentEdition'],'neutral')
  (self.root/'one'/'X9 V1.txt').write_text('another standard',encoding='utf8');engine.scan(self.root,self.work)
  self.assertEqual(engine.resolve_documents(self.work,[{'name':'X9 V1.txt'}])['results'][0]['reason'],'same-name-content-conflict')
 def test_unsigned_label_remains_available_and_signed_only_is_hidden(self):
  (self.root/'未签章').mkdir();(self.root/'签章').mkdir()
  (self.root/'未签章'/'U1.txt').write_text('normal',encoding='utf8');(self.root/'签章'/'S1.txt').write_text('signed',encoding='utf8');engine.scan(self.root,self.work)
  rows=engine.resolve_documents(self.work,[{'name':'U1.txt'},{'name':'S1.txt'}])['results']
  self.assertTrue(rows[0]['available']);self.assertEqual(rows[1]['reason'],'signed-edition-hidden')

if __name__=='__main__':unittest.main()
