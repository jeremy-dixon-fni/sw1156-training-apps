(function(){
const C={
  events:[2,5,10,25,50,100],
  flows:[430,780,940,1080,1360,1720],
  nChannel:0.040,nOverbank:0.085,bedSlope:0.0015,bottomWidth:20,channelSideSlope:3,
  benchSlopePct:1,cutSideSlope:3,structureGroundSlopePct:1,
  projectLength:2500,earthworkUnitCost:40,indirectFactor:1.20,
  analysisYears:50,discountRate:0.03,structureValue:500000,maxDamageFraction:0.50,
  existing:{depth:4.25,width:95,slopePct:0.65},
  // Five rows per side. Counts and offsets are tuned to create a fairly flat EAD contribution profile.
  structureRows:[
    {offset:145,countPerSide:4,ffOffset:0.15},
    {offset:170,countPerSide:5,ffOffset:0.35},
    {offset:200,countPerSide:6,ffOffset:0.40},
    {offset:235,countPerSide:7,ffOffset:0.45},
    {offset:275,countPerSide:8,ffOffset:0.50},
    {offset:320,countPerSide:10,ffOffset:0.55}
  ]
};
function geom(p){
  const d=Math.min(Math.max(p.depth,0),C.existing.depth),w=Math.max(p.width,0),s=p.slopePct/100;
  const halfBottom=C.bottomWidth/2, bed=-C.existing.depth, bank=halfBottom+C.channelSideSlope*d;

  // Retain the existing invert. Lowering the remaining channel depth
  // excavates the adjacent overbank benches rather than deepening the
  // low-flow channel; width alone sets the existing-ground tie-ins.
  const existingBank=halfBottom+C.channelSideSlope*C.existing.depth;
  // Width controls the floodplain extent without allowing a depth change to
  // move its connection to existing ground.
  const outer=existingBank+w;
  const outerRise=w*C.existing.slopePct/100;
  const bankElevation=bed+d;
  // Intersect the outward-sloping bench with the 3H:1V cut face projected
  // inward from the existing-ground tie-in.
  const cutSlope=1/C.cutSideSlope;
  const intersection=(outerRise-cutSlope*outer-bankElevation+s*bank)/(s-cutSlope);
  const benchOuter=Math.min(outer,Math.max(bank,intersection));
  const benchOuterElevation=benchOuter===outer?outerRise:bankElevation+(benchOuter-bank)*s;
  const extension=35;
  const domainOuter=existingBank+C.existing.width+extension;
  const domainRise=(C.existing.width+extension)*C.existing.slopePct/100;
  const points=[
    [-domainOuter,domainRise],
    [-outer,outerRise],
    [-benchOuter,benchOuterElevation],
    [-bank,bankElevation],
    [-halfBottom,bed],
    [0,bed],
    [halfBottom,bed],
    [bank,bankElevation],
    [benchOuter,benchOuterElevation],
    [outer,outerRise],
    [domainOuter,domainRise]
  ];
  // The unchanged section has coincident bench and tie-in points; collapse
  // them so interpolation never encounters a zero-length segment.
  const unique=[];
  for(const point of points){
    const last=unique[unique.length-1];
    if(last&&Math.abs(last[0]-point[0])<1e-9) last[1]=point[1]; else unique.push(point);
  }
  return {x:unique.map(v=>v[0]),z:unique.map(v=>v[1]),outer,bank,outerRise,bed,benchOuter};
}
function interpPolyline(x,z,xq){
  if(xq<=x[0]) return z[0]+(xq-x[0])*(z[1]-z[0])/(x[1]-x[0]);
  for(let i=0;i<x.length-1;i++) if(xq<=x[i+1]) return z[i]+(xq-x[i])*(z[i+1]-z[i])/(x[i+1]-x[i]);
  const n=x.length; return z[n-2]+(xq-x[n-2])*(z[n-1]-z[n-2])/(x[n-1]-x[n-2]);
}
function wetted(p,wse){
  const g=geom(p), xmin=g.x[0], xmax=g.x[g.x.length-1], N=800,dx=(xmax-xmin)/(N-1);
  let area=0, per=0, topMin=null,topMax=null, prevX=xmin,prevZ=interpPolyline(g.x,g.z,xmin),prevD=Math.max(wse-prevZ,0);
  for(let i=1;i<N;i++){
    const x=xmin+i*dx,z=interpPolyline(g.x,g.z,x),d=Math.max(wse-z,0);
    area += 0.5*(prevD+d)*dx;
    if(prevD>0 || d>0){ per += Math.hypot(dx,z-prevZ); if(topMin===null) topMin=prevX; topMax=x; }
    prevX=x;prevZ=z;prevD=d;
  }
  const R=per>0?area/per:0, topWidth=topMin===null?0:topMax-topMin;
  return {area,per,R,topWidth};
}
function dischargeAtWse(p,wse){
  const g=geom(p); if(wse<=g.bed) return 0;
  // Composite Manning via dense subsection integration: channel between banks, overbanks outside.
  const xmin=g.x[0],xmax=g.x[g.x.length-1],N=900,dx=(xmax-xmin)/(N-1);
  const zones=[[-1e9,-g.bank,C.nOverbank],[-g.bank,g.bank,C.nChannel],[g.bank,1e9,C.nOverbank]];
  let K=0;
  for(const [a,b,n] of zones){let area=0,per=0;let last=null;
    for(let i=0;i<N;i++){const x=xmin+i*dx;if(x<a||x>b) continue;const z=interpPolyline(g.x,g.z,x),d=Math.max(wse-z,0);if(last){area+=0.5*(last.d+d)*(x-last.x);if(last.d>0||d>0)per+=Math.hypot(x-last.x,z-last.z);}last={x,z,d};}
    if(area>0&&per>0){const R=area/per;K+=(1.486/n)*area*Math.pow(R,2/3);}
  }
  return K*Math.sqrt(C.bedSlope);
}
function normalWse(p,q){
  const g=geom(p);let lo=g.bed, hi=Math.max(12,g.outerRise+8); while(dischargeAtWse(p,hi)<q && hi<40) hi+=4;
  for(let k=0;k<60;k++){const mid=(lo+hi)/2;if(dischargeAtWse(p,mid)<q)lo=mid;else hi=mid;} return (lo+hi)/2;
}
function capacityEvent(p){
  const top=geom(p).outerRise; const cap=dischargeAtWse(p,top); let label="< 2-yr"; for(let i=0;i<C.events.length;i++) if(cap>=C.flows[i]) label=C.events[i]+"-yr"; return {q:cap,label};
}
function cutArea(existing,proposed){
  const ge=geom(existing),gp=geom(proposed), xmin=Math.min(ge.x[0],gp.x[0]),xmax=Math.max(ge.x[ge.x.length-1],gp.x[gp.x.length-1]),N=1400,dx=(xmax-xmin)/(N-1);let A=0;
  let prev=Math.max(interpPolyline(ge.x,ge.z,xmin)-interpPolyline(gp.x,gp.z,xmin),0);
  for(let i=1;i<N;i++){const x=xmin+i*dx,cur=Math.max(interpPolyline(ge.x,ge.z,x)-interpPolyline(gp.x,gp.z,x),0);A+=0.5*(prev+cur)*dx;prev=cur;}return A;
}
function groundAtOffset(offset,slopePct=C.structureGroundSlopePct){
  const x=Math.abs(offset),g=geom(C.existing);
  if(x<=g.outer) return interpPolyline(g.x,g.z,x);
  return g.outerRise+(x-g.outer)*slopePct/100;
}
function elevationAt(p,offset){const g=geom(p);return interpPolyline(g.x,g.z,offset);}
function depthDamage(depth){ if(depth<=0) return 0; return Math.min(C.maxDamageFraction, C.maxDamageFraction*(depth/4)); }
function damagesForParams(p){
  const wses=C.flows.map(q=>normalWse(p,q));
  return C.events.map((ev,i)=>{
    let dmg=0; for(const row of C.structureRows){const ground=groundAtOffset(row.offset,p.structureSlopePct),ffe=ground+row.ffOffset,dep=wses[i]-ffe;dmg += 2*row.countPerSide*C.structureValue*depthDamage(dep);} return dmg;
  });
}
function eadContributions(damages){
  // Incremental trapezoidal EAD contribution by AEP interval. Last bin closes to zero AEP.
  const aep=C.events.map(t=>1/t); const contrib=[];
  for(let i=0;i<C.events.length;i++){
    const pHi=aep[i], pLo=(i<C.events.length-1?aep[i+1]:0); const dHi=damages[i], dLo=(i<C.events.length-1?damages[i+1]:damages[i]);
    contrib.push(0.5*(dHi+dLo)*(pHi-pLo));
  }
  return contrib;
}
function pvFactor(){const r=C.discountRate,n=C.analysisYears;return (1-Math.pow(1+r,-n))/r;}
const existingParams={depth:C.existing.depth,width:C.existing.width,slopePct:C.existing.slopePct,structureSlopePct:C.structureGroundSlopePct};
const existingWses=C.flows.map(q=>normalWse(existingParams,q));
const existingDamages=damagesForParams(existingParams); const existingContrib=eadContributions(existingDamages); const existingEAD=existingContrib.reduce((a,b)=>a+b,0);
function evaluate(p){
  const baselineParams={...existingParams,structureSlopePct:p.structureSlopePct};
  const baselineDamages=damagesForParams(baselineParams),baselineContrib=eadContributions(baselineDamages),baselineEAD=baselineContrib.reduce((a,b)=>a+b,0);
  const damages=damagesForParams(p), contrib=eadContributions(damages),ead=contrib.reduce((a,b)=>a+b,0), benefitEAD=Math.max(baselineEAD-ead,0),npvBenefit=benefitEAD*pvFactor();
  const area=cutArea(existingParams,p),cy=area*C.projectLength/27,cost=cy*C.earthworkUnitCost*C.indirectFactor;
  const capacity=capacityEvent(p),wses=C.flows.map(q=>normalWse(p,q));
  return {params:p,existingDamages:baselineDamages,existingContrib:baselineContrib,existingEAD:baselineEAD,damages,contrib,ead,benefitEAD,npvBenefit,cutAreaSqft:area,excavationCY:cy,cost,bcr:cost>0?npvBenefit/cost:0,capacity,wses};
}
window.TrainingModel={C,geom,normalWse,capacityEvent,cutArea,damagesForParams,eadContributions,evaluate,existingParams,existingWses,existingDamages,existingContrib,existingEAD,pvFactor,groundAtOffset,elevationAt};
})();
