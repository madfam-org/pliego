// One exclusive open site, held across capture, then one write on the same FD.
import assert from 'node:assert/strict';
import {openSync,writeFileSync,closeSync,realpathSync,statSync} from 'node:fs';
import {resolve,join,dirname,basename,relative,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../../',import.meta.url));
export function reserveStateModalOutput(output,{pretty=false}={}){
  const location=resolve(output),parent=realpathSync(dirname(location)),target=join(parent,basename(location)),inside=relative(realpathSync(root),target);
  assert.ok(inside&&(inside.startsWith('..'+sep)||isAbsolute(inside)),'output must be outside checkout');
  assert.equal(statSync(parent).mode&0o777,0o700,'output directory must be durable private0700 storage');
  assert.ok(!target.startsWith('/tmp/')&&!target.startsWith('/private/tmp/')&&!target.startsWith('/var/folders/'),'system temporary storage is not durable evidence');
  const fd=openSync(target,'wx',0o600);let closed=false,written=false;
  return {write(report){assert.ok(!closed&&!written,'one open descriptor and one report write required');
    const data=JSON.stringify(report,(_k,v)=>typeof v==='number'&&!Number.isFinite(v)?{nonFinite:Number.isNaN(v)?'NaN':v>0?'Infinity':'-Infinity'}:v,pretty?2:undefined)+'\n';
    writeFileSync(fd,data);written=true;},close(){if(!closed){closeSync(fd);closed=true;}}};
}
