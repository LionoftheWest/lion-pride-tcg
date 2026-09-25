// Procedural, seeded WebGL raid-boss for the Pride Hunt battle screen. Each weekly
// boss name deterministically builds a unique low-poly monster (WoW-ish, flat
// shaded), rendered live with a menacing idle, a hit-flinch, and a defeat slump.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { createAttackFX } from './attack-fx.js';
import { clipSetFor, mountVideoBoss } from './boss-video.js';

function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed) { return function () { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const PALETTES = [
  { body: 0x241826, accent: 0xff3a10, horn: 0xe6d6b0 }, // ember
  { body: 0x18281c, accent: 0x53ff6a, horn: 0xd6e6c4 }, // toxic
  { body: 0x172836, accent: 0x3ac8ff, horn: 0xdcefff }, // frost
  { body: 0x241832, accent: 0xb060ff, horn: 0xe0d0f4 }, // void
  { body: 0x321c14, accent: 0xffb020, horn: 0xf4e6c8 }, // molten
  { body: 0x142e2c, accent: 0x27e0d0, horn: 0xd2f0ea }, // abyss
];

// The seed also picks WHICH KIND of monster (archetype), then the picked builder
// runs. Each archetype returns { group, body, glowMat, bw, bh, bodyBase }.
// Name keywords that PIN a boss to a specific archetype, so a hunt can be made to
// show a chosen (pre-rendered) boss on demand — name it with the keyword. Checked
// before the name hash. Add a row per archetype we want to feature by name.
const NAME_PINS = [
  [/behemoth|stone\s*titan|stone\s*golem|lava\s*golem/i, 'behemoth'],
];

// Derive WHICH archetype a boss name maps to (same hash the builder uses). Kept
// separate so the video-clip path can key its registry on the archetype too.
// Priority: an explicit `arch:<name>` prefix, then a NAME_PINS keyword, then the hash.
export function archetypeOf(seedStr) {
  const s = seedStr || '';
  const mo = s.match(/^arch:(\w+)/); if (mo) return mo[1];
  for (const [re, a] of NAME_PINS) if (re.test(s)) return a;
  const r0 = rng(hashStr('arch:' + (s || 'boss')));
  const names = Object.keys(ARCH_BUILDERS);
  return names[Math.floor(r0() * names.length)];
}
function buildMonster(seedStr) {
  const arch = archetypeOf(seedStr);
  return (ARCH_BUILDERS[arch] || buildBrute)(seedStr);
}

// Shared kit so each archetype stays compact (materials + geometry helpers).
function baseKit(seedStr, salt) {
  const rand = rng(hashStr((seedStr || 'boss') + (salt || '')));
  const pick = (a) => a[Math.floor(rand() * a.length)], between = (a, b) => a + rand() * (b - a);
  const pal = pick(PALETTES);
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: pal.body, roughness: 0.6, metalness: 0.12, flatShading: true });
  const hornMat = new THREE.MeshStandardMaterial({ color: pal.horn, roughness: 0.45, flatShading: true });
  const clawMat = new THREE.MeshStandardMaterial({ color: 0x060608, roughness: 0.4, flatShading: true });
  const glowMat = new THREE.MeshStandardMaterial({ color: pal.accent, emissive: pal.accent, emissiveIntensity: 1.5, roughness: 0.3, flatShading: true });
  const plateMat = new THREE.MeshStandardMaterial({ color: 0x14141c, roughness: 0.45, metalness: 0.5, flatShading: true });
  const ico = (r, d = 1) => new THREE.IcosahedronGeometry(r, d >= 1 ? d + 1 : d), cone = (r, h, s = 6) => new THREE.ConeGeometry(r, h, Math.max(s, 9)), cyl = (r, h, s = 8) => new THREE.CylinderGeometry(r * 0.72, r, h, Math.max(s, 11)), box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const UP = new THREE.Vector3(0, 1, 0);
  const add = (geo, mat, x, y, z, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.rotation.set(rx, ry, rz); group.add(m); return m; };
  const spikeAt = (px, py, pz, dx, dy, dz, len, r, mat) => { const m = new THREE.Mesh(cone(r, len, 6), mat || hornMat); m.position.set(px, py, pz); m.quaternion.setFromUnitVectors(UP, new THREE.Vector3(dx, dy, dz).normalize()); group.add(m); return m; };
  const limb = (a, b, r, mat) => { const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], len = Math.hypot(dx, dy, dz); const m = new THREE.Mesh(cyl(r, len, 7), mat || bodyMat); m.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2); m.quaternion.setFromUnitVectors(UP, new THREE.Vector3(dx, dy, dz).normalize()); group.add(m); return m; };
  return { group, rand, pick, between, pal, bodyMat, hornMat, clawMat, glowMat, plateMat, ico, cone, cyl, box, add, spikeAt, limb, UP };
}

function buildColossus(s){const k=baseKit(s,':col');const{group,between,box,ico,add,limb}=k;
  const stone=new THREE.MeshStandardMaterial({color:0x8b8d86,roughness:0.96,metalness:0.03,flatShading:true});
  const stoneDk=new THREE.MeshStandardMaterial({color:0x63655f,roughness:0.97,flatShading:true});
  const moss=new THREE.MeshStandardMaterial({color:0x4f7a2e,roughness:1.0,flatShading:true});
  const mossEye=new THREE.MeshStandardMaterial({color:0x8be34a,emissive:0x62c22a,emissiveIntensity:1.3,roughness:0.5,flatShading:true});
  const bw=between(1.15,1.35),bh=between(1.35,1.6);
  const body=add(box(bw*1.7,bh*1.25,1.0),stone,0,bh*0.35,0);
  for(const c of [[-0.5,0.4],[0.5,0.4],[0,0.0],[-0.45,-0.3],[0.5,-0.3],[0,0.55]])add(box(0.5,0.42,0.14),stoneDk,c[0]*bw,bh*0.35+c[1],0.52);
  for(const d of[1,-1]){add(box(0.72,0.55,1.05),stone,d*bw*1.05,bh*0.9,0);for(let i=0;i<3;i++)add(box(0.16,0.24,0.9),stone,d*bw*1.05+(i-1)*0.26,bh*1.22,0);}
  add(box(0.74,0.74,0.7),stone,0,bh*1.2,0.12);
  for(let i=0;i<3;i++)add(box(0.16,0.22,0.66),stone,(i-1)*0.26,bh*1.55,0.12);
  add(ico(0.11,0),mossEye,0.18,bh*1.24,0.5,1,0.8,1);add(ico(0.11,0),mossEye,-0.18,bh*1.24,0.5,1,0.8,1);
  add(box(0.4,0.08,0.1),stoneDk,0,bh*1.05,0.48);
  for(const d of[1,-1]){limb([d*bw*1.0,bh*0.85,0.1],[d*bw*1.12,bh*0.05,0.15],0.26,stone);add(box(0.6,0.6,0.6),stone,d*bw*1.14,-bh*0.35,0.2);}
  add(box(0.12,1.0,0.75),stoneDk,-bw*1.38,bh*0.35,0.35);add(box(0.1,0.7,0.5),stone,-bw*1.4,bh*0.35,0.35);
  for(const d of[1,-1]){add(box(0.6,bh*0.85,0.7),stone,d*0.5,-bh*0.55,0);add(box(0.7,0.4,0.85),stoneDk,d*0.5,-bh*1.0,0.1);}
  for(const m of [[-0.7,bh*0.9,0.5],[0.6,bh*0.2,0.52],[0,-bh*0.1,0.52],[bw*1.05,bh*1.3,0.4],[-0.5,-bh*0.9,0.4]])add(ico(0.22,0),moss,m[0],m[1],m[2],1.4,0.5,1.0);
  for(let i=0;i<8;i++){const bx=between(-0.6,0.6),by=between(-0.6,1.0);add(box(between(0.22,0.42),between(0.22,0.4),0.1),stoneDk,bx*bw,bh*0.35+by,0.53);}
  const dark=new THREE.MeshBasicMaterial({color:0x0b0b0d});for(const d of[1,-1])add(box(0.15,0.2,0.06),dark,d*0.3,bh*0.55,0.55);
  for(const m of[[-0.32,bh*1.32,0.4],[0.36,bh*0.62,0.5],[-0.56,bh*0.12,0.5],[0.62,-bh*0.6,0.45]])add(ico(between(0.14,0.22),0),moss,m[0],m[1],m[2],1.5,0.5,1.1);
  for(const d of[1,-1])add(box(0.05,0.6,0.05),moss,d*bw*0.92,bh*0.5,0.5);
    return{group,body,glowMat:mossEye,bw,bh,bodyBase:[1,1,1]};}

