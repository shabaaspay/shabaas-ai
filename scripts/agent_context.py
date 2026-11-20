#!/usr/bin/env python3
"""Offline context integrity and bounded repository navigation; no application commands execute."""
import argparse, fnmatch, json, pathlib, re, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
CONFIG = ROOT / 'docs/agent-context.json'

def read_config():
    return json.loads(CONFIG.read_text(encoding='utf-8'))

def adapters(config):
    files = {}
    for rule in config['rules']:
        body = '# ' + rule['title'] + '\n\n' + '\n'.join('- ' + x for x in rule['instructions']) + '\n'
        patterns = rule['paths']
        files['.clinerules/' + rule['id'] + '.md'] = ('---\npaths:\n' + ''.join('  - ' + json.dumps(x) + '\n' for x in patterns) + '---\n\n' + body)
        files['.github/instructions/' + rule['id'] + '.instructions.md'] = ('---\napplyTo: ' + json.dumps(','.join(patterns)) + '\n---\n\n' + body)
    return files

def tracked_paths():
    return set(subprocess.check_output(['git', 'ls-files', '-z'], cwd=ROOT).decode().split('\0')) - {''}

def safe_path(value):
    p = pathlib.PurePosixPath(value)
    return bool(value) and not p.is_absolute() and '..' not in p.parts and '\\' not in value and not re.match(r'^[A-Za-z]:', value)

def sensitive(value):
    p = pathlib.PurePosixPath(value)
    return (any(x in ('secrets', '.control', 'browser-profiles') for x in p.parts)
            or p.name == '.env' or p.name.startswith('.env.')
            or p.suffix.lower() in ('.pem', '.key', '.pfx', '.p12', '.jks', '.har', '.pcap'))

def matches(path, pattern):
    # These generated scopes use literal prefixes and recursive /**, not arbitrary glob dialects.
    return path.startswith(pattern[:-2]) if pattern.endswith('/**') else fnmatch.fnmatchcase(path, pattern)

def validate(config, tracked):
    errors = []
    if config.get('schema_version') != 1:
        errors.append('Unsupported context schema')
    if not config.get('purpose') or not config.get('repository'):
        errors.append('Missing repository purpose or identity')
    for entry in config.get('entrypoints', []):
        if not safe_path(entry) or sensitive(entry) or entry not in tracked:
            errors.append('Invalid, sensitive or missing entrypoint: ' + entry)
    ids = set()
    for rule in config.get('rules', []):
        if not re.fullmatch(r'[a-z][a-z0-9-]{0,63}', rule['id']) or rule['id'] in ids:
            errors.append('Invalid or duplicate rule id')
        ids.add(rule['id'])
        if not rule['paths'] or not rule['instructions']:
            errors.append('Empty rule: ' + rule['id'])
        for pattern in rule['paths']:
            if not safe_path(pattern) or ',' in pattern or pattern in ('*', '**', '**/*'):
                errors.append('Unbounded or invalid scope: ' + pattern)
            elif not any(matches(p, pattern) for p in tracked):
                errors.append('Scope matches no tracked file: ' + pattern)
    for path, expected in adapters(config).items():
        file = ROOT / path
        if not file.is_file() or file.read_text(encoding='utf-8') != expected:
            errors.append('Generated adapter drift: ' + path + '; run python scripts/agent_context.py sync')
    for path in ['AGENTS.md', 'CLAUDE.md', '.github/copilot-instructions.md']:
        file = ROOT / path
        if not file.is_file():
            errors.append('Missing instruction entrypoint: ' + path)
    for skill in (ROOT / '.cline/skills').glob('*/SKILL.md'):
        text = skill.read_text(encoding='utf-8')
        name = re.search(r'^name: ([a-z0-9-]+)$', text, re.M)
        description = re.search(r'^description: (".*")$', text, re.M)
        if not text.startswith('---\n') or not name or name.group(1) != skill.parent.name or not description:
            errors.append('Invalid generated skill metadata: ' + str(skill.relative_to(ROOT)))
        elif not json.loads(description.group(1)) or len(text.splitlines()) > 100:
            errors.append('Empty description or oversized skill: ' + str(skill.relative_to(ROOT)))
    # Preserve the existing governed constitution instead of imposing a new size limit on it.
    if config['repository'] != 'sbpagentic' and (ROOT / 'AGENTS.md').is_file():
        if len((ROOT / 'AGENTS.md').read_text(encoding='utf-8').split()) > 1000:
            errors.append('AGENTS.md exceeds 1000 words; move detail into scoped references')
    for command in config.get('commands', []):
        if not safe_path(command['cwd']) or command['cwd'] not in ('.',) and not any(p.startswith(command['cwd'] + '/') for p in tracked):
            errors.append('Invalid command directory: ' + command['cwd'])
        if 'npm_script' in command:
            pkg = ROOT / command['cwd'] / 'package.json'
            if not pkg.is_file() or command['npm_script'] not in json.loads(pkg.read_text()).get('scripts', {}):
                errors.append('Documented npm script missing: ' + command['npm_script'])
    return errors

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['check', 'sync', 'map'])
    parser.add_argument('--paths', nargs='*', default=[])
    args = parser.parse_args()
    config = read_config()
    if args.action == 'sync':
        for path, content in adapters(config).items():
            file = ROOT / path
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_text(content, encoding='utf-8')
        print('Updated generated Cline/Copilot adapters; review and commit their diffs.')
        return 0
    tracked = tracked_paths()
    if args.action == 'map':
        invalid = [p for p in args.paths if not safe_path(p) or sensitive(p) or p not in tracked]
        if invalid:
            print('Select tracked non-sensitive source paths; no file contents were read.', file=sys.stderr)
            return 2
        selected = [r for r in config['rules'] if any(matches(p, g) for p in args.paths for g in r['paths'])]
        print(json.dumps({'repository': config['repository'], 'purpose': config['purpose'],
            'entrypoints': config['entrypoints'], 'selected_rules': selected,
            'commands': config['commands'], 'limitations': config['limitations']}, indent=2))
        return 0
    errors = validate(config, tracked)
    for error in errors:
        print('ERROR: ' + error, file=sys.stderr)
    print(('FAIL' if errors else 'PASS') + ': repository context integrity (not application validation)')
    return 1 if errors else 0

if __name__ == '__main__':
    raise SystemExit(main())
