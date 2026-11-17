"""Generate REST exports from the reviewed operation sources. No live API calls."""
import argparse, copy, json, pathlib, sys
ROOT = pathlib.Path(__file__).resolve().parents[1]
METHODS = {'get','post','put','patch','delete','head','options'}
def bundle(source):
    result = {'openapi':'3.0.3','info':{'title':'ShaBaas Pay Public REST API','version':'1.0.0'},'servers':[{'url':'https://dev-api.shabaas.com','description':'Sandbox'},{'url':'https://api.shabaas.com','description':'Production'}],'paths':{},'components':{}}
    def rewrite(value, prefix):
        if isinstance(value, dict):
            return {key: ('#/components/'+child.split('/')[2]+'/'+prefix+'__'+child.split('/')[3] if key=='$ref' and child.startswith('#/components/') else rewrite(child,prefix)) for key,child in value.items()}
        if isinstance(value,list):return [rewrite(child,prefix) for child in value]
        return value
    for slug,spec in sorted(source['operations'].items()):
        prefix=slug.replace('-','_')
        def security(value):return [{prefix+'__'+name:scopes for name,scopes in requirement.items()} for requirement in value]
        for kind,entries in spec.get('components',{}).items():
            result['components'].setdefault(kind,{}).update({prefix+'__'+name:rewrite(value,prefix) for name,value in entries.items()})
        for path,item in spec['paths'].items():
            target=result['paths'].setdefault(path,{})
            for method,operation in item.items():
                if method not in METHODS:continue
                op=rewrite(operation,prefix)
                op['security']=security(operation.get('security',spec.get('security',[])))
                op['x-documentation-slug']=slug
                if method in target:
                    # Bookkeeper is a documented variant of the same initiation operation.
                    previous=target[method]
                    primary,variant=(op,previous) if slug=='createpaymentinitiation' else (previous,op)
                    primary.setdefault('x-operation-variants',[]).append(variant)
                    target[method]=primary
                else:target[method]=op
    return result

def validate(source):
    if source.get('format_version')!=1:raise ValueError('Unsupported source format')
    for slug,spec in source['operations'].items():
        def visit(value):
            if isinstance(value,dict):
                if '$ref' in value:
                    ref=value['$ref']; assert ref.startswith('#/'),(slug,ref)
                    node=spec
                    for key in ref[2:].split('/'):node=node[key.replace('~1','/').replace('~0','~')]
                for child in value.values():visit(child)
            elif isinstance(value,list):
                for child in value:visit(child)
        visit(spec)
    return bundle(source)

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--check',action='store_true');args=parser.parse_args()
    source=json.loads((ROOT/'restapi/operations.json').read_text()); result=validate(source)
    # JSON is valid YAML 1.2: same exact bytes at both public download paths.
    expected=json.dumps(result,indent=2)+'\n'
    for filename in ['shabaaspay-public-api.json','shabaaspay-public-api.yaml']:
        path=ROOT/'restapi'/filename
        if args.check:
            if not path.exists() or path.read_text()!=expected:raise SystemExit(f'{filename} differs from source; run python scripts/api_contract.py')
        else:path.write_text(expected)
    print(f"Validated {len(source['operations'])} operation documents; {len(result['paths'])} REST paths")
if __name__=='__main__':main()