function buildHydra(s){const k=baseKit(s,':hyd');const{group,between,ico,cone,add,limb,glowMat,hornMat,clawMat}=k;
  const scale=new THREE.MeshStandardMaterial({color:0x2f5142,roughness:0.7,metalness:0.05,flatShading:true});
  const belly=new THREE.MeshStandardMaterial({color:0x6f7d5a,roughness:0.8,flatShading:true});
  const mouth=new THREE.MeshStandardMaterial({color:0x3a0d10,roughness:0.6,flatShading:true});
  const bw=between(1.15,1.4),bh=between(0.9,1.1);
  const body=add(ico(1.05,0),scale,0,-0.35,-0.1,bw*1.2,bh*0.9,1.35);
  add(ico(0.7,0),scale,0,0.15,0.35,bw*0.95,bh*0.85,0.95);
  add(ico(0.85,0),scale,0,-0.5,-1.0,bw*1.0,bh*0.8,1.05);
  add(ico(0.5,0),belly,0,-0.75,0.35,bw*0.9,0.6,0.8);
  for(const sx of[1,-1])for(const sz of[0.7,-0.85]){const lx=sx*bw*0.95,lz=sz;
    limb([sx*bw*0.65,-0.5,lz],[lx,-bh*1.15,lz+(sz>0?0.25:-0.1)],0.19,scale);
    add(ico(0.2,0),scale,lx,-bh*1.2,lz+(sz>0?0.35:-0.15),1.3,0.7,1.3);
    for(const o of[-0.13,0,0.13])add(cone(0.05,0.24,5),clawMat,lx+o,-bh*1.28,lz+(sz>0?0.55:-0.02),1,1,1,-0.5,0,0);}
  {let px=0.1,py=-0.35,pz=-1.5,a=0;for(let i=0;i<7;i++){const nx=px+Math.sin(a)*0.55,ny=py+0.05*i,nz=pz-0.35;limb([px,py,pz],[nx,ny,nz],0.24-i*0.03,scale);px=nx;py=ny;pz=nz;a+=0.55;}}
  const spec=[[-0.62,1.7,1.35,-1.4],[-0.32,2.15,1.05,-0.7],[0.02,2.45,0.7,0.0],[0.34,2.05,1.05,0.7],[0.64,1.65,1.4,1.4]];
  for(const sp of spec){const bx0=sp[0],hyT=sp[1],hzT=sp[2],splay=sp[3];
    const P0=[bx0*bw,0.35,0.45],P2=[bx0*bw+splay*0.25,hyT,hzT],P1=[bx0*bw+splay*0.55,(0.35+hyT)/2+0.35,0.2];
    const segs=6;let prev=P0;
    for(let i=1;i<=segs;i++){const t=i/segs,u=1-t;
      const pt=[u*u*P0[0]+2*u*t*P1[0]+t*t*P2[0],u*u*P0[1]+2*u*t*P1[1]+t*t*P2[1],u*u*P0[2]+2*u*t*P1[2]+t*t*P2[2]];
      limb(prev,pt,0.22-0.13*t,scale);prev=pt;}
    const hx=P2[0],hy=P2[1],hz=P2[2];
    add(ico(0.28,0),scale,hx,hy,hz+0.02,1.0,0.85,1.7);
    add(ico(0.17,0),scale,hx,hy-0.16,hz+0.34,1.0,0.55,1.35);
    add(ico(0.12,0),mouth,hx,hy-0.06,hz+0.3,1.0,0.6,0.9);
    for(let t=-1;t<=1;t++){add(cone(0.035,0.13,5),hornMat,hx+t*0.08,hy+0.04,hz+0.52,1,1,1,Math.PI,0,0);add(cone(0.035,0.13,5),hornMat,hx+t*0.08,hy-0.2,hz+0.5);}
    add(ico(0.055,0),glowMat,hx+0.12,hy+0.1,hz+0.24);add(ico(0.055,0),glowMat,hx-0.12,hy+0.1,hz+0.24);
    for(let f=0;f<4;f++)add(cone(0.05,0.34,4),hornMat,hx,hy+0.18-f*0.14,hz-0.12-f*0.05,1,1,1,-1.9,0,0);
    add(cone(0.05,0.2,5),hornMat,hx+0.14,hy+0.16,hz+0.08,1,1,1,-0.7,0,0.4);add(cone(0.05,0.2,5),hornMat,hx-0.14,hy+0.16,hz+0.08,1,1,1,-0.7,0,-0.4);}
  for(let i=0;i<7;i++)add(cone(0.09,0.32,4),hornMat,0,0.0+i*0.02,0.3-i*0.32,1,1,1,-1.2,0,0);
  for(const sx of[1,-1])for(let i=0;i<4;i++)add(ico(0.13,0),scale,sx*(0.3+i*0.12),-0.3-i*0.05,0.5-i*0.3,1,0.5,1);
  for(let i=0;i<8;i++){const a=between(0,6.283);add(ico(between(0.08,0.14),0),belly,Math.cos(a)*bw*0.85,-0.45+between(-0.25,0.35),0.35+Math.sin(a)*0.4,1,0.6,1);}
    return{group,body,glowMat,bw,bh,bodyBase:[bw*1.2,bh*0.9,1.35]};}

function buildLich(s){const k=baseKit(s,':lich');const{group,between,ico,cone,cyl,box,add,glowMat,bodyMat,hornMat}=k;
  const bw=between(0.9,1.1),bh=1.3;
  const body=add(cone(1.15,2.4,10),bodyMat,0,-0.2,0);
  add(cone(1.2,0.5,10),bodyMat,0,0.9,0);
  add(ico(0.4,1),hornMat,0,1.35,0.2,0.9,1.0,0.95);
  add(ico(0.1,0),glowMat,0.14,1.36,0.42,1,0.7,1);add(ico(0.1,0),glowMat,-0.14,1.36,0.42,1,0.7,1);
  add(box(0.5,0.14,0.4),hornMat,0,1.18,0.35);
  add(cone(0.6,0.7,8),bodyMat,0,1.55,-0.02,1,1,1,-0.1,0,0);
  for(const d of[1,-1])add(cyl(0.08,1.0),hornMat,d*0.7,0.5,0.2,1,1,1,0.3,0,d*-0.3);
  add(cyl(0.06,2.6),hornMat,0.95,0.3,0.3);add(ico(0.18,0),glowMat,0.95,1.65,0.3);
  add(ico(0.16,0),glowMat,0,0.35,0.55);
  return{group,body,glowMat,bw,bh,bodyBase:[1,1,1]};}

function buildElemental(s){const k=baseKit(s,':elem');const{group,rand,between,ico,cone,box,add,spikeAt,limb}=k;
  const el=((s||'').match(/^arch:elemental:(\w+)/)||[])[1]||'arcane';
  const T={fire:{body:0x241016,glow:0xff5a10,mode:'legs',crag:true},
           water:{body:0x123244,glow:0x37c8ff,mode:'wisp'},
           ice:{body:0x9fd4ec,glow:0xbfeeff,mode:'crystal'},
           earth:{body:0xa07a3c,glow:0xe0b24a,mode:'crystal'},
           nature:{body:0x2c4a1e,glow:0x74e23a,mode:'legs',crag:true},
           shadow:{body:0x1a1622,glow:0xb060ff,mode:'wisp'},
           lightning:{body:0x1a1a26,glow:0xffe24a,mode:'legs',bolt:true},
           wind:{body:0x6f8a92,glow:0xbfe0e8,mode:'wisp'}}[el]||{body:0x241832,glow:0x9a6bff,mode:'wisp'};
  const bMat=new THREE.MeshStandardMaterial({color:T.body,roughness:T.mode==='crystal'?0.25:0.7,metalness:0.05,flatShading:true,transparent:T.mode==='wisp',opacity:T.mode==='wisp'?0.74:1});
  const gMat=new THREE.MeshStandardMaterial({color:T.glow,emissive:T.glow,emissiveIntensity:1.5,roughness:0.3,flatShading:true});
  const bw=1.05,bh=1.3;let body;
  if(T.mode==='crystal'){
    body=add(ico(0.6,0),bMat,0,0.42,0);                 // faceted crystal core (NOT emissive → no blowout)
    add(ico(0.2,0),gMat,0,0.42,0.14);                    // small glowing heart
    const dirs=[[0,1.3,0.9],[0.5,1.0,0.6],[-0.5,1.0,0.6],[0.85,0.4,0.3],[-0.85,0.4,0.3],[0.3,1.5,0.2],[-0.3,1.5,0.2],[0,0.2,0.85]];
    for(const dd of dirs)spikeAt(dd[0]*0.6,0.4+dd[1]*0.2,dd[2]*0.5,dd[0],dd[1],dd[2],between(0.7,1.3),between(0.14,0.24),bMat);
    for(const d of[1,-1]){spikeAt(d*1.0,-0.2,0.2,d*0.6,-0.6,0.2,0.7,0.18,bMat);add(ico(0.09,0),gMat,d*0.9,0.55,0.4);}
  for(let i=0;i<6;i++)spikeAt(between(-0.6,0.6),0.4+between(-0.2,0.9),between(-0.2,0.5),between(-0.5,0.5),between(0.3,1),between(-0.3,0.5),between(0.3,0.7),between(0.06,0.12),bMat);
      return{group,body,glowMat:gMat,bw,bh,bodyBase:[1,1,1]};}
  body=add(ico(0.85,1),bMat,0,0.4,0,1.0,1.2,0.9);
  add(ico(0.3,1),gMat,0,0.55,0.5,1,1.2,0.5);
  add(ico(0.4,1),bMat,0,1.35,0.1);
  add(ico(0.09,0),gMat,0.16,1.4,0.34);add(ico(0.09,0),gMat,-0.16,1.4,0.34);
  for(const d of[1,-1]){limb([d*0.7,0.9,0.1],[d*1.3,0.4,0.2],0.22,bMat);add(ico(0.36,1),bMat,d*1.42,0.2,0.28);add(ico(0.16,0),gMat,d*1.42,0.34,0.5);}
  if(T.crag)for(const d of[1,-1]){spikeAt(d*0.7,1.1,-0.1,d*0.5,1,-0.2,0.6,0.16,bMat);add(ico(0.14,0),gMat,d*0.6,0.9,0.2);}
  if(T.bolt)for(let i=0;i<4;i++)add(box(0.05,0.5,0.05),gMat,between(-0.6,0.6),0.6+between(0,0.6),0.4,1,1,1,between(-1,1),0,between(-1,1));
  if(T.mode==='legs'){for(const d of[1,-1]){limb([d*0.4,-0.1,0],[d*0.45,-0.9,0.05],0.24,bMat);add(ico(0.26,1),bMat,d*0.45,-0.95,0.15,1.1,0.7,1.2);if(T.crag)add(ico(0.1,0),gMat,d*0.45,-0.5,0.3);}}
  else{for(let i=0;i<5;i++){const t=i/4;add(ico(0.5-t*0.36,1),bMat,Math.sin(t*6)*0.2,-0.1-t*0.9,0,1,1,1,0,t*3,0);}for(let i=0;i<5;i++)add(ico(0.07,0),gMat,between(-0.5,0.5),between(-1.0,0.4),between(-0.3,0.4));}
  if(el==='fire'){for(let i=0;i<6;i++)spikeAt(between(-0.5,0.5),0.5+between(0,0.9),0.3,between(-0.3,0.3),1,0.2,between(0.3,0.7),0.08,gMat);}
  else if(el==='nature'){for(let i=0;i<7;i++)add(cone(0.1,0.3,4),gMat,between(-0.7,0.7),0.4+between(0,0.9),between(-0.2,0.5),1,1,1,between(-0.5,0.5),0,between(-0.5,0.5));}
  else if(el==='lightning'){for(let i=0;i<3;i++)add(box(0.04,0.6,0.04),gMat,between(-0.7,0.7),0.7,0.4,1,1,1,between(-1.2,1.2),0,between(-0.6,0.6));}
  else if(el==='shadow'){for(let i=0;i<6;i++)add(ico(0.1,0),bMat,between(-0.8,0.8),between(-0.6,1.2),between(-0.4,0.4),1,1.5,1);}
  else{for(let i=0;i<6;i++)add(ico(0.08,0),gMat,between(-0.6,0.6),between(0,1.2),between(-0.3,0.5));}
    return{group,body,glowMat:gMat,bw,bh,bodyBase:[1,1.2,0.9]};}


