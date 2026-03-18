import { useEffect, useRef, useState, useCallback } from "react";

const CANVAS_WIDTH = 900;
const CANVAS_HEIGHT = 650;
const BASE_PLAYER_SPEED = 1.25;
const PLAYER_RADIUS = 16;
const MOB_RADIUS = 14;
const BASE_SWORD_RANGE = 80;
const BASE_SWORD_ARC = Math.PI / 3;
const MOB_SPEED_BASE = 0.5;
const MOB_SPAWN_INTERVAL = 1500;
const JOYSTICK_MAX_DIST = 52;

const ABILITY_LIST: { id: string; name: string; icon: string; desc: string; killsRequired: number }[] = [
  { id: "speed",           name: "Swift Feet",      icon: "💨", desc: "+50% movement speed",         killsRequired: 5  },
  { id: "wide_slash",      name: "Wide Slash",       icon: "⚔️",  desc: "Sword arc doubled",           killsRequired: 10 },
  { id: "fire_blade",      name: "Fire Blade",       icon: "🔥", desc: "Sword leaves burning fire",    killsRequired: 15 },
  { id: "chain_lightning", name: "Chain Lightning",  icon: "⚡", desc: "Kills arc to nearby enemies",  killsRequired: 25 },
  { id: "giant_sword",     name: "Giant Sword",      icon: "🗡️",  desc: "+75% sword reach",            killsRequired: 30 },
  { id: "whirlwind",       name: "Whirlwind",        icon: "🌪️", desc: "Auto spin-attack every 3s",   killsRequired: 35 },
  { id: "explosive",       name: "Explosive Death",  icon: "💥", desc: "Enemies explode on death",    killsRequired: 40 },
  { id: "swift_strikes",   name: "Swift Strikes",    icon: "⚡", desc: "Swing speed doubled",         killsRequired: 45 },
  { id: "double_strike",   name: "Double Strike",    icon: "✌️",  desc: "Two swings per click",        killsRequired: 50 },
  { id: "iron_hide",       name: "Iron Hide",        icon: "🛡️",  desc: "2x invincibility time",       killsRequired: 55 },
  { id: "time_stop",       name: "Time Stop",        icon: "⏳", desc: "Kills freeze nearby mobs",    killsRequired: 60 },
  { id: "berserker",       name: "Berserker",        icon: "😤", desc: "Triple arc, 2x speed",        killsRequired: 80 },
];

interface Mob { id: number; x: number; y: number; hp: number; maxHp: number; dying: boolean; dyingTimer: number; frozen: number; }
interface SwordSwing { angle: number; progress: number; duration: number; hitIds: Set<number>; phase: number; dir: 1 | -1; }
interface Particle { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; color: string; size: number; }
interface DamageNumber { x: number; y: number; vy: number; life: number; text: string; color?: string; }
interface FireTrail { x: number; y: number; life: number; maxLife: number; radius: number; }
interface LightningBolt { x1: number; y1: number; x2: number; y2: number; life: number; }
interface DraftChoice { id: string; name: string; icon: string; desc: string; }

let mobIdCounter = 0;

function spawnMob(score: number): Mob {
  const side = Math.floor(Math.random() * 4);
  let x = 0, y = 0;
  const pad = 30;
  if (side === 0) { x = Math.random() * CANVAS_WIDTH; y = -pad; }
  else if (side === 1) { x = CANVAS_WIDTH + pad; y = Math.random() * CANVAS_HEIGHT; }
  else if (side === 2) { x = Math.random() * CANVAS_WIDTH; y = CANVAS_HEIGHT + pad; }
  else { x = -pad; y = Math.random() * CANVAS_HEIGHT; }
  const hp = 1 + Math.floor(score / 15);
  return { id: ++mobIdCounter, x, y, hp, maxHp: hp, dying: false, dyingTimer: 0, frozen: 0 };
}

