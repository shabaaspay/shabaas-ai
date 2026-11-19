import importlib.util,json,pathlib,unittest,copy
root=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('contract',root/'scripts/api_contract.py');mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
class ContractTests(unittest.TestCase):
 def setUp(self):self.source=json.loads((root/'restapi/operations.json').read_text())
 def test_bundle_retains_all_variants(self):
  result=mod.validate(self.source);op=result['paths']['/api/public/payment_initiation']['post']
  self.assertEqual(op['x-documentation-slug'],'createpaymentinitiation')
  self.assertEqual(op['x-operation-variants'][0]['x-documentation-slug'],'bookkeeperinitiatepayment')
  self.assertIn('/api/public/payment_initiation/refund',result['paths'])
 def test_unknown_reference_fails(self):
  self.source['operations']['post_api-public-authorization']['paths']['/api/public/authorization']['post']['responses']['200']['content']['application/json']['schema']['$ref']='#/components/schemas/DoesNotExist'
  with self.assertRaises(KeyError):mod.validate(self.source)
 def test_endpoint_component_names_do_not_collide(self):
  result=mod.validate(self.source)
  for kind,entries in result['components'].items():self.assertTrue(all('__' in name for name in entries))