// Behemoth = a bipedal ROCK TITAN (Hercules Rock Titan): dark faceted stone body,
// glowing lava eyes/cracks, and a fan of big jagged rock shards down the back.
function buildBehemoth(s){const k=baseKit(s,':beh');const{group,between,ico,cone,cyl,box,add,spikeAt,limb}=k;
  const rock = new THREE.MeshStandardMaterial({ color: 0x2c2b33, roughness: 0.96, metalness: 0.05, flatShading: true });
  const rockDk = new THREE.MeshStandardMaterial({ color: 0x1a1920, roughness: 0.96, flatShading: true });
  const lava = new THREE.MeshStandardMaterial({ color: 0xff6a1e, emissive: 0xff4a10, emissiveIntensity: 2.2, roughness: 0.4, flatShading: true });
  const bw = between(1.15,1.35), bh = between(1.3,1.55);
  // hulking FACETED torso (low-poly = craggy), hunched + pushed back so the head reads
  const body = add(ico(1.05,0), rock, 0, bh*0.42, -0.2, bw*1.02, bh*0.8, 0.8);
  add(ico(0.5,0), rock, 0, bh*0.05, 0.22, bw*0.9, bh*0.55, 0.7);         // lower belly block, forward
  add(ico(0.24,0), lava, 0, bh*0.5, 0.62, 1.4, 1.6, 0.5);               // chest lava crack
  // big rock shoulders
  for(const d of [1,-1]) add(ico(0.6,0), rock, d*bw*0.98, bh*0.95, -0.05, 1, 0.9, 1);
  // low blocky head thrust FORWARD between the shoulders, glowing lava face
  add(box(0.72,0.62,0.66), rockDk, 0, bh*1.02, 0.56);
  add(box(0.72,0.14,0.2), rock, 0, bh*1.24, 0.66, 1,1,1,-0.2,0,0);       // brow
  add(ico(0.14,0), lava, 0.2, bh*1.04, 0.92, 1, 0.85, 1); add(ico(0.14,0), lava, -0.2, bh*1.04, 0.92, 1, 0.85, 1);
  add(box(0.4,0.1,0.14), lava, 0, bh*0.82, 0.88);                        // glowing mouth slit
  // thick arms down to huge fists
  for(const d of [1,-1]){ const sx = d*bw*1.0;
    limb([sx, bh*0.95, 0], [sx*1.14, bh*0.2, 0.12], 0.24, rock);
    limb([sx*1.14, bh*0.2, 0.12], [sx*1.08, -bh*0.35, 0.3], 0.22, rock);
    add(ico(0.44,1), rock, sx*1.08, -bh*0.5, 0.35);                     // fist
    spikeAt(sx*1.08, -bh*0.5, 0.72, 0, 0, 1, 0.34, 0.1, rockDk);        // knuckle shard
  }
  // short thick legs
  for(const d of [1,-1]){ const lx = d*0.5;
    limb([lx, bh*0.2, 0], [lx, -bh*0.75, 0.05], 0.28, rock);
    add(ico(0.3,1), rockDk, lx, -bh*0.82, 0.16, 1.2, 0.7, 1.3);
  }
  // SIGNATURE: a fan of big jagged rock shards up-and-back off the shoulders/back
  const shards = [[0, bh*1.2, -0.2, 0.05, 1, -0.5, 1.6, 0.3],
                  [0.35, bh*1.28, -0.1, 0.25, 1, -0.35, 1.35, 0.24], [-0.35, bh*1.28, -0.1, -0.25, 1, -0.35, 1.35, 0.24],
                  [0.6, bh*1.02, -0.25, 0.55, 1, -0.5, 1.2, 0.24], [-0.6, bh*1.02, -0.25, -0.55, 1, -0.5, 1.2, 0.24],
                  [0.98, bh*0.82, -0.2, 0.85, 0.9, -0.45, 1.0, 0.2], [-0.98, bh*0.82, -0.2, -0.85, 0.9, -0.45, 1.0, 0.2]];
  for(const [px,py,pz,dx,dy,dz,len,r] of shards) spikeAt(px, py, pz, dx, dy, dz, len, r, rockDk);
  add(ico(0.12,0), lava, 0.3, bh*0.95, -0.15); add(ico(0.1,0), lava, -0.34, bh*0.85, -0.15); // lava between shards
  for(let i=0;i<12;i++){const a=between(0,6.283),rr=between(0.55,1.05);add(ico(between(0.12,0.26),0),i%2?rockDk:rock,Math.cos(a)*rr*bw*0.9,bh*0.45+between(-0.55,0.7),0.12+Math.sin(a)*0.5,1,1,1,between(0,3),between(0,3),between(0,3));}
  for(const d of[1,-1]){add(box(0.07,0.75,0.07),lava,d*bw*1.06,bh*0.4,0.18,1,1,1,0.3,0,d*0.18);add(box(0.06,0.55,0.06),lava,d*0.5,-bh*0.25,0.16);}
  add(box(0.48,0.08,0.12),lava,0,bh*0.2,0.62);add(box(0.08,0.34,0.12),lava,0,bh*0.34,0.62);
    return { group, body, glowMat: lava, bw, bh, bodyBase: [bw*1.05, bh*0.95, 0.95] };}

function buildGargoyle(s){const k=baseKit(s,':garg');const{group,between,ico,cone,cyl,add,glowMat,bodyMat,hornMat,clawMat}=k;
  const bw=between(0.9,1.1),bh=between(1.0,1.2);
  const body=add(ico(0.9,1),bodyMat,0,0,0,bw,bh*0.9,0.9);
  add(ico(0.45,1),bodyMat,0,bh*0.75,0.2);
  add(ico(0.09,1),glowMat,0.18,bh*0.78,0.42,1,0.6,1);add(ico(0.09,1),glowMat,-0.18,bh*0.78,0.42,1,0.6,1);
  add(cone(0.1,0.6,5),hornMat,0.2,bh*1.1,0.0,1,1,1,-0.3,0,0.3);add(cone(0.1,0.6,5),hornMat,-0.2,bh*1.1,0.0,1,1,1,-0.3,0,-0.3);
  for(const d of[1,-1])add(cone(0.5,1.4,3),bodyMat,d*bw*0.9,bh*0.5,-0.4,1,1,0.3,-0.3,d*0.6,d*-0.4);
  for(const d of[1,-1]){add(cyl(0.16,0.6),bodyMat,d*bw*0.7,-bh*0.3,0.2,1,1,1,0.6,0,d*-0.2);add(ico(0.2,1),bodyMat,d*bw*0.75,-bh*0.7,0.4);for(const o of[-0.1,0.1])add(cone(0.05,0.24,5),clawMat,d*bw*0.75+o,-bh*0.88,0.55,1,1,1,1.2,0,0);}
  return{group,body,glowMat,bw,bh,bodyBase:[bw,bh*0.9,0.9]};}

function buildKraken(s){const k=baseKit(s,':krak');const{group,ico,cone,add,glowMat,bodyMat,between,limb}=k;
  const bw=between(1.1,1.35),bh=between(1.0,1.2);
  const body=add(ico(1.0,1),bodyMat,0,0.4,0,bw,bh*1.1,1.0);
  add(cone(0.7,1.0,7),bodyMat,0,bh*1.3,0);
  add(ico(0.12,1),glowMat,0.25,0.5,0.6,1,0.6,1);add(ico(0.12,1),glowMat,-0.25,0.5,0.6,1,0.6,1);
  const n=8;for(let i=0;i<n;i++){const a=(i/n)*6.28;let px=Math.cos(a)*0.5,py=-0.2,pz=Math.sin(a)*0.4+0.2;
    for(let j=0;j<4;j++){const nx=px+Math.cos(a)*0.35,ny=py-0.4,nz=pz+Math.sin(a)*0.25+0.08;limb([px,py,pz],[nx,ny,nz],0.12-j*0.02,bodyMat);px=nx;py=ny;pz=nz;}}
  return{group,body,glowMat,bw,bh,bodyBase:[bw,bh*1.1,1.0]};}

function buildTreant(s){const k=baseKit(s,':tree');const{group,between,ico,cone,cyl,add,glowMat,bodyMat,hornMat,limb}=k;
  const bw=between(0.8,1.05),bh=between(1.3,1.6);
  const body=add(cyl(0.8,2.4,7),bodyMat,0,0.1,0);
  add(ico(0.1,0),glowMat,0.2,0.6,0.6,1,0.7,1);add(ico(0.1,0),glowMat,-0.2,0.6,0.6,1,0.7,1);
  add(ico(0.16,0),glowMat,0,0.2,0.6);
  for(const d of[1,-1]){limb([d*0.7,0.7,0],[d*1.5,1.3,0.1],0.14);limb([d*1.5,1.3,0.1],[d*2.0,1.0,0.2],0.1);for(const o of[0,0.25,-0.25])add(cone(0.06,0.3,5),hornMat,d*2.1,1.0+o,0.2,1,1,1,0,0,d*-1.2);}
  for(let i=0;i<5;i++){const a=(i/5)*6.28;limb([0,-1.0,0],[Math.cos(a)*0.9,-1.4,Math.sin(a)*0.6],0.12);}
  for(let i=0;i<6;i++)add(ico(0.2,0),glowMat,between(-0.6,0.6),1.4+between(0,0.5),between(-0.4,0.4));
  return{group,body,glowMat,bw,bh,bodyBase:[1,1,1]};}

function buildWraith(s){const k=baseKit(s,':wr');const{group,between,ico,cone,cyl,add,glowMat,bodyMat,clawMat}=k;
  const bw=between(0.9,1.1),bh=1.3;
  const body=add(cone(1.0,2.6,9),bodyMat,0,-0.1,0);
  add(cone(0.6,0.8,8),bodyMat,0,1.2,0.05,1,1,1,-0.1,0,0);
  add(ico(0.09,0),glowMat,0.13,1.1,0.32,1,1.3,1);add(ico(0.09,0),glowMat,-0.13,1.1,0.32,1,1.3,1);
  for(let i=0;i<6;i++){const a=(i/6)*6.28;add(cone(0.18,0.6,4),bodyMat,Math.cos(a)*0.6,-1.3,Math.sin(a)*0.5,1,1,1,Math.PI,0,0);}
  for(const d of[1,-1]){add(cyl(0.1,0.9),bodyMat,d*0.7,0.4,0.3,1,1,1,0.5,0,d*-0.3);for(const o of[-0.12,0,0.12])add(cone(0.04,0.3,5),clawMat,d*0.95+o,-0.1,0.55,1,1,1,1.0,0,0);}
  return{group,body,glowMat,bw,bh,bodyBase:[1,1,1]};}

