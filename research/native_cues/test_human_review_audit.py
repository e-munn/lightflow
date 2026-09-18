import copy,unittest
from audit_human_reviews import audit,METHODS
class ReviewAuditTests(unittest.TestCase):
 def row(self):return {'trial':{'id':'one','order':[1,0],'evaluationVersion':2,'automated':False,'visibleOnly':True,'readySeconds':21,'errors':[],'resets':0,'drops':0,'interruptedFrames':0,'modelHash':'a'*64,'source':'song','heardBefore':'unfamiliar'},'ratings':dict(overall='A',timing='B',detail='tie',phrasing='neither'),'notes':'','humanSubmitted':True}
 def run_rows(self,*rows):return audit([('fixture',{'methods':METHODS,'records':list(rows)})])
 def test_mapping_and_dedup(self):
  r=self.row();d=self.run_rows(r,r);self.assertEqual(d['eligible_self_reported_trials'],1);g=next(iter(d['groups'].values()));self.assertEqual(g['ratings']['overall']['learned'],1);self.assertEqual(g['ratings']['timing']['control'],1)
 def test_both_sides(self):
  r=self.row();r['trial']['order']=[0,1];g=next(iter(self.run_rows(r)['groups'].values()));self.assertEqual(g['ratings']['overall']['control'],1)
 def test_unsafe_records(self):
  for key,value in [('automated',True),('evaluationVersion',1),('readySeconds',float('nan')),('readySeconds',19.9),('visibleOnly',False),('drops',1),('resets',1),('interruptedFrames',1),('errors',['failed']),('modelHash','bad'),('order',[1,1])]:
   with self.subTest(key=key):r=self.row();r['trial'][key]=value;self.assertEqual(self.run_rows(r)['eligible_self_reported_trials'],0)
 def test_note_and_export_automation(self):
  r=self.row();r['notes']='AUTOMATED UI TEST ONLY';self.assertEqual(self.run_rows(r)['eligible_self_reported_trials'],0)
  d=audit([('fixture',{'methods':METHODS,'records':[self.row()],'testOnly':True})]);self.assertEqual(d['eligible_self_reported_trials'],0)
 def test_conflict_excludes_both(self):
  a=self.row();b=copy.deepcopy(a);b['ratings']['overall']='B';self.assertEqual(self.run_rows(a,b)['eligible_self_reported_trials'],0)
if __name__=='__main__':unittest.main()
