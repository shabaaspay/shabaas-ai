import importlib.util
from pathlib import Path
import unittest
spec = importlib.util.spec_from_file_location('audit', Path(__file__).with_name('dependency_audit.py'))
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)

class GateTests(unittest.TestCase):
    def test_dependency_free_workspace_root_is_still_audited(self):
        self.assertTrue(audit.has_npm_scope({'workspaces':['packages/*']}))
        self.assertFalse(audit.has_npm_scope({'name':'no-deps'}))

    def test_berry_audits_exact_versions_and_rejects_unreviewed_sources(self):
        lock={'app@workspace:.':{'resolution':'app@workspace:.','dependencies':{'lib':'^1.0.0'}}, 'lib@npm:^1.0.0':{'resolution':'lib@npm:1.0.1','version':'1.0.1'}}
        package={'name':'app','dependencies':{'lib':'^1.0.0'}}
        self.assertEqual(audit.berry_packages(lock,package,{})[0],{'lib':['1.0.1']})
        lock['foreign']={'resolution':'native@https://git.invalid/repo','version':'1.0.0'}
        with self.assertRaises(ValueError): audit.berry_packages(lock,package,{})
    def test_berry_blocks_high_and_rejects_incomplete_evidence(self):
        data={'lib':[{'id':1,'url':'https://advisory.invalid/1','vulnerable_versions':'<1.0.2','severity':'critical'}]}
        self.assertEqual(audit.berry_advisories(data,{'lib':['1.0.1']})['critical'],1)
        with self.assertRaises(ValueError): audit.berry_advisories({'lib':[{'id':1}]},{'lib':['1.0.1']})

    def test_npm_high_and_critical_block(self):
        for counts in ({'high':1,'critical':0}, {'high':0,'critical':1}):
            self.assertEqual(audit.npm_result(1, {'metadata':{'vulnerabilities':counts}})[0], 'FINDINGS')
    def test_npm_moderate_does_not_block(self):
        self.assertEqual(audit.npm_result(0, {'metadata':{'vulnerabilities':{'high':0,'critical':0,'moderate':9}}})[0], 'PASS')
    def test_npm_scanner_failure_never_passes(self):
        for code, data in ((1,{}),(1,{'error':'unavailable'}),(1,{'metadata':{'vulnerabilities':{'high':0,'critical':0}}})):
            with self.assertRaises(ValueError): audit.npm_result(code,data)
    def test_yarn_low_exit_bit_is_not_a_high_finding(self):
        raw='{"type":"auditSummary","data":{"vulnerabilities":{"high":0,"critical":0,"low":1}}}'
        self.assertEqual(audit.yarn_classic_result(2,raw)[0],'PASS')
    def test_yarn_high_and_critical_bits_block(self):
        for code,counts in ((8,{'high':1,'critical':0}),(16,{'high':0,'critical':1})):
            import json
            self.assertEqual(audit.yarn_classic_result(code,json.dumps({'type':'auditSummary','data':{'vulnerabilities':counts}}))[0],'FINDINGS')
    def test_missing_yarn_summary_or_network_error_fails(self):
        for raw in ('', '{"type":"error","data":"network"}'):
            with self.assertRaises(ValueError): audit.yarn_classic_result(1,raw)
    def test_added_dependency_root_requires_coverage(self):
        with self.assertRaises(ValueError): audit.coverage({'covered_manifests':['package.json']},['package.json','new/package.json'])
    def test_exclusion_needs_reason(self):
        with self.assertRaises(ValueError): audit.coverage({'excluded_manifests':{'package.json':''}},['package.json'])
    def test_explicit_workspace_coverage_and_snapshot_exclusion(self):
        audit.coverage({'covered_manifests':['package.json','packages/client/package.json'],'excluded_manifests':{'snapshot/package.json':'exported legacy snapshot'}}, ['package.json','packages/client/package.json','snapshot/package.json'])
if __name__ == '__main__': unittest.main()
