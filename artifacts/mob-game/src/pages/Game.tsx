import { useEffect, useRef, useState, useCallback } from "react";

const CANVAS_WIDTH = 900;
const CANVAS_HEIGHT = 650;
const BASE_PLAYER_SPEED = 1.25;
const PLAYER_RADIUS = 16;
const BASE_SWORD_RANGE = 80;
const BASE_SWORD_ARC = Math.PI / 3;
const MOB_SPEED_BASE = 0.5;
const MOB_SPAWN_INTERVAL = 1500;
const JOYSTICK_MAX_DIST = 52;

const DRAFT_MILESTONES = new Set([5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 70, 80]);

type MobType = "basic" | "tanky" | "ranged" | "exploder";

interface MobDef { type: MobType; radius: number; baseHp: number; speedMult: number; waveUnlock: number; spawnWeight: number; }
const MOB_DEFS: Record<MobType, MobDef> = {
  basic:    { type:"basic",    radius:14, baseHp:1, speedMult:1.0,  waveUnlock:1, spawnWeight:5 },
  tanky:    { type:"tanky",    radius:20, baseHp:5, speedMult:0.45, waveUnlock:3, spawnWeight:2 },
  ranged:   { type:"ranged",   radius:11, baseHp:1, speedMult:0.7,  waveUnlock:5, spawnWeight:3 },
  exploder: { type:"exploder", radius:13, baseHp:1, speedMult:1.6,  waveUnlock:7, spawnWeight:2 },
};

const ABILITY_LIST: { id: string; name: string; icon: string; desc: string }[] = [
  { id:"speed",           name:"Swift Feet",      icon:"💨", desc:"+50% movement speed"        },
  { id:"wide_slash",      name:"Wide Slash",       icon:"⚔️",  desc:"Sword arc doubled"          },
  { id:"fire_blade",      name:"Fire Blade",       icon:"🔥", desc:"Sword leaves burning fire"   },
  { id:"chain_lightning", name:"Chain Lightning",  icon:"⚡", desc:"Kills arc to nearby enemies" },
  { id:"giant_sword",     name:"Giant Sword",      icon:"🗡️",  desc:"+75% sword reach"           },
  { id:"whirlwind",       name:"Whirlwind",        icon:"🌪️", desc:"Auto spin-attack every 3s"  },
  { id:"explosive",       name:"Explosive Death",  icon:"💥", desc:"Enemies explode on death"   },
  { id:"swift_strikes",   name:"Swift Strikes",    icon:"⚡", desc:"Swing speed doubled"        },
  { id:"double_strike",   name:"Double Strike",    icon:"✌️",  desc:"Two swings per click"       },
  { id:"iron_hide",       name:"Iron Hide",        icon:"🛡️",  desc:"2x invincibility time"      },
  { id:"time_stop",       name:"Time Stop",        icon:"⏳", desc:"Kills freeze nearby mobs"   },
  { id:"berserker",       name:"Berserker",        icon:"😤", desc:"Triple arc, 2x speed"       },
];

interface Mob {
  id: number; x: number; y: number; hp: number; maxHp: number;
  dying: boolean; dyingTimer: number; frozen: number; mobType: MobType;
  shootCooldown: number; explodeTimer: number; exploding: boolean;
}
interface Projectile { id: number; x: number; y: number; vx: number; vy: number; life: number; }
interface SwordSwing { angle: number; progress: number; duration: number; hitIds: Set<number>; phase: number; dir: 1 | -1; }
interface Particle { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; color: string; size: number; }
interface DamageNumber { x: number; y: number; vy: number; life: number; text: string; color?: string; }
interface FireTrail { x: number; y: number; life: number; maxLife: number; radius: number; }
interface LightningBolt { x1: number; y1: number; x2: number; y2: number; life: number; }

let mobIdCounter = 0;
let projIdCounter = 0;

function pickMobType(wave: number): MobType {
  const eligible = (Object.values(MOB_DEFS) as MobDef[]).filter(d => wave >= d.waveUnlock);
  const total = eligible.reduce((s,d)=>s+d.spawnWeight,0);
  let r = Math.random()*total;
  for (const d of eligible) { r-=d.spawnWeight; if (r<=0) return d.type; }
  return "basic";
}

function spawnMob(score: number, wave: number): Mob {
  const side = Math.floor(Math.random()*4);
  let x=0,y=0; const pad=30;
  if (side===0){x=Math.random()*CANVAS_WIDTH;y=-pad;}
  else if (side===1){x=CANVAS_WIDTH+pad;y=Math.random()*CANVAS_HEIGHT;}
  else if (side===2){x=Math.random()*CANVAS_WIDTH;y=CANVAS_HEIGHT+pad;}
  else{x=-pad;y=Math.random()*CANVAS_HEIGHT;}
  const mobType=pickMobType(wave);
  const def=MOB_DEFS[mobType];
  const hp=def.baseHp+(mobType==="tanky"?Math.floor(score/10):mobType==="basic"?Math.floor(score/15):0);
  return {id:++mobIdCounter,x,y,hp,maxHp:hp,dying:false,dyingTimer:0,frozen:0,mobType,shootCooldown:1500+Math.random()*1000,explodeTimer:0,exploding:false};
}

function angleDiff(a:number,b:number){let d=a-b;while(d>Math.PI)d-=Math.PI*2;while(d<-Math.PI)d+=Math.PI*2;return d;}
function pickDraftChoices(owned:Set<string>):typeof ABILITY_LIST{
  const av=ABILITY_LIST.filter(a=>!owned.has(a.id));
  if(av.length===0)return[];if(av.length===1)return[av[0]];
  const sh=[...av].sort(()=>Math.random()-0.5);return[sh[0],sh[1]];
}