function angleDiff(a: number, b: number) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export default function Game() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [joystickVis, setJoystickVis] = useState<{
    active: boolean; bx: number; by: number; tx: number; ty: number;
  }>({ active: false, bx: 0, by: 0, tx: 0, ty: 0 });

  const joystickRef = useRef({
    active: false,
    touchId: -1,
    screenBX: 0, screenBY: 0,
    dx: 0, dy: 0,
  });

  const stateRef = useRef({
    player: { x: CANVAS_WIDTH / 2, y: CANVAS_HEIGHT / 2 },
    playerFacing: 0,
    legAnim: 0,
    keys: new Set<string>(),
    mobs: [] as Mob[],
    particles: [] as Particle[],
    damageNums: [] as DamageNumber[],
    fireTrails: [] as FireTrail[],
    lightningBolts: [] as LightningBolt[],
    sword: null as SwordSwing | null,
    pendingSwing: false,
    score: 0, hp: 5, maxHp: 5, dead: false,
    lastSpawn: 0, spawnInterval: MOB_SPAWN_INTERVAL,
    wave: 1, waveTimer: 0, gameTime: 0, invincible: 0,
    abilities: new Set<string>(),
    whirlwindTimer: 0, vampiricKillTrack: 0,
    moving: false, playerVx: 0, playerVy: 0,
    swingDir: 1 as (1 | -1),
    // Draft system
    paused: false,
  });

  // Draft UI state
  const [draftChoices, setDraftChoices] = useState<DraftChoice[] | null>(null);

  const animRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const [uiScore, setUiScore] = useState(0);
  const [uiHp, setUiHp] = useState(5);
  const [uiMaxHp, setUiMaxHp] = useState(5);
  const [uiDead, setUiDead] = useState(false);
  const [uiWave, setUiWave] = useState(1);
  const [uiAbilities, setUiAbilities] = useState<string[]>([]);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    function updateScale() {
      const maxW = window.innerWidth - 16;
      const maxH = window.innerHeight - 180;
      const s = Math.min(1, maxW / CANVAS_WIDTH, maxH / CANVAS_HEIGHT);
      setScale(s);
    }
    updateScale();
    window.addEventListener("resize", updateScale);
    return () => window.removeEventListener("resize", updateScale);
  }, []);

  const restartGame = useCallback(() => {
    const s = stateRef.current;
    Object.assign(s, {
      player: { x: CANVAS_WIDTH / 2, y: CANVAS_HEIGHT / 2 },
      playerFacing: 0, legAnim: 0,
      mobs: [], particles: [], damageNums: [], fireTrails: [], lightningBolts: [],
      sword: null, pendingSwing: false,
      score: 0, hp: 5, maxHp: 5, dead: false,
      lastSpawn: 0, spawnInterval: MOB_SPAWN_INTERVAL,
      wave: 1, waveTimer: 0, gameTime: 0, invincible: 0,
      abilities: new Set<string>(),
      whirlwindTimer: 0, vampiricKillTrack: 0, moving: false,
      swingDir: 1 as (1 | -1),
      paused: false,
    });
    joystickRef.current = { active: false, touchId: -1, screenBX: 0, screenBY: 0, dx: 0, dy: 0 };
    mobIdCounter = 0;
    setUiScore(0); setUiHp(5); setUiMaxHp(5); setUiDead(false); setUiWave(1);
    setUiAbilities([]); setDraftChoices(null);
    setJoystickVis({ active: false, bx: 0, by: 0, tx: 0, ty: 0 });
  }, []);

  // Called when player picks an ability from the draft
  const chooseDraftAbility = useCallback((id: string) => {
    const s = stateRef.current;
    s.abilities.add(id);
    s.paused = false;
    setUiAbilities([...s.abilities]);
    setDraftChoices(null);
  }, []);

  function triggerSwing(angle: number, phase: number) {
    const s = stateRef.current;
    const dur = s.abilities.has("swift_strikes") ? 160 : 300;
    if (phase === 0) s.swingDir = s.swingDir === 1 ? -1 : 1;
    s.sword = { angle, progress: 0, duration: dur, hitIds: new Set(), phase, dir: s.swingDir };
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    function screenToCanvas(cx: number, cy: number) {
      const rect = canvas.getBoundingClientRect();
      return {
        gx: (cx - rect.left) * (CANVAS_WIDTH / rect.width),
        gy: (cy - rect.top) * (CANVAS_HEIGHT / rect.height),
      };
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      stateRef.current.keys.add(e.key.toLowerCase());
      if (["arrowup","arrowdown","arrowleft","arrowright","w","a","s","d"," "].includes(e.key.toLowerCase()))
        e.preventDefault();
    };
    const handleKeyUp = (e: KeyboardEvent) => stateRef.current.keys.delete(e.key.toLowerCase());

    const handleMouseDown = (e: MouseEvent) => {
      const s = stateRef.current;
      if (s.dead || s.paused) return;
      const { gx, gy } = screenToCanvas(e.clientX, e.clientY);
      const dx = gx - s.player.x, dy = gy - s.player.y;
      const angle = Math.atan2(dy, dx);
      s.playerFacing = angle;
      if (s.sword === null) triggerSwing(angle, 0);
      else s.pendingSwing = true;
    };

    const handleTouchStart = (e: TouchEvent) => {
      e.preventDefault();
      const s = stateRef.current;
      if (s.dead || s.paused) return;
      const rect = canvas.getBoundingClientRect();
      const halfScreen = rect.left + rect.width / 2;

      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        const isLeftSide = t.clientX < halfScreen;

        if (isLeftSide && !joystickRef.current.active) {
          joystickRef.current.active = true;
          joystickRef.current.touchId = t.identifier;
          joystickRef.current.screenBX = t.clientX;
          joystickRef.current.screenBY = t.clientY;
          joystickRef.current.dx = 0;
          joystickRef.current.dy = 0;
          setJoystickVis({ active: true, bx: t.clientX, by: t.clientY, tx: t.clientX, ty: t.clientY });
        } else if (!isLeftSide) {
          const { gx, gy } = screenToCanvas(t.clientX, t.clientY);
          let angle = s.playerFacing;
          let closest = Infinity;
          s.mobs.forEach(mob => {
            if (mob.dying) return;
            const d = Math.hypot(mob.x - s.player.x, mob.y - s.player.y);
            if (d < closest) { closest = d; angle = Math.atan2(mob.y - s.player.y, mob.x - s.player.x); }
          });
          const tapDx = gx - s.player.x, tapDy = gy - s.player.y;
          if (Math.hypot(tapDx, tapDy) > 30) angle = Math.atan2(tapDy, tapDx);
          s.playerFacing = angle;
          if (s.sword === null) triggerSwing(angle, 0);
          else s.pendingSwing = true;
        }
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      const j = joystickRef.current;
      if (!j.active) return;
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.identifier !== j.touchId) continue;
        const rawDx = t.clientX - j.screenBX;
        const rawDy = t.clientY - j.screenBY;
        const dist = Math.hypot(rawDx, rawDy);
        const clamped = Math.min(dist, JOYSTICK_MAX_DIST);
        const factor = dist > 0 ? clamped / dist : 0;
        j.dx = rawDx / Math.max(dist, 1);
        j.dy = rawDy / Math.max(dist, 1);
        const tx = j.screenBX + rawDx * factor;
        const ty = j.screenBY + rawDy * factor;
        setJoystickVis({ active: true, bx: j.screenBX, by: j.screenBY, tx, ty });
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      e.preventDefault();
      const j = joystickRef.current;
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.identifier === j.touchId) {
          j.active = false; j.dx = 0; j.dy = 0; j.touchId = -1;
          setJoystickVis({ active: false, bx: 0, by: 0, tx: 0, ty: 0 });
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    canvas.addEventListener("mousedown", handleMouseDown);
    canvas.addEventListener("touchstart", handleTouchStart, { passive: false });
    canvas.addEventListener("touchmove", handleTouchMove, { passive: false });
    canvas.addEventListener("touchend", handleTouchEnd, { passive: false });
    canvas.addEventListener("touchcancel", handleTouchEnd, { passive: false });

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      canvas.removeEventListener("mousedown", handleMouseDown);
      canvas.removeEventListener("touchstart", handleTouchStart);
      canvas.removeEventListener("touchmove", handleTouchMove);
      canvas.removeEventListener("touchend", handleTouchEnd);
      canvas.removeEventListener("touchcancel", handleTouchEnd);
    };
  }, []);

  // ─── GAME LOOP ────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;

    function spawnParticles(x: number, y: number, color: string, count: number, speed = 3, sizeRange = 3) {
      const s = stateRef.current;
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = 1 + Math.random() * speed;
        s.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 30 + Math.random() * 20, maxLife: 50, color, size: 2 + Math.random() * sizeRange });
      }
    }

    // Triggers the draft: picks 2 random abilities the player doesn't have yet
    function triggerDraft() {
      const s = stateRef.current;
      const available = ABILITY_LIST.filter(a => !s.abilities.has(a.id));
      if (available.length === 0) return; // all abilities already owned
      // Shuffle and pick 2
      const shuffled = [...available].sort(() => Math.random() - 0.5);
      const choices = shuffled.slice(0, Math.min(2, shuffled.length));
      s.paused = true;
      setDraftChoices(choices.map(c => ({ id: c.id, name: c.name, icon: c.icon, desc: c.desc })));
    }

    function onMobKill(mob: Mob) {
      const s = stateRef.current;
      s.score += 1;
      s.vampiricKillTrack += 1;

      // Check if this kill hits a milestone
      const milestone = ABILITY_LIST.find(a => a.killsRequired === s.score && !s.abilities.has(a.id));
      if (milestone) {
        triggerDraft();
      }

      setUiScore(s.score);

      if (s.abilities.has("chain_lightning")) {
        const nearby = s.mobs.filter(m => !m.dying && m.id !== mob.id)
          .sort((a, b) => Math.hypot(a.x-mob.x,a.y-mob.y) - Math.hypot(b.x-mob.x,b.y-mob.y)).slice(0, 3);
        nearby.forEach(target => {
          if (Math.hypot(target.x-mob.x, target.y-mob.y) < 180) {
            target.hp -= 2;
            s.lightningBolts.push({ x1: mob.x, y1: mob.y, x2: target.x, y2: target.y, life: 15 });
            spawnParticles(target.x, target.y, "#a78bfa", 4);
            if (target.hp <= 0) { target.dying = true; target.dyingTimer = 0; }
          }
        });
      }
      if (s.abilities.has("explosive")) {
        s.mobs.forEach(other => {
          if (other.dying || other.id === mob.id) return;
          if (Math.hypot(other.x-mob.x, other.y-mob.y) < 80) {
            other.hp -= 3;
            spawnParticles(other.x, other.y, "#f97316", 6);
            if (other.hp <= 0) { other.dying = true; other.dyingTimer = 0; }
          }
        });
        spawnParticles(mob.x, mob.y, "#fbbf24", 16, 5, 4);
      }
      if (s.abilities.has("time_stop")) {
        s.mobs.forEach(other => {
          if (other.dying) return;
          if (Math.hypot(other.x-mob.x, other.y-mob.y) < 140) {
            other.frozen = Math.max(other.frozen, 1500);
            spawnParticles(other.x, other.y, "#7dd3fc", 5, 2);
          }
        });
      }
    }

    function processSwordHits(s: typeof stateRef.current) {
      if (!s.sword) return;
      const { angle, progress, hitIds, dir } = s.sword;
      const swordRange = BASE_SWORD_RANGE * (s.abilities.has("giant_sword") ? 1.75 : 1);
      let arcHalf = BASE_SWORD_ARC;
      if (s.abilities.has("wide_slash")) arcHalf *= 2;
      if (s.abilities.has("berserker")) arcHalf *= 1.5;
      const currentAngle = dir === 1
        ? (angle - arcHalf) + progress * arcHalf * 2
        : (angle + arcHalf) - progress * arcHalf * 2;

      s.mobs.forEach(mob => {
        if (mob.dying || hitIds.has(mob.id)) return;
        const dx = mob.x - s.player.x, dy = mob.y - s.player.y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        if (dist > swordRange + MOB_RADIUS) return;
        const mobAngle = Math.atan2(dy, dx);
        if (Math.abs(angleDiff(mobAngle, currentAngle)) < arcHalf * 0.5) {
          hitIds.add(mob.id);
          mob.hp -= 1;
          spawnParticles(mob.x, mob.y, "#ef4444", 5);
          s.damageNums.push({ x: mob.x, y: mob.y - 10, vy: -1.5, life: 45, text: "-1" });
          if (s.abilities.has("fire_blade"))
            s.fireTrails.push({ x: mob.x, y: mob.y, life: 120, maxLife: 120, radius: 20 });
          if (mob.hp <= 0) {
            mob.dying = true; mob.dyingTimer = 0;
            spawnParticles(mob.x, mob.y, "#f97316", 10);
            s.damageNums.push({ x: mob.x + (Math.random()-0.5)*20, y: mob.y-20, vy: -2, life: 60, text: "+1" });
            onMobKill(mob);
          }
        }
      });
    }

    function gameLoop(timestamp: number) {
      const dt = Math.min(timestamp - lastTimeRef.current, 50);
      lastTimeRef.current = timestamp;
      const s = stateRef.current;
      const j = joystickRef.current;

      // If paused (draft screen open), only draw — no game logic
      if (!s.dead && !s.paused) {
        s.gameTime += dt;
        s.invincible = Math.max(0, s.invincible - dt);

        if (s.abilities.has("whirlwind")) {
          s.whirlwindTimer -= dt;
          if (s.whirlwindTimer <= 0) {
            s.whirlwindTimer = 3000;
            for (let i = 0; i < 8; i++) {
              const a = (i/8) * Math.PI * 2;
              spawnParticles(s.player.x + Math.cos(a)*60, s.player.y + Math.sin(a)*60, "#a78bfa", 5, 3);
            }
            const sr = BASE_SWORD_RANGE * (s.abilities.has("giant_sword") ? 1.75 : 1);
            s.mobs.forEach(mob => {
              if (mob.dying) return;
              if (Math.hypot(mob.x-s.player.x, mob.y-s.player.y) < sr * 1.2) {
                mob.hp -= 2; spawnParticles(mob.x, mob.y, "#a78bfa", 8);
                s.damageNums.push({ x: mob.x, y: mob.y-12, vy: -2, life: 50, text: "🌪️-2", color: "#a78bfa" });
                if (mob.hp <= 0) { mob.dying = true; mob.dyingTimer = 0; onMobKill(mob); }
              }
            });
          }
        }

        let dx = 0, dy = 0;
        if (s.keys.has("a") || s.keys.has("arrowleft")) dx -= 1;
        if (s.keys.has("d") || s.keys.has("arrowright")) dx += 1;
        if (s.keys.has("w") || s.keys.has("arrowup")) dy -= 1;
        if (s.keys.has("s") || s.keys.has("arrowdown")) dy += 1;
        if (j.active) { dx = j.dx; dy = j.dy; }
        if (dx !== 0 && dy !== 0 && !j.active) { dx *= 0.707; dy *= 0.707; }

        s.moving = dx !== 0 || dy !== 0;
        if (s.moving) {
          s.legAnim += dt * 0.012;
          s.playerFacing = Math.atan2(dy, dx);
        }

        let speed = BASE_PLAYER_SPEED;
        if (s.abilities.has("speed")) speed *= 1.5;
        if (s.abilities.has("berserker")) speed *= 2;

        s.player.x = Math.max(PLAYER_RADIUS+2, Math.min(CANVAS_WIDTH-PLAYER_RADIUS-2, s.player.x + dx * speed));
        s.player.y = Math.max(PLAYER_RADIUS+2, Math.min(CANVAS_HEIGHT-PLAYER_RADIUS-2, s.player.y + dy * speed));

        if (s.sword !== null) {
          s.sword.progress += dt / s.sword.duration;
          processSwordHits(s);
          if (s.sword.progress >= 1) {
            const completedPhase = s.sword.phase;
            s.sword = null;
            if (s.abilities.has("double_strike") && completedPhase === 0) {
              triggerSwing(s.playerFacing + Math.PI * 0.3, 1);
            } else if (s.pendingSwing) {
              s.pendingSwing = false;
              triggerSwing(s.playerFacing, 0);
            }
          }
        }

        s.waveTimer += dt;
        if (s.waveTimer > 15000) {
          s.wave += 1; s.waveTimer = 0;
          s.spawnInterval = Math.max(350, MOB_SPAWN_INTERVAL - (s.wave-1)*100);
          setUiWave(s.wave);
        }

        if (timestamp - s.lastSpawn > s.spawnInterval) {
          s.lastSpawn = timestamp;
          const count = 1 + Math.floor(s.wave/3);
          for (let i = 0; i < count; i++) s.mobs.push(spawnMob(s.score));
        }

        s.fireTrails.forEach(fire => {
          if (Math.random() < 0.3) {
            s.mobs.forEach(mob => {
              if (mob.dying) return;
              if (Math.hypot(mob.x-fire.x, mob.y-fire.y) < fire.radius + MOB_RADIUS && Math.random() < 0.05) {
                mob.hp -= 1; spawnParticles(mob.x, mob.y, "#f97316", 3);
                if (mob.hp <= 0) { mob.dying = true; mob.dyingTimer = 0; onMobKill(mob); }
              }
            });
          }
          fire.life -= dt;
        });
        s.fireTrails = s.fireTrails.filter(f => f.life > 0);

        const mobSpeed = MOB_SPEED_BASE + s.wave * 0.04;
        s.mobs.forEach(mob => {
          if (mob.dying) { mob.dyingTimer += dt; return; }
          if (mob.frozen > 0) { mob.frozen -= dt; return; }
          const ddx = s.player.x - mob.x, ddy = s.player.y - mob.y;
          const dist = Math.sqrt(ddx*ddx + ddy*ddy);
          if (dist > 0) { mob.x += (ddx/dist)*mobSpeed; mob.y += (ddy/dist)*mobSpeed; }
          const invDur = s.abilities.has("iron_hide") ? 1600 : 800;
          if (s.invincible <= 0 && dist < PLAYER_RADIUS + MOB_RADIUS) {
            s.hp -= 1; s.invincible = invDur;
            spawnParticles(s.player.x, s.player.y, "#facc15", 8);
            setUiHp(s.hp);
            if (s.hp <= 0) { s.dead = true; setUiDead(true); }
          }
        });
        s.mobs = s.mobs.filter(m => !(m.dying && m.dyingTimer > 350));

        s.particles.forEach(p => { p.x+=p.vx; p.y+=p.vy; p.vx*=0.93; p.vy*=0.93; p.life-=1; });
        s.particles = s.particles.filter(p => p.life > 0);
        s.damageNums.forEach(d => { d.y+=d.vy; d.life-=1; });
        s.damageNums = s.damageNums.filter(d => d.life > 0);
        s.lightningBolts.forEach(b => { b.life-=1; });
        s.lightningBolts = s.lightningBolts.filter(b => b.life > 0);
      }

      drawGame(ctx, s, timestamp);
      animRef.current = requestAnimationFrame(gameLoop);
    }

    animRef.current = requestAnimationFrame(gameLoop);
    return () => cancelAnimationFrame(animRef.current);
  }, []);

  // ─── DRAWING ──────────────────────────────────────────────────────────────
  function getSwordColors(abilities: Set<string>) {
    if (abilities.has("berserker"))       return { blade: "#ff0080", glow: "#ff0080", arc: "#ff00ff" };
    if (abilities.has("fire_blade"))      return { blade: "#fb923c", glow: "#f97316", arc: "#fbbf24" };
    if (abilities.has("chain_lightning")) return { blade: "#c4b5fd", glow: "#a78bfa", arc: "#818cf8" };
    return { blade: "#fef3c7", glow: "#fbbf24", arc: "#fbbf24" };
  }

  function drawPlayer(ctx: CanvasRenderingContext2D, px: number, py: number, facing: number, legAnim: number, invincible: number, ts: number, abilities: Set<string>) {
    ctx.save();
    ctx.translate(px, py);

    if (abilities.has("berserker")) {
      ctx.globalAlpha = 0.25 + 0.1 * Math.sin(ts * 0.01);
      ctx.fillStyle = "#ff0080";
      ctx.beginPath(); ctx.arc(0, 0, 28, 0, Math.PI*2); ctx.fill();
    }
    if (abilities.has("fire_blade")) {
      ctx.globalAlpha = 0.2 + 0.08 * Math.sin(ts * 0.008);
      ctx.fillStyle = "#f97316";
      ctx.beginPath(); ctx.arc(0, 0, 26, 0, Math.PI*2); ctx.fill();
    }
    if (abilities.has("chain_lightning")) {
      ctx.globalAlpha = 0.15 + 0.08 * Math.sin(ts * 0.012);
      ctx.fillStyle = "#a78bfa";
      ctx.beginPath(); ctx.arc(0, 0, 26, 0, Math.PI*2); ctx.fill();
    }
    ctx.globalAlpha = 1;

    if (invincible > 0 && Math.floor(ts / 80) % 2 === 0) {
      ctx.globalAlpha = 0.7;
      ctx.fillStyle = "#fbbf24";
      ctx.beginPath(); ctx.arc(0, 0, 22, 0, Math.PI*2); ctx.fill();
      ctx.globalAlpha = 1;
    }

    ctx.rotate(facing + Math.PI / 2);
    const ls = Math.sin(legAnim) * 5;

    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.beginPath(); ctx.ellipse(0, 4, 12, 6, 0, 0, Math.PI*2); ctx.fill();

    ctx.strokeStyle = "#374151"; ctx.lineWidth = 5; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(-4, 4); ctx.lineTo(-5 - ls*0.4, 14); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(4, 4); ctx.lineTo(5 + ls*0.4, 14); ctx.stroke();

    ctx.fillStyle = "#1f2937";
    ctx.beginPath(); ctx.ellipse(-5 - ls*0.4, 15, 4, 3, -0.3, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(5 + ls*0.4, 15, 4, 3, 0.3, 0, Math.PI*2); ctx.fill();

    ctx.fillStyle = abilities.has("berserker") ? "#dc2626" : abilities.has("fire_blade") ? "#b45309" : "#1d4ed8";
    ctx.strokeStyle = abilities.has("berserker") ? "#fca5a5" : abilities.has("fire_blade") ? "#fbbf24" : "#bfdbfe";
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.roundRect(-7, -4, 14, 16, 3); ctx.fill(); ctx.stroke();

    ctx.strokeStyle = "#92400e"; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(-7, 2); ctx.lineTo(-14, 8 + ls*0.3); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(7, 2); ctx.lineTo(14, 8 - ls*0.3); ctx.stroke();
    ctx.fillStyle = "#fcd9a8";
    ctx.beginPath(); ctx.arc(-14, 8 + ls*0.3, 3.5, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(14, 8 - ls*0.3, 3.5, 0, Math.PI*2); ctx.fill();

    ctx.fillStyle = "#fcd9a8"; ctx.strokeStyle = "#d97706"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(0, -8, 9, 0, Math.PI*2); ctx.fill(); ctx.stroke();

    ctx.fillStyle = "#78350f";
    ctx.beginPath(); ctx.ellipse(0, -14, 7, 4, 0, 0, Math.PI*2); ctx.fill();

    ctx.fillStyle = "#1f2937";
    ctx.beginPath(); ctx.arc(-3, -8, 1.5, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(3, -8, 1.5, 0, Math.PI*2); ctx.fill();

    ctx.restore();
  }

  function drawMob(ctx: CanvasRenderingContext2D, mob: Mob, ts: number) {
    const alpha = mob.dying ? Math.max(0, 1 - mob.dyingTimer / 350) : 1;
    ctx.globalAlpha = alpha;
    const bob = Math.sin(ts * 0.003 + mob.id) * 1.5;

    if (mob.frozen > 0) {
      ctx.fillStyle = "rgba(125,211,252,0.4)";
      ctx.beginPath(); ctx.arc(mob.x, mob.y + bob, MOB_RADIUS + 4, 0, Math.PI*2); ctx.fill();
    }

    const g = ctx.createRadialGradient(mob.x-4, mob.y-4+bob, 2, mob.x, mob.y+bob, MOB_RADIUS);
    g.addColorStop(0, mob.frozen > 0 ? "#bae6fd" : "#ef4444");
    g.addColorStop(1, mob.frozen > 0 ? "#0ea5e9" : "#7f1d1d");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(mob.x, mob.y+bob, MOB_RADIUS, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = mob.frozen > 0 ? "#7dd3fc" : "#fca5a5"; ctx.lineWidth = 1.5; ctx.stroke();

    ctx.fillStyle = "#fbbf24";
    ctx.beginPath(); ctx.moveTo(mob.x-6, mob.y - MOB_RADIUS*0.5+bob); ctx.lineTo(mob.x-3, mob.y - MOB_RADIUS*1.1+bob); ctx.lineTo(mob.x, mob.y - MOB_RADIUS*0.5+bob); ctx.fill();
    ctx.beginPath(); ctx.moveTo(mob.x, mob.y - MOB_RADIUS*0.5+bob); ctx.lineTo(mob.x+3, mob.y - MOB_RADIUS*1.1+bob); ctx.lineTo(mob.x+6, mob.y - MOB_RADIUS*0.5+bob); ctx.fill();

    ctx.fillStyle = "#fff200";
    ctx.beginPath(); ctx.arc(mob.x-5, mob.y-2+bob, 3, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(mob.x+5, mob.y-2+bob, 3, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = "#000";
    ctx.beginPath(); ctx.arc(mob.x-4, mob.y-2+bob, 1.5, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(mob.x+6, mob.y-2+bob, 1.5, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(mob.x, mob.y+4+bob, 4, 0.2, Math.PI-0.2); ctx.stroke();

    if (!mob.dying && mob.maxHp > 1) {
      const bx = mob.x - MOB_RADIUS, by = mob.y - MOB_RADIUS - 10 + bob;
      ctx.fillStyle = "#450a0a"; ctx.fillRect(bx, by, MOB_RADIUS*2, 4);
      ctx.fillStyle = "#22c55e"; ctx.fillRect(bx, by, MOB_RADIUS*2*(mob.hp/mob.maxHp), 4);
    }
    ctx.globalAlpha = 1;
  }

  function drawGame(ctx: CanvasRenderingContext2D, s: typeof stateRef.current, ts: number) {
    ctx.fillStyle = "#0f0f1a"; ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    ctx.strokeStyle = "rgba(255,255,255,0.035)"; ctx.lineWidth = 1;
    for (let x = 0; x < CANVAS_WIDTH; x += 60) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,CANVAS_HEIGHT); ctx.stroke(); }
    for (let y = 0; y < CANVAS_HEIGHT; y += 60) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(CANVAS_WIDTH,y); ctx.stroke(); }

    ctx.strokeStyle = "#4a3f6b"; ctx.lineWidth = 8; ctx.strokeRect(4,4,CANVAS_WIDTH-8,CANVAS_HEIGHT-8);
    ctx.strokeStyle = "#6b5fa0"; ctx.lineWidth = 2; ctx.strokeRect(10,10,CANVAS_WIDTH-20,CANVAS_HEIGHT-20);

    s.fireTrails.forEach(fire => {
      const a = fire.life / fire.maxLife;
      const grad = ctx.createRadialGradient(fire.x, fire.y, 0, fire.x, fire.y, fire.radius);
      grad.addColorStop(0, `rgba(251,146,60,${a*0.8})`);
      grad.addColorStop(0.5, `rgba(239,68,68,${a*0.5})`);
      grad.addColorStop(1, "transparent");
      ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(fire.x, fire.y, fire.radius, 0, Math.PI*2); ctx.fill();
    });

    s.lightningBolts.forEach(bolt => {
      ctx.globalAlpha = bolt.life / 15;
      ctx.strokeStyle = "#c4b5fd"; ctx.lineWidth = 2;
      ctx.shadowBlur = 10; ctx.shadowColor = "#a78bfa";
      ctx.beginPath(); ctx.moveTo(bolt.x1, bolt.y1);
      ctx.lineTo((bolt.x1+bolt.x2)/2 + (Math.random()-0.5)*30, (bolt.y1+bolt.y2)/2 + (Math.random()-0.5)*30);
      ctx.lineTo(bolt.x2, bolt.y2); ctx.stroke();
      ctx.shadowBlur = 0; ctx.globalAlpha = 1;
    });

    s.particles.forEach(p => {
      ctx.globalAlpha = p.life / p.maxLife;
      ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI*2); ctx.fill();
    });
    ctx.globalAlpha = 1;

    s.mobs.forEach(mob => drawMob(ctx, mob, ts));

    if (s.sword !== null) {
      const { angle, progress, dir } = s.sword;
      const swordRange = BASE_SWORD_RANGE * (s.abilities.has("giant_sword") ? 1.75 : 1);
      let arcHalf = BASE_SWORD_ARC;
      if (s.abilities.has("wide_slash")) arcHalf *= 2;
      if (s.abilities.has("berserker")) arcHalf *= 1.5;
      const startAng = dir === 1 ? angle - arcHalf : angle + arcHalf;
      const endAng   = dir === 1 ? angle + arcHalf : angle - arcHalf;
      const currentAng = dir === 1
        ? (angle - arcHalf) + progress * arcHalf * 2
        : (angle + arcHalf) - progress * arcHalf * 2;
      const colors = getSwordColors(s.abilities);
      const fade = 1 - progress * 0.5;

      ctx.save();
      ctx.translate(s.player.x, s.player.y);

      ctx.globalAlpha = 0.35 * fade;
      ctx.strokeStyle = colors.arc;
      ctx.lineWidth = 12;
      ctx.lineCap = "round";
      ctx.shadowBlur = 18;
      ctx.shadowColor = colors.glow;
      ctx.beginPath();
      if (dir === 1) ctx.arc(0, 0, swordRange * 0.8, startAng, currentAng, false);
      else           ctx.arc(0, 0, swordRange * 0.8, startAng, currentAng, true);
      ctx.stroke();
      ctx.shadowBlur = 0;

      ctx.globalAlpha = fade;
      ctx.rotate(currentAng);

      const bladeLen = swordRange - PLAYER_RADIUS - 2;
      const baseX = PLAYER_RADIUS + 2;

      ctx.shadowBlur = 16;
      ctx.shadowColor = colors.glow;

      ctx.beginPath();
      ctx.moveTo(baseX + 12, -4);
      ctx.lineTo(baseX + bladeLen, 0);
      ctx.lineTo(baseX + 12, 4);
      ctx.closePath();
      const bladeGrad = ctx.createLinearGradient(baseX + 12, 0, baseX + bladeLen, 0);
      bladeGrad.addColorStop(0, colors.blade);
      bladeGrad.addColorStop(1, "#ffffff");
      ctx.fillStyle = bladeGrad;
      ctx.fill();

      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(baseX + 12, 0);
      ctx.lineTo(baseX + bladeLen - 2, 0);
      ctx.stroke();

      ctx.shadowBlur = 0;

      ctx.fillStyle = "#9ca3af";
      ctx.fillRect(baseX + 8, -8, 5, 16);
      ctx.strokeStyle = "#d1d5db";
      ctx.lineWidth = 1;
      ctx.strokeRect(baseX + 8, -8, 5, 16);

      ctx.fillStyle = "#78350f";
      ctx.beginPath();
      ctx.roundRect(baseX - 2, -3, 12, 6, 2);
      ctx.fill();
      ctx.strokeStyle = "#d97706";
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = "#d4af37";
      ctx.beginPath();
      ctx.arc(baseX - 3, 0, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#fef3c7";
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.globalAlpha = 1;
      ctx.restore();
    }

    drawPlayer(ctx, s.player.x, s.player.y, s.playerFacing, s.legAnim, s.invincible, ts, s.abilities);

    s.damageNums.forEach(d => {
      ctx.globalAlpha = Math.min(1, d.life/40);
      ctx.fillStyle = d.color ?? (d.text.startsWith("+") ? "#4ade80" : "#f87171");
      ctx.font = `bold ${d.text.length > 3 ? 13 : 15}px monospace`;
      ctx.textAlign = "center"; ctx.fillText(d.text, d.x, d.y);
    });
    ctx.globalAlpha = 1; ctx.textAlign = "left";

    // Draw paused overlay on canvas
    if (s.paused && !s.dead) {
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    }

    if (s.dead) {
      ctx.fillStyle = "rgba(0,0,0,0.65)";
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    }
  }

  const abilityMeta = ABILITY_LIST.reduce<Record<string, typeof ABILITY_LIST[0]>>((acc, a) => { acc[a.id] = a; return acc; }, {});

  // Next milestone
  const nextMilestone = ABILITY_LIST.find(a => !uiAbilities.includes(a.id));

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-950 select-none overflow-hidden">
      {/* HUD */}
      <div className="mb-1 flex items-center gap-4 text-white flex-wrap justify-center px-2">
        <div className="flex items-center gap-1">
          <span className="text-gray-400 text-xs font-mono">WAVE</span>
          <span className="text-purple-400 font-bold text-lg font-mono">{uiWave}</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-gray-400 text-xs font-mono">KILLS</span>
          <span className="text-yellow-400 font-bold text-lg font-mono">{uiScore}</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-gray-400 text-xs font-mono">HP</span>
          <div className="flex gap-0.5">
            {Array.from({ length: uiMaxHp }).map((_, i) => (
              <div key={i} className={`w-3.5 h-3.5 rounded-sm transition-colors ${i < uiHp ? "bg-red-500" : "bg-gray-700"}`} />
            ))}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-gray-400 text-xs font-mono">NEXT</span>
          <span className="text-green-400 font-bold text-xs font-mono">
            {nextMilestone ? `@${nextMilestone.killsRequired}` : "MAX"}
          </span>
        </div>
      </div>

      {/* Abilities bar */}
      {uiAbilities.length > 0 && (
        <div className="mb-1 flex gap-1 flex-wrap justify-center px-2" style={{ maxWidth: CANVAS_WIDTH * scale }}>
          {uiAbilities.map(id => {
            const a = abilityMeta[id];
            if (!a) return null;
            return (
              <div key={id} title={`${a.name}: ${a.desc}`}
                className="flex items-center gap-0.5 px-1.5 py-0.5 bg-gray-800 border border-purple-700 rounded text-xs text-purple-200 font-mono">
                <span>{a.icon}</span><span className="hidden sm:inline">{a.name}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Canvas */}
      <div
        ref={containerRef}
        className="relative"
        style={{ width: CANVAS_WIDTH * scale, height: CANVAS_HEIGHT * scale }}
      >
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          className="block rounded-lg border-2 border-purple-900 cursor-crosshair touch-none"
          style={{ width: CANVAS_WIDTH * scale, height: CANVAS_HEIGHT * scale }}
        />

        {/* Virtual joystick */}
        {joystickVis.active && (
          <>
            <div
              className="absolute pointer-events-none rounded-full border-2 border-white/30 bg-white/5"
              style={{
                width: JOYSTICK_MAX_DIST * 2, height: JOYSTICK_MAX_DIST * 2,
                left: joystickVis.bx - JOYSTICK_MAX_DIST, top: joystickVis.by - JOYSTICK_MAX_DIST,
                position: "fixed",
              }}
            />
            <div
              className="absolute pointer-events-none rounded-full bg-white/40 border-2 border-white/60"
              style={{
                width: 44, height: 44,
                left: joystickVis.tx - 22, top: joystickVis.ty - 22,
                position: "fixed",
              }}
            />
          </>
        )}

        {/* ── ABILITY DRAFT OVERLAY ── */}
        {draftChoices && (
          <div className="absolute inset-0 flex flex-col items-center justify-center z-20 pointer-events-auto">
            {/* Header */}
            <div className="mb-4 text-center">
              <div className="text-yellow-400 font-mono font-bold text-xl tracking-widest drop-shadow">
                ⚔️ CHOOSE AN ABILITY
              </div>
              <div className="text-gray-400 font-mono text-xs mt-1">{uiScore} kills</div>
            </div>

            {/* Buttons */}
            <div className="flex gap-4 flex-wrap justify-center px-4">
              {draftChoices.map(choice => (
                <button
                  key={choice.id}
                  onClick={() => chooseDraftAbility(choice.id)}
                  className="
                    group flex flex-col items-center gap-2 px-6 py-4
                    bg-gray-900 border-2 border-gray-600
                    hover:border-yellow-400 hover:bg-gray-800
                    rounded-xl font-mono transition-all duration-150
                    min-w-[140px] shadow-lg
                    active:scale-95
                  "
                >
                  <span className="text-4xl">{choice.icon}</span>
                  <span className="text-white font-bold text-sm text-center leading-tight">{choice.name}</span>
                  <span className="text-gray-400 text-xs text-center leading-snug">{choice.desc}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Death screen */}
        {uiDead && (
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none z-30">
            <div className="text-center pointer-events-auto">
              <h2 className="text-4xl font-bold text-red-500 mb-2 font-mono tracking-widest drop-shadow-lg">YOU DIED</h2>
              <p className="text-yellow-400 text-lg font-mono mb-1">Kills: {uiScore}</p>
              <p className="text-purple-400 font-mono mb-2">Wave: {uiWave}</p>
              {uiAbilities.length > 0 && (
                <p className="text-gray-300 text-sm font-mono mb-4">
                  {uiAbilities.map(id => abilityMeta[id]?.icon).join(" ")}
                </p>
              )}
              <button onClick={restartGame}
                className="px-8 py-3 bg-purple-700 hover:bg-purple-600 text-white font-bold font-mono rounded-lg text-lg border border-purple-400 transition-colors">
                PLAY AGAIN
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Control hints */}
      <div className="mt-2 flex gap-6 text-gray-500 text-xs font-mono flex-wrap justify-center px-2">
        <span className="hidden sm:inline">WASD — Move</span>
        <span className="hidden sm:inline">CLICK — Swing sword</span>
        <span className="sm:hidden">Left side — Joystick</span>
        <span className="sm:hidden">Right side — Attack</span>
        <span>Choose an ability every milestone!</span>
      </div>
    </div>
  );
}