"""Analytic one-mode time-method diagnostic. Not a World or material simulation."""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path

p=argparse.ArgumentParser();p.add_argument('--inputs',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args()
raw=a.inputs.read_bytes();assert hashlib.sha256(raw).hexdigest()=='e8f006ab770da4ed3790cd8fb8e2a2108be725ec9e4525d227c18b185452d620'
data=json.loads(raw);omega=data['reference']['mode']['omega'];rows=[]
for level in (1,2,4,8):
    row=next(r for r in data['rows'] if r['level']==level);h,n=row['h'],row['steps'];s=omega*h
    rho=(1+s*s)**-.5;be_phase=math.atan(s);midpoint_phase=2*math.atan(s/2)
    # Unit modal q, zero v. Norm is sqrt((q/A)^2+(v/(omega*A))^2).
    be=max(math.hypot(rho**k*math.cos(k*be_phase)-math.cos(k*s),rho**k*math.sin(k*be_phase)-math.sin(k*s)) for k in range(n+1))
    midpoint=max(2*abs(math.sin(k*(midpoint_phase-s)/2)) for k in range(n+1))
    rows.append({'level':level,'h':h,'steps':n,'omegaH':s,'backwardEulerMaximumStateError':be,'backwardEulerFinalEnergyLoss':1-rho**(2*n),'implicitMidpointMaximumStateError':midpoint,'implicitMidpointExactLinearEnergyLoss':0,'midpointEnergyMeaning':'analytic exact-real modal invariant, not measured floating-point energy'})
result={'schema':'pliego-analytic-modal-time-methods/1','inputSHA256':hashlib.sha256(raw).hexdigest(),'programSHA256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'omega':omega,'initialModalCoordinate':1,'initialModalVelocity':0,'rows':rows,'arithmetic':'native Python binary64 transcendental evaluation of exact linear formulas','scope':'post-capture analytical selected linear mode only; no nonlinear selected-law/native-C solve, force gate, World step, material/booklet/device or time-accuracy acceptance'}
assert a.out.parent.stat().st_mode&0o777==0o700
fd=os.open(a.out,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
with os.fdopen(fd,'w') as f:json.dump(result,f,indent=2);f.write('\n')
print('analytic-modal-methods: four same-horizon linear modal formulas; zero World calls, no acceptance gate')
