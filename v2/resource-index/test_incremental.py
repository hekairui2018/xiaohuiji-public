import unittest,tempfile,json,shutil
from pathlib import Path
import engine,incremental,catalog_metadata
from unittest.mock import patch

class IncrementalTests(unittest.TestCase):
 def test_only_requested_paths_are_updated_with_identity_history_and_retry(self):
  with tempfile.TemporaryDirectory(dir=engine.PROJECT/'tmp') as temp:
   root=Path(temp)/'sources';root.mkdir();work=Path(temp)/'index';p=root/'X9说明.txt';p.write_text('initial');engine.scan(root,work)
   db=engine.connect(work,True);old=dict(db.execute('SELECT * FROM locations').fetchone());db.close()
   moved=root/'X9改名说明.txt';p.rename(moved);rows=incremental.update(work,[str(p),str(moved)]);self.assertEqual([x['state'] for x in rows],['missing','present'])
   db=engine.connect(work,True);current=dict(db.execute('SELECT * FROM locations WHERE path=?',(str(moved),)).fetchone());self.assertEqual(old['resource_id'],current['resource_id']);self.assertEqual(old['version_id'],current['version_id']);db.close()
   resolved=engine.resolve_documents(work,[{'name':'X9说明.txt'}])['results'][0];self.assertTrue(resolved['available']);self.assertEqual(resolved['originalName'],moved.name);self.assertEqual(resolved['resolutionBasis'],'registered-missing-location-same-hash')
   moved.write_text('changed content');incremental.update(work,[str(moved)]);db=engine.connect(work,True);new=dict(db.execute('SELECT * FROM locations WHERE path=?',(str(moved),)).fetchone());self.assertEqual(new['resource_id'],old['resource_id']);self.assertNotEqual(new['version_id'],old['version_id']);self.assertEqual(db.execute('SELECT count(*) FROM versions').fetchone()[0],2);self.assertGreater(db.execute('SELECT count(*) FROM location_history').fetchone()[0],0);db.close()
   outside=Path(temp)/'outside.txt';outside.write_text('blocked');self.assertEqual(incremental.update(work,[str(outside)])[0]['state'],'failed');self.assertEqual(incremental.update(work,[str(root)])[0]['state'],'failed')
   installer=root/'下载软件.exe';installer.write_bytes(b'MZsynthetic');incremental.update(work,[str(installer)]);db=engine.connect(work,True);items=catalog_metadata.catalog(db,work);db.close();self.assertEqual(next(x for x in items if x['name']==installer.name)['resourceType'],'software')
   retry=root/'重试说明.txt';retry.write_text('new doc')
   with patch.object(engine,'digest',side_effect=PermissionError('temporary read failure')):self.assertEqual(incremental.update(work,[str(retry)])[0]['state'],'failed')
   self.assertEqual(incremental.update(work,[str(retry)])[0]['state'],'present');db=engine.connect(work,True);task=db.execute('SELECT state,attempts FROM incremental_tasks WHERE path=?',(str(retry),)).fetchone();self.assertEqual(tuple(task),('done',2));db.close()
   relocated=root/'再次改名.txt';retry.rename(relocated);incremental.update(work,[str(relocated)]);db=engine.connect(work,True);self.assertEqual(db.execute('SELECT state FROM locations WHERE path=?',(str(retry),)).fetchone()[0],'missing');db.close()
   relocated.unlink();incremental.update(work,[str(relocated)]);db=engine.connect(work,True);catalog=catalog_metadata.catalog(db,work);db.close();self.assertEqual(next(r for r in catalog if r['name']==relocated.name)['availabilityState'],'missing')
 def test_new_document_parse_and_catalog_refresh_reuse_the_same_index(self):
  with tempfile.TemporaryDirectory(dir=engine.PROJECT/'tmp') as temp:
   root=Path(temp)/'sources';root.mkdir();work=Path(temp)/'index';engine.scan(root,work)
   db=engine.connect(work,True);self.assertEqual(catalog_metadata.catalog(db,work),[]);db.close()
   p=root/'X9使用说明.txt';p.write_text('产品说明书\nHD-X9\n版本号：V2.0\n检查连接。',encoding='utf8');incremental.update(work,[str(p)]);engine.index_documents(work,contains=str(p),limit=1)
   db=engine.connect(work,True);items=catalog_metadata.catalog(db,work);db.close();self.assertEqual(len(items),1);self.assertEqual(items[0]['documentMetadata']['version'],'V2.0');self.assertEqual(items[0]['documentMetadata']['coverModels'],['X9']);self.assertEqual(items[0]['parseStatus']['state'],'parsed')
   resolved=engine.resolve_documents(work,[{'name':p.name}])['results'][0];self.assertEqual(resolved['resourceId'],items[0]['resourceId']);self.assertEqual(resolved['versionId'],items[0]['versionId'])
   hits=engine.query(work,'产品说明书','text')['results'];self.assertTrue(hits);self.assertEqual(hits[0]['resourceId'],items[0]['resourceId']);self.assertEqual(hits[0]['versionId'],items[0]['versionId'])
   (work/'quick-resource-reviews.json').write_text(json.dumps({items[0]['sha256']:{'kind':'other','reviewId':'synthetic-review','basis':'synthetic reviewer evidence','coverModels':['X9']}}),encoding='utf8')
   db=engine.connect(work,True);reviewed=catalog_metadata.catalog(db,work);db.close();self.assertEqual(reviewed[0]['documentMetadata']['kind'],'other');self.assertEqual(reviewed[0]['documentMetadata']['classificationStatus'],'manual-review')
 def test_cover_metadata_does_not_treat_certificate_embedded_spec_titles_as_specifications(self):
  blocks=[{'id':1,'locator':'{"page":1}','text':'PRODUCT SPECIFICATION\nHD-X9\n版本号：V2.0\n硬件版本：E2'}]
  data=catalog_metadata.analyze('X9.pdf',blocks);self.assertEqual(data['kind'],'spec');self.assertEqual(data['version'],'V2.0');self.assertEqual(data['coverModels'],['X9']);self.assertEqual(data['scopeEvidence'],['硬件版本：E2'])
  certificate=catalog_metadata.analyze('Radio_Certificate.pdf',blocks);self.assertEqual(certificate['kind'],'other')
  self.assertIsNone(catalog_metadata.analyze('手册.pdf',[{'id':2,'locator':'{}','text':'支持软件V9.0，硬件V2.0，最大分辨率1920。'}])['version'])

if __name__=='__main__':unittest.main()
