"""Post-capture native-word consistency review; no World or material oracle calls.

This does not validate elastic gradients against independent physical truth.
It checks every captured buffer binding, actual state recurrence and native force
association, keeping both failed force classifications. Source supplied by CLI.
"""
import argparse
import base64
import hashlib
import json
import math
import os
from pathlib import Path
import struct
import subprocess

STATE={'x','xs','xt','v','u','us','ut','x0','mass','h','initialX','initialU','initialV','reference'}
FORCE={p+s for p in ('public','authoritative') for s in ('ElasticGradient','InertiaGradient','Residual')}
def sha(b): return hashlib.sha256(b).hexdigest()
def bits(a): return struct.pack('<'+'d'*len(a),*a)
def decode(enc,dig):
    b=base64.b64decode(enc,validate=True)
    assert base64.b64encode(b).decode()==enc and sha(b)==dig and len(b)%8==0
    v=struct.unpack('<'+'d'*(len(b)//8),b);assert all(map(math.isfinite,v));return v
def guard(repo,pin):
    assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip()==pin['git']
    assert not subprocess.check_output(['git','status','--porcelain','--untracked-files=all'],cwd=repo,text=True).strip()
    for item in pin['files']:
        b=(repo/item['path']).read_bytes();assert len(b)==item['bytes'] and sha(b)==item['sha256']
def review(report):
    assert report['schema']=='pliego-membrane-state-modal-audit/1' and report['source']['dirty'] is False
    rows=report['results'][0]['trajectories'];assert len(rows)==24
    outcomes=[];states=poststeps=words=0;reference=None
    for row in rows:
        previous=None;fail={'public':0,'authoritative':0};tau=row['forceTolerance']
        assert tau==max(1e-7,1e-10*row['fixedForceScale'])
        assert len(row['history'])==len(row['trace'])==row['steps']+1
        for index,(h,t) in enumerate(zip(row['history'],row['trace'])):
            assert h['step']==t['step']==index and h['time']==t['time'] and h['h']==row['h']
            assert h['stateFloat64LE'].keys()==h['stateSHA256'].keys()==STATE
            assert h['forceFloat64LE'].keys()==h['forceSHA256'].keys()==FORCE
            a={k:decode(h['stateFloat64LE'][k],h['stateSHA256'][k]) for k in STATE}
            f={k:decode(h['forceFloat64LE'][k],h['forceSHA256'][k]) for k in FORCE}
            words+=sum(map(len,a.values()))+sum(map(len,f.values()));states+=1
            assert bits(a['mass'])==bits(row['runtime']['massProof']['native']) and a['h']==(row['h'],)
            if reference is None: reference=bits(a['reference'])
            assert bits(a['reference'])==reference
            assert t['validation']['valid'] is True
            assert bits([x+u for x,u in zip(a['x0'],a['u'])])==bits(a['x'])
            if not index:
                assert h['targetValid'] is False and t['literalForceGate'] is None and t['authoritativeConverged'] is None
            else:
                poststeps+=1;dt=a['h'][0]
                assert h['targetValid'] is True and t['validation']['boundaryCertified'] is True
                assert bits(a['us'])==bits(previous['u'])
                assert bits(a['ut'])==bits([u+dt*v for u,v in zip(previous['u'],previous['v'])])
                assert bits(a['v'])==bits([(u-us)/dt for u,us in zip(a['u'],a['us'])])
                for q,u in [('xs','us'),('xt','ut')]:
                    assert bits(a[q])==bits([x+z for x,z in zip(a['x0'],a[u])])
                for prefix,q,target,flag,rkey in [('public','x','xt','literalForceGate','residualInfinity'),('authoritative','u','ut','authoritativeConverged','authoritativeResidualInfinity')]:
                    coefficient=[m*(1/(dt*dt)) for m in a['mass']]
                    inertia=[coefficient[i//3]*(x-y) for i,(x,y) in enumerate(zip(a[q],a[target]))]
                    assert bits(inertia)==bits(f[prefix+'InertiaGradient'])
                    residual=[g+i for g,i in zip(f[prefix+'ElasticGradient'],inertia)]
                    assert bits(residual)==bits(f[prefix+'Residual'])
                    maximum=max(map(abs,residual));passed=maximum<=tau
                    assert maximum==t[rkey] and type(t[flag]) is bool and t[flag]==passed
                    assert t['validation']['publicConverged' if prefix=='public' else 'authoritativeConverged']==passed
                    fail[prefix]+=not passed
            previous=a
        assert fail['public']==row['failedSteps'] and fail['authoritative']==row['authoritativeFailedSteps']
        outcomes.append({'level':row['level'],'budget':row['budget'],'seed':row['seed'],'steps':row['steps'],'publicFailures':fail['public'],'authoritativeFailures':fail['authoritative']})
    assert states==7134 and poststeps==7110
    return {'schema':'pliego-state-matrix-native-boundary-review/1','nativeWordBindingsAndAssociationsVerified':True,'states':states,'poststeps':poststeps,'decodedFloat64Words':words,'trajectories':outcomes,'publicFailures':sum(r['publicFailures'] for r in outcomes),'authoritativeFailures':sum(r['authoritativeFailures'] for r in outcomes),'scope':'every captured state/native association only; elastic gradients are captured inputs here, not independent material truth; no HP full-trajectory/time/material/booklet/device acceptance'}
def main():
    p=argparse.ArgumentParser();p.add_argument('--repo',type=Path,required=True);p.add_argument('--run',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args()
    assert a.out.parent.stat().st_mode&0o777==0o700
    fd=os.open(a.out,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    try:
        terminal=json.loads((a.run/'candidate.terminal.json').read_bytes());assert terminal['returnCode']==0 and terminal['sourceGuardError'] is None
        assert json.loads((a.run/'candidate.source-after.json').read_bytes())['clean'] is True
        pin=json.loads((a.run/'source-pin.json').read_bytes());guard(a.repo,pin)
        raw=(a.run/'candidate.json').read_bytes();identity={'bytes':len(raw),'sha256':sha(raw)};assert identity==terminal['outputDigest']
        result=review(json.loads(raw));guard(a.repo,pin);assert sha((a.run/'candidate.json').read_bytes())==identity['sha256']
        result.update({'input':identity,'sourceGit':pin['git'],'sourceInventorySHA256':pin['inventorySHA256'],'reviewerSHA256':sha(Path(__file__).read_bytes()),'reviewTiming':'additional read-only consistency review authored after candidate capture; no solver/selection/threshold changes'})
        with os.fdopen(fd,'w') as f:fd=None;json.dump(result,f,indent=2);f.write('\n')
        print(json.dumps({k:result[k] for k in ('states','poststeps','publicFailures','authoritativeFailures')}))
    finally:
        if fd is not None:os.close(fd)
if __name__=='__main__':main()
