// Procedural, seeded WebGL raid-boss for the Pride Hunt battle screen. Each weekly
// boss name deterministically builds a unique low-poly monster (WoW-ish, flat
// shaded), rendered live with a menacing idle, a hit-flinch, and a defeat slump.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

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
function buildMonster(seedStr) {
  const r0 = rng(hashStr('arch:' + (seedStr || 'boss')));
  const names = Object.keys(ARCH_BUILDERS);
  let arch = names[Math.floor(r0() * names.length)];
  const mo = (seedStr || '').match(/^arch:(\w+)/); if (mo) arch = mo[1];
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
  const glowMat = new THREE.MeshStandardMaterial({ color: pal.accent, emissive: pal.accent, emissiveIntensity: 2.7, roughness: 0.3, flatShading: true });
  const plateMat = new THREE.MeshStandardMaterial({ color: 0x14141c, roughness: 0.45, metalness: 0.5, flatShading: true });
  const ico = (r, d = 1) => new THREE.IcosahedronGeometry(r, d >= 1 ? d + 1 : d), cone = (r, h, s = 6) => new THREE.ConeGeometry(r, h, Math.max(s, 9)), cyl = (r, h, s = 8) => new THREE.CylinderGeometry(r * 0.72, r, h, Math.max(s, 11)), box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const UP = new THREE.Vector3(0, 1, 0);
  const add = (geo, mat, x, y, z, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.rotation.set(rx, ry, rz); group.add(m); return m; };
  const spikeAt = (px, py, pz, dx, dy, dz, len, r, mat) => { const m = new THREE.Mesh(cone(r, len, 6), mat || hornMat); m.position.set(px, py, pz); m.quaternion.setFromUnitVectors(UP, new THREE.Vector3(dx, dy, dz).normalize()); group.add(m); return m; };
  const limb = (a, b, r, mat) => { const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], len = Math.hypot(dx, dy, dz); const m = new THREE.Mesh(cyl(r, len, 7), mat || bodyMat); m.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2); m.quaternion.setFromUnitVectors(UP, new THREE.Vector3(dx, dy, dz).normalize()); group.add(m); return m; };
  return { group, rand, pick, between, pal, bodyMat, hornMat, clawMat, glowMat, plateMat, ico, cone, cyl, box, add, spikeAt, limb, UP };
}

function buildColossus(s){const k=baseKit(s,':col');const{group,between,box,ico,add,glowMat,bodyMat,plateMat}=k;
  const bw=between(1.0,1.25),bh=between(1.3,1.6);
  const body=add(box(bw*1.5,bh*1.3,0.95),bodyMat,0,bh*0.3,0);
  add(box(bw*1.9,0.5,1.05),plateMat,0,bh*0.82,0);
  add(box(0.62,0.6,0.62),bodyMat,0,bh*1.15,0.12);
  add(ico(0.1,0),glowMat,0.16,bh*1.18,0.34);add(ico(0.1,0),glowMat,-0.16,bh*1.18,0.34);
  add(ico(0.32,0),glowMat,0,bh*0.42,0.52);
  for(const d of[1,-1]){add(box(0.55,bh*1.1,0.62),bodyMat,d*bw*1.0,bh*0.15,0);add(box(0.66,0.62,0.72),bodyMat,d*bw*1.05,-bh*0.45,0.1);add(box(0.62,bh*0.9,0.72),bodyMat,d*0.45,-bh*0.72,0);}
  return{group,body,glowMat,bw,bh,bodyBase:[1,1,1]};}

