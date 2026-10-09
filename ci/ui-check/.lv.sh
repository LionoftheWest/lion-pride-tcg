#!/bin/bash
# usage: .lv.sh <browser> <sizes> <variants> <out> [screens]   (records its own PID in .out/<out>.pid)
cd /c/Users/vaugh/discord-ui49/ci/ui-check
echo $$ > $4.pid
S=${5:-dungeon-choose,dungeon-choose2,dungeon-rest,dungeon-path,dungeon-chest,dungeon-chest-open,dungeon-chest-flipped,dungeon-floor,dungeon-floor-revealed,dungeon-retreat}
node run.mjs --browser $1 --sizes $2 --variants $3 --workers 3 --screens $S --out $4 > $4.log 2>&1
PR_TITLE="UI-48 UI-49" node evaluate.mjs --results $4 --browsers $1 --screens $S --sizes $2 > $4.txt 2>&1
node -e "
const d=JSON.parse(require('fs').readFileSync('$4/defects.json','utf8'));
const L=d.defects||[];
const m={};for(const x of L){ if(!['UI-49','UI-48'].includes(x.owner)||x.rule==='not-checked')continue; const k=x.rule+' | '+(x.where||'').replace(/\"[^\"]*\"/g,'').slice(0,70)+' = '+String(x.value).slice(0,16)+(x.accepted?' ACCEPTED '+x.accepted:''); (m[k]=m[k]||new Set()).add(x.size+' '+x.screen+' '+x.variant);}
for(const [k,v] of Object.entries(m)) console.log(v.size,k,[...v].slice(0,12).join('; '));
console.log('cells',d.cells,'kinds',Object.keys(m).length);
"