function buildCyclops(s){const k=baseKit(s,':cyc');const{group,between,ico,cone,box,add,limb}=k;
  const skin=new THREE.MeshStandardMaterial({color:0xa87c48,roughness:0.78,flatShading:true});
  const skinDk=new THREE.MeshStandardMaterial({color:0x77552e,roughness:0.8,flatShading:true});
  const loin=new THREE.MeshStandardMaterial({color:0x7a3f13,roughness:0.9,flatShading:true});
  const horn=new THREE.MeshStandardMaterial({color:0xbcbcc2,roughness:0.5,flatShading:true});
  const claw=new THREE.MeshStandardMaterial({color:0x2a2622,roughness:0.5,flatShading:true});
  const maw=new THREE.MeshStandardMaterial({color:0x5a1418,roughness:0.6,flatShading:true});
  const tooth=new THREE.MeshStandardMaterial({color:0xeee6d2,roughness:0.5,flatShading:true});
  const eyeMat=new THREE.MeshStandardMaterial({color:0xfff2c0,emissive:0xffd060,emissiveIntensity:1.5,roughness:0.3,flatShading:true});
  const bw=between(1.2,1.4),bh=between(1.2,1.4);
  const body=add(ico(0.95,1),skin,0,bh*0.0,0.05,bw*1.0,bh*0.72,0.85);
  add(ico(0.46,1),skin,0.5,bh*0.28,0.2,1,0.9,0.9);add(ico(0.46,1),skin,-0.5,bh*0.28,0.2,1,0.9,0.9);
  add(ico(0.82,1),skin,0,-bh*0.55,0.0,bw*0.8,bh*0.5,0.75);
  const hy=bh*1.12;add(ico(0.55,1),skin,0,hy,0.15);
  add(ico(0.26,1),eyeMat,0,hy+0.05,0.52,1,1,0.7);add(ico(0.06,0),claw,0,hy+0.05,0.72);
  add(box(0.5,0.1,0.2),skinDk,0,hy+0.28,0.4,1,1,1,-0.2,0,0);
  add(cone(0.13,0.6,7),horn,0,hy+0.5,0.18,1,1,1,-0.15,0,0);
  add(cone(0.14,0.34,6),skin,0.5,hy+0.16,0.0,1,1,1,0,0,-1.0);add(cone(0.14,0.34,6),skin,-0.5,hy+0.16,0.0,1,1,1,0,0,1.0);
  add(ico(0.3,1),skin,0,hy-0.34,0.32,1.1,0.6,0.9);add(ico(0.2,1),maw,0,hy-0.26,0.42,1.2,0.6,0.6);
  for(let i=-1;i<=1;i++){add(cone(0.05,0.14,5),tooth,i*0.14,hy-0.14,0.56,1,1,1,Math.PI,0,0);add(cone(0.05,0.14,5),tooth,i*0.14,hy-0.4,0.54);}
  for(const d of[1,-1]){limb([d*bw*0.9,bh*0.5,0.05],[d*bw*1.2,bh*0.0,0.2],0.28,skin);limb([d*bw*1.2,bh*0.0,0.2],[d*bw*1.1,-bh*0.5,0.4],0.24,skin);
    add(ico(0.34,1),skin,d*bw*1.08,-bh*0.62,0.45);for(const o of[-0.13,0,0.13])add(cone(0.05,0.2,5),claw,d*bw*1.08+o,-bh*0.82,0.5,1,1,1,2.9,0,0);}
  add(box(bw*1.2,0.55,0.85),loin,0,-bh*0.78,0.1);
  for(const d of[1,-1]){limb([d*0.45,-bh*0.7,0.05],[d*0.5,-bh*1.4,0.1],0.26,skin);add(box(0.44,0.24,0.72),skin,d*0.5,-bh*1.5,0.2);for(const o of[-0.13,0,0.13])add(box(0.09,0.08,0.14),skinDk,d*0.5+o,-bh*1.52,0.54);}
  add(ico(0.28,1),skinDk,0,bh*0.12,0.74,1.2,0.4,0.4);
  for(const yy of[-0.12,-0.34,-0.56])add(box(0.46,0.05,0.1),skinDk,0,yy,0.68);
  for(const d of[1,-1])add(ico(0.2,1),skin,d*bw*0.78,bh*0.42,0.22);
  add(box(0.34,0.05,0.08),skinDk,0,hy+0.2,0.5,1,1,1,-0.2,0,0);
    return{group,body,glowMat:eyeMat,bw,bh,bodyBase:[bw*1.0,bh*0.72,0.85]};}

function buildOoze(s){const k=baseKit(s,':ooz');const{group,rand,between,ico,add,glowMat,pal}=k;
  const bw=between(1.2,1.5),bh=between(0.8,1.0);
  const gel=new THREE.MeshStandardMaterial({color:pal.accent,emissive:pal.accent,emissiveIntensity:0.5,roughness:0.2,flatShading:true,transparent:true,opacity:0.75});
  const body=add(ico(1.1,1),gel,0,-0.2,0,bw,bh,bw);
  for(let i=0;i<6;i++){const a=rand()*6.28;add(ico(between(0.25,0.5),1),gel,Math.cos(a)*bw*0.6,-bh*0.5+between(-0.2,0.3),Math.sin(a)*bw*0.5);}
  add(ico(0.12,0),glowMat,0.25,0.1,0.6);add(ico(0.12,0),glowMat,-0.25,0.1,0.6);
  for(let i=0;i<5;i++)add(ico(0.1,0),glowMat,between(-0.6,0.6),between(-0.4,0.4),between(-0.3,0.5));
  return{group,body,glowMat,bw,bh,bodyBase:[bw,bh,bw]};}

function buildScorpion(s){const k=baseKit(s,':scor');const{group,between,ico,cone,add,glowMat,bodyMat,hornMat,limb}=k;
  const bw=between(1.0,1.25),bh=between(0.7,0.9);
  const body=add(ico(0.9,1),bodyMat,0,0.0,-0.2,bw,bh,1.2);
  add(ico(0.5,1),bodyMat,0,-0.05,0.7,0.9,0.8,0.9);
  add(ico(0.08,0),glowMat,0.2,0.1,1.0);add(ico(0.08,0),glowMat,-0.2,0.1,1.0);
  for(const d of[1,-1]){limb([d*0.6,0.0,0.4],[d*1.1,0.1,1.1],0.14);add(cone(0.18,0.5,5),hornMat,d*1.2,0.1,1.5,1,1,1,1.3,0,0);add(cone(0.14,0.4,5),hornMat,d*1.05,0.1,1.45,1,1,1,1.3,0,0);}
  for(const d of[1,-1])for(let i=0;i<3;i++){const pz=0.2-i*0.4;limb([d*bw*0.6,-0.1,pz],[d*(bw*1.2+0.3),-bh*0.9,pz-0.1],0.06);}
  for(let i=0;i<5;i++){const t=i/4;add(ico(0.2-i*0.028,1),bodyMat,0,0.2+t*1.6,-1.0+t*0.9);}
  add(cone(0.14,0.5,6),glowMat,0,2.0,-0.1,1,1,1,0.6,0,0);
  return{group,body,glowMat,bw,bh,bodyBase:[bw,bh,1.2]};}

function buildChimera(s){const k=baseKit(s,':chi');const{group,between,ico,cone,box,add,limb,spikeAt}=k;
  const fur=new THREE.MeshStandardMaterial({color:0xb98f4e,roughness:0.82,flatShading:true});
  const mane=new THREE.MeshStandardMaterial({color:0x7d551f,roughness:0.9,flatShading:true});
  const drg=new THREE.MeshStandardMaterial({color:0xb23a17,roughness:0.6,flatShading:true});
  const ram=new THREE.MeshStandardMaterial({color:0x8f8a80,roughness:0.7,flatShading:true});
  const ramH=new THREE.MeshStandardMaterial({color:0xcfc6b4,roughness:0.5,flatShading:true});
  const claw=new THREE.MeshStandardMaterial({color:0x241f1a,roughness:0.5,flatShading:true});
  const tooth=new THREE.MeshStandardMaterial({color:0xe6dcc6,roughness:0.5,flatShading:true});
  const maw=new THREE.MeshStandardMaterial({color:0x4a1013,roughness:0.6,flatShading:true});
  const fire=new THREE.MeshStandardMaterial({color:0xff7a1e,emissive:0xff5210,emissiveIntensity:1.6,roughness:0.4,flatShading:true});
  const bw=between(1.1,1.3),bh=between(1.0,1.15);
  const body=add(ico(0.95,1),fur,0,0.0,0.1,bw*1.0,bh*0.88,1.4);
  add(ico(0.72,1),fur,0,-0.05,-1.0,bw*0.82,bh*0.78,1.0);
  add(ico(0.55,1),fur,0,0.2,0.85,bw*0.7,bh*0.6,0.7);
  for(const sx of[1,-1])for(const sz of[0.9,-0.95]){const lx=sx*bw*0.6,lz=sz;
    limb([lx,-bh*0.35,lz],[lx,-bh*1.1,lz+(sz>0?0.2:-0.05)],0.17,fur);
    add(ico(0.17,1),fur,lx,-bh*1.15,lz+(sz>0?0.32:-0.1));
    for(const o of[-0.09,0,0.09])add(cone(0.045,0.16,5),claw,lx+o,-bh*1.22,lz+(sz>0?0.46:-0.02),1,1,1,-0.3,0,0);}
  {const hx=0,hy=0.62,hz=1.05;
   for(let i=0;i<14;i++){const a=i/14*6.283;add(cone(0.16,0.44,5),mane,hx+Math.cos(a)*0.5,hy+Math.sin(a)*0.5,hz-0.3,1,1,1,Math.cos(a)*0.7,0,Math.sin(a)*0.7-1.5);}
   add(ico(0.36,1),fur,hx,hy,hz);add(ico(0.24,1),fur,hx,hy-0.12,hz+0.3,1,0.85,1.15);
   add(ico(0.16,1),maw,hx,hy-0.16,hz+0.4,1.15,0.7,0.7);
   for(let t=-1;t<=1;t++){add(cone(0.045,0.14,5),tooth,hx+t*0.09,hy-0.04,hz+0.52,1,1,1,Math.PI,0,0);add(cone(0.045,0.14,5),tooth,hx+t*0.09,hy-0.26,hz+0.5);}
   add(cone(0.07,0.24,6),tooth,hx+0.14,hy-0.18,hz+0.5,1,1,1,0.2,0,0);add(cone(0.07,0.24,6),tooth,hx-0.14,hy-0.18,hz+0.5,1,1,1,0.2,0,0);
   add(ico(0.06,0),fire,hx+0.13,hy+0.1,hz+0.2);add(ico(0.06,0),fire,hx-0.13,hy+0.1,hz+0.2);}
  {const P0=[-bw*0.5,0.3,0.4],P2=[-bw*0.95,1.75,0.75],P1=[-bw*1.05,1.0,0.1];
   let prev=P0;for(let i=1;i<=5;i++){const t=i/5,u=1-t;const pt=[u*u*P0[0]+2*u*t*P1[0]+t*t*P2[0],u*u*P0[1]+2*u*t*P1[1]+t*t*P2[1],u*u*P0[2]+2*u*t*P1[2]+t*t*P2[2]];limb(prev,pt,0.2-0.08*t,drg);prev=pt;}
   const hx=P2[0],hy=P2[1],hz=P2[2];
   add(ico(0.26,0),drg,hx,hy,hz+0.05,1.0,0.8,1.7);add(ico(0.16,0),drg,hx,hy-0.16,hz+0.34,1,0.55,1.3);
   add(ico(0.1,0),maw,hx,hy-0.06,hz+0.32,1,0.6,0.9);
   add(cone(0.06,0.28,5),drg,hx+0.1,hy+0.2,hz-0.05,1,1,1,-0.5,0,0.3);add(cone(0.06,0.28,5),drg,hx-0.1,hy+0.2,hz-0.05,1,1,1,-0.5,0,-0.3);
   add(ico(0.16,0),fire,hx,hy-0.05,hz+0.62,1.3,0.8,1.8);
   add(ico(0.05,0),fire,hx+0.1,hy+0.08,hz+0.2);add(ico(0.05,0),fire,hx-0.1,hy+0.08,hz+0.2);}
  {const P0=[bw*0.5,0.3,0.4],P2=[bw*0.9,1.35,0.7],P1=[bw*1.0,0.85,0.25];
   let prev=P0;for(let i=1;i<=4;i++){const t=i/4,u=1-t;const pt=[u*u*P0[0]+2*u*t*P1[0]+t*t*P2[0],u*u*P0[1]+2*u*t*P1[1]+t*t*P2[1],u*u*P0[2]+2*u*t*P1[2]+t*t*P2[2]];limb(prev,pt,0.19-0.06*t,ram);prev=pt;}
   const hx=P2[0],hy=P2[1],hz=P2[2];
   add(ico(0.24,1),ram,hx,hy,hz,1,0.95,1.2);add(ico(0.15,1),ram,hx,hy-0.14,hz+0.24,1,0.7,1.05);
   add(ico(0.05,0),fire,hx+0.09,hy+0.05,hz+0.2);add(ico(0.05,0),fire,hx-0.09,hy+0.05,hz+0.2);
   for(const d of[1,-1]){let a=0,rr=0.24,cx=hx+d*0.22,cy=hy+0.06,cz=hz-0.05;for(let i=0;i<6;i++){add(ico(0.1-i*0.013,0),ramH,cx+d*Math.sin(a)*rr,cy-(1-Math.cos(a))*rr,cz);a+=0.9;rr*=0.86;}}}
  for(const d of[1,-1]){const ox=d*0.5;
    add(box(1.5,1.25,0.05),drg,ox+d*0.9,1.0,-0.75,1,1,1,0.15,d*0.35,d*0.55);
    for(let f=0;f<4;f++)spikeAt(ox+d*0.4,0.7,-0.55,d*(0.5+f*0.25),0.7+f*0.1,-0.15,1.1-f*0.12,0.05,drg);}
  {let px=0.1,py=-0.1,pz=-1.4,a=0;for(let i=0;i<6;i++){const nx=px+Math.sin(a)*0.15,ny=py+0.32,nz=pz-0.12;limb([px,py,pz],[nx,ny,nz],0.15-i*0.02,drg);px=nx;py=ny;pz=nz;a+=0.5;}
   add(cone(0.16,0.42,4),drg,px,py+0.16,pz,1,1,1,0.4,0,0);}
  for(let i=0;i<12;i++){const a=i/12*6.283;add(cone(0.12,0.34,5),mane,Math.cos(a)*0.62,0.62+Math.sin(a)*0.62,1.05-0.5,1,1,1,Math.cos(a)*0.8,0,Math.sin(a)*0.8-1.5);}
  for(const d of[1,-1])for(let f=0;f<3;f++)add(cone(0.17,0.36,3),drg,d*(1.25+f*0.26),0.5+f*0.16,-0.95,1,1,1,Math.PI,d*0.3,0);
  for(let i=0;i<5;i++)add(ico(0.06,0),fire,between(-1.1,-0.55),between(0.6,1.6),between(0.2,0.7));
    return{group,body,glowMat:fire,bw,bh,bodyBase:[bw*1.0,bh*0.88,1.4]};}