function buildHydra(s){const k=baseKit(s,':hyd');const{group,between,ico,cone,add,glowMat,bodyMat,hornMat}=k;
  const bw=between(1.1,1.4),bh=between(0.9,1.1);
  const body=add(ico(1.1,1),bodyMat,0,-0.2,0,bw*1.1,bh,1.1);
  for(let n=0;n<3;n++){const ang=(n-1)*0.6;let nx=Math.sin(ang)*0.5,ny=0.4,nz=0.2;
    for(let i=0;i<4;i++){add(ico(0.3-i*0.03,1),bodyMat,nx,ny,nz);nx+=Math.sin(ang)*0.18;ny+=0.42;nz+=Math.cos(ang)*0.05;}
    add(ico(0.34,1),bodyMat,nx,ny,nz+0.1,1,0.85,1.3);
    add(ico(0.08,1),glowMat,nx+0.12,ny+0.02,nz+0.3,1,0.6,1);add(ico(0.08,1),glowMat,nx-0.12,ny+0.02,nz+0.3,1,0.6,1);
    add(cone(0.05,0.18,5),hornMat,nx+0.08,ny-0.14,nz+0.36,1,1,1,Math.PI,0,0);add(cone(0.05,0.18,5),hornMat,nx-0.08,ny-0.14,nz+0.36,1,1,1,Math.PI,0,0);
    add(cone(0.08,0.4,6),hornMat,nx,ny+0.22,nz-0.15,1,1,1,-1.0,0,0);}
  add(ico(0.9,1),bodyMat,0,-1.0,0,bw*1.2,0.5,bw*1.2);
  return{group,body,glowMat,bw,bh,bodyBase:[bw*1.1,bh,1.1]};}

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

function buildElemental(s){const k=baseKit(s,':elem');const{group,rand,between,ico,add,glowMat,bodyMat}=k;
  const body=add(ico(0.7,1),glowMat,0,0.3,0);
  const n=10+Math.floor(rand()*6);
  for(let i=0;i<n;i++){const a=rand()*6.28,e=between(-0.9,1.2),rr=between(0.9,1.6);
    add(ico(between(0.15,0.35),0),bodyMat,Math.cos(a)*rr,0.3+Math.sin(e)*1.2,Math.sin(a)*rr*0.6,1,between(0.6,1.4),1,rand()*3,rand()*3,rand()*3);}
  for(let i=0;i<6;i++)add(ico(0.08,0),glowMat,between(-1,1),between(-0.5,1.6),between(-0.6,0.6));
  return{group,body,glowMat,bw:1,bh:1.2,bodyBase:[1,1,1]};}

function buildBehemoth(s){const k=baseKit(s,':beh');const{group,between,ico,cone,add,glowMat,bodyMat,hornMat,clawMat,limb}=k;
  const bw=between(1.3,1.6),bh=between(0.9,1.1);
  const body=add(ico(1.2,1),bodyMat,0,0.2,-0.2,bw*1.2,bh,1.5);
  add(ico(0.7,1),bodyMat,0,0.0,0.9,bw*0.7,bh*0.8,0.8);
  const hy=-0.1,hz=1.5;
  add(ico(0.5,1),bodyMat,0,hy,hz,1,0.9,1.1);
  add(ico(0.09,1),glowMat,0.2,hy+0.1,hz+0.2,1,0.6,1);add(ico(0.09,1),glowMat,-0.2,hy+0.1,hz+0.2,1,0.6,1);
  add(cone(0.12,0.6,6),hornMat,0.3,hy+0.1,hz+0.1,1,1,1,0.2,0,1.2);add(cone(0.12,0.6,6),hornMat,-0.3,hy+0.1,hz+0.1,1,1,1,0.2,0,-1.2);
  for(const sx of[1,-1])for(const sz of[1,-1]){const px=sx*bw*0.8,pz=sz*0.9;limb([px,0.0,pz],[px,-bh*1.0,pz],0.16);add(cone(0.12,0.2,5),clawMat,px,-bh*1.15,pz,1,1,1,Math.PI,0,0);}
  for(let i=0;i<4;i++)add(cone(0.14,0.4,6),hornMat,0,0.6,-1.0+i*0.5,1,1,1,0.3,0,0);
  return{group,body,glowMat,bw,bh,bodyBase:[bw*1.2,bh,1.5]};}

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

