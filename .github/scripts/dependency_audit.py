"""Dependency gates: nonzero on findings, missing coverage, or scanner failure."""
import fnmatch
import json
import hashlib
import re
import urllib.request
import os
from pathlib import Path
import subprocess
import sys

FIELDS = ('dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies')

def has_npm_scope(package):
    return bool(package.get('workspaces') or any(package.get(field) for field in FIELDS))

def npm_result(code, data):
    if not isinstance(data, dict) or data.get('error') or not isinstance(data.get('metadata', {}).get('vulnerabilities'), dict):
        raise ValueError('npm did not return a complete audit report')
    counts = data['metadata']['vulnerabilities']
    if any(not isinstance(counts.get(k), int) or counts[k] < 0 for k in ('high', 'critical')):
        raise ValueError('npm severity counts are missing/invalid')
    blocked = counts['high'] + counts['critical'] > 0
    if code not in (0, 1) or (code != 0 and not blocked):
        raise ValueError('npm scanner failed independently of the vulnerability gate')
    return 'FINDINGS' if blocked else 'PASS', counts

def yarn_classic_result(code, output):
    records = [json.loads(line) for line in output.splitlines() if line.strip()]
    summaries = [r['data']['vulnerabilities'] for r in records if r.get('type') == 'auditSummary']
    if any(r.get('type') == 'error' for r in records) or len(summaries) != 1:
        raise ValueError('Yarn did not return a complete audit summary')
    counts = summaries[0]
    if any(not isinstance(counts.get(k), int) or counts[k] < 0 for k in ('high', 'critical')):
        raise ValueError('Yarn severity counts are missing/invalid')
    # Yarn Classic's --level filters text, not its severity-bitmask exit code.
    if code < 0 or code > 31:
        raise ValueError('Yarn scanner failed')
    blocked = counts['high'] + counts['critical'] > 0
    if bool(code & 24) != blocked:
        raise ValueError('Yarn severity/exit-code mismatch')
    return 'FINDINGS' if blocked else 'PASS', counts

def berry_packages(lock, package, exclusions):
    root = lock.get(package['name'] + '@workspace:.')
    declared = {}
    for field in ('dependencies', 'devDependencies', 'optionalDependencies'):
        declared.update(package.get(field, {}))
    if not isinstance(root, dict) or root.get('dependencies', {}) != declared:
        raise ValueError('Berry workspace manifest and lockfile disagree')
    packages = {}
    excluded = []
    for key, item in lock.items():
        if key == '__metadata':
            continue
        resolution = item.get('resolution', '')
        if '@workspace:' in resolution:
            continue
        match = re.match(r'^(.+?)@(npm|patch):', resolution)
        if not match:
            name_match = re.match(r'^(@[^/]+/[^@]+|[^@]+)@', resolution)
            name = name_match.group(1) if name_match else 'unknown-source'
            exemption = exclusions.get(name, {})
            if exemption.get('resolution_sha256') == hashlib.sha256(resolution.encode()).hexdigest() and exemption.get('reason'):
                excluded.append({'package': name, 'reason': exemption['reason']})
                continue
            raise ValueError('Unverified non-registry Yarn source: ' + name)
        if match.group(2) == 'patch' and '@npm%3A' not in resolution and '@npm:' not in resolution:
            raise ValueError('Yarn patch is not based on a registry package')
        name = match.group(1)
        version = item.get('version', '')
        if not re.fullmatch(r'\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.+-]+)?', version):
            raise ValueError('Invalid registry package version in Yarn lock')
        packages.setdefault(name, set()).add(version)
    local_names = {item.get('resolution', '').split('@workspace:')[0] for key, item in lock.items() if key != '__metadata' and '@workspace:' in item.get('resolution', '')}
    missing = set(declared) - set(packages) - local_names - {item['package'] for item in excluded}
    if missing:
        raise ValueError('Unresolved Yarn root dependency: ' + ', '.join(sorted(missing)))
    return {name: sorted(versions) for name, versions in packages.items()}, excluded

