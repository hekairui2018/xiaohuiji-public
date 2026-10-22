import sqlite3,unittest
from directory_catalog import directory_catalog
class DirectoryCatalogTests(unittest.TestCase):
 def test_registered_metadata_includes_archives_configuration_and_binary_without_reading_originals(self):
  db=sqlite3.connect(':memory:');db.row_factory=sqlite3.Row
  db.execute('CREATE TABLE parses(hash TEXT,state TEXT,blocks INTEGER)')
  db.execute('CREATE TABLE locations(id INTEGER,path TEXT,name TEXT,kind TEXT,extension TEXT,state TEXT,sha256 TEXT,resource_id TEXT,version_id TEXT,bytes INTEGER)')
  samples=[('G:/固件/card.img','software-firmware'),('G:/模组/a.ssr','other'),('G:/资料/历史规格V1.0.pdf','document'),('G:/软件/app/qml/内部.txt','document'),('G:/私密/受限.pdf','sensitive-metadata-only'),('G:/软件/app.dll','other'),('E:/开发项目/xiaohuiji/tmp/测试.pdf','document')]
  for i,(path,kind) in enumerate(samples):
   name=path.rsplit('/',1)[1];db.execute('INSERT INTO locations VALUES(?,?,?,?,?,?,?,?,?,?)',(i,path,name,kind,'.'+name.rsplit('.',1)[1],'present',None,'r'+str(i),'v'+str(i),12))
  result=directory_catalog(db);self.assertEqual(result['directoryCatalogVersion'],1)
  self.assertEqual({r['name'] for r in result['resources']},{'card.img','a.ssr','历史规格V1.0.pdf'})
  self.assertTrue(all(r['searchContent']=='file-metadata-only' for r in result['resources']))
  self.assertTrue(all('text' not in r and 'path' not in r for r in result['resources']))
  db.close()
if __name__=='__main__':unittest.main()