function buildCyclops(s){const k=baseKit(s,':cyc');const{group,between,ico,cone,cyl,add,glowMat,bodyMat,hornMat,clawMat}=k;
  const bw=between(1.1,1.35),bh=between(1.1,1.3);
  const body=add(ico(1.0,1),bodyMat,0,0.1,0,bw,bh,0.95);
  add(ico(0.6,1),bodyMat,0,bh*0.95,0.15,1,0.95,1);
  add(ico(0.24,1),glowMat,0,bh*0.98,0.5,1,1,0.6);
  add(cone(0.1,0.5,5),hornMat,0,bh*1.4,0.0,1,1,1,-0.1,0,0);
  for(const d of[1,-1]){add(cyl(0.22,1.0),bodyMat,d*bw*0.85,bh*0.2,0.05,1,1,1,0.2,0,d*-0.3);add(ico(0.26,1),bodyMat,d*bw*0.95,-bh*0.4,0.15);for(const o of[-0.12,0.12])add(cone(0.06,0.3,5),clawMat,d*bw*0.95+o,-bh*0.6,0.35,1,1,1,1.2,0,0);}
  for(const d of[1,-1])add(cyl(0.28,0.9),bodyMat,d*0.4,-bh*0.75,0);
  return{group,body,glowMat,bw,bh,bodyBase:[bw,bh,0.95]};}

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

function buildChimera(s){const k=baseKit(s,':chi');const{group,between,ico,cone,add,glowMat,bodyMat,hornMat,clawMat,limb}=k;
  const bw=between(1.1,1.35),bh=between(1.0,1.2);
  const body=add(ico(1.1,1),bodyMat,0,0.1,0,bw*1.1,bh,1.1);
  add(ico(0.5,1),bodyMat,0,bh*0.85,0.4,1,0.95,1);
  add(ico(0.09,1),glowMat,0.18,bh*0.88,0.7,1,0.6,1);add(ico(0.09,1),glowMat,-0.18,bh*0.88,0.7,1,0.6,1);
  for(let i=0;i<7;i++){const a=(i/6-0.5)*2.4;add(cone(0.1,0.5,6),hornMat,Math.sin(a)*0.55,bh*0.9,0.0,1,1,1,0.6,a*0.3,0);}
  add(ico(0.35,1),bodyMat,bw*0.72,bh*0.9,0.2,1,1.1,1);
  add(cone(0.09,0.6,6),hornMat,bw*0.72+0.15,bh*1.2,0.1,1,1,1,-0.6,0,0.4);add(cone(0.09,0.6,6),hornMat,bw*0.72-0.15,bh*1.2,0.1,1,1,1,-0.6,0,-0.4);
  add(ico(0.06,0),glowMat,bw*0.72,bh*0.92,0.5);
  let px=-bw*0.9,py=0.0,pz=-0.2;for(let i=0;i<3;i++){add(ico(0.22-i*0.03,1),bodyMat,px,py,pz);px-=0.2;py+=0.3;pz-=0.1;}
  add(ico(0.05,0),glowMat,px,py,pz+0.15);
  for(const sx of[1,-1])for(const sz of[1,-1]){const lx=sx*bw*0.7,lz=sz*0.6;limb([lx,-0.2,lz],[lx,-bh*1.0,lz],0.15);add(cone(0.1,0.2,5),clawMat,lx,-bh*1.15,lz+0.1,1,1,1,Math.PI,0,0);}
  return{group,body,glowMat,bw,bh,bodyBase:[bw*1.1,bh,1.1]};}

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
function buildBrood(seedStr) {
  const rand = rng(hashStr((seedStr || 'boss') + ':b'));
  const pick = (a) => a[Math.floor(rand() * a.length)];
  const between = (a, b) => a + rand() * (b - a);
  const pal = pick(PALETTES);
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: pal.body, roughness: 0.5, metalness: 0.2, flatShading: true });
  const hornMat = new THREE.MeshStandardMaterial({ color: pal.horn, roughness: 0.4, flatShading: true });
  const clawMat = new THREE.MeshStandardMaterial({ color: 0x060608, roughness: 0.4, flatShading: true });
  const glowMat = new THREE.MeshStandardMaterial({ color: pal.accent, emissive: pal.accent, emissiveIntensity: 2.7, roughness: 0.3, flatShading: true });
  const ico = (r, d = 1) => new THREE.IcosahedronGeometry(r, d);
  const cone = (r, h, s = 6) => new THREE.ConeGeometry(r, h, s);
  const cyl = (r, h, s = 7) => new THREE.CylinderGeometry(r * 0.8, r, h, s);
  const UP = new THREE.Vector3(0, 1, 0);
  const add = (geo, mat, x, y, z, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.rotation.set(rx, ry, rz); group.add(m); return m; };
  const limb = (a, b, r, mat) => { const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], len = Math.hypot(dx, dy, dz); const m = new THREE.Mesh(cyl(r, len, 6), mat || bodyMat); m.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2); m.quaternion.setFromUnitVectors(UP, new THREE.Vector3(dx, dy, dz).normalize()); group.add(m); };
  const bw = between(1.0, 1.25), bh = between(0.8, 1.0);
  const body = add(ico(1.1, 1), bodyMat, 0, 0.25, -0.95, bw * 1.1, bh * 1.15, 1.25);
  for (let i = 0; i < 6; i += 1) add(ico(between(0.12, 0.2), 0), glowMat, between(-0.55, 0.55), 0.25 + between(-0.1, 0.55), -1.35 + between(-0.2, 0.2));
  add(ico(0.6, 1), bodyMat, 0, 0.05, 0.1, bw * 0.82, bh, 0.95);
  const hy = 0.12, hz = 0.72;
  add(ico(0.4, 1), bodyMat, 0, hy, hz, 1, 0.82, 1);
  for (const p of [[0.15, 0.12], [-0.15, 0.12], [0.3, 0.02], [-0.3, 0.02], [0.12, -0.05], [-0.12, -0.05]]) add(ico(0.06, 0), glowMat, p[0], hy + p[1], hz + 0.3);
  add(cone(0.08, 0.42, 5), hornMat, 0.15, hy - 0.16, hz + 0.34, 1, 1, 1, 1.4, 0, 0.3);
  add(cone(0.08, 0.42, 5), hornMat, -0.15, hy - 0.16, hz + 0.34, 1, 1, 1, 1.4, 0, -0.3);
  for (const s of [1, -1]) for (let i = 0; i < 4; i += 1) {
    const lz = 0.55 - i * 0.42;
    const hip = [s * bw * 0.65, 0.2, lz], knee = [s * (bw * 1.25 + 0.2), 0.65, lz - 0.05], foot = [s * (bw * 1.4 + 0.4), -bh * 0.85, lz - 0.1];
    limb(hip, knee, 0.075); limb(knee, foot, 0.055);
    add(cone(0.05, 0.2, 5), clawMat, foot[0], foot[1], foot[2], 1, 1, 1, Math.PI, 0, 0);
  }
  for (let i = 0; i < 3; i += 1) add(cone(0.1, between(0.35, 0.55), 6), hornMat, 0, 0.55 + i * 0.1, -0.7 - i * 0.35, 1, 1, 1, 0.5, 0, 0);
  return { group, body, glowMat, bw, bh, bodyBase: [bw * 1.1, bh * 1.15, 1.25] };
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