function buildFortress(s){const k=baseKit(s,':fort');const{group,between,ico,cone,cyl,box,add,glowMat,bodyMat,hornMat,plateMat}=k;
  const bw=between(1.3,1.6),bh=between(0.8,1.0);
  const body=add(ico(1.3,1),plateMat,0,0.3,0,bw*1.2,bh*1.1,bw*1.2);
  for(let i=0;i<8;i++){const a=(i/8)*6.28;add(cone(0.14,0.5,6),hornMat,Math.cos(a)*bw*0.7,0.6,Math.sin(a)*bw*0.6,1,1,1,Math.cos(a)*0.4-0.2,0,-Math.sin(a)*0.4);}
  add(cone(0.2,0.7,6),hornMat,0,1.1,0);
  add(ico(0.4,1),bodyMat,0,-0.1,bw*0.9,1,0.85,1.2);
  add(ico(0.08,0),glowMat,0.16,0.0,bw*0.9+0.3);add(ico(0.08,0),glowMat,-0.16,0.0,bw*0.9+0.3);
  for(const sx of[1,-1])for(const sz of[1,-1])add(cyl(0.25,0.5),bodyMat,sx*bw*0.7,-bh*0.6,sz*bw*0.6);
  for(let i=0;i<4;i++)add(box(0.05,0.5,0.05),glowMat,Math.cos(i*1.6)*bw*0.5,0.3,Math.sin(i*1.6)*bw*0.5,1,1,1,0.3,0,0.3);
  return{group,body,glowMat,bw,bh,bodyBase:[bw*1.2,bh*1.1,bw*1.2]};}

function buildEye(s){const k=baseKit(s,':eye');const{group,ico,cone,add,glowMat,bodyMat,hornMat,limb}=k;
  const body=add(ico(1.0,1),bodyMat,0,0.3,0);
  add(ico(0.5,1),new THREE.MeshStandardMaterial({color:0xffffff,roughness:0.2,flatShading:true}),0,0.3,0.7,1,1,0.4);
  add(ico(0.22,1),glowMat,0,0.3,0.95,1,1,0.5);
  add(ico(0.3,0),bodyMat,0,-0.2,0.75,1.3,0.5,0.6);
  for(let i=-2;i<=2;i++)add(cone(0.05,0.14,5),hornMat,i*0.1,-0.1,0.95,1,1,1,Math.PI,0,0);
  const n=6;for(let i=0;i<n;i++){const a=(i/n)*6.28;const kx=Math.cos(a)*1.6,ky=1.1+Math.sin(a*1.3)*0.5,kz=Math.sin(a)*0.8;
    limb([0,0.6,0.2],[kx,ky,kz],0.06,bodyMat);add(ico(0.12,1),bodyMat,kx,ky,kz);add(ico(0.06,1),glowMat,kx,ky,kz+0.13);}
  return{group,body,glowMat,bw:1.1,bh:1.1,bodyBase:[1,1,1]};}

const ARCH_BUILDERS = {
  brute: buildBrute, golem: buildGolem, wyrm: buildWyrm, fiend: buildFiend, brood: buildBrood,
  colossus: buildColossus, hydra: buildHydra, lich: buildLich, elemental: buildElemental, behemoth: buildBehemoth,
  gargoyle: buildGargoyle, kraken: buildKraken, treant: buildTreant, wraith: buildWraith, cyclops: buildCyclops,
  ooze: buildOoze, scorpion: buildScorpion, chimera: buildChimera, fortress: buildFortress, eye: buildEye,
};

// WINGED FIEND — lean horned demon with membrane wings + a spade tail.
function buildFiend(seedStr) {
  const rand = rng(hashStr((seedStr || 'boss') + ':f'));
  const pick = (a) => a[Math.floor(rand() * a.length)];
  const between = (a, b) => a + rand() * (b - a);
  const pal = pick(PALETTES);
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: pal.body, roughness: 0.55, metalness: 0.12, flatShading: true });
  const hornMat = new THREE.MeshStandardMaterial({ color: pal.horn, roughness: 0.45, flatShading: true });
  const clawMat = new THREE.MeshStandardMaterial({ color: 0x060608, roughness: 0.4, flatShading: true });
  const glowMat = new THREE.MeshStandardMaterial({ color: pal.accent, emissive: pal.accent, emissiveIntensity: 2.6, roughness: 0.3, flatShading: true });
  const memCol = new THREE.Color(pal.accent).lerp(new THREE.Color(pal.body), 0.55);
  const membraneMat = new THREE.MeshStandardMaterial({ color: memCol, roughness: 0.6, metalness: 0.1, flatShading: true, side: THREE.DoubleSide, transparent: true, opacity: 0.9 });
  const ico = (r, d = 1) => new THREE.IcosahedronGeometry(r, d);
  const cone = (r, h, s = 6) => new THREE.ConeGeometry(r, h, s);
  const cyl = (r, h, s = 8) => new THREE.CylinderGeometry(r * 0.7, r, h, s);
  const UP = new THREE.Vector3(0, 1, 0);
  const add = (geo, mat, x, y, z, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.rotation.set(rx, ry, rz); group.add(m); return m; };
  const bw = between(0.9, 1.12), bh = between(1.05, 1.25);
  const body = add(ico(0.9, 1), bodyMat, 0, 0.05, 0, bw, bh, 0.82);
  add(ico(0.8, 1), bodyMat, 0, bh * 0.6, 0.05, bw * 0.92, bh * 0.6, 0.8);
  add(ico(0.4, 1), bodyMat, bw * 0.78, bh * 0.72, 0); add(ico(0.4, 1), bodyMat, -bw * 0.78, bh * 0.72, 0);
  const hy = bh * 1.18, hz = 0.3;
  add(ico(0.5, 1), bodyMat, 0, hy, hz, 0.95, 0.95, 0.95);
  add(ico(0.32, 1), bodyMat, 0, hy - 0.16, hz + 0.34, 1, 0.7, 1.2);
  add(ico(0.16, 1), glowMat, 0, hy - 0.1, hz + 0.16, 1.4, 0.6, 0.6);
  add(ico(0.1, 1), glowMat, 0.2, hy + 0.03, hz + 0.34, 1, 0.55, 1, 0, 0, -0.34);
  add(ico(0.1, 1), glowMat, -0.2, hy + 0.03, hz + 0.34, 1, 0.55, 1, 0, 0, 0.34);
  add(cone(0.05, 0.2, 5), hornMat, 0.09, hy - 0.28, hz + 0.44, 1, 1, 1, Math.PI, 0, 0);
  add(cone(0.05, 0.2, 5), hornMat, -0.09, hy - 0.28, hz + 0.44, 1, 1, 1, Math.PI, 0, 0);
  add(cone(0.16, 1.5, 6), hornMat, 0.3, hy + 0.5, hz - 0.22, 1, 1, 1, -0.7, 0, 0.4);
  add(cone(0.16, 1.5, 6), hornMat, -0.3, hy + 0.5, hz - 0.22, 1, 1, 1, -0.7, 0, -0.4);
  const wing = (side) => {
    const grp = new THREE.Group();
    const pts = [[0, 0, 0], [2.4, 0.95, -0.2], [2.2, 0.05, -0.35], [1.7, -0.7, -0.4], [1.0, -1.2, -0.3]];
    const verts = []; pts.forEach((p) => verts.push(p[0], p[1], p[2]));
    const idx = []; for (let i = 1; i < pts.length - 1; i += 1) idx.push(0, i, i + 1);
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3)); geo.setIndex(idx); geo.computeVertexNormals();
    grp.add(new THREE.Mesh(geo, membraneMat));
    for (let i = 1; i < pts.length; i += 1) { const t = pts[i]; const len = Math.hypot(t[0], t[1], t[2]); const bone = new THREE.Mesh(cone(0.05, len, 5), hornMat); bone.position.set(t[0] / 2, t[1] / 2, t[2] / 2); bone.quaternion.setFromUnitVectors(UP, new THREE.Vector3(t[0], t[1], t[2]).normalize()); grp.add(bone); }
    grp.position.set(side * bw * 0.7, bh * 0.7, -0.25); grp.scale.x = side; grp.rotation.y = side * -0.35; grp.rotation.z = side * -0.15;
    group.add(grp);
  };
  wing(1); wing(-1);
  for (const s of [1, -1]) { add(cyl(0.16, 0.9), bodyMat, s * bw * 0.82, bh * 0.2, 0.12, 1, 1, 1, 0.3, 0, s * -0.42); add(ico(0.2, 1), bodyMat, s * bw * 1.02, bh * -0.42, 0.2); for (const o of [-0.1, 0.1]) add(cone(0.05, 0.28, 5), clawMat, s * bw * 1.02 + o, bh * -0.62, 0.36, 1, 1, 1, 1.2, 0, 0); }
  for (const s of [1, -1]) { add(cyl(0.2, 0.7), bodyMat, s * 0.35, -bh * 0.5, 0.05, 1, 1, 1, 0.12, 0, 0); add(cyl(0.15, 0.6), bodyMat, s * 0.4, -bh * 1.0, 0.16, 1, 1, 1, -0.2, 0, 0); add(cone(0.14, 0.32, 5), hornMat, s * 0.42, -bh * 1.34, 0.26, 1, 1, 1, Math.PI * 0.92, 0, 0); }
  let tx = 0, ty = -bh * 0.7, tz = -0.5;
  for (let i = 0; i < 5; i += 1) { add(cyl(0.1 - i * 0.012, 0.36), bodyMat, tx, ty, tz, 1, 1, 1, 0.9, 0, Math.sin(i) * 0.25); tx += Math.sin(i * 1.3) * 0.16; ty -= 0.02; tz -= 0.32; }
  add(cone(0.17, 0.4, 4), hornMat, tx, ty, tz, 1, 1.5, 0.35, 1.2, 0, 0);
  add(ico(0.2, 1), glowMat, 0, bh * 0.3, 0.52);
  return { group, body, glowMat, bw, bh, bodyBase: [bw, bh, 0.82] };
}