export default function Game() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [joystickVis,setJoystickVis]=useState({active:false,bx:0,by:0,tx:0,ty:0});
  const joystickRef=useRef({active:false,touchId:-1,screenBX:0,screenBY:0,dx:0,dy:0});

  const stateRef=useRef({
    player:{x:CANVAS_WIDTH/2,y:CANVAS_HEIGHT/2},playerFacing:0,legAnim:0,
    keys:new Set<string>(),
    mobs:[] as Mob[],projectiles:[] as Projectile[],particles:[] as Particle[],
    damageNums:[] as DamageNumber[],fireTrails:[] as FireTrail[],lightningBolts:[] as LightningBolt[],
    sword:null as SwordSwing|null,pendingSwing:false,
    score:0,hp:5,maxHp:5,dead:false,
    lastSpawn:0,spawnInterval:MOB_SPAWN_INTERVAL,
    wave:1,waveTimer:0,gameTime:0,invincible:0,
    abilities:new Set<string>(),
    whirlwindTimer:0,moving:false,swingDir:1 as (1|-1),choosingAbility:false,
  });

  const animRef=useRef<number>(0);
  const lastTimeRef=useRef<number>(0);
  const [uiScore,setUiScore]=useState(0);
  const [uiHp,setUiHp]=useState(5);
  const [uiMaxHp,setUiMaxHp]=useState(5);
  const [uiDead,setUiDead]=useState(false);
  const [uiWave,setUiWave]=useState(1);
  const [uiAbilities,setUiAbilities]=useState<string[]>([]);
  const [scale,setScale]=useState(1);
  const [draftChoices,setDraftChoices]=useState<typeof ABILITY_LIST>([]);
  const [showDraft,setShowDraft]=useState(false);
  const [draftVisible,setDraftVisible]=useState(false);

  useEffect(()=>{
    function upd(){const maxW=window.innerWidth-16;const maxH=window.innerHeight-180;setScale(Math.min(1,maxW/CANVAS_WIDTH,maxH/CANVAS_HEIGHT));}
    upd();window.addEventListener("resize",upd);return()=>window.removeEventListener("resize",upd);
  },[]);

  const restartGame=useCallback(()=>{
    const s=stateRef.current;
    Object.assign(s,{player:{x:CANVAS_WIDTH/2,y:CANVAS_HEIGHT/2},playerFacing:0,legAnim:0,
      mobs:[],projectiles:[],particles:[],damageNums:[],fireTrails:[],lightningBolts:[],
      sword:null,pendingSwing:false,score:0,hp:5,maxHp:5,dead:false,
      lastSpawn:0,spawnInterval:MOB_SPAWN_INTERVAL,wave:1,waveTimer:0,gameTime:0,invincible:0,
      abilities:new Set<string>(),whirlwindTimer:0,moving:false,swingDir:1 as(1|-1),choosingAbility:false});
    joystickRef.current={active:false,touchId:-1,screenBX:0,screenBY:0,dx:0,dy:0};
    mobIdCounter=0;projIdCounter=0;
    setUiScore(0);setUiHp(5);setUiMaxHp(5);setUiDead(false);setUiWave(1);
    setUiAbilities([]);setShowDraft(false);setDraftChoices([]);setDraftVisible(false);
    setJoystickVis({active:false,bx:0,by:0,tx:0,ty:0});
  },[]);

  const chooseDraftAbility=useCallback((id:string)=>{
    const s=stateRef.current;
    if(id!=="__none__")s.abilities.add(id);
    s.choosingAbility=false;
    setUiAbilities([...s.abilities]);
    setDraftVisible(false);
    setTimeout(()=>{setShowDraft(false);setDraftChoices([]);},300);
  },[]);

  function openDraft(){
    const s=stateRef.current;s.choosingAbility=true;
    const choices=pickDraftChoices(s.abilities);
    setDraftChoices(choices);setShowDraft(true);
    requestAnimationFrame(()=>requestAnimationFrame(()=>setDraftVisible(true)));
  }

  function triggerSwing(angle:number,phase:number){
    const s=stateRef.current;
    const dur=s.abilities.has("swift_strikes")?160:300;
    if(phase===0)s.swingDir=s.swingDir===1?-1:1;
    s.sword={angle,progress:0,duration:dur,hitIds:new Set(),phase,dir:s.swingDir};
  }

  // INPUT
  useEffect(()=>{
    const canvas=canvasRef.current;if(!canvas)return;
    function s2c(cx:number,cy:number){const r=canvas.getBoundingClientRect();return{gx:(cx-r.left)*(CANVAS_WIDTH/r.width),gy:(cy-r.top)*(CANVAS_HEIGHT/r.height)};}
    const kd=(e:KeyboardEvent)=>{stateRef.current.keys.add(e.key.toLowerCase());if(["arrowup","arrowdown","arrowleft","arrowright","w","a","s","d"," "].includes(e.key.toLowerCase()))e.preventDefault();};
    const ku=(e:KeyboardEvent)=>stateRef.current.keys.delete(e.key.toLowerCase());
    const md=(e:MouseEvent)=>{const s=stateRef.current;if(s.dead||s.choosingAbility)return;const{gx,gy}=s2c(e.clientX,e.clientY);const ang=Math.atan2(gy-s.player.y,gx-s.player.x);s.playerFacing=ang;if(s.sword===null)triggerSwing(ang,0);else s.pendingSwing=true;};
    const ts=(e:TouchEvent)=>{
      e.preventDefault();const s=stateRef.current;if(s.dead||s.choosingAbility)return;
      const rect=canvas.getBoundingClientRect();const half=rect.left+rect.width/2;
      for(let i=0;i<e.changedTouches.length;i++){
        const t=e.changedTouches[i];
        if(t.clientX<half&&!joystickRef.current.active){joystickRef.current={active:true,touchId:t.identifier,screenBX:t.clientX,screenBY:t.clientY,dx:0,dy:0};setJoystickVis({active:true,bx:t.clientX,by:t.clientY,tx:t.clientX,ty:t.clientY});}
        else if(t.clientX>=half){const{gx,gy}=s2c(t.clientX,t.clientY);let ang=s.playerFacing;let cl=Infinity;s.mobs.forEach(m=>{if(m.dying)return;const d=Math.hypot(m.x-s.player.x,m.y-s.player.y);if(d<cl){cl=d;ang=Math.atan2(m.y-s.player.y,m.x-s.player.x);}});if(Math.hypot(gx-s.player.x,gy-s.player.y)>30)ang=Math.atan2(gy-s.player.y,gx-s.player.x);s.playerFacing=ang;if(s.sword===null)triggerSwing(ang,0);else s.pendingSwing=true;}
      }
    };
    const tm=(e:TouchEvent)=>{e.preventDefault();const j=joystickRef.current;if(!j.active)return;for(let i=0;i<e.changedTouches.length;i++){const t=e.changedTouches[i];if(t.identifier!==j.touchId)continue;const rx=t.clientX-j.screenBX,ry=t.clientY-j.screenBY;const dist=Math.hypot(rx,ry);const cl=Math.min(dist,JOYSTICK_MAX_DIST);j.dx=rx/Math.max(dist,1);j.dy=ry/Math.max(dist,1);setJoystickVis({active:true,bx:j.screenBX,by:j.screenBY,tx:j.screenBX+rx*(cl/Math.max(dist,1)),ty:j.screenBY+ry*(cl/Math.max(dist,1))});}};
    const te=(e:TouchEvent)=>{e.preventDefault();const j=joystickRef.current;for(let i=0;i<e.changedTouches.length;i++){if(e.changedTouches[i].identifier===j.touchId){joystickRef.current={active:false,touchId:-1,screenBX:0,screenBY:0,dx:0,dy:0};setJoystickVis({active:false,bx:0,by:0,tx:0,ty:0});}}};
    window.addEventListener("keydown",kd);window.addEventListener("keyup",ku);
    canvas.addEventListener("mousedown",md);
    canvas.addEventListener("touchstart",ts,{passive:false});canvas.addEventListener("touchmove",tm,{passive:false});
    canvas.addEventListener("touchend",te,{passive:false});canvas.addEventListener("touchcancel",te,{passive:false});
    return()=>{window.removeEventListener("keydown",kd);window.removeEventListener("keyup",ku);canvas.removeEventListener("mousedown",md);canvas.removeEventListener("touchstart",ts);canvas.removeEventListener("touchmove",tm);canvas.removeEventListener("touchend",te);canvas.removeEventListener("touchcancel",te);};
  },[]);

  // GAME LOOP
  useEffect(()=>{
    const canvas=canvasRef.current;if(!canvas)return;
    const ctx=canvas.getContext("2d")!;

    function spawnParticles(x:number,y:number,color:string,count:number,speed=3,sizeRange=3){
      const s=stateRef.current;
      for(let i=0;i<count;i++){const a=Math.random()*Math.PI*2;const sp=1+Math.random()*speed;s.particles.push({x,y,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,life:30+Math.random()*20,maxLife:50,color,size:2+Math.random()*sizeRange});}
    }

    function triggerExploderBoom(mob:Mob,s:typeof stateRef.current){
      spawnParticles(mob.x,mob.y,"#f97316",20,6,5);
      spawnParticles(mob.x,mob.y,"#fbbf24",12,4,3);
      spawnParticles(mob.x,mob.y,"#ef4444",8,3,4);
      const dist=Math.hypot(mob.x-s.player.x,mob.y-s.player.y);
      if(dist<55&&s.invincible<=0){s.hp-=1;s.invincible=900;spawnParticles(s.player.x,s.player.y,"#facc15",10);setUiHp(s.hp);if(s.hp<=0){s.dead=true;setUiDead(true);}}
    }

    function onMobKill(mob:Mob){
      const s=stateRef.current;s.score+=1;setUiScore(s.score);
      if(DRAFT_MILESTONES.has(s.score)&&!s.choosingAbility){const u=ABILITY_LIST.filter(a=>!s.abilities.has(a.id));if(u.length>0)openDraft();}
      if(s.abilities.has("chain_lightning")){
        const nb=s.mobs.filter(m=>!m.dying&&m.id!==mob.id).sort((a,b)=>Math.hypot(a.x-mob.x,a.y-mob.y)-Math.hypot(b.x-mob.x,b.y-mob.y)).slice(0,3);
        nb.forEach(t=>{if(Math.hypot(t.x-mob.x,t.y-mob.y)<180){t.hp-=2;s.lightningBolts.push({x1:mob.x,y1:mob.y,x2:t.x,y2:t.y,life:15});spawnParticles(t.x,t.y,"#a78bfa",4);if(t.hp<=0){t.dying=true;t.dyingTimer=0;}}});
      }
      if(s.abilities.has("explosive")){s.mobs.forEach(o=>{if(o.dying||o.id===mob.id)return;if(Math.hypot(o.x-mob.x,o.y-mob.y)<80){o.hp-=3;spawnParticles(o.x,o.y,"#f97316",6);if(o.hp<=0){o.dying=true;o.dyingTimer=0;}}});spawnParticles(mob.x,mob.y,"#fbbf24",16,5,4);}
      if(s.abilities.has("time_stop")){s.mobs.forEach(o=>{if(o.dying)return;if(Math.hypot(o.x-mob.x,o.y-mob.y)<140){o.frozen=Math.max(o.frozen,1500);spawnParticles(o.x,o.y,"#7dd3fc",5,2);}});}
    }

    function processSwordHits(s:typeof stateRef.current){
      if(!s.sword)return;
      const{angle,progress,hitIds,dir}=s.sword;
      const swordRange=BASE_SWORD_RANGE*(s.abilities.has("giant_sword")?1.75:1);
      let arcHalf=BASE_SWORD_ARC;
      if(s.abilities.has("wide_slash"))arcHalf*=2;if(s.abilities.has("berserker"))arcHalf*=1.5;
      const curAng=dir===1?(angle-arcHalf)+progress*arcHalf*2:(angle+arcHalf)-progress*arcHalf*2;
      s.mobs.forEach(mob=>{
        if(mob.dying||hitIds.has(mob.id))return;
        const def=MOB_DEFS[mob.mobType];
        const dx=mob.x-s.player.x,dy=mob.y-s.player.y;
        if(Math.sqrt(dx*dx+dy*dy)>swordRange+def.radius)return;
        if(Math.abs(angleDiff(Math.atan2(dy,dx),curAng))<arcHalf*0.5){
          hitIds.add(mob.id);mob.hp-=1;
          spawnParticles(mob.x,mob.y,"#ef4444",5);
          s.damageNums.push({x:mob.x,y:mob.y-10,vy:-1.5,life:45,text:"-1"});
          if(s.abilities.has("fire_blade"))s.fireTrails.push({x:mob.x,y:mob.y,life:120,maxLife:120,radius:20});
          if(mob.hp<=0){
            mob.dying=true;mob.dyingTimer=0;
            if(mob.mobType==="exploder")triggerExploderBoom(mob,s);
            spawnParticles(mob.x,mob.y,"#f97316",10);
            s.damageNums.push({x:mob.x+(Math.random()-0.5)*20,y:mob.y-20,vy:-2,life:60,text:"+1"});
            onMobKill(mob);
          }
        }
      });
    }

    function gameLoop(timestamp:number){
      const dt=Math.min(timestamp-lastTimeRef.current,50);
      lastTimeRef.current=timestamp;
      const s=stateRef.current;const j=joystickRef.current;

      if(!s.dead&&!s.choosingAbility){
        s.gameTime+=dt;s.invincible=Math.max(0,s.invincible-dt);

        // Whirlwind
        if(s.abilities.has("whirlwind")){
          s.whirlwindTimer-=dt;
          if(s.whirlwindTimer<=0){
            s.whirlwindTimer=3000;
            for(let i=0;i<8;i++){const a=(i/8)*Math.PI*2;spawnParticles(s.player.x+Math.cos(a)*60,s.player.y+Math.sin(a)*60,"#a78bfa",5,3);}
            const sr=BASE_SWORD_RANGE*(s.abilities.has("giant_sword")?1.75:1);
            s.mobs.forEach(mob=>{if(mob.dying)return;if(Math.hypot(mob.x-s.player.x,mob.y-s.player.y)<sr*1.2){mob.hp-=2;spawnParticles(mob.x,mob.y,"#a78bfa",8);s.damageNums.push({x:mob.x,y:mob.y-12,vy:-2,life:50,text:"🌪️-2",color:"#a78bfa"});if(mob.hp<=0){mob.dying=true;mob.dyingTimer=0;onMobKill(mob);}}});
          }
        }

        // Movement
        let dx=0,dy=0;
        if(s.keys.has("a")||s.keys.has("arrowleft"))dx-=1;if(s.keys.has("d")||s.keys.has("arrowright"))dx+=1;
        if(s.keys.has("w")||s.keys.has("arrowup"))dy-=1;if(s.keys.has("s")||s.keys.has("arrowdown"))dy+=1;
        if(j.active){dx=j.dx;dy=j.dy;}if(dx!==0&&dy!==0&&!j.active){dx*=0.707;dy*=0.707;}
        s.moving=dx!==0||dy!==0;
        if(s.moving){s.legAnim+=dt*0.012;s.playerFacing=Math.atan2(dy,dx);}
        let speed=BASE_PLAYER_SPEED;if(s.abilities.has("speed"))speed*=1.5;if(s.abilities.has("berserker"))speed*=2;
        s.player.x=Math.max(PLAYER_RADIUS+2,Math.min(CANVAS_WIDTH-PLAYER_RADIUS-2,s.player.x+dx*speed));
        s.player.y=Math.max(PLAYER_RADIUS+2,Math.min(CANVAS_HEIGHT-PLAYER_RADIUS-2,s.player.y+dy*speed));

        // Sword
        if(s.sword!==null){
          s.sword.progress+=dt/s.sword.duration;processSwordHits(s);
          if(s.sword.progress>=1){const cp=s.sword.phase;s.sword=null;if(s.abilities.has("double_strike")&&cp===0)triggerSwing(s.playerFacing+Math.PI*0.3,1);else if(s.pendingSwing){s.pendingSwing=false;triggerSwing(s.playerFacing,0);}}
        }

        // Wave
        s.waveTimer+=dt;
        if(s.waveTimer>15000){s.wave+=1;s.waveTimer=0;s.spawnInterval=Math.max(350,MOB_SPAWN_INTERVAL-(s.wave-1)*100);setUiWave(s.wave);}
        if(timestamp-s.lastSpawn>s.spawnInterval){s.lastSpawn=timestamp;const cnt=1+Math.floor(s.wave/3);for(let i=0;i<cnt;i++)s.mobs.push(spawnMob(s.score,s.wave));}

        // Fire
        s.fireTrails.forEach(fire=>{
          if(Math.random()<0.3)s.mobs.forEach(mob=>{if(mob.dying)return;if(Math.hypot(mob.x-fire.x,mob.y-fire.y)<fire.radius+MOB_DEFS[mob.mobType].radius&&Math.random()<0.05){mob.hp-=1;spawnParticles(mob.x,mob.y,"#f97316",3);if(mob.hp<=0){mob.dying=true;mob.dyingTimer=0;onMobKill(mob);}}});
          fire.life-=dt;
        });
        s.fireTrails=s.fireTrails.filter(f=>f.life>0);

        // Mob AI
        const mobSpd=MOB_SPEED_BASE+s.wave*0.04;
        s.mobs.forEach(mob=>{
          if(mob.dying){mob.dyingTimer+=dt;return;}if(mob.frozen>0){mob.frozen-=dt;return;}
          const def=MOB_DEFS[mob.mobType];
          const ddx=s.player.x-mob.x,ddy=s.player.y-mob.y;
          const dist=Math.sqrt(ddx*ddx+ddy*ddy);

          if(mob.mobType==="ranged"){
            const IDEAL=220;const moveDir=dist<IDEAL-30?-1:dist>IDEAL+30?1:0;
            if(dist>0&&moveDir!==0){mob.x+=(ddx/dist)*mobSpd*def.speedMult*moveDir;mob.y+=(ddy/dist)*mobSpd*def.speedMult*moveDir;}
            mob.shootCooldown-=dt;
            if(mob.shootCooldown<=0&&dist<350){mob.shootCooldown=1800+Math.random()*800;const ang=Math.atan2(ddy,ddx);s.projectiles.push({id:++projIdCounter,x:mob.x,y:mob.y,vx:Math.cos(ang)*2.2,vy:Math.sin(ang)*2.2,life:180});}
          } else if(mob.mobType==="exploder"){
            if(dist>0){mob.x+=(ddx/dist)*mobSpd*def.speedMult;mob.y+=(ddy/dist)*mobSpd*def.speedMult;}
            if(!mob.exploding&&dist<PLAYER_RADIUS+def.radius+4){mob.exploding=true;mob.explodeTimer=0;}
            if(mob.exploding){mob.explodeTimer+=dt;if(mob.explodeTimer>300){mob.dying=true;mob.dyingTimer=0;triggerExploderBoom(mob,s);onMobKill(mob);}}
          } else {
            if(dist>0){mob.x+=(ddx/dist)*mobSpd*def.speedMult;mob.y+=(ddy/dist)*mobSpd*def.speedMult;}
            const invDur=s.abilities.has("iron_hide")?1600:800;
            if(s.invincible<=0&&dist<PLAYER_RADIUS+def.radius){s.hp-=1;s.invincible=invDur;spawnParticles(s.player.x,s.player.y,"#facc15",8);setUiHp(s.hp);if(s.hp<=0){s.dead=true;setUiDead(true);}}
          }
        });
        s.mobs=s.mobs.filter(m=>!(m.dying&&m.dyingTimer>350));

        // Projectiles
        s.projectiles.forEach(proj=>{
          proj.x+=proj.vx;proj.y+=proj.vy;proj.life-=1;
          const d=Math.hypot(proj.x-s.player.x,proj.y-s.player.y);
          const inv=s.abilities.has("iron_hide")?1600:800;
          if(s.invincible<=0&&d<PLAYER_RADIUS+5){s.hp-=1;s.invincible=inv;spawnParticles(s.player.x,s.player.y,"#34d399",6);setUiHp(s.hp);if(s.hp<=0){s.dead=true;setUiDead(true);}proj.life=0;}
        });
        s.projectiles=s.projectiles.filter(p=>p.life>0&&p.x>-20&&p.x<CANVAS_WIDTH+20&&p.y>-20&&p.y<CANVAS_HEIGHT+20);

        s.particles.forEach(p=>{p.x+=p.vx;p.y+=p.vy;p.vx*=0.93;p.vy*=0.93;p.life-=1;});
        s.particles=s.particles.filter(p=>p.life>0);
        s.damageNums.forEach(d=>{d.y+=d.vy;d.life-=1;});
        s.damageNums=s.damageNums.filter(d=>d.life>0);
        s.lightningBolts.forEach(b=>{b.life-=1;});
        s.lightningBolts=s.lightningBolts.filter(b=>b.life>0);
      }

      drawGame(ctx,s,timestamp);
      animRef.current=requestAnimationFrame(gameLoop);
    }

    animRef.current=requestAnimationFrame(gameLoop);
    return()=>cancelAnimationFrame(animRef.current);
  },[]);

  // ── DRAW HELPERS ──────────────────────────────────────────────────────────
  function getSwordColors(ab:Set<string>){
    if(ab.has("berserker"))return{blade:"#ff0080",glow:"#ff0080",arc:"#ff00ff"};
    if(ab.has("fire_blade"))return{blade:"#fb923c",glow:"#f97316",arc:"#fbbf24"};
    if(ab.has("chain_lightning"))return{blade:"#c4b5fd",glow:"#a78bfa",arc:"#818cf8"};
    return{blade:"#fef3c7",glow:"#fbbf24",arc:"#fbbf24"};
  }

  function drawPlayer(ctx:CanvasRenderingContext2D,px:number,py:number,facing:number,legAnim:number,invincible:number,ts:number,ab:Set<string>){
    ctx.save();ctx.translate(px,py);
    if(ab.has("berserker")){ctx.globalAlpha=0.25+0.1*Math.sin(ts*0.01);ctx.fillStyle="#ff0080";ctx.beginPath();ctx.arc(0,0,28,0,Math.PI*2);ctx.fill();}
    if(ab.has("fire_blade")){ctx.globalAlpha=0.2+0.08*Math.sin(ts*0.008);ctx.fillStyle="#f97316";ctx.beginPath();ctx.arc(0,0,26,0,Math.PI*2);ctx.fill();}
    if(ab.has("chain_lightning")){ctx.globalAlpha=0.15+0.08*Math.sin(ts*0.012);ctx.fillStyle="#a78bfa";ctx.beginPath();ctx.arc(0,0,26,0,Math.PI*2);ctx.fill();}
    ctx.globalAlpha=1;
    if(invincible>0&&Math.floor(ts/80)%2===0){ctx.globalAlpha=0.7;ctx.fillStyle="#fbbf24";ctx.beginPath();ctx.arc(0,0,22,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;}
    ctx.rotate(facing+Math.PI/2);
    const ls=Math.sin(legAnim)*5;
    ctx.fillStyle="rgba(0,0,0,0.3)";ctx.beginPath();ctx.ellipse(0,4,12,6,0,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle="#374151";ctx.lineWidth=5;ctx.lineCap="round";
    ctx.beginPath();ctx.moveTo(-4,4);ctx.lineTo(-5-ls*0.4,14);ctx.stroke();
    ctx.beginPath();ctx.moveTo(4,4);ctx.lineTo(5+ls*0.4,14);ctx.stroke();
    ctx.fillStyle="#1f2937";
    ctx.beginPath();ctx.ellipse(-5-ls*0.4,15,4,3,-0.3,0,Math.PI*2);ctx.fill();
    ctx.beginPath();ctx.ellipse(5+ls*0.4,15,4,3,0.3,0,Math.PI*2);ctx.fill();
    ctx.fillStyle=ab.has("berserker")?"#dc2626":ab.has("fire_blade")?"#b45309":"#1d4ed8";
    ctx.strokeStyle=ab.has("berserker")?"#fca5a5":ab.has("fire_blade")?"#fbbf24":"#bfdbfe";
    ctx.lineWidth=1.5;ctx.beginPath();ctx.roundRect(-7,-4,14,16,3);ctx.fill();ctx.stroke();
    ctx.strokeStyle="#92400e";ctx.lineWidth=5;
    ctx.beginPath();ctx.moveTo(-7,2);ctx.lineTo(-14,8+ls*0.3);ctx.stroke();
    ctx.beginPath();ctx.moveTo(7,2);ctx.lineTo(14,8-ls*0.3);ctx.stroke();
    ctx.fillStyle="#fcd9a8";
    ctx.beginPath();ctx.arc(-14,8+ls*0.3,3.5,0,Math.PI*2);ctx.fill();
    ctx.beginPath();ctx.arc(14,8-ls*0.3,3.5,0,Math.PI*2);ctx.fill();
    ctx.fillStyle="#fcd9a8";ctx.strokeStyle="#d97706";ctx.lineWidth=1.5;
    ctx.beginPath();ctx.arc(0,-8,9,0,Math.PI*2);ctx.fill();ctx.stroke();
    ctx.fillStyle="#78350f";ctx.beginPath();ctx.ellipse(0,-14,7,4,0,0,Math.PI*2);ctx.fill();
    ctx.fillStyle="#1f2937";
    ctx.beginPath();ctx.arc(-3,-8,1.5,0,Math.PI*2);ctx.fill();
    ctx.beginPath();ctx.arc(3,-8,1.5,0,Math.PI*2);ctx.fill();
    ctx.restore();
  }

  function drawBasicMob(ctx:CanvasRenderingContext2D,mob:Mob,ts:number){
    const bob=Math.sin(ts*0.003+mob.id)*1.5;const r=MOB_DEFS.basic.radius;
    if(mob.frozen>0){ctx.fillStyle="rgba(125,211,252,0.4)";ctx.beginPath();ctx.arc(mob.x,mob.y+bob,r+4,0,Math.PI*2);ctx.fill();}
    const g=ctx.createRadialGradient(mob.x-4,mob.y-4+bob,2,mob.x,mob.y+bob,r);
    g.addColorStop(0,mob.frozen>0?"#bae6fd":"#ef4444");g.addColorStop(1,mob.frozen>0?"#0ea5e9":"#7f1d1d");
    ctx.fillStyle=g;ctx.beginPath();ctx.arc(mob.x,mob.y+bob,r,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle=mob.frozen>0?"#7dd3fc":"#fca5a5";ctx.lineWidth=1.5;ctx.stroke();
    ctx.fillStyle="#fbbf24";
    ctx.beginPath();ctx.moveTo(mob.x-6,mob.y-r*0.5+bob);ctx.lineTo(mob.x-3,mob.y-r*1.1+bob);ctx.lineTo(mob.x,mob.y-r*0.5+bob);ctx.fill();
    ctx.beginPath();ctx.moveTo(mob.x,mob.y-r*0.5+bob);ctx.lineTo(mob.x+3,mob.y-r*1.1+bob);ctx.lineTo(mob.x+6,mob.y-r*0.5+bob);ctx.fill();
    ctx.fillStyle="#fff200";ctx.beginPath();ctx.arc(mob.x-5,mob.y-2+bob,3,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(mob.x+5,mob.y-2+bob,3,0,Math.PI*2);ctx.fill();
    ctx.fillStyle="#000";ctx.beginPath();ctx.arc(mob.x-4,mob.y-2+bob,1.5,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(mob.x+6,mob.y-2+bob,1.5,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle="#fff";ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(mob.x,mob.y+4+bob,4,0.2,Math.PI-0.2);ctx.stroke();
    if(!mob.dying&&mob.maxHp>1){const bx=mob.x-r,by=mob.y-r-10+bob;ctx.fillStyle="#450a0a";ctx.fillRect(bx,by,r*2,4);ctx.fillStyle="#22c55e";ctx.fillRect(bx,by,r*2*(mob.hp/mob.maxHp),4);}
  }

  function drawTankyMob(ctx:CanvasRenderingContext2D,mob:Mob,ts:number){
    const bob=Math.sin(ts*0.002+mob.id)*1;const r=MOB_DEFS.tanky.radius;
    const cx=mob.x,cy=mob.y+bob;
    if(mob.frozen>0){ctx.fillStyle="rgba(125,211,252,0.4)";ctx.beginPath();ctx.arc(cx,cy,r+5,0,Math.PI*2);ctx.fill();}
    const g=ctx.createRadialGradient(cx-6,cy-6,3,cx,cy,r);
    g.addColorStop(0,mob.frozen>0?"#bae6fd":"#7c3aed");g.addColorStop(0.5,mob.frozen>0?"#60a5fa":"#4c1d95");g.addColorStop(1,mob.frozen>0?"#1e40af":"#1e1b4b");
    ctx.fillStyle=g;ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle=mob.frozen>0?"#7dd3fc":"#8b5cf6";ctx.lineWidth=2.5;ctx.stroke();
    ctx.strokeStyle="rgba(167,139,250,0.55)";ctx.lineWidth=3;ctx.lineCap="round";
    for(let i=-1;i<=1;i++){const yy=cy+i*7;const hw=Math.sqrt(Math.max(0,r*r-(i*7)*(i*7)))*0.85;ctx.beginPath();ctx.moveTo(cx-hw,yy);ctx.lineTo(cx+hw,yy);ctx.stroke();}
    ctx.fillStyle="#6d28d9";ctx.beginPath();ctx.ellipse(cx,cy-r*0.35,r*0.7,5,0,0,Math.PI*2);ctx.fill();
    ctx.fillStyle="#ff2222";ctx.shadowBlur=8;ctx.shadowColor="#ff0000";
    ctx.beginPath();ctx.arc(cx-7,cy-4,4,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(cx+7,cy-4,4,0,Math.PI*2);ctx.fill();
    ctx.shadowBlur=0;ctx.fillStyle="#ff8888";ctx.beginPath();ctx.arc(cx-7,cy-4,1.5,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(cx+7,cy-4,1.5,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle="#ff6666";ctx.lineWidth=2;ctx.beginPath();ctx.arc(cx,cy+9,6,Math.PI+0.3,-0.3,false);ctx.stroke();
    ctx.fillStyle="#a78bfa";
    for(const sx of[-1,1]){ctx.beginPath();ctx.moveTo(cx+sx*(r-2),cy-8);ctx.lineTo(cx+sx*(r+7),cy-14);ctx.lineTo(cx+sx*(r+2),cy-2);ctx.closePath();ctx.fill();}
    const bx=cx-r,by=cy-r-12;ctx.fillStyle="#1e1b4b";ctx.fillRect(bx,by,r*2,5);ctx.fillStyle="#7c3aed";ctx.fillRect(bx,by,r*2*(mob.hp/mob.maxHp),5);ctx.strokeStyle="#a78bfa";ctx.lineWidth=1;ctx.strokeRect(bx,by,r*2,5);
  }

  function drawRangedMob(ctx:CanvasRenderingContext2D,mob:Mob,ts:number){
    const bob=Math.sin(ts*0.005+mob.id)*2.5;const r=MOB_DEFS.ranged.radius;
    const cx=mob.x,cy=mob.y+bob;
    if(mob.frozen>0){ctx.fillStyle="rgba(125,211,252,0.4)";ctx.beginPath();ctx.arc(cx,cy,r+4,0,Math.PI*2);ctx.fill();}
    ctx.globalAlpha=0.25+0.1*Math.sin(ts*0.006+mob.id);
    ctx.fillStyle=mob.frozen>0?"#7dd3fc":"#34d399";ctx.beginPath();ctx.arc(cx,cy,r+6,0,Math.PI*2);ctx.fill();
    ctx.globalAlpha=1;
    const g=ctx.createRadialGradient(cx-3,cy-3,2,cx,cy,r);
    g.addColorStop(0,mob.frozen>0?"#bae6fd":"#34d399");g.addColorStop(1,mob.frozen>0?"#0369a1":"#065f46");
    ctx.fillStyle=g;ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle=mob.frozen>0?"#7dd3fc":"#6ee7b7";ctx.lineWidth=1.5;ctx.stroke();
    ctx.fillStyle="#065f46";
    ctx.beginPath();ctx.moveTo(cx-r*0.9,cy-r*0.3);ctx.lineTo(cx+r*0.9,cy-r*0.3);ctx.lineTo(cx+r*0.5,cy-r);ctx.lineTo(cx,cy-r*1.7);ctx.lineTo(cx-r*0.5,cy-r);ctx.closePath();ctx.fill();
    ctx.strokeStyle="#34d399";ctx.lineWidth=1;ctx.stroke();
    ctx.fillStyle="#047857";ctx.beginPath();ctx.ellipse(cx,cy-r*0.3,r*0.95,3.5,0,0,Math.PI*2);ctx.fill();
    ctx.fillStyle="#fff";ctx.beginPath();ctx.arc(cx-4,cy,2.5,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(cx+4,cy,2.5,0,Math.PI*2);ctx.fill();
    ctx.fillStyle="#10b981";ctx.beginPath();ctx.arc(cx-4,cy,1.2,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(cx+4,cy,1.2,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle="#d1fae5";ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(cx+r*0.6,cy+3);ctx.lineTo(cx+r+6,cy-4);ctx.stroke();
    ctx.fillStyle="#a7f3d0";ctx.beginPath();ctx.arc(cx+r+6,cy-4,2.5,0,Math.PI*2);ctx.fill();
    if(mob.shootCooldown<600){const prog=1-mob.shootCooldown/600;ctx.strokeStyle="#34d399";ctx.lineWidth=2;ctx.globalAlpha=0.7;ctx.beginPath();ctx.arc(cx,cy,r+4,-Math.PI/2,-Math.PI/2+prog*Math.PI*2);ctx.stroke();ctx.globalAlpha=1;}
  }

  function drawExploderMob(ctx:CanvasRenderingContext2D,mob:Mob,ts:number){
    const jitter=mob.exploding?(Math.random()-0.5)*4:0;
    const cx=mob.x+jitter,cy=mob.y+jitter;const r=MOB_DEFS.exploder.radius;
    const ep=mob.exploding?Math.sin(ts*0.04)*0.5+0.5:0;
    if(mob.frozen>0){ctx.fillStyle="rgba(125,211,252,0.4)";ctx.beginPath();ctx.arc(cx,cy,r+4,0,Math.PI*2);ctx.fill();}
    if(mob.exploding){ctx.globalAlpha=ep*0.45;ctx.fillStyle="#ff4500";ctx.beginPath();ctx.arc(cx,cy,55,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;}
    const g=ctx.createRadialGradient(cx-3,cy-3,2,cx,cy,r);
    g.addColorStop(0,mob.frozen>0?"#bae6fd":mob.exploding?"#ff6600":"#f97316");
    g.addColorStop(1,mob.frozen>0?"#0369a1":mob.exploding?"#7f1200":"#7c2d12");
    ctx.fillStyle=g;ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle=mob.exploding?"#ff4500":"#fb923c";ctx.lineWidth=mob.exploding?3:1.5;ctx.stroke();
    ctx.strokeStyle="#d97706";ctx.lineWidth=2;
    ctx.beginPath();ctx.moveTo(cx+2,cy-r);ctx.bezierCurveTo(cx+8,cy-r-8,cx-2,cy-r-14,cx+2,cy-r-18);ctx.stroke();
    if(Math.sin(ts*(mob.exploding?0.025:0.01)+mob.id*3.7)>0){ctx.fillStyle="#fbbf24";ctx.shadowBlur=8;ctx.shadowColor="#fbbf24";ctx.beginPath();ctx.arc(cx+2,cy-r-18,3,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;}
    const ec=mob.exploding?"#ffffff":"#1f2937";ctx.strokeStyle=ec;ctx.lineWidth=2;ctx.lineCap="round";
    for(const ex of[-5,5]){ctx.beginPath();ctx.moveTo(cx+ex-2.5,cy-4);ctx.lineTo(cx+ex+2.5,cy+2);ctx.stroke();ctx.beginPath();ctx.moveTo(cx+ex+2.5,cy-4);ctx.lineTo(cx+ex-2.5,cy+2);ctx.stroke();}
    if(mob.exploding){ctx.strokeStyle="#fff";ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(cx-6,cy+5);ctx.lineTo(cx-3,cy+8);ctx.lineTo(cx,cy+5);ctx.lineTo(cx+3,cy+8);ctx.lineTo(cx+6,cy+5);ctx.stroke();}
  }

  function drawProjectile(ctx:CanvasRenderingContext2D,proj:Projectile,ts:number){
    ctx.save();ctx.globalAlpha=Math.min(1,proj.life/30);
    const pulse=0.8+0.2*Math.sin(ts*0.02+proj.id);
    ctx.shadowBlur=10;ctx.shadowColor="#34d399";ctx.fillStyle="#34d399";ctx.beginPath();ctx.arc(proj.x,proj.y,5*pulse,0,Math.PI*2);ctx.fill();
    ctx.fillStyle="#d1fae5";ctx.beginPath();ctx.arc(proj.x-1,proj.y-1,2,0,Math.PI*2);ctx.fill();
    ctx.shadowBlur=0;ctx.globalAlpha=1;ctx.restore();
  }

  function drawMob(ctx:CanvasRenderingContext2D,mob:Mob,ts:number){
    const alpha=mob.dying?Math.max(0,1-mob.dyingTimer/350):1;
    ctx.globalAlpha=alpha;
    if(mob.mobType==="basic")drawBasicMob(ctx,mob,ts);
    else if(mob.mobType==="tanky")drawTankyMob(ctx,mob,ts);
    else if(mob.mobType==="ranged")drawRangedMob(ctx,mob,ts);
    else drawExploderMob(ctx,mob,ts);
    ctx.globalAlpha=1;
  }

  function drawGame(ctx:CanvasRenderingContext2D,s:typeof stateRef.current,ts:number){
    ctx.fillStyle="#0f0f1a";ctx.fillRect(0,0,CANVAS_WIDTH,CANVAS_HEIGHT);
    ctx.strokeStyle="rgba(255,255,255,0.035)";ctx.lineWidth=1;
    for(let x=0;x<CANVAS_WIDTH;x+=60){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,CANVAS_HEIGHT);ctx.stroke();}
    for(let y=0;y<CANVAS_HEIGHT;y+=60){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(CANVAS_WIDTH,y);ctx.stroke();}
    ctx.strokeStyle="#4a3f6b";ctx.lineWidth=8;ctx.strokeRect(4,4,CANVAS_WIDTH-8,CANVAS_HEIGHT-8);
    ctx.strokeStyle="#6b5fa0";ctx.lineWidth=2;ctx.strokeRect(10,10,CANVAS_WIDTH-20,CANVAS_HEIGHT-20);
    s.fireTrails.forEach(fire=>{const a=fire.life/fire.maxLife;const grad=ctx.createRadialGradient(fire.x,fire.y,0,fire.x,fire.y,fire.radius);grad.addColorStop(0,`rgba(251,146,60,${a*0.8})`);grad.addColorStop(0.5,`rgba(239,68,68,${a*0.5})`);grad.addColorStop(1,"transparent");ctx.fillStyle=grad;ctx.beginPath();ctx.arc(fire.x,fire.y,fire.radius,0,Math.PI*2);ctx.fill();});
    s.lightningBolts.forEach(bolt=>{ctx.globalAlpha=bolt.life/15;ctx.strokeStyle="#c4b5fd";ctx.lineWidth=2;ctx.shadowBlur=10;ctx.shadowColor="#a78bfa";ctx.beginPath();ctx.moveTo(bolt.x1,bolt.y1);ctx.lineTo((bolt.x1+bolt.x2)/2+(Math.random()-0.5)*30,(bolt.y1+bolt.y2)/2+(Math.random()-0.5)*30);ctx.lineTo(bolt.x2,bolt.y2);ctx.stroke();ctx.shadowBlur=0;ctx.globalAlpha=1;});
    s.particles.forEach(p=>{ctx.globalAlpha=p.life/p.maxLife;ctx.fillStyle=p.color;ctx.beginPath();ctx.arc(p.x,p.y,p.size,0,Math.PI*2);ctx.fill();});ctx.globalAlpha=1;
    s.projectiles.forEach(proj=>drawProjectile(ctx,proj,ts));
    s.mobs.forEach(mob=>drawMob(ctx,mob,ts));
    // Sword
    if(s.sword!==null){
      const{angle,progress,dir}=s.sword;
      const swordRange=BASE_SWORD_RANGE*(s.abilities.has("giant_sword")?1.75:1);
      let arcHalf=BASE_SWORD_ARC;if(s.abilities.has("wide_slash"))arcHalf*=2;if(s.abilities.has("berserker"))arcHalf*=1.5;
      const startAng=dir===1?angle-arcHalf:angle+arcHalf;
      const curAng=dir===1?(angle-arcHalf)+progress*arcHalf*2:(angle+arcHalf)-progress*arcHalf*2;
      const colors=getSwordColors(s.abilities);const fade=1-progress*0.5;
      ctx.save();ctx.translate(s.player.x,s.player.y);
      ctx.globalAlpha=0.35*fade;ctx.strokeStyle=colors.arc;ctx.lineWidth=12;ctx.lineCap="round";ctx.shadowBlur=18;ctx.shadowColor=colors.glow;
      ctx.beginPath();if(dir===1)ctx.arc(0,0,swordRange*0.8,startAng,curAng,false);else ctx.arc(0,0,swordRange*0.8,startAng,curAng,true);ctx.stroke();ctx.shadowBlur=0;
      ctx.globalAlpha=fade;ctx.rotate(curAng);
      const bL=swordRange-PLAYER_RADIUS-2;const bX=PLAYER_RADIUS+2;
      ctx.shadowBlur=16;ctx.shadowColor=colors.glow;
      ctx.beginPath();ctx.moveTo(bX+12,-4);ctx.lineTo(bX+bL,0);ctx.lineTo(bX+12,4);ctx.closePath();
      const bg=ctx.createLinearGradient(bX+12,0,bX+bL,0);bg.addColorStop(0,colors.blade);bg.addColorStop(1,"#ffffff");ctx.fillStyle=bg;ctx.fill();
      ctx.strokeStyle="#ffffff";ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(bX+12,0);ctx.lineTo(bX+bL-2,0);ctx.stroke();ctx.shadowBlur=0;
      ctx.fillStyle="#9ca3af";ctx.fillRect(bX+8,-8,5,16);ctx.strokeStyle="#d1d5db";ctx.lineWidth=1;ctx.strokeRect(bX+8,-8,5,16);
      ctx.fillStyle="#78350f";ctx.beginPath();ctx.roundRect(bX-2,-3,12,6,2);ctx.fill();ctx.strokeStyle="#d97706";ctx.lineWidth=1;ctx.stroke();
      ctx.fillStyle="#d4af37";ctx.beginPath();ctx.arc(bX-3,0,4,0,Math.PI*2);ctx.fill();ctx.strokeStyle="#fef3c7";ctx.lineWidth=1;ctx.stroke();
      ctx.globalAlpha=1;ctx.restore();
    }
    drawPlayer(ctx,s.player.x,s.player.y,s.playerFacing,s.legAnim,s.invincible,ts,s.abilities);
    s.damageNums.forEach(d=>{ctx.globalAlpha=Math.min(1,d.life/40);ctx.fillStyle=d.color??(d.text.startsWith("+")?"#4ade80":"#f87171");ctx.font=`bold ${d.text.length>3?13:15}px monospace`;ctx.textAlign="center";ctx.fillText(d.text,d.x,d.y);});
    ctx.globalAlpha=1;ctx.textAlign="left";
    if(s.choosingAbility){ctx.fillStyle="rgba(0,0,0,0.62)";ctx.fillRect(0,0,CANVAS_WIDTH,CANVAS_HEIGHT);}
    if(s.dead){ctx.fillStyle="rgba(0,0,0,0.65)";ctx.fillRect(0,0,CANVAS_WIDTH,CANVAS_HEIGHT);}
  }

  const abilityMeta=ABILITY_LIST.reduce<Record<string,typeof ABILITY_LIST[0]>>((acc,a)=>{acc[a.id]=a;return acc;},{});
  const nextMilestone=(()=>{const sorted=[...DRAFT_MILESTONES].sort((a,b)=>a-b);return sorted.find(m=>m>uiScore)??null;})();

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-950 select-none overflow-hidden">
      <div className="mb-1 flex items-center gap-4 text-white flex-wrap justify-center px-2">
        <div className="flex items-center gap-1"><span className="text-gray-400 text-xs font-mono">WAVE</span><span className="text-purple-400 font-bold text-lg font-mono">{uiWave}</span></div>
        <div className="flex items-center gap-1"><span className="text-gray-400 text-xs font-mono">KILLS</span><span className="text-yellow-400 font-bold text-lg font-mono">{uiScore}</span></div>
        <div className="flex items-center gap-1">
          <span className="text-gray-400 text-xs font-mono">HP</span>
          <div className="flex gap-0.5">{Array.from({length:uiMaxHp}).map((_,i)=>(<div key={i} className={`w-3.5 h-3.5 rounded-sm transition-colors ${i<uiHp?"bg-red-500":"bg-gray-700"}`}/>))}</div>
        </div>
        {nextMilestone!==null&&(<div className="flex items-center gap-1"><span className="text-gray-400 text-xs font-mono">NEXT PICK</span><span className="text-green-400 font-bold text-xs font-mono">@ {nextMilestone} kills</span></div>)}
      </div>

      {/* Mob legend */}
      <div className="mb-1 flex gap-3 text-xs font-mono flex-wrap justify-center px-2">
        <span className="text-red-400">🔴 Basic</span>
        <span className="text-purple-400">🟣 Tanky (w3+)</span>
        <span className="text-emerald-400">🟢 Ranged (w5+)</span>
        <span className="text-orange-400">🟠 Exploder (w7+)</span>
      </div>

      {uiAbilities.length>0&&(
        <div className="mb-1 flex gap-1 flex-wrap justify-center px-2" style={{maxWidth:CANVAS_WIDTH*scale}}>
          {uiAbilities.map(id=>{const a=abilityMeta[id];if(!a)return null;return(<div key={id} title={`${a.name}: ${a.desc}`} className="flex items-center gap-0.5 px-1.5 py-0.5 bg-gray-800 border border-purple-700 rounded text-xs text-purple-200 font-mono"><span>{a.icon}</span><span className="hidden sm:inline">{a.name}</span></div>);})}
        </div>
      )}

      <div ref={containerRef} className="relative" style={{width:CANVAS_WIDTH*scale,height:CANVAS_HEIGHT*scale}}>
        <canvas ref={canvasRef} width={CANVAS_WIDTH} height={CANVAS_HEIGHT}
          className="block rounded-lg border-2 border-purple-900 cursor-crosshair touch-none"
          style={{width:CANVAS_WIDTH*scale,height:CANVAS_HEIGHT*scale}}/>

        {joystickVis.active&&(<>
          <div className="absolute pointer-events-none rounded-full border-2 border-white/30 bg-white/5" style={{width:JOYSTICK_MAX_DIST*2,height:JOYSTICK_MAX_DIST*2,left:joystickVis.bx-JOYSTICK_MAX_DIST,top:joystickVis.by-JOYSTICK_MAX_DIST,position:"fixed"}}/>
          <div className="absolute pointer-events-none rounded-full bg-white/40 border-2 border-white/60" style={{width:44,height:44,left:joystickVis.tx-22,top:joystickVis.ty-22,position:"fixed"}}/>
        </>)}

        {showDraft&&(
          <div className="absolute inset-0 flex flex-col items-center justify-center z-20" style={{transition:"opacity 0.25s ease",opacity:draftVisible?1:0,pointerEvents:draftVisible?"auto":"none"}}>
            <div className="mb-6 text-center">
              <div className="text-xs font-mono tracking-[0.35em] uppercase mb-2" style={{color:"#a78bfa",textShadow:"0 0 14px rgba(167,139,250,0.9)"}}>✦ Ability Draft ✦</div>
              <div className="text-3xl font-bold font-mono" style={{color:"#fff",textShadow:"0 0 24px rgba(255,255,255,0.25)"}}>Choose Your Power</div>
              <div className="text-xs font-mono mt-1.5" style={{color:"#6b7280"}}>{uiScore} kills — game paused — pick one</div>
            </div>
            <div className="flex gap-5 flex-wrap justify-center px-4">
              {draftChoices.map((ability,idx)=>{
                const accent=idx===0?"#7c3aed":"#0891b2";const accentLight=idx===0?"#c4b5fd":"#7dd3fc";const accentAlpha=idx===0?"124,58,237":"8,145,178";
                return(
                  <button key={ability.id} onClick={()=>chooseDraftAbility(ability.id)}
                    className="flex flex-col items-center gap-3 rounded-2xl cursor-pointer relative"
                    style={{background:"linear-gradient(160deg,rgba(20,15,50,0.98),rgba(8,6,24,0.99))",border:`2px solid ${accent}`,boxShadow:`0 0 28px rgba(${accentAlpha},0.45),inset 0 1px 0 rgba(255,255,255,0.05)`,padding:"24px 28px",minWidth:170,maxWidth:210,transform:draftVisible?"translateY(0) scale(1)":"translateY(28px) scale(0.9)",transition:`transform 0.38s cubic-bezier(0.34,1.56,0.64,1) ${idx*0.11}s`}}
                    onMouseEnter={e=>{const el=e.currentTarget as HTMLButtonElement;el.style.transform="translateY(-7px) scale(1.06)";el.style.boxShadow=`0 0 52px rgba(${accentAlpha},0.7),0 20px 40px rgba(0,0,0,0.6),inset 0 1px 0 rgba(255,255,255,0.1)`;}}
                    onMouseLeave={e=>{const el=e.currentTarget as HTMLButtonElement;el.style.transform="translateY(0) scale(1)";el.style.boxShadow=`0 0 28px rgba(${accentAlpha},0.45),inset 0 1px 0 rgba(255,255,255,0.05)`;}}
                  >
                    <div style={{position:"absolute",top:12,right:12,width:8,height:8,borderRadius:"50%",background:accent,boxShadow:`0 0 10px ${accent}`,pointerEvents:"none"}}/>
                    <div style={{fontSize:52,lineHeight:1,filter:`drop-shadow(0 0 18px rgba(${accentAlpha},0.6))`}}>{ability.icon}</div>
                    <div style={{color:"#fff",fontFamily:"monospace",fontWeight:700,fontSize:14,letterSpacing:"0.05em",textAlign:"center"}}>{ability.name}</div>
                    <div style={{width:"100%",height:1,background:`linear-gradient(90deg,transparent,${accent},transparent)`}}/>
                    <div style={{color:"#9ca3af",fontFamily:"monospace",fontSize:12,textAlign:"center",lineHeight:1.55}}>{ability.desc}</div>
                    <div style={{marginTop:4,padding:"5px 16px",borderRadius:999,background:`rgba(${accentAlpha},0.18)`,border:`1px solid ${accent}`,color:accentLight,fontFamily:"monospace",fontSize:11,fontWeight:700,letterSpacing:"0.15em"}}>PICK THIS</div>
                  </button>
                );
              })}
              {draftChoices.length===0&&(<div style={{color:"#6b7280",fontFamily:"monospace",fontSize:14,textAlign:"center"}}>All abilities unlocked! 💪<br/><button onClick={()=>chooseDraftAbility("__none__")} style={{marginTop:16,padding:"8px 24px",background:"#374151",border:"1px solid #6b7280",borderRadius:8,color:"#fff",fontFamily:"monospace",cursor:"pointer"}}>Continue</button></div>)}
            </div>
          </div>
        )}

        {uiDead&&(
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <div className="text-center pointer-events-auto">
              <h2 className="text-4xl font-bold text-red-500 mb-2 font-mono tracking-widest drop-shadow-lg">YOU DIED</h2>
              <p className="text-yellow-400 text-lg font-mono mb-1">Kills: {uiScore}</p>
              <p className="text-purple-400 font-mono mb-2">Wave: {uiWave}</p>
              {uiAbilities.length>0&&(<p className="text-gray-300 text-sm font-mono mb-4">{uiAbilities.map(id=>abilityMeta[id]?.icon).join(" ")}</p>)}
              <button onClick={restartGame} className="px-8 py-3 bg-purple-700 hover:bg-purple-600 text-white font-bold font-mono rounded-lg text-lg border border-purple-400 transition-colors">PLAY AGAIN</button>
            </div>
          </div>
        )}
      </div>

      <div className="mt-2 flex gap-6 text-gray-500 text-xs font-mono flex-wrap justify-center px-2">
        <span className="hidden sm:inline">WASD — Move</span>
        <span className="hidden sm:inline">CLICK — Swing sword</span>
        <span className="sm:hidden">Left — Joystick</span>
        <span className="sm:hidden">Right — Attack</span>
        <span>New mob types unlock each wave!</span>
      </div>
    </div>
  );
}