// HORNED BRUTE — the original detailed beast.
function buildBrute(seedStr) {
  const rand = rng(hashStr(seedStr || 'boss'));
  const pick = (a) => a[Math.floor(rand() * a.length)];
  const between = (a, b) => a + rand() * (b - a);
  const pal = pick(PALETTES);
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: pal.body, roughness: 0.62, metalness: 0.12, flatShading: true });
  const hornMat = new THREE.MeshStandardMaterial({ color: pal.horn, roughness: 0.5, flatShading: true });
  const clawMat = new THREE.MeshStandardMaterial({ color: 0x060608, roughness: 0.4, flatShading: true });
  const glowMat = new THREE.MeshStandardMaterial({ color: pal.accent, emissive: pal.accent, emissiveIntensity: 2.6, roughness: 0.3, flatShading: true });

  const ico = (r, d = 1) => new THREE.IcosahedronGeometry(r, d);
  const cone = (r, h, s = 7) => new THREE.ConeGeometry(r, h, s);
  const cyl = (r, h, s = 9) => new THREE.CylinderGeometry(r * 0.65, r, h, s);
  function add(geo, mat, x, y, z, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.rotation.set(rx, ry, rz); group.add(m); return m;
  }

  const bw = between(1.2, 1.5), bh = between(1.0, 1.25);
  // torso: belly + broad chest + shoulder humps + neck
  const body = add(ico(1.0, 1), bodyMat, 0, -0.2, 0, bw, bh * 0.92, 1.05);           // belly (breathe target)
  add(ico(0.95, 1), bodyMat, 0, bh * 0.55, 0.06, bw * 1.06, bh * 0.72, 1.02);        // chest
  add(ico(0.5, 1), bodyMat, bw * 0.9, bh * 0.72, 0);                                  // shoulder R
  add(ico(0.5, 1), bodyMat, -bw * 0.9, bh * 0.72, 0);                                 // shoulder L
  add(cyl(0.4, 0.5), bodyMat, 0, bh * 1.0, 0.16, 1, 1, 1, 0.2, 0, 0);                 // neck
  // head + fanged maw
  const hr = between(0.55, 0.66), headY = bh * 1.28, headZ = 0.34;
  add(ico(hr, 1), bodyMat, 0, headY, headZ, 1.0, 0.95, 0.95);                         // skull
  add(ico(hr * 0.62, 1), bodyMat, 0, headY - 0.2, headZ + hr * 0.72, 1.0, 0.75, 1.25); // snout
  add(ico(hr * 0.5, 1), bodyMat, 0, headY - 0.44, headZ + hr * 0.58, 1.1, 0.55, 1.0);  // jaw
  const eyeY = headY + 0.06, eyeZ = headZ + hr * 0.74, eyeX = between(0.22, 0.3), er = between(0.1, 0.14);
  add(ico(er, 1), glowMat, eyeX, eyeY, eyeZ, 1, 0.55, 1, 0, 0, -0.34);
  add(ico(er, 1), glowMat, -eyeX, eyeY, eyeZ, 1, 0.55, 1, 0, 0, 0.34);
  add(new THREE.BoxGeometry(0.92, 0.16, 0.34), bodyMat, 0, eyeY + 0.16, eyeZ - 0.06, 1, 1, 1, -0.28, 0, 0);
  const mZ = headZ + hr * 0.95, mY = headY - 0.3;
  add(ico(hr * 0.3, 1), glowMat, 0, mY - 0.04, mZ - 0.1, 1.5, 0.7, 0.6);              // glowing maw
  for (let i = -2; i <= 2; i += 1) { const tx = i * 0.1; add(cone(0.04, 0.15, 5), hornMat, tx, mY + 0.06, mZ, 1, 1, 1, Math.PI, 0, 0); add(cone(0.04, 0.13, 5), hornMat, tx, mY - 0.14, mZ - 0.02, 1, 1, 1, 0, 0, 0); }
  add(cone(0.09, 0.5, 6), hornMat, 0.24, mY - 0.02, mZ - 0.02, 1, 1, 1, -0.3, 0, 0.18);   // tusk R
  add(cone(0.09, 0.5, 6), hornMat, -0.24, mY - 0.02, mZ - 0.02, 1, 1, 1, -0.3, 0, -0.18); // tusk L
  // horns + spiky mane
  const hornLen = between(1.3, 1.9), tilt = between(0.12, 0.35), thick = between(0.18, 0.24);
  add(cone(thick, hornLen), hornMat, 0.34, headY + hr * 0.7, headZ - 0.16, 1, 1, 1, -tilt, 0, 0.34);
  add(cone(thick, hornLen), hornMat, -0.34, headY + hr * 0.7, headZ - 0.16, 1, 1, 1, -tilt, 0, -0.34);
  const nm = 6; for (let i = 0; i < nm; i += 1) { const a = (i / (nm - 1) - 0.5) * 2.6; add(cone(0.09, between(0.45, 0.75), 6), hornMat, Math.sin(a) * 0.6, headY - 0.1, headZ - 0.5 - Math.abs(Math.sin(a)) * 0.12, 1, 1, 1, 1.0, a * 0.35, 0); }
  // spine ridge (graduated) + shoulder spikes
  const nsp = 5; for (let i = 0; i < nsp; i += 1) { const f = i / (nsp - 1); add(cone(0.11, 0.4 + 0.5 * (1 - f), 6), hornMat, 0, bh * 0.7 - f * bh * 1.4, -0.72, 1, 1, 1, 0.7 + f * 0.4, 0, 0); }
  for (const side of [1, -1]) for (let i = 0; i < 2; i += 1) add(cone(0.1, between(0.4, 0.65), 6), hornMat, side * bw * 0.95, bh * 0.8 + i * 0.12, -0.1 - i * 0.12, 1, 1, 1, -0.3, 0, side * (0.5 + i * 0.35));
  // arms: upper + forearm + fist + claws
  for (const side of [1, -1]) {
    add(cyl(0.27, 0.85), bodyMat, side * bw * 0.95, bh * 0.4, 0.06, 1, 1, 1, 0.2, 0, side * -0.42);
    add(cyl(0.23, 0.8), bodyMat, side * bw * 1.16, bh * -0.15, 0.28, 1, 1, 1, 0.55, 0, side * -0.18);
    add(ico(0.3, 1), bodyMat, side * bw * 1.22, bh * -0.52, 0.42);
    for (const o of [-0.15, 0, 0.15]) add(cone(0.06, 0.36, 6), clawMat, side * bw * 1.22 + o, bh * -0.74, 0.6, 1, 1, 1, 1.2, 0, 0);
  }
  // legs: thighs + feet
  add(ico(0.46, 1), bodyMat, 0.52, -bh * 0.7, 0.1);
  add(ico(0.46, 1), bodyMat, -0.52, -bh * 0.7, 0.1);
  add(ico(0.44, 1), bodyMat, 0.56, -bh * 1.12, 0.28, 1, 0.6, 1.3);
  add(ico(0.44, 1), bodyMat, -0.56, -bh * 1.12, 0.28, 1, 0.6, 1.3);

  // extra detail: plates, spiky hide, brow ridges, ear-horns, glowing cracks, tail
  const plateMat = new THREE.MeshStandardMaterial({ color: 0x14141c, roughness: 0.45, metalness: 0.5, flatShading: true });
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const UP = new THREE.Vector3(0, 1, 0);
  const spikeAt = (px, py, pz, dx, dy, dz, len, r, mat) => { const m = new THREE.Mesh(cone(r, len, 6), mat || hornMat); m.position.set(px, py, pz); m.quaternion.setFromUnitVectors(UP, new THREE.Vector3(dx, dy, dz).normalize()); group.add(m); return m; };
  add(box(0.34, 0.1, 0.26), bodyMat, eyeX + 0.02, eyeY + 0.12, eyeZ - 0.02, 1, 1, 1, -0.2, 0, -0.5);
  add(box(0.34, 0.1, 0.26), bodyMat, -eyeX - 0.02, eyeY + 0.12, eyeZ - 0.02, 1, 1, 1, -0.2, 0, 0.5);
  add(cone(0.08, 0.42, 6), hornMat, hr * 0.92, headY + 0.08, headZ - 0.1, 1, 1, 1, 0, 0, 1.2);
  add(cone(0.08, 0.42, 6), hornMat, -hr * 0.92, headY + 0.08, headZ - 0.1, 1, 1, 1, 0, 0, -1.2);
  add(cone(0.06, 0.3, 6), hornMat, hr * 0.72, headY - 0.34, headZ + 0.18, 1, 1, 1, 0.2, 0, 0.95);
  add(cone(0.06, 0.3, 6), hornMat, -hr * 0.72, headY - 0.34, headZ + 0.18, 1, 1, 1, 0.2, 0, -0.95);
  add(box(0.9, 0.7, 0.25), plateMat, 0, bh * 0.5, 0.6, 1, 1, 1, 0.12, 0, 0);
  for (let i = 0; i < 3; i += 1) add(box(0.82 - i * 0.14, 0.12, 0.2), plateMat, 0, bh * 0.02 - i * 0.28, 0.74 - i * 0.03, 1, 1, 1, 0.1, 0, 0);
  add(box(0.52, 0.3, 0.52), plateMat, bw * 0.9, bh * 0.86, 0.05, 1, 1, 1, 0, 0, -0.3);
  add(box(0.52, 0.3, 0.52), plateMat, -bw * 0.9, bh * 0.86, 0.05, 1, 1, 1, 0, 0, 0.3);
  for (let i = 0; i < 12; i += 1) { const a = between(-1.15, 1.15), up = between(0.3, 1.1); spikeAt(Math.sin(a) * bw * 0.72, bh * (0.15 + up * 0.45), -0.5 - Math.abs(Math.sin(a)) * 0.2, Math.sin(a) * 0.7, up, -Math.cos(a) * 0.5 - 0.4, between(0.2, 0.42), 0.06); }
  add(cone(0.08, 0.36, 6), hornMat, bw * 1.06, bh * 0.05, 0.1, 1, 1, 1, 0, 0, 1.0);
  add(cone(0.08, 0.36, 6), hornMat, -bw * 1.06, bh * 0.05, 0.1, 1, 1, 1, 0, 0, -1.0);
  add(cone(0.08, 0.3, 6), hornMat, 0.52, -bh * 0.5, 0.42, 1, 1, 1, 1.0, 0, 0);
  add(cone(0.08, 0.3, 6), hornMat, -0.52, -bh * 0.5, 0.42, 1, 1, 1, 1.0, 0, 0);
  for (const side of [1, -1]) for (const o of [-0.12, 0.12]) add(cone(0.05, 0.2, 6), hornMat, side * bw * 1.22 + o, bh * -0.4, 0.52, 1, 1, 1, 0, 0, 0);
  add(box(0.05, 0.36, 0.05), glowMat, 0.16, bh * 0.1, 0.78, 1, 1, 1, 0, 0, 0.4);
  add(box(0.05, 0.28, 0.05), glowMat, -0.1, bh * -0.16, 0.8, 1, 1, 1, 0, 0, -0.35);
  add(box(0.05, 0.22, 0.05), glowMat, 0.06, bh * -0.36, 0.78, 1, 1, 1, 0, 0, 0.2);
  let tx = bw * 0.55, ty = -bh * 0.85, tz = -0.6;
  for (let i = 0; i < 4; i += 1) { add(cyl(0.18 - i * 0.03, 0.42), bodyMat, tx, ty, tz, 1, 1, 1, 0.9, 0, 0.3); tx += 0.26; ty -= 0.04; tz -= 0.34; }
  add(cone(0.15, 0.5, 6), hornMat, tx, ty, tz, 1, 1, 1, 1.2, 0, 0.3);
  add(cone(0.1, 0.32, 6), hornMat, tx + 0.12, ty, tz - 0.08, 1, 1, 1, 1.0, 0, 1.0);
  add(cone(0.1, 0.32, 6), hornMat, tx - 0.12, ty, tz - 0.08, 1, 1, 1, 1.0, 0, -1.0);

  return { group, body, glowMat, bw, bh, bodyBase: [bw, bh * 0.92, 1.05] };
}

