"""Offline regression checks for context selection and generated instruction drift."""
import copy
import importlib.util
import json
import pathlib
import subprocess
import tempfile
import unittest

SOURCE = pathlib.Path(__file__).with_name('agent_context.py')
spec = importlib.util.spec_from_file_location('agent_context', SOURCE)
context = importlib.util.module_from_spec(spec)
spec.loader.exec_module(context)


class ContextIntegrityTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.tmp.name)
        self.previous_root = context.ROOT
        context.ROOT = self.root
        self.config = {'schema_version': 1, 'repository': 'fixture', 'purpose': 'fixture',
            'entrypoints': ['src/app.py'], 'commands': [], 'limitations': [],
            'rules': [{'id': 'source', 'title': 'Source', 'paths': ['src/**'],
                       'instructions': ['Preserve behavior.']}]}
        self.tracked = {'src/app.py'}
        for path, body in {**context.adapters(self.config), 'AGENTS.md': 'Policy',
                           'CLAUDE.md': '@AGENTS.md', '.github/copilot-instructions.md': 'Read AGENTS.md'}.items():
            file = self.root / path
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_text(body, encoding='utf-8')

    def tearDown(self):
        context.ROOT = self.previous_root
        self.tmp.cleanup()

    def test_valid_bounded_context(self):
        self.assertEqual(context.validate(self.config, self.tracked), [])

    def test_missing_reference_rejected(self):
        self.assertTrue(context.validate(self.config, set()))

    def test_sensitive_or_escaping_reference_rejected(self):
        for path in ['.env', 'backend/.env.prod', 'keys/service.key', '../outside', 'C:/outside']:
            config = copy.deepcopy(self.config)
            config['entrypoints'] = [path]
            self.assertTrue(context.validate(config, self.tracked | {path}), path)

    def test_generated_adapter_drift_rejected(self):
        (self.root / '.clinerules/source.md').write_text('unreviewed rule')
        self.assertTrue(any('drift' in x for x in context.validate(self.config, self.tracked)))

    def test_unbounded_and_dead_scopes_rejected(self):
        for scope in ['**', '**/*', '*', 'missing/**', '../outside/**']:
            config = copy.deepcopy(self.config)
            config['rules'][0]['paths'] = [scope]
            self.assertTrue(context.validate(config, self.tracked), scope)

    def test_missing_npm_script_rejected(self):
        (self.root / 'package.json').write_text(json.dumps({'scripts': {'build': 'echo build'}}))
        self.config['commands'] = [{'cwd': '.', 'command': 'npm test', 'npm_script': 'test'}]
        self.assertTrue(any('npm script missing' in x for x in context.validate(self.config, self.tracked)))

    def test_prefix_does_not_match_sibling(self):
        self.assertTrue(context.matches('src/deep/file.py', 'src/**'))
        self.assertFalse(context.matches('src-other/file.py', 'src/**'))

    def test_map_rejects_sensitive_paths_without_reading_contents(self):
        (self.root / 'scripts').mkdir(exist_ok=True)
        (self.root / 'scripts/agent_context.py').write_text(SOURCE.read_text(), encoding='utf-8')
        (self.root / 'docs').mkdir()
        (self.root / 'docs/agent-context.json').write_text(json.dumps(self.config))
        subprocess.run(['git', 'init', '-q', str(self.root)], check=True)
        result = subprocess.run(['python', str(self.root / 'scripts/agent_context.py'),
            'map', '--paths', '.env'], capture_output=True, text=True)
        self.assertEqual(result.returncode, 2)
        self.assertNotIn('selected_rules', result.stdout)


if __name__ == '__main__':
    unittest.main()
