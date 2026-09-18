import copy,json,tempfile,unittest,uuid
from pathlib import Path
from audit_moments import inspect,audit

def mark():
 return {'id':str(uuid.uuid4()),'automated':False,'modelEnabled':False,'baseline':'scope-coverage-256-soft-v1','tag':'missed_detail','note':'Listener observation, not a precise target','source':{'sessionId':str(uuid.uuid4()),'kind':'url','name':'Example','url':'/api/scope-research/forest'},'frames':[{'at':i*.02,'sourceSeconds':1860+i*.02,'brightness':.3,'features':[.2]*8,'exposure':40,'softCurve':True,'visibleFraction':1,'pageVisible':True} for i in range(151)]}
class AuditTest(unittest.TestCase):
 def test_visible_observation_is_only_manual_review_candidate(self):
  m=mark();issues,summary=inspect(m);self.assertEqual(issues,[]);self.assertAlmostEqual(summary['visible_seconds'],3)
 def test_invalid_provenance_visibility_and_settings(self):
  m=mark();m['automated']=True;self.assertTrue(inspect(m)[0]);m=mark()
  for f in m['frames']:f['pageVisible']=False
  self.assertIn('insufficient visible brightness context',inspect(m)[0]);m=mark();m['frames'][100]['exposure']=50;self.assertIn('display settings changed inside reaction window',inspect(m)[0]);m=mark();m['source']['kind']='mic';self.assertIn('live audio not retained; cannot replay source from this record',inspect(m)[0])
 def test_duplicates_conflicts_and_automation_never_become_training_labels(self):
  with tempfile.TemporaryDirectory() as temp:
   p=Path(temp);m=mark();(p/'a.json').write_text(json.dumps({'moments':[m]}));(p/'b.json').write_text(json.dumps({'moments':[m]}));r=audit(p);self.assertEqual(r['duplicates'],1);self.assertEqual(r['candidate_listener_observations'],1);self.assertEqual(r['training_ready_labels'],0)
   edited=copy.deepcopy(m);edited['note']='different';(p/'c.json').write_text(json.dumps({'moments':[edited]}));r=audit(p);self.assertEqual(r['conflicts'],1);self.assertEqual(r['candidate_listener_observations'],0)
   auto=p/'automated';auto.mkdir();m=mark();(auto/'fixture.json').write_text(json.dumps({'moments':[m]}));self.assertEqual(audit(p)['candidate_listener_observations'],0)
if __name__=='__main__':unittest.main()
