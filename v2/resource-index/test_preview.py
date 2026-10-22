import tempfile,threading,unittest,json
from pathlib import Path
from urllib.request import urlopen
from urllib.error import HTTPError
import engine,server

class PreviewTests(unittest.TestCase):
 def test_exact_resource_info_preserves_video_access_source_without_reading_body(self):
  with tempfile.TemporaryDirectory(dir=engine.PROJECT/'tmp') as tmp:
   root=Path(tmp)/'source';private=root/'私密';private.mkdir(parents=True);work=Path(tmp)/'work'
   video=private/'操作.mov';video.write_bytes(b'synthetic-not-a-real-video')
   (root/'说明.txt').write_text('synthetic',encoding='utf8')
   engine.scan(root,work)
   db=engine.connect(work,True);ids={r['name']:r['id'] for r in db.execute('SELECT name,id FROM locations')};db.close()
   before=video.stat().st_mtime_ns
   http=server.create_server(work);thread=threading.Thread(target=http.serve_forever,daemon=True);thread.start()
   base=f'http://127.0.0.1:{http.server_port}/resource-info?id='
   try:
    result=json.load(urlopen(base+str(ids['操作.mov'])))
    self.assertTrue(result['isVideo']);self.assertIn('私密',result['resources'][0]['folders'])
    self.assertEqual(result['resources'][0]['locationId'],ids['操作.mov']);self.assertNotIn('path',result['resources'][0])
    normal=json.load(urlopen(base+str(ids['说明.txt'])));self.assertFalse(normal['isVideo']);self.assertEqual(normal['resources'][0]['locationId'],ids['说明.txt']);self.assertNotIn('path',normal['resources'][0])
    self.assertEqual(video.stat().st_mtime_ns,before)
    with self.assertRaises(HTTPError) as error:urlopen(base+'999999')
    self.assertEqual(error.exception.code,404)
   finally:http.shutdown();http.server_close();thread.join()
 def test_preview_reads_cached_original_and_rejects_changed_file(self):
  with tempfile.TemporaryDirectory(dir=engine.PROJECT/'tmp') as tmp:
   root=Path(tmp)/'source';root.mkdir();work=Path(tmp)/'work'
   original=root/'操作.txt';original.write_text('操作步骤\n检查后恢复',encoding='utf8')
   engine.scan(root,work);engine.index_documents(work)
   db=engine.connect(work,True);rid=db.execute('SELECT id FROM locations').fetchone()[0];db.close()
   http=server.create_server(work);thread=threading.Thread(target=http.serve_forever,daemon=True);thread.start()
   url=f'http://127.0.0.1:{http.server_port}/preview-document?id={rid}'
   try:
    data=json.load(urlopen(url));self.assertEqual(data['name'],'操作.txt');self.assertTrue(data['blocks']);self.assertIn('操作步骤',data['blocks'][0]['text']);self.assertNotIn('path',data)
    original.write_text('changed original',encoding='utf8')
    with self.assertRaises(HTTPError) as error:urlopen(url)
    self.assertEqual(error.exception.code,409)
   finally:http.shutdown();http.server_close();thread.join()

if __name__=='__main__':unittest.main()
