import tempfile,unittest,threading,json
from unittest.mock import patch
from pathlib import Path
from urllib.request import Request,urlopen
from urllib.error import HTTPError
import engine,server
class LocalAssetTests(unittest.TestCase):
 def test_runtime_hash_cache_survives_memory_reset_and_invalidates_changed_identity(self):
  with tempfile.TemporaryDirectory(dir=engine.PROJECT/'tmp') as temp:
   root=Path(temp);p=root/'asset.bin';p.write_bytes(b'first');stat=p.stat()
   with patch.object(engine,'PROJECT',root):
    expected=engine.asset_digest(str(p),stat.st_size,stat.st_mtime_ns);engine.asset_digest.cache_clear()
    with patch.object(engine,'digest',side_effect=AssertionError('unchanged file should reuse verified cache')):self.assertEqual(engine.asset_digest(str(p),stat.st_size,stat.st_mtime_ns),expected)
    p.write_bytes(b'different content');stat=p.stat();self.assertNotEqual(engine.asset_digest(str(p),stat.st_size,stat.st_mtime_ns),expected)
 def test_identical_duplicate_videos_are_resolved_by_bytes_not_just_filename(self):
  with tempfile.TemporaryDirectory(dir=engine.PROJECT/'tmp') as temp:
   root=Path(temp)/'source';root.mkdir();work=Path(temp)/'work';(root/'copy').mkdir()
   (root/'video.mp4').write_bytes(b'same movie');(root/'copy'/'video.mp4').write_bytes(b'same movie')
   (root/'different.mp4').write_bytes(b'first movie');(root/'copy'/'different.mp4').write_bytes(b'other movie')
   engine.scan(root,work);before=engine.digest(work/'resources.db')
   result=engine.resolve_assets(work,[{'name':'video.mp4'},{'name':'different.mp4'}])['results']
   self.assertTrue(result[0]['available']);self.assertFalse(result[1]['available']);self.assertEqual(result[1]['reason'],'same-name-content-conflict');self.assertEqual(engine.digest(work/'resources.db'),before)
 def test_exact_asset_resolution_conflicts_and_range(self):
  with tempfile.TemporaryDirectory(dir=engine.PROJECT/'tmp') as temp:
   root=Path(temp)/'source';root.mkdir();work=Path(temp)/'work'
   (root/'R7.bin').write_bytes(b'firmware');(root/'movie.mp4').write_bytes(b'0123456789')
   (root/'copy').mkdir();(root/'copy'/'R7.bin').write_bytes(b'wrong firmware')
   engine.scan(root,work)
   result=engine.resolve_assets(work,[{'name':'R7.bin'},{'name':'R7.bin','sha256':engine.digest(root/'R7.bin')},{'name':'movie.mp4'},{'name':'R7L.bin'}])['results']
   self.assertFalse(result[0]['available']);self.assertTrue(result[1]['available']);self.assertTrue(result[2]['available']);self.assertFalse(result[3]['available'])
   http=server.create_server(work);thread=threading.Thread(target=http.serve_forever,daemon=True);thread.start()
   url=f"http://127.0.0.1:{http.server_port}/resource?id={result[2]['locationId']}"
   try:
    with urlopen(Request(url,headers={'Range':'bytes=3-6'})) as r:self.assertEqual(r.status,206);self.assertEqual(r.headers['Content-Range'],'bytes 3-6/10');self.assertEqual(r.read(),b'3456')
    with urlopen(Request(url,headers={'Range':'bytes=-2'})) as r:self.assertEqual(r.read(),b'89')
    with self.assertRaises(HTTPError) as e:urlopen(Request(url,headers={'Range':'bytes=99-100'}))
    self.assertEqual(e.exception.code,416)
   finally:http.shutdown();http.server_close();thread.join()
if __name__=='__main__':unittest.main()
