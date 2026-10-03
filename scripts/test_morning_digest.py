import datetime as dt
import json
import pathlib
import tempfile
import unittest
from unittest.mock import patch
import morning_digest as digest

class BriefingTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=pathlib.Path(self.tmp.name);self.vault=self.root/'vault';self.system=self.vault/'system';(self.system/'metrics').mkdir(parents=True)
        (self.root/'.argus-config.json').write_text(json.dumps({'vault':str(self.vault)}))
    def tearDown(self):self.tmp.cleanup()
    def test_missing_data_is_not_zero(self):
        _,text,_=digest.build(self.vault,dt.datetime.now(digest.IST));self.assertIn('Unavailable',text);self.assertIn('not necessarily yesterday',text)
    def test_null_totals_and_escaping(self):
        (self.system/'metrics/marketing-latest.json').write_text(json.dumps({'channels':{'meta':{'totals':None,'window':None}},'flags':[{'text':'<script>bad</script>'}]}))
        _,_,markup=digest.build(self.vault,dt.datetime.now(digest.IST));self.assertNotIn('<script>',markup);self.assertIn('&lt;script&gt;',markup)
    def test_old_source_is_stale(self):
        (self.system/'metrics/marketing-latest.json').write_text(json.dumps({'pull':{'sources':[{'source':'meta','status':'ok','ts':'2020-01-01T00:00:00Z'}]}}))
        _,text,_=digest.build(self.vault,dt.datetime.now(digest.IST));self.assertIn('stale (ok)',text)
    def test_send_then_retry_is_deduplicated(self):
        class Response:
            def __enter__(self):return self
            def __exit__(self,*a):pass
            def read(self):return b'{"id":"test-id"}'
        with patch.object(digest,'ROOT',self.root),patch.object(digest,'env',return_value={'RESEND_API_KEY':'test','ARGUS_DIGEST_FROM':'ARGUS <test@example.com>','ARGUS_DIGEST_TO':'rishi@echovme.com'}),patch('sys.argv',['digest','--send']),patch.object(digest.urllib.request,'urlopen',return_value=Response()) as send:
            digest.main();digest.main();self.assertEqual(send.call_count,1)
    def test_missing_sender_never_calls_network(self):
        with patch.object(digest,'ROOT',self.root),patch.object(digest,'env',return_value={'RESEND_API_KEY':'test'}),patch('sys.argv',['digest','--send']),patch.object(digest.urllib.request,'urlopen') as send:
            with self.assertRaises(SystemExit):digest.main()
            send.assert_not_called()

if __name__=='__main__':unittest.main()