// Mount a boss into a <canvas>. Returns { flinch, counter, enrage, stun, defeat, dispose }.
export function mountBoss(canvas, seedStr, tier) {
  // On mobile the webview has a tight GPU/memory budget shared with the card images.
  // Render the boss at 1x and skip the bloom pipeline there so the cards keep enough
  // budget to paint. Desktop keeps full quality.
  const isMobile = !!(window.matchMedia && window.matchMedia('(max-width: 620px)').matches);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isMobile, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(isMobile ? 1 : Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;   // filmic highlights (early-2000s+)
  renderer.toneMappingExposure = 1.2;
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
  const key = new THREE.DirectionalLight(0xfff0dc, 2.4); key.position.set(4, 2.5, 5); scene.add(key);
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
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 0.75, 0.5, 0.85));
    composer.addPass(new OutputPass());
  }

  const built = buildMonster(seedStr);
  scene.add(built.group);
  built.group.traverse((o) => { if (o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach((m) => { if (m.isMeshStandardMaterial) m.envMapIntensity = 1.4; }); } });
  // Difficulty tier makes the boss bigger and glow harder.
  const TS = { Heroic: 1.12, Mythic: 1.26 }[tier] || 1.0;
  const baseEmis = 2.6 * ({ Heroic: 1.3, Mythic: 1.8 }[tier] || 1.0);
  built.group.scale.setScalar(TS);

  let running = true, raf = 0;
  const t0 = performance.now();
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
    if (composer) composer.render(); else renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  return {
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