def berry_advisories(data, packages):
    if not isinstance(data, dict):
        raise ValueError('Malformed npm bulk advisory response')
    counts = {level: 0 for level in ('info', 'low', 'moderate', 'high', 'critical')}
    for name, entries in data.items():
        if name not in packages or not isinstance(entries, list):
            raise ValueError('Unexpected npm advisory package')
        for entry in entries:
            severity = entry.get('severity')
            if severity not in counts or not entry.get('id') or not entry.get('url') or not entry.get('vulnerable_versions') or ('name' in entry and entry['name'] != name) or ('module_name' in entry and entry['module_name'] != name):
                raise ValueError('Incomplete npm advisory evidence')
            counts[severity] += 1
    return counts

def coverage(config, tracked):
    covered = set(config.get('covered_manifests', []))
    exclusions = config.get('excluded_manifests', {})
    if any(not reason.strip() for reason in exclusions.values()):
        raise ValueError('Coverage exclusions need a reviewable reason')
    manifests = {p for p in tracked if Path(p).name in ('package.json', 'Gemfile', 'pyproject.toml', 'Pipfile', 'setup.py', 'composer.json', 'Cargo.toml', 'go.mod', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'Podfile') or (Path(p).name.startswith('requirements') and p.endswith('.txt'))}
    unknown = sorted(manifests - covered - set(exclusions))
    if unknown:
        raise ValueError('Uncovered dependency manifests: ' + ', '.join(unknown))
    missing = sorted(covered - set(tracked))
    if missing:
        raise ValueError('Configured manifests disappeared: ' + ', '.join(missing))

def run(command, cwd, report):
    result = subprocess.run(command, cwd=cwd, text=True, capture_output=True, timeout=600)
    report.write_text(result.stdout, encoding='utf-8')
    # Keep logs private: report package advisories, never requirement URLs/credentials.
    return result.returncode, result.stdout

