import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as D from '../src/xpbd/double-double.js';

const py = process.env.PLIEGO_AUDIT_PYTHON || 'python3';
const exactCheck = cases => JSON.parse(execFileSync(py, ['-c', `
import json,sys
from fractions import Fraction as F
cases=json.load(sys.stdin);max_error=F(0);proofs=0
for c in cases:
 a,b=c['a'],c['b'];real_a=sum(F(float(x)) for x in a);real_b=sum(F(float(x)) for x in b);observed=sum(F(float(x)) for x in c['out'])
 expected=real_a+real_b if c['op']=='add' else real_a*real_b
 error=abs(observed-expected)
 if c['exact']: assert error==0,(c,error)
 else:
  scale=abs(real_a)+abs(real_b) if c['op']=='add' else abs(real_a*real_b)
  assert error<=F(1,2**98)*scale,(c,float(error),float(scale))
  if scale:max_error=max(max_error,error/scale)
 proofs+=1
print(json.dumps({'proofs':proofs,'maximumScaledError':float(max_error)}))
`], { input: JSON.stringify(cases), encoding: 'utf8' }));

test('bounded TwoSum/TwoProduct retain exact rational values at cancellation, binade and exponent boundaries', () => {
  const cases = [];
  for (const [a, b] of [[1, 2**-54], [1e100, -1e100], [Number.MIN_VALUE, Number.MIN_VALUE], [2**450, -(2**450)*(1-2**-52)],
    [2**-450, 2**-450], [1+2**-52, 1-2**-53], [-(2**450)*(1-2**-52), (2**450)*(1-2**-53)], [2**-450*(1+2**-52), 2**-450*(1+2**-51)]]) {
    cases.push({op:'add',a:[a],b:[b],out:D.twoSum(a,b),exact:true});
    if (Math.abs(a)>=2**-450&&Math.abs(b)>=2**-450) cases.push({op:'mul',a:[a],b:[b],out:D.twoProduct(a,b),exact:true});
  }
  for (let i=0;i<60;i++) {
    const a=(1+.5*Math.sin(i+.1))*2**(i*13%800-400),b=-(1+.5*Math.cos(i+.4))*2**(i*19%800-400);
    cases.push({op:'mul',a:[a],b:[b],out:D.twoProduct(a,b),exact:true});
  }
  const proof=exactCheck(cases);assert.equal(proof.proofs,cases.length);
  console.log(`double-double-primitive: ${proof.proofs} exact Fraction identities, including 2^-450 Split-boundary nonzero products and gradual-underflow addition`);
});

test('two-word operations carry low terms across cancellation and products under declared finite-input tests', () => {
  const cases=[];
  for(let i=0;i<80;i++) {
    const a=D.twoSum((1+.5*Math.sin(i+.2))*2**(i%200-100),2**(i%200-155));
    const b=D.twoSum(-(1+.5*Math.cos(i+.9))*2**(i%200-100),-(2**(i%200-156)));
    cases.push({op:'add',a,b,out:D.add(a,b),exact:false},{op:'mul',a,b,out:D.mul(a,b),exact:false});
  }
  const proof=exactCheck(cases);assert.equal(proof.proofs,160);assert.ok(proof.maximumScaledError<2**-98);
  assert.equal(D.rounded(D.sub([1,2**-54],[1,0])),2**-54);
  console.log(`double-double-operations: ${proof.proofs} rational comparisons; max scaled error=${proof.maximumScaledError}; finite suite accuracy, no universal polynomial rounding certificate`);
});

test('unsupported products and nonfinite intermediates throw without flushing low parts or fallback', () => {
  for(const [a,b] of [[2**-451,1],[2**451,1],[Number.MIN_VALUE,1],[Infinity,0],[NaN,1]])assert.throws(()=>D.twoProduct(a,b),RangeError);
  assert.throws(()=>D.mul([1,2**-451],[1,0]),/operand outside/);
  assert.throws(()=>D.twoSum(1e308,1e308),/nonfinite/);
  assert.deepEqual(D.twoProduct(0,1),[0,0]);
  assert.deepEqual(D.DOUBLE_DOUBLE_IDENTITY,{name:'double-double',version:1,productExponentLimit:450,derivative:'coherent-difference',displacement:'two-diff'});
  console.log('double-double-domain: all nonzero cross-word factors guarded; small/large/nonfinite inputs refuse visibly, no zeroing or lower-accuracy fallback');
});