// BROODMOTHER — bulbous insectoid, eight arched legs, mandibles, eye cluster.
// Brood = a giant SPIDER: bulbous abdomen, a red glowing eye-cluster, red fangs,
// and eight spiky jointed legs with the knees raised above the body (tarantula pose).
function buildBrood(seedStr) {
  const rand = rng(hashStr((seedStr || 'boss') + ':b'));
  const between = (a, b) => a + rand() * (b - a);
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x24222c, roughness: 0.7, metalness: 0.14, flatShading: true });
  const legMat = new THREE.MeshStandardMaterial({ color: 0x2b2230, roughness: 0.62, metalness: 0.18, flatShading: true });
  const faceMat = new THREE.MeshStandardMaterial({ color: 0x4a1420, roughness: 0.55, flatShading: true });
  const brisMat = new THREE.MeshStandardMaterial({ color: 0x120f16, roughness: 0.6, flatShading: true });
  const fangMat = new THREE.MeshStandardMaterial({ color: 0x6a1620, roughness: 0.5, flatShading: true });
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0xff3030, emissive: 0xff1a1a, emissiveIntensity: 1.8, roughness: 0.3, flatShading: true });
  const ico = (r, d = 1) => new THREE.IcosahedronGeometry(r, d);
  const cone = (r, h, s = 6) => new THREE.ConeGeometry(r, h, s);
  const cyl = (r, h, s = 7) => new THREE.CylinderGeometry(r * 0.72, r, h, s);
  const UP = new THREE.Vector3(0, 1, 0);
  const add = (geo, mat, x, y, z, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.rotation.set(rx, ry, rz); group.add(m); return m; };
  const limb = (a, b, r, mat) => { const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], len = Math.hypot(dx, dy, dz); const m = new THREE.Mesh(cyl(r, len, 7), mat || legMat); m.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2); m.quaternion.setFromUnitVectors(UP, new THREE.Vector3(dx, dy, dz).normalize()); group.add(m); return m; };
  const spike = (px, py, pz, dx, dy, dz, len, r, mat) => { const m = new THREE.Mesh(cone(r, len, 5), mat || brisMat); m.position.set(px, py, pz); m.quaternion.setFromUnitVectors(UP, new THREE.Vector3(dx, dy, dz).normalize()); group.add(m); return m; };
  const bw = between(1.05, 1.25), bh = between(0.85, 1.0);
  // abdomen (bulbous, raised rear) with bristles
  const body = add(ico(1.0, 1), bodyMat, 0, 0.5, -1.05, bw * 1.1, 1.0, bw * 1.25);
  for (let i = 0; i < 9; i += 1) { const a = between(-1, 1); spike(Math.sin(a) * 0.5, 0.95 + between(-0.1, 0.35), -1.05 + Math.cos(a) * 0.5, Math.sin(a) * 0.5, 1, Math.cos(a) * 0.4 - 0.4, between(0.16, 0.3), 0.04); }
  // cephalothorax (front body)
  add(ico(0.68, 1), bodyMat, 0, 0.28, 0.2, 1.05, 0.8, 1.05);
  // face + red eye cluster + fangs
  add(ico(0.42, 1), faceMat, 0, 0.14, 0.68, 1.0, 0.85, 0.9);
  for (const [ex, ey] of [[0.12, 0.28], [-0.12, 0.28], [0.27, 0.2], [-0.27, 0.2], [0.1, 0.1], [-0.1, 0.1], [0.24, 0.04], [-0.24, 0.04]]) add(ico(0.07, 0), eyeMat, ex, 0.05 + ey * 0.5, 0.98);
  add(cone(0.11, 0.5, 6), fangMat, 0.14, -0.12, 0.92, 1, 1, 1, 2.7, 0, 0.12);
  add(cone(0.11, 0.5, 6), fangMat, -0.14, -0.12, 0.92, 1, 1, 1, 2.7, 0, -0.12);
  limb([0.2, 0.05, 0.8], [0.4, -0.5, 1.02], 0.06, legMat); limb([-0.2, 0.05, 0.8], [-0.4, -0.5, 1.02], 0.06, legMat); // pedipalps
  // 8 spiky jointed legs, knees raised above the body
  for (const sdir of [1, -1]) for (let i = 0; i < 4; i += 1) {
    const lz = 0.55 - i * 0.5;
    const hip = [sdir * bw * 0.5, 0.28, lz], knee = [sdir * (bw * 1.05 + 0.35), 0.98, lz * 1.05], foot = [sdir * (bw * 1.55 + 0.55), -1.0, lz * 1.2];
    limb(hip, knee, 0.1, legMat); limb(knee, foot, 0.065, legMat);
    for (let j = 1; j <= 3; j += 1) { const t = j / 4, fx = knee[0] + (foot[0] - knee[0]) * t, fy = knee[1] + (foot[1] - knee[1]) * t, fz = knee[2] + (foot[2] - knee[2]) * t; spike(fx, fy, fz, sdir * 0.6, 0.2, 0.2, 0.18, 0.03); }
    spike(foot[0], foot[1], foot[2], 0, -1, 0.2, 0.22, 0.05, brisMat);
    spike(knee[0], knee[1], knee[2], sdir * 0.4, 0.9, 0, 0.26, 0.06);
  }
  for(let i=0;i<7;i++){const a=between(0,6.283),rr=between(0.3,0.8);add(ico(between(0.08,0.16),0),faceMat,Math.sin(a)*rr,0.55+between(0,0.5),-1.05+Math.cos(a)*rr,1,0.6,1);}
  for(let i=0;i<14;i++){const a=between(0,6.283);spike(Math.sin(a)*0.55,0.9+between(-0.2,0.4),-1.05+Math.cos(a)*0.55,Math.sin(a),between(0.6,1),Math.cos(a),between(0.14,0.28),0.03,brisMat);}
  for(let i=0;i<8;i++){const a=between(0,6.283),rr=between(0.4,0.9);spike(Math.sin(a)*rr,0.2,0.2+Math.cos(a)*rr,Math.sin(a)*0.6,0.7,Math.cos(a)*0.6,between(0.12,0.22),0.025,brisMat);}
    return { group, body, glowMat: eyeMat, bw, bh, bodyBase: [bw * 1.1, 1.0, bw * 1.25] };
}

// WYRM — a rearing serpent: coiled base, S-curved segmented body, horned head.
function buildWyrm(seedStr) {
  const rand = rng(hashStr((seedStr || 'boss') + ':w'));
  const pick = (a) => a[Math.floor(rand() * a.length)];
  const between = (a, b) => a + rand() * (b - a);
  const pal = pick(PALETTES);
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: pal.body, roughness: 0.55, metalness: 0.15, flatShading: true });
  const bellyMat = new THREE.MeshStandardMaterial({ color: pal.horn, roughness: 0.5, flatShading: true });
  const hornMat = new THREE.MeshStandardMaterial({ color: pal.horn, roughness: 0.45, flatShading: true });
  const glowMat = new THREE.MeshStandardMaterial({ color: pal.accent, emissive: pal.accent, emissiveIntensity: 2.6, roughness: 0.3, flatShading: true });
  const ico = (r, d = 1) => new THREE.IcosahedronGeometry(r, d);
  const cone = (r, h, s = 6) => new THREE.ConeGeometry(r, h, s);
  const cyl = (r, h, s = 8) => new THREE.CylinderGeometry(r * 0.7, r, h, s);
  const UP = new THREE.Vector3(0, 1, 0);
  const add = (geo, mat, x, y, z, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.rotation.set(rx, ry, rz); group.add(m); return m; };
  const spikeAt = (px, py, pz, dx, dy, dz, len, r, mat) => { const m = new THREE.Mesh(cone(r, len, 6), mat || hornMat); m.position.set(px, py, pz); m.quaternion.setFromUnitVectors(UP, new THREE.Vector3(dx, dy, dz).normalize()); group.add(m); };
  const bw = between(1.0, 1.25);
  const body = add(ico(1.0, 1), bodyMat, 0, -1.15, 0, bw * 1.3, 0.55, bw * 1.3);
  add(ico(0.78, 1), bodyMat, bw * 0.6, -1.05, 0.35, 1, 0.6, 1);
  add(ico(0.66, 1), bodyMat, -bw * 0.55, -1.0, 0.45, 1, 0.6, 1);
  let hx = 0, hy = 0, hz = 0;
  const segs = 7;
  for (let i = 0; i < segs; i += 1) {
    const t = i / (segs - 1), y = -0.55 + t * 2.5, x = Math.sin(t * 3.4) * 0.42 * (1 - t * 0.2), z = Math.cos(t * 2.2) * 0.16, r = 0.6 * (1 - t * 0.44);
    add(ico(r, 1), bodyMat, x, y, z);
    add(ico(r * 0.72, 1), bellyMat, x, y, z + r * 0.62, 1, 1, 0.45);
    if (i > 1) spikeAt(x, y + r * 0.55, z - r * 0.4, 0, 0.55, -0.85, 0.3 * (1 - t * 0.4), 0.06);
    hx = x; hy = y; hz = z;
  }
  const HY = hy + 0.36, HZ = hz + 0.12;
  add(ico(0.42, 1), bodyMat, hx, HY, HZ, 1.0, 0.85, 1.35);
  add(ico(0.3, 1), bodyMat, hx, HY - 0.12, HZ + 0.42, 1.0, 0.7, 1.3);
  add(ico(0.24, 1), bodyMat, hx, HY - 0.27, HZ + 0.32, 1.1, 0.5, 1.0);
  add(ico(0.14, 1), glowMat, hx, HY - 0.14, HZ + 0.2, 1.4, 0.6, 0.6);
  add(ico(0.09, 1), glowMat, hx + 0.17, HY + 0.05, HZ + 0.32, 1, 0.6, 1, 0, 0, -0.3);
  add(ico(0.09, 1), glowMat, hx - 0.17, HY + 0.05, HZ + 0.32, 1, 0.6, 1, 0, 0, 0.3);
  add(cone(0.05, 0.22, 5), hornMat, hx + 0.1, HY - 0.22, HZ + 0.48, 1, 1, 1, Math.PI, 0, 0);
  add(cone(0.05, 0.22, 5), hornMat, hx - 0.1, HY - 0.22, HZ + 0.48, 1, 1, 1, Math.PI, 0, 0);
  add(cone(0.11, 0.75, 6), hornMat, hx + 0.2, HY + 0.24, HZ - 0.16, 1, 1, 1, -1.05, 0, 0.3);
  add(cone(0.11, 0.75, 6), hornMat, hx - 0.2, HY + 0.24, HZ - 0.16, 1, 1, 1, -1.05, 0, -0.3);
  const nf = 7; for (let i = 0; i < nf; i += 1) { const a = (i / (nf - 1) - 0.5) * 2.4; spikeAt(hx + Math.sin(a) * 0.42, HY + 0.06, HZ - 0.34, Math.sin(a) * 0.7, 0.35, -0.85, 0.42, 0.05); }
  add(cyl(0.14, 0.55), bodyMat, hx + 0.52, 0.35, 0.25, 1, 1, 1, 0.4, 0, -0.7);
  add(cyl(0.14, 0.55), bodyMat, hx - 0.52, 0.35, 0.25, 1, 1, 1, 0.4, 0, 0.7);
  return { group, body, glowMat, bw, bh: 1.2, bodyBase: [bw * 1.3, 0.55, bw * 1.3] };
}