def main():
    root = Path.cwd()
    output = root / '.security-reports'
    output.mkdir(exist_ok=True)
    config = json.loads((root / '.github/dependency-audit.json').read_text())
    results = []
    try:
        tracked = subprocess.check_output(['git', 'ls-files', '-z'], text=True).split('\0')
        coverage(config, tracked)
    except Exception as exc:
        results.append({'scope': 'coverage', 'status': 'ERROR', 'reason': str(exc)})
    if not config['targets'] and not results:
        results.append({'scope': 'repository', 'status': 'NOT_APPLICABLE', 'reason': 'No application dependency manifests; gate contract tests still run'})
    for index, target in enumerate(config['targets']):
        manifest = target['manifest']
        kind = target['kind']
        report = output / f'{index}-{kind}.json'
        try:
            path = (root / manifest).resolve()
            if not path.is_relative_to(root) or not path.is_file():
                raise ValueError('Invalid or missing manifest')
            directory = path.parent
            if kind == 'npm':
                package = json.loads(path.read_text())
                if not has_npm_scope(package):
                    results.append({'scope': manifest, 'status': 'NOT_APPLICABLE', 'reason': 'No declared npm dependencies'})
                    continue
                lock = directory / 'package-lock.json'
                if not lock.is_file():
                    raise ValueError('Commit package-lock.json before this audit can certify the dependency tree')
                lock_data = json.loads(lock.read_text())
                lock_root = lock_data.get('packages', {}).get('')
                if not isinstance(lock_root, dict):
                    raise ValueError('A lockfile v2/v3 with root metadata is required for manifest consistency')
                for field in FIELDS:
                    if (package.get(field) or {}) != (lock_root.get(field) or {}):
                        raise ValueError('package.json and package-lock.json disagree: ' + field)
                for child in config['covered_manifests']:
                    child_path = (root / child).resolve()
                    if child_path == path or child_path.name != 'package.json' or not child_path.is_relative_to(directory):
                        continue
                    relative = str(child_path.parent.relative_to(directory))
                    locked = lock_data['packages'].get(relative)
                    if not isinstance(locked, dict):
                        raise ValueError('Workspace package is missing from the lockfile: ' + child)
                    declared = json.loads(child_path.read_text())
                    for field in FIELDS:
                        if (declared.get(field) or {}) != (locked.get(field) or {}):
                            raise ValueError('Workspace manifest and lockfile disagree: ' + child)
                command = ['npm', 'audit', '--package-lock-only', '--include=dev', '--audit-level=high', '--json', '--fetch-retries=1', '--fetch-timeout=30000']
                if package.get('workspaces'):
                    if package['workspaces'] != lock_root.get('workspaces'):
                        raise ValueError('Workspace configuration and lockfile disagree')
                    command += ['--workspaces', '--include-workspace-root']
                code, raw = run(command, directory, report)
                status, counts = npm_result(code, json.loads(raw))
                result = {'scope': manifest, 'status': status, 'counts': counts}
            elif kind == 'yarn-classic':
                if not (directory / 'yarn.lock').is_file():
                    raise ValueError('Missing yarn.lock')
                code, raw = run(['yarn', 'audit', '--json'], directory, report)
                status, counts = yarn_classic_result(code, raw)
                result = {'scope': manifest, 'status': status, 'counts': counts}
            elif kind == 'yarn-modern':
                import yaml
                lock = directory / 'yarn.lock'
                if not lock.is_file():
                    raise ValueError('Missing yarn.lock')
                packages, excluded = berry_packages(yaml.safe_load(lock.read_text()), json.loads(path.read_text()), config.get('yarn_nonregistry_exclusions', {}))
                request = urllib.request.Request('https://registry.npmjs.org/-/npm/v1/security/advisories/bulk', data=json.dumps(packages).encode(), headers={'Content-Type': 'application/json', 'Accept': 'application/json'}, method='POST')
                with urllib.request.urlopen(request, timeout=60) as response:
                    data = json.load(response)
                counts = berry_advisories(data, packages)
                report.write_text(json.dumps({'packages_audited': len(packages), 'counts': counts, 'advisories': data, 'non_registry_exclusions': excluded}, indent=2))
                result = {'scope': manifest, 'status': 'FINDINGS' if counts['high'] + counts['critical'] else 'PASS', 'counts': counts, 'packages_audited': len(packages), 'excluded_native_sources': len(excluded)}
            elif kind == 'python':
                code, raw = run([sys.executable, '-m', 'pip_audit', '--strict', '-r', str(path), '--format', 'json', '--progress-spinner', 'off', '--desc', 'off'], directory, report)
                data = json.loads(raw)
                dependencies = data.get('dependencies')
                if not isinstance(dependencies, list) or any(d.get('skip_reason') for d in dependencies):
                    raise ValueError('Incomplete Python dependency audit')
                count = sum(len(d.get('vulns', [])) for d in dependencies)
                if code not in (0, 1) or bool(code) != bool(count):
                    raise ValueError('Python audit exit/report mismatch')
                result = {'scope': manifest, 'status': 'FINDINGS' if count else 'PASS', 'advisories': count, 'policy': 'all known vulnerabilities (severity unavailable)'}
            elif kind == 'ruby':
                if not (directory / 'Gemfile.lock').is_file():
                    raise ValueError('Commit Gemfile.lock before the Ruby audit can certify the resolved dependencies')
                update_code, _ = run(['bundle-audit', 'update'], directory, output / f'{index}-ruby-database.txt')
                if update_code != 0:
                    raise ValueError('Ruby advisory database update failed')
                policy = output / 'ruby-audit-policy.yml'
                policy.write_text('---\nignore: []\n')
                code, raw = run(['bundle-audit', 'check', '--no-update', '--config', str(policy), '--format', 'json'], directory, report)
                data = json.loads(raw)
                findings = data.get('results')
                if not isinstance(findings, list) or code not in (0, 1) or bool(code) != bool(findings):
                    raise ValueError('Incomplete Ruby advisory report')
                result = {'scope': manifest, 'status': 'FINDINGS' if findings else 'PASS', 'advisories': len(findings), 'policy': 'all known vulnerabilities'}
            else:
                raise ValueError('Unknown audit type')
            results.append(result)
        except Exception as exc:
            # Exceptions contain only local manifest/config/scanner-state descriptions.
            reason = str(exc) if isinstance(exc, ValueError) else type(exc).__name__
            results.append({'scope': manifest, 'status': 'ERROR', 'reason': reason})
    (output / 'summary.json').write_text(json.dumps(results, indent=2) + '\n')
    lines = ['## Dependency audit', '', '| Scope | Status | Evidence |', '| --- | --- | --- |']
    for item in results:
        detail = item.get('reason') or item.get('counts') or item.get('advisories', '')
        lines.append(f"| {item['scope']} | {item['status']} | {str(detail).replace('|', '/')} |")
    summary = '\n'.join(lines) + '\n'
    print(summary)
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as stream:
            stream.write(summary)
    return int(any(item['status'] in ('ERROR', 'FINDINGS') for item in results))

if __name__ == '__main__':
    sys.exit(main())