// CRYSTAL GOLEM — blocky, angular, glowing crystal shards + core.
function buildGolem(seedStr) {
  const rand = rng(hashStr((seedStr || 'boss') + ':g'));
  const pick = (a) => a[Math.floor(rand() * a.length)];
  const between = (a, b) => a + rand() * (b - a);
  const pal = pick(PALETTES);
  const group = new THREE.Group();
  const rockMat = new THREE.MeshStandardMaterial({ color: pal.body, roughness: 0.88, metalness: 0.05, flatShading: true });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x0e0e14, roughness: 0.7, flatShading: true });
  const glowMat = new THREE.MeshStandardMaterial({ color: pal.accent, emissive: pal.accent, emissiveIntensity: 2.8, roughness: 0.3, flatShading: true });
  const ico = (r, d = 0) => new THREE.IcosahedronGeometry(r, d);
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const cone = (r, h, s = 5) => new THREE.ConeGeometry(r, h, s);
  const UP = new THREE.Vector3(0, 1, 0);
  const add = (geo, mat, x, y, z, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.rotation.set(rx, ry, rz); group.add(m); return m; };
  const shard = (px, py, pz, dx, dy, dz, len, r) => { const m = new THREE.Mesh(cone(r, len, 5), glowMat); m.position.set(px, py, pz); m.quaternion.setFromUnitVectors(UP, new THREE.Vector3(dx, dy, dz).normalize()); group.add(m); };
  const bw = between(1.1, 1.35), bh = between(1.0, 1.2);
  const body = add(box(bw * 1.6, bh * 1.4, 1.0), rockMat, 0, 0.1, 0, 1, 1, 1, 0, 0, between(-0.05, 0.05));
  add(ico(1.0, 0), rockMat, 0, -0.15, 0.05, bw * 0.9, bh * 0.8, 0.9);
  add(ico(0.66, 0), rockMat, bw * 1.0, bh * 0.78, 0, 1, 1, 1, 0.3, 0.5, 0);
  add(ico(0.66, 0), rockMat, -bw * 1.0, bh * 0.78, 0, 1, 1, 1, 0.3, -0.5, 0);
  const hy = bh * 1.16;
  add(box(0.85, 0.6, 0.72), rockMat, 0, hy, 0.2, 1, 1, 1, 0.05, 0, 0);
  add(box(0.9, 0.2, 0.55), darkMat, 0, hy, 0.46, 1, 1, 1, 0.1, 0, 0);
  add(ico(0.13, 0), glowMat, 0.22, hy, 0.52, 1, 0.5, 0.6); add(ico(0.13, 0), glowMat, -0.22, hy, 0.52, 1, 0.5, 0.6);
  add(box(0.7, 0.2, 0.5), rockMat, 0, hy - 0.32, 0.36, 1, 1, 1, -0.1, 0, 0);
  add(ico(0.34, 0), glowMat, 0, bh * 0.28, 0.56);
  const ns = 5 + Math.floor(rand() * 4);
  for (let i = 0; i < ns; i += 1) { const a = between(-1.2, 1.2), up = between(0.4, 1.2); shard(Math.sin(a) * bw * 0.8, bh * (0.3 + up * 0.5), -0.42 - Math.abs(Math.sin(a)) * 0.2, Math.sin(a) * 0.6, up, -Math.cos(a) * 0.5 - 0.4, between(0.45, 0.95), between(0.1, 0.17)); }
  add(cone(0.2, 0.8, 5), glowMat, bw * 1.0, bh * 1.15, -0.1, 1, 1, 1, -0.2, 0, 0.4); add(cone(0.2, 0.8, 5), glowMat, -bw * 1.0, bh * 1.15, -0.1, 1, 1, 1, -0.2, 0, -0.4);
  for (const side of [1, -1]) {
    add(box(0.5, 1.15, 0.5), rockMat, side * bw * 1.18, bh * 0.1, 0.05, 1, 1, 1, 0, 0, side * -0.1);
    add(ico(0.52, 0), rockMat, side * bw * 1.28, bh * -0.62, 0.15);
    for (const o of [-0.18, 0.18]) add(cone(0.09, 0.32, 5), glowMat, side * bw * 1.28 + o, bh * -0.92, 0.35, 1, 1, 1, 0.2, 0, 0);
  }
  add(box(0.55, 0.85, 0.62), rockMat, 0.5, -bh * 0.98, 0.05); add(box(0.55, 0.85, 0.62), rockMat, -0.5, -bh * 0.98, 0.05);
  add(box(0.06, 0.42, 0.06), glowMat, 0.2, bh * 0.0, 0.53, 1, 1, 1, 0, 0, 0.3); add(box(0.06, 0.3, 0.06), glowMat, -0.16, bh * -0.32, 0.5, 1, 1, 1, 0, 0, -0.3);
  return { group, body, glowMat, bw, bh, bodyBase: [1, 1, 1] };
}

// Brute = a fat OGRE: huge belly, hunched back, roaring fanged maw, arm wraps,
// a spiked wooden club in one fist, loincloth, dark claws.
function buildBrute(seedStr){
  const rand=rng(hashStr(seedStr||'boss'));
  const between=(a,b)=>a+rand()*(b-a);
  const group=new THREE.Group();
  const skin=new THREE.MeshStandardMaterial({color:0x9c7647,roughness:0.82,metalness:0.02,flatShading:true});
  const skinDk=new THREE.MeshStandardMaterial({color:0x6e5230,roughness:0.85,flatShading:true});
  const cloth=new THREE.MeshStandardMaterial({color:0xd8ccb2,roughness:0.95,flatShading:true});
  const claw=new THREE.MeshStandardMaterial({color:0x2a2622,roughness:0.5,flatShading:true});
  const wood=new THREE.MeshStandardMaterial({color:0x6e4a28,roughness:0.9,flatShading:true});
  const metal=new THREE.MeshStandardMaterial({color:0x9aa0aa,roughness:0.4,metalness:0.7,flatShading:true});
  const maw=new THREE.MeshStandardMaterial({color:0x5a1418,roughness:0.6,flatShading:true});
  const tooth=new THREE.MeshStandardMaterial({color:0xe8e0cc,roughness:0.5,flatShading:true});
  const eyeMat=new THREE.MeshStandardMaterial({color:0xffd060,emissive:0xffb020,emissiveIntensity:1.3,roughness:0.4,flatShading:true});
  const ico=(r,d=1)=>new THREE.IcosahedronGeometry(r,d);
  const cone=(r,h,s=6)=>new THREE.ConeGeometry(r,h,s);
  const cyl=(r,h,s=8)=>new THREE.CylinderGeometry(r*0.8,r,h,s);
  const box=(w,h,d)=>new THREE.BoxGeometry(w,h,d);
  const UP=new THREE.Vector3(0,1,0);
  const add=(geo,mat,x,y,z,sx=1,sy=1,sz=1,rx=0,ry=0,rz=0)=>{const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);m.scale.set(sx,sy,sz);m.rotation.set(rx,ry,rz);group.add(m);return m;};
  const limb=(a,b,r,mat)=>{const dx=b[0]-a[0],dy=b[1]-a[1],dz=b[2]-a[2],len=Math.hypot(dx,dy,dz);const m=new THREE.Mesh(cyl(r,len,8),mat||skin);m.position.set((a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2);m.quaternion.setFromUnitVectors(UP,new THREE.Vector3(dx,dy,dz).normalize());group.add(m);return m;};
  const bw=between(1.2,1.4),bh=between(1.15,1.35);
  const body=add(ico(1.0,1),skin,0,-0.18,0.5,bw*1.05,bh*0.72,0.98);               // low pot belly, forward (breathe target)
  add(ico(0.95,1),skin,0,bh*0.62,-0.05,bw*1.15,bh*0.6,0.9);                        // hunched upper back/chest
  add(ico(0.62,1),skin,bw*0.98,bh*0.72,0.05);add(ico(0.62,1),skin,-bw*0.98,bh*0.72,0.05); // shoulders
  const hy=bh*0.8,hz=1.05;                                                         // head juts FORWARD + above the belly
  add(ico(0.52,1),skin,0.08,hy,hz,1.05,0.95,1.0);                                  // skull
  add(ico(0.36,1),skin,0.08,hy-0.18,hz+0.3,1.1,0.7,1.1);                           // snout
  add(box(0.5,0.12,0.3),skinDk,0.08,hy+0.12,hz+0.24,1,1,1,-0.2,0,0);               // brow
  add(ico(0.1,0),eyeMat,0.24,hy+0.05,hz+0.36,1,0.7,1);add(ico(0.1,0),eyeMat,-0.08,hy+0.05,hz+0.36,1,0.7,1);
  add(cone(0.14,0.3,6),skin,0.42,hy+0.2,hz-0.1,1,1,1,0,0,-0.9);add(cone(0.14,0.3,6),skin,-0.26,hy+0.2,hz-0.1,1,1,1,0,0,0.9); // ears
  add(ico(0.4,1),skin,0.08,hy-0.42,hz+0.2,1.1,0.6,1.0);                            // lower jaw
  add(ico(0.24,1),maw,0.08,hy-0.28,hz+0.28,1.3,0.7,0.7);                           // mouth
  for(let i=-2;i<=2;i++){add(cone(0.05,0.16,5),tooth,0.08+i*0.11,hy-0.14,hz+0.44,1,1,1,Math.PI,0,0);add(cone(0.05,0.16,5),tooth,0.08+i*0.11,hy-0.4,hz+0.42);}
  add(cone(0.09,0.42,6),tooth,0.26,hy-0.34,hz+0.4,1,1,1,-0.2,0,0);add(cone(0.09,0.42,6),tooth,-0.1,hy-0.34,hz+0.4,1,1,1,-0.2,0,0); // tusks
  for(const d of[1,-1]){const lx=d*0.55;limb([lx,-bh*0.05,0.15],[lx,-bh*0.95,0.25],0.3,skin);add(ico(0.34,1),skin,lx,-bh*1.0,0.42,1.2,0.7,1.3);add(cyl(0.32,0.24),cloth,lx,-bh*0.55,0.2);for(const o of[-0.12,0,0.12])add(cone(0.05,0.14,5),claw,lx+o,-bh*1.02,0.64,1,1,1,Math.PI,0,0);}
  add(box(bw*1.3,0.6,0.9),cloth,0,-bh*0.35,0.2,1,1,1,0.1,0,0);                     // loincloth
  { const sx=-bw*1.05;limb([sx,bh*0.85,0.05],[sx*1.05,bh*0.1,0.2],0.24,skin);add(cyl(0.15,0.22),cloth,sx*1.03,bh*0.55,0.12);
    const hx=sx*1.02,hyy=-bh*0.22,hzz=0.35;add(ico(0.32,1),skin,hx,hyy,hzz);
    add(cyl(0.13,1.5),wood,hx-0.1,hyy-0.55,hzz+0.1,1,1,1,0.12,0,0.1);add(ico(0.28,0),wood,hx-0.16,hyy-1.28,hzz+0.16);
    for(let i=0;i<6;i++){const a=i/6*6.283;add(cone(0.05,0.22,5),metal,hx-0.16+Math.cos(a)*0.26,hyy-1.28+Math.sin(a)*0.26,hzz+0.16,1,1,1,Math.cos(a)*1.4,0,Math.sin(a)*1.4);}
  }
  { const sx=bw*1.05;limb([sx,bh*0.85,0.05],[sx*1.02,-bh*0.02,0.38],0.25,skin);add(cyl(0.16,0.22),cloth,sx*1.0,bh*0.5,0.18);
    const hx=sx*0.98,hyy=-bh*0.4,hzz=0.58;add(ico(0.36,1),skin,hx,hyy,hzz);
    for(const o of[-0.15,0,0.15])add(cone(0.06,0.26,6),claw,hx+o,hyy-0.3,hzz+0.12,1,1,1,2.9,0,0);
  }
  for(const yy of[-0.4,-0.02])add(box(0.85,0.06,0.1),skinDk,0,yy,0.98,1,1,1,0.12,0,0);
  add(ico(0.08,0),skinDk,0,-0.2,1.0);
  for(let i=0;i<8;i++){const a=between(0,6.283),rr=between(0.5,1.0);add(ico(between(0.06,0.12),0),skinDk,Math.cos(a)*rr,between(-0.4,0.9),0.55+Math.sin(a)*0.4);}
  add(ico(0.13,0),skinDk,0.08,hy-0.02,hz+0.52,1,0.7,0.8);
    return {group,body,glowMat:eyeMat,bw,bh,bodyBase:[bw*1.05,bh*0.72,0.98]};
}

// Mount a boss into a <canvas>. Returns { flinch, counter, enrage, stun, defeat, dispose }.
export function mountBoss(canvas, seedStr, tier) {
  // Hybrid: if this archetype has a pre-rendered clip set, play the video boss
  // (with the attack-FX overlay). Otherwise fall through to the live WebGL boss.
  const clip = clipSetFor(archetypeOf(seedStr));
  if (clip) { try { return mountVideoBoss(canvas, clip, tier); } catch (e) { /* fall back to WebGL */ } }
  // On mobile the webview has a tight GPU/memory budget shared with the card images.
  // Render the boss at 1x and skip the bloom pipeline there so the cards keep enough
  // budget to paint. Desktop keeps full quality.
  const isMobile = !!(window.matchMedia && window.matchMedia('(max-width: 620px)').matches);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isMobile, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(isMobile ? 1 : Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;   // filmic highlights (early-2000s+)
  renderer.toneMappingExposure = 1.2;
  // Desktop: soft shadow maps so the boss casts a real contact shadow (grounds it, adds depth).
  if (!isMobile) { renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; }
  const scene = new THREE.Scene();
  // Soft studio environment so every surface picks up subtle reflections/depth.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
  scene.environment = envRT.texture;
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  camera.position.set(0, 0.5, 7.8);
  camera.lookAt(0, 0.3, 0);
  scene.add(new THREE.HemisphereLight(0x6a7ba0, 0x241a26, 0.7));
  const rim = new THREE.DirectionalLight(0xbcd6ff, 3.2); rim.position.set(-3.5, 4.5, -2); scene.add(rim);
  const rim2 = new THREE.DirectionalLight(0xff7a52, 2.2); rim2.position.set(3.5, 3, -2.5); scene.add(rim2);
  const key = new THREE.DirectionalLight(0xfff0dc, 2.4); key.position.set(4, 6.5, 5); scene.add(key);
  if (!isMobile) {
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    const sc = key.shadow.camera; sc.near = 1; sc.far = 24; sc.left = -4.5; sc.right = 4.5; sc.top = 5; sc.bottom = -4.5; sc.updateProjectionMatrix();
    key.shadow.bias = -0.0006; key.shadow.radius = 4;
    // Contact-shadow catcher: invisible except where the boss shadow lands, so the bg stays transparent.
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(24, 24), new THREE.ShadowMaterial({ opacity: 0.42 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -1.7; ground.receiveShadow = true; scene.add(ground);
  }
  const under = new THREE.PointLight(0xff5030, 1.2, 14); under.position.set(0, -1.2, 2.5); scene.add(under);
  // Arena backdrop (dark radial fading to transparent) so the bloom halo reads and it blends into the boss card.
  const arenaTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'); const rg = g.createRadialGradient(128, 128, 8, 128, 128, 128); rg.addColorStop(0, 'rgba(34,26,44,0.95)'); rg.addColorStop(0.55, 'rgba(20,15,26,0.82)'); rg.addColorStop(1, 'rgba(10,8,14,0)'); g.fillStyle = rg; g.fillRect(0, 0, 256, 256); return new THREE.CanvasTexture(c); })();
  const arena = new THREE.Mesh(new THREE.PlaneGeometry(22, 22), new THREE.MeshBasicMaterial({ map: arenaTex, transparent: true, depthWrite: false }));
  arena.position.set(0, 0.5, -4); scene.add(arena);
  // Bloom pipeline (glow bleed on the emissive eyes / cores / cracks). Desktop only —
  // on mobile we render straight through to save GPU/memory for the card images.
  const composer = isMobile ? null : new EffectComposer(renderer);
  if (composer) {
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 0.34, 0.5, 0.92)); // softer bloom so models don't wash out
    composer.addPass(new OutputPass());
  }

  const built = buildMonster(seedStr);
  scene.add(built.group);
  built.group.traverse((o) => { if (o.isMesh && !isMobile) { o.castShadow = true; o.receiveShadow = true; } if (o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach((m) => { if (m.isMeshStandardMaterial) m.envMapIntensity = 1.4; }); } });
  // Difficulty tier makes the boss bigger and glow harder.
  const TS = { Heroic: 1.12, Mythic: 1.26 }[tier] || 1.0;
  const baseEmis = 2.15 * ({ Heroic: 1.3, Mythic: 1.8 }[tier] || 1.0);
  built.group.scale.setScalar(TS);

  // Per-element attack FX live in this group, scaled/offset so the lab's coordinate
  // space (boss ~ y1.4) maps onto the real boss (~ y0.4). See attack-fx.js.
  const fxRoot = new THREE.Group(); fxRoot.scale.setScalar(0.62); fxRoot.position.set(0, -0.47, 0); scene.add(fxRoot);
  const fx = createAttackFX(fxRoot, camera);

  let running = true, raf = 0;
  const t0 = performance.now();
  let lastNow = t0;
  let flinchAt = -1e9, defeatAt = -1e9, counterAt = -1e9, enrageAt = -1e9, stunAt = -1e9;

  function size() {
    const w = canvas.clientWidth || 300, h = canvas.clientHeight || 220;
    renderer.setSize(w, h, false);
    if (composer) composer.setSize(w, h);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  size();
  let ro = null;
  try { ro = new ResizeObserver(size); ro.observe(canvas); } catch (e) { /* older webviews */ }

  function frame() {
    if (!running) return;
    const now = performance.now(), t = (now - t0) / 1000, g = built.group;
    g.rotation.set(0, Math.sin(t * 0.5) * 0.16, 0);
    g.position.set(0, Math.sin(t * 1.3) * 0.06, 0);
    const s = 1 + Math.sin(t * 1.7) * 0.02, bb = built.bodyBase;
    built.body.scale.set(bb[0] * s, bb[1] * s, bb[2] * s);
    const fe = (now - flinchAt) / 450, ce = (now - counterAt) / 520, ee = (now - enrageAt) / 950, se = (now - stunAt) / 850;
    let emis = baseEmis;
    if (ce >= 0 && ce <= 1) { const env = Math.sin(ce * Math.PI); g.position.z = 0.85 * env; g.rotation.x = 0.13 * env; emis += 5.5 * env; }        // lunge forward (counterattack)
    else if (fe >= 0 && fe <= 1) { const env = Math.sin(fe * Math.PI); g.rotation.x = -0.14 * env; g.position.z = -0.45 * env; emis += 4.0 * env; } // recoil (took a hit)
    // Enrage: a roar — the boss punches up in size, shakes its head, and its cores flare hot.
    if (ee >= 0 && ee <= 1) { const env = Math.sin(ee * Math.PI); g.scale.setScalar(TS * (1 + 0.15 * env)); g.rotation.y += Math.sin(ee * 42) * 0.06 * env; emis += 7.5 * env; }
    else g.scale.setScalar(TS);
    // Stun: the boss staggers — a dazed side-to-side wobble and its glow gutters out.
    if (se >= 0 && se <= 1) { const env = Math.sin(se * Math.PI); g.rotation.z = Math.sin(se * 24) * 0.13 * env; emis *= (1 - 0.6 * env); }
    built.glowMat.emissiveIntensity = emis;
    if (defeatAt > 0) { const k = Math.min((now - defeatAt) / 1100, 1); g.rotation.x = 1.1 * k; g.position.y = Math.sin(t * 1.3) * 0.06 - 1.4 * k * k; built.glowMat.emissiveIntensity = baseEmis * (1 - k); }
    const dt = Math.min(0.05, (now - lastNow) / 1000); lastNow = now;
    fx.update(dt, t);
    if (composer) composer.render(); else renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  return {
    attack(element) { try { fx.fire(element || 'physical'); } catch (e) { /* ignore */ } },
    bossAct(kind) { try { fx.bossFire(kind); } catch (e) { /* ignore */ } },
    flinch() { flinchAt = performance.now(); },
    counter() { counterAt = performance.now(); },
    enrage() { enrageAt = performance.now(); },
    stun() { stunAt = performance.now(); },
    defeat() { defeatAt = performance.now(); },
    dispose() {
      running = false; cancelAnimationFrame(raf);
      try { if (ro) ro.disconnect(); } catch (e) { /* ignore */ }
      scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) { (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose()); } });
      try { envRT.dispose(); pmrem.dispose(); arenaTex.dispose(); if (composer) composer.dispose(); } catch (e) { /* ignore */ }
      renderer.dispose();
    },
  };
}
