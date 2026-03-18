import { useEffect, useRef, useState, useCallback } from "react";

const CANVAS_WIDTH = 900;
const CANVAS_HEIGHT = 650;
const BASE_PLAYER_SPEED = 3.5;
const PLAYER_RADIUS = 16;
const MOB_RADIUS = 14;
const BASE_SWORD_RANGE = 80;
const BASE_SWORD_ARC = Math.PI / 3;
const MOB_SPEED_BASE = 1.2;
const MOB_SPAWN_INTERVAL = 1500;

// Abilities in order of unlock (every 5 kills)
const ABILITY_LIST: { id: string; name: string; icon: string; desc: string; killsRequired: number }[] = [
  { id: "speed",        name: "Swift Feet",      icon: "💨", desc: "+50% movement speed",           killsRequired: 5  },
  { id: "wide_slash",   name: "Wide Slash",       icon: "⚔️",  desc: "Sword arc doubled",             killsRequired: 10 },
  { id: "fire_blade",   name: "Fire Blade",       icon: "🔥", desc: "Sword leaves burning fire",      killsRequired: 15 },
  { id: "life_steal",   name: "Life Steal",       icon: "🩸", desc: "Every kill restores HP",         killsRequired: 20 },
  { id: "chain_lightning", name: "Chain Lightning", icon: "⚡", desc: "Kills arc to nearby enemies",  killsRequired: 25 },
  { id: "giant_sword",  name: "Giant Sword",      icon: "🗡️",  desc: "+75% sword reach",              killsRequired: 30 },
  { id: "whirlwind",    name: "Whirlwind",        icon: "🌪️", desc: "Auto spin-attack every 3s",     killsRequired: 35 },
  { id: "explosive",    name: "Explosive Death",  icon: "💥", desc: "Enemies explode on death",      killsRequired: 40 },
  { id: "swift_strikes",name: "Swift Strikes",    icon: "⚡", desc: "Swing speed doubled",           killsRequired: 45 },
  { id: "double_strike",name: "Double Strike",    icon: "✌️",  desc: "Two swings per click",          killsRequired: 50 },
  { id: "iron_hide",    name: "Iron Hide",        icon: "🛡️",  desc: "2x invincibility time",         killsRequired: 55 },
  { id: "time_stop",    name: "Time Stop",        icon: "⏳", desc: "Kills freeze nearby mobs",      killsRequired: 60 },
  { id: "vampiric",     name: "Vampiric Aura",    icon: "🧛", desc: "Heal 2 HP every 10 kills",      killsRequired: 70 },
  { id: "berserker",    name: "Berserker",        icon: "😤", desc: "Triple sword arc, 2x speed",    killsRequired: 80 },
];

interface Mob {
  id: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  dying: boolean;
  dyingTimer: number;
  frozen: number;
}

interface SwordSwing {
  angle: number;
  progress: number;
  duration: number;
  hitIds: Set<number>;
  phase: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
  type?: string;
}

interface DamageNumber {
  x: number;
  y: number;
  vy: number;
  life: number;
  text: string;
  color?: string;
}

interface FireTrail {
  x: number;
  y: number;
  life: number;
  maxLife: number;
  radius: number;
}

interface LightningBolt {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  life: number;
}

interface AbilityNotif {
  name: string;
  icon: string;
  desc: string;
  timer: number;
}

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
    score: 0,
    hp: 5,
    maxHp: 5,
    dead: false,
    lastSpawn: 0,
    spawnInterval: MOB_SPAWN_INTERVAL,
    wave: 1,
    waveTimer: 0,
    gameTime: 0,
    invincible: 0,
    abilities: new Set<string>(),
    abilityNotif: null as AbilityNotif | null,
    whirlwindTimer: 0,
    vampiricKillTrack: 0,
    moving: false,
    playerVx: 0,
    playerVy: 0,
  });
  const animRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const [uiScore, setUiScore] = useState(0);
  const [uiHp, setUiHp] = useState(5);
  const [uiMaxHp, setUiMaxHp] = useState(5);
  const [uiDead, setUiDead] = useState(false);
  const [uiWave, setUiWave] = useState(1);
  const [uiAbilities, setUiAbilities] = useState<string[]>([]);
  const [uiNotif, setUiNotif] = useState<AbilityNotif | null>(null);

  const restartGame = useCallback(() => {
    const s = stateRef.current;
    s.player = { x: CANVAS_WIDTH / 2, y: CANVAS_HEIGHT / 2 };
    s.playerFacing = 0;
    s.legAnim = 0;
    s.mobs = [];
    s.particles = [];
    s.damageNums = [];
    s.fireTrails = [];
    s.lightningBolts = [];
    s.sword = null;
    s.pendingSwing = false;
    s.score = 0;
    s.hp = 5;
    s.maxHp = 5;
    s.dead = false;
    s.lastSpawn = 0;
    s.spawnInterval = MOB_SPAWN_INTERVAL;
    s.wave = 1;
    s.waveTimer = 0;
    s.gameTime = 0;
    s.invincible = 0;
    s.abilities = new Set();
    s.abilityNotif = null;
    s.whirlwindTimer = 0;
    s.vampiricKillTrack = 0;
    s.moving = false;
    mobIdCounter = 0;
    setUiScore(0);
    setUiHp(5);
    setUiMaxHp(5);
    setUiDead(false);
    setUiWave(1);
    setUiAbilities([]);
    setUiNotif(null);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      stateRef.current.keys.add(e.key.toLowerCase());
      if (["arrowup","arrowdown","arrowleft","arrowright","w","a","s","d"," "].includes(e.key.toLowerCase())) {
        e.preventDefault();
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      stateRef.current.keys.delete(e.key.toLowerCase());
    };

    const handleMouseDown = (e: MouseEvent) => {
      const s = stateRef.current;
      if (s.dead) return;
      const rect = canvas.getBoundingClientRect();
      const mx = (e.clientX - rect.left) * (CANVAS_WIDTH / rect.width);
      const my = (e.clientY - rect.top) * (CANVAS_HEIGHT / rect.height);
      const dx = mx - s.player.x;
      const dy = my - s.player.y;
      const angle = Math.atan2(dy, dx);
      s.playerFacing = angle;
      if (s.sword === null) {
        triggerSwing(angle, 0);
      } else {
        s.pendingSwing = true;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    canvas.addEventListener("mousedown", handleMouseDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      canvas.removeEventListener("mousedown", handleMouseDown);
    };
  }, []);

  function triggerSwing(angle: number, phase: number) {
    const s = stateRef.current;
    const dur = s.abilities.has("swift_strikes") ? 160 : 300;
    s.sword = { angle, progress: 0, duration: dur, hitIds: new Set(), phase };
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;

    function spawnParticles(x: number, y: number, color: string, count: number, speed = 3, sizeRange = 3) {
      const s = stateRef.current;
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const sp = 1 + Math.random() * speed;
        s.particles.push({
          x, y,
          vx: Math.cos(angle) * sp,
          vy: Math.sin(angle) * sp,
          life: 30 + Math.random() * 20,
          maxLife: 50,
          color, size: 2 + Math.random() * sizeRange,
        });
      }
    }

    function grantAbility(kills: number) {
      const s = stateRef.current;
      const toGrant = ABILITY_LIST.find(a => a.killsRequired === kills && !s.abilities.has(a.id));
      if (!toGrant) return;
      s.abilities.add(toGrant.id);
      s.abilityNotif = { name: toGrant.name, icon: toGrant.icon, desc: toGrant.desc, timer: 3000 };
      setUiAbilities([...s.abilities]);
      setUiNotif(s.abilityNotif);
    }

    function onMobKill(mob: Mob) {
      const s = stateRef.current;
      s.score += 1;
      s.vampiricKillTrack += 1;

      // Check ability unlocks
      grantAbility(s.score);

      // Life steal
      if (s.abilities.has("life_steal") && Math.random() < 0.5) {
        s.hp = Math.min(s.maxHp, s.hp + 1);
        s.damageNums.push({ x: s.player.x, y: s.player.y - 30, vy: -1.5, life: 50, text: "+1 HP", color: "#4ade80" });
        setUiHp(s.hp);
      }

      // Vampiric: heal 2 every 10 kills
      if (s.abilities.has("vampiric") && s.vampiricKillTrack >= 10) {
        s.vampiricKillTrack = 0;
        s.hp = Math.min(s.maxHp, s.hp + 2);
        s.damageNums.push({ x: s.player.x, y: s.player.y - 40, vy: -2, life: 60, text: "+2 HP", color: "#c084fc" });
        setUiHp(s.hp);
      }

      // Chain lightning
      if (s.abilities.has("chain_lightning")) {
        const nearby = s.mobs.filter(m => !m.dying && m.id !== mob.id).sort((a, b) => {
          const da = Math.hypot(a.x - mob.x, a.y - mob.y);
          const db = Math.hypot(b.x - mob.x, b.y - mob.y);
          return da - db;
        }).slice(0, 3);
        nearby.forEach(target => {
          const dist = Math.hypot(target.x - mob.x, target.y - mob.y);
          if (dist < 180) {
            target.hp -= 2;
            s.lightningBolts.push({ x1: mob.x, y1: mob.y, x2: target.x, y2: target.y, life: 15 });
            spawnParticles(target.x, target.y, "#a78bfa", 4);
            if (target.hp <= 0) { target.dying = true; target.dyingTimer = 0; }
          }
        });
      }

      // Explosive death
      if (s.abilities.has("explosive")) {
        s.mobs.forEach(other => {
          if (other.dying || other.id === mob.id) return;
          const dist = Math.hypot(other.x - mob.x, other.y - mob.y);
          if (dist < 80) {
            other.hp -= 3;
            spawnParticles(other.x, other.y, "#f97316", 6);
            if (other.hp <= 0) { other.dying = true; other.dyingTimer = 0; }
          }
        });
        spawnParticles(mob.x, mob.y, "#fbbf24", 16, 5, 4);
        spawnParticles(mob.x, mob.y, "#f97316", 12, 4, 3);
      }

      // Time stop: freeze nearby
      if (s.abilities.has("time_stop")) {
        s.mobs.forEach(other => {
          if (other.dying) return;
          const dist = Math.hypot(other.x - mob.x, other.y - mob.y);
          if (dist < 140) {
            other.frozen = Math.max(other.frozen, 1500);
            spawnParticles(other.x, other.y, "#7dd3fc", 5, 2);
          }
        });
      }

      setUiScore(s.score);
    }

    function processSwordHits(s: typeof stateRef.current) {
      if (!s.sword) return;
      const { angle, progress, hitIds } = s.sword;
      const swordRange = BASE_SWORD_RANGE * (s.abilities.has("giant_sword") ? 1.75 : 1);
      let arcHalf = BASE_SWORD_ARC;
      if (s.abilities.has("wide_slash")) arcHalf *= 2;
      if (s.abilities.has("berserker")) arcHalf *= 1.5;
      const startAngle = angle - arcHalf;
      const currentAngle = startAngle + progress * arcHalf * 2;

      s.mobs.forEach(mob => {
        if (mob.dying || hitIds.has(mob.id)) return;
        const dx = mob.x - s.player.x;
        const dy = mob.y - s.player.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > swordRange + MOB_RADIUS) return;
        const mobAngle = Math.atan2(dy, dx);
        if (Math.abs(angleDiff(mobAngle, currentAngle)) < arcHalf * 0.5) {
          hitIds.add(mob.id);
          mob.hp -= 1;
          spawnParticles(mob.x, mob.y, "#ef4444", 5);
          s.damageNums.push({ x: mob.x, y: mob.y - 10, vy: -1.5, life: 45, text: "-1" });

          // Fire blade: add fire trail
          if (s.abilities.has("fire_blade")) {
            s.fireTrails.push({ x: mob.x, y: mob.y, life: 120, maxLife: 120, radius: 20 });
          }

          if (mob.hp <= 0) {
            mob.dying = true;
            mob.dyingTimer = 0;
            spawnParticles(mob.x, mob.y, "#f97316", 10);
            s.damageNums.push({ x: mob.x + (Math.random() - 0.5) * 20, y: mob.y - 20, vy: -2, life: 60, text: "+1" });
            onMobKill(mob);
          }
        }
      });
    }

    function gameLoop(timestamp: number) {
      const dt = Math.min(timestamp - lastTimeRef.current, 50);
      lastTimeRef.current = timestamp;
      const s = stateRef.current;

      if (!s.dead) {
        s.gameTime += dt;
        s.invincible = Math.max(0, s.invincible - dt);

        // Whirlwind timer
        if (s.abilities.has("whirlwind")) {
          s.whirlwindTimer -= dt;
          if (s.whirlwindTimer <= 0) {
            s.whirlwindTimer = 3000;
            // Spawn a full-circle attack
            for (let i = 0; i < 8; i++) {
              const angle = (i / 8) * Math.PI * 2;
              spawnParticles(
                s.player.x + Math.cos(angle) * 60,
                s.player.y + Math.sin(angle) * 60,
                "#a78bfa", 5, 3
              );
            }
            const swordRange = BASE_SWORD_RANGE * (s.abilities.has("giant_sword") ? 1.75 : 1);
            s.mobs.forEach(mob => {
              if (mob.dying) return;
              const dist = Math.hypot(mob.x - s.player.x, mob.y - s.player.y);
              if (dist < swordRange * 1.2) {
                mob.hp -= 2;
                spawnParticles(mob.x, mob.y, "#a78bfa", 8);
                s.damageNums.push({ x: mob.x, y: mob.y - 12, vy: -2, life: 50, text: "🌪️-2", color: "#a78bfa" });
                if (mob.hp <= 0) { mob.dying = true; mob.dyingTimer = 0; onMobKill(mob); }
              }
            });
          }
        }

        // Movement
        let dx = 0, dy = 0;
        if (s.keys.has("a") || s.keys.has("arrowleft")) dx -= 1;
        if (s.keys.has("d") || s.keys.has("arrowright")) dx += 1;
        if (s.keys.has("w") || s.keys.has("arrowup")) dy -= 1;
        if (s.keys.has("s") || s.keys.has("arrowdown")) dy += 1;
        if (dx !== 0 && dy !== 0) { dx *= 0.707; dy *= 0.707; }

        s.moving = dx !== 0 || dy !== 0;
        if (s.moving) {
          s.legAnim += dt * 0.012;
          s.playerFacing = Math.atan2(dy, dx);
        }

        let speed = BASE_PLAYER_SPEED;
        if (s.abilities.has("speed")) speed *= 1.5;
        if (s.abilities.has("berserker")) speed *= 2;

        s.playerVx = dx * speed;
        s.playerVy = dy * speed;
        s.player.x = Math.max(PLAYER_RADIUS + 2, Math.min(CANVAS_WIDTH - PLAYER_RADIUS - 2, s.player.x + s.playerVx));
        s.player.y = Math.max(PLAYER_RADIUS + 2, Math.min(CANVAS_HEIGHT - PLAYER_RADIUS - 2, s.player.y + s.playerVy));

        // Sword progress
        if (s.sword !== null) {
          s.sword.progress += dt / s.sword.duration;
          processSwordHits(s);
          if (s.sword.progress >= 1) {
            const completedPhase = s.sword.phase;
            s.sword = null;
            // Double strike: auto-trigger second swing
            if (s.abilities.has("double_strike") && completedPhase === 0) {
              triggerSwing(s.playerFacing + Math.PI * 0.3, 1);
            } else if (s.pendingSwing) {
              s.pendingSwing = false;
              triggerSwing(s.playerFacing, 0);
            }
          }
        }

        // Wave system
        s.waveTimer += dt;
        if (s.waveTimer > 15000) {
          s.wave += 1;
          s.waveTimer = 0;
          s.spawnInterval = Math.max(350, MOB_SPAWN_INTERVAL - (s.wave - 1) * 100);
          setUiWave(s.wave);
        }

        // Mob spawning
        if (timestamp - s.lastSpawn > s.spawnInterval) {
          s.lastSpawn = timestamp;
          const count = 1 + Math.floor(s.wave / 3);
          for (let i = 0; i < count; i++) s.mobs.push(spawnMob(s.score));
        }

        // Fire trail damage
        s.fireTrails.forEach(fire => {
          if (Math.random() < 0.3) {
            s.mobs.forEach(mob => {
              if (mob.dying) return;
              if (Math.hypot(mob.x - fire.x, mob.y - fire.y) < fire.radius + MOB_RADIUS) {
                if (Math.random() < 0.05) {
                  mob.hp -= 1;
                  spawnParticles(mob.x, mob.y, "#f97316", 3);
                  if (mob.hp <= 0) { mob.dying = true; mob.dyingTimer = 0; onMobKill(mob); }
                }
              }
            });
          }
          fire.life -= dt;
        });
        s.fireTrails = s.fireTrails.filter(f => f.life > 0);

        // Mob movement
        const mobSpeed = MOB_SPEED_BASE + s.wave * 0.04;
        s.mobs.forEach(mob => {
          if (mob.dying) { mob.dyingTimer += dt; return; }
          if (mob.frozen > 0) { mob.frozen -= dt; return; }
          const ddx = s.player.x - mob.x;
          const ddy = s.player.y - mob.y;
          const dist = Math.sqrt(ddx * ddx + ddy * ddy);
          if (dist > 0) {
            mob.x += (ddx / dist) * mobSpeed;
            mob.y += (ddy / dist) * mobSpeed;
          }
          const invDur = s.abilities.has("iron_hide") ? 1600 : 800;
          if (s.invincible <= 0 && dist < PLAYER_RADIUS + MOB_RADIUS) {
            s.hp -= 1;
            s.invincible = invDur;
            spawnParticles(s.player.x, s.player.y, "#facc15", 8);
            setUiHp(s.hp);
            if (s.hp <= 0) { s.dead = true; setUiDead(true); }
          }
        });
        s.mobs = s.mobs.filter(m => !(m.dying && m.dyingTimer > 350));

        // Particles
        s.particles.forEach(p => { p.x += p.vx; p.y += p.vy; p.vx *= 0.93; p.vy *= 0.93; p.life -= 1; });
        s.particles = s.particles.filter(p => p.life > 0);

        // Damage nums
        s.damageNums.forEach(d => { d.y += d.vy; d.life -= 1; });
        s.damageNums = s.damageNums.filter(d => d.life > 0);

        // Lightning bolts
        s.lightningBolts.forEach(b => { b.life -= 1; });
        s.lightningBolts = s.lightningBolts.filter(b => b.life > 0);

        // Ability notif timer
        if (s.abilityNotif) {
          s.abilityNotif.timer -= dt;
          if (s.abilityNotif.timer <= 0) {
            s.abilityNotif = null;
            setUiNotif(null);
          }
        }
      }

      drawGame(ctx, s, timestamp);
      animRef.current = requestAnimationFrame(gameLoop);
    }

    animRef.current = requestAnimationFrame(gameLoop);
    return () => cancelAnimationFrame(animRef.current);
  }, []);

  function getSwordColor(s: typeof stateRef.current) {
    if (s.abilities.has("berserker")) return { blade: "#ff0080", glow: "#ff0080", arc: "#ff00ff" };
    if (s.abilities.has("fire_blade")) return { blade: "#fb923c", glow: "#f97316", arc: "#fbbf24" };
    if (s.abilities.has("chain_lightning")) return { blade: "#c4b5fd", glow: "#a78bfa", arc: "#818cf8" };
    return { blade: "#fef3c7", glow: "#fbbf24", arc: "#fbbf24" };
  }

  function drawPlayer(ctx: CanvasRenderingContext2D, px: number, py: number, facing: number, legAnim: number, invincible: number, timestamp: number, abilities: Set<string>) {
    ctx.save();
    ctx.translate(px, py);

    // Aura effects
    if (abilities.has("berserker")) {
      ctx.globalAlpha = 0.25 + 0.1 * Math.sin(timestamp * 0.01);
      ctx.fillStyle = "#ff0080";
      ctx.beginPath(); ctx.arc(0, 0, 28, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }
    if (abilities.has("fire_blade")) {
      ctx.globalAlpha = 0.2 + 0.08 * Math.sin(timestamp * 0.008);
      ctx.fillStyle = "#f97316";
      ctx.beginPath(); ctx.arc(0, 0, 26, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }
    if (abilities.has("chain_lightning")) {
      ctx.globalAlpha = 0.15 + 0.08 * Math.sin(timestamp * 0.012);
      ctx.fillStyle = "#a78bfa";
      ctx.beginPath(); ctx.arc(0, 0, 26, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Invincible flash
    if (invincible > 0 && Math.floor(timestamp / 80) % 2 === 0) {
      ctx.globalAlpha = 0.7;
      ctx.fillStyle = "#fbbf24";
      ctx.beginPath(); ctx.arc(0, 0, 22, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Draw the top-down person oriented toward `facing`
    ctx.rotate(facing + Math.PI / 2); // rotate so character "faces" right by default

    const legSwing = Math.sin(legAnim) * 5;

    // Shadow
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.beginPath();
    ctx.ellipse(0, 4, 12, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    // Legs (behind body)
    ctx.strokeStyle = "#374151";
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    // Left leg
    ctx.beginPath();
    ctx.moveTo(-4, 4);
    ctx.lineTo(-5 - legSwing * 0.4, 14);
    ctx.stroke();
    // Right leg
    ctx.beginPath();
    ctx.moveTo(4, 4);
    ctx.lineTo(5 + legSwing * 0.4, 14);
    ctx.stroke();

    // Shoes
    ctx.fillStyle = "#1f2937";
    ctx.beginPath(); ctx.ellipse(-5 - legSwing * 0.4, 15, 4, 3, -0.3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(5 + legSwing * 0.4, 15, 4, 3, 0.3, 0, Math.PI * 2); ctx.fill();

    // Body / torso
    ctx.fillStyle = abilities.has("berserker") ? "#dc2626" : abilities.has("fire_blade") ? "#b45309" : "#1d4ed8";
    ctx.strokeStyle = abilities.has("berserker") ? "#fca5a5" : abilities.has("fire_blade") ? "#fbbf24" : "#bfdbfe";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(-7, -4, 14, 16, 3);
    ctx.fill();
    ctx.stroke();

    // Arms
    ctx.strokeStyle = "#92400e";
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    // Left arm
    ctx.beginPath();
    ctx.moveTo(-7, 2);
    ctx.lineTo(-14, 8 + legSwing * 0.3);
    ctx.stroke();
    // Right arm
    ctx.beginPath();
    ctx.moveTo(7, 2);
    ctx.lineTo(14, 8 - legSwing * 0.3);
    ctx.stroke();
    // Hands
    ctx.fillStyle = "#fcd9a8";
    ctx.beginPath(); ctx.arc(-14, 8 + legSwing * 0.3, 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(14, 8 - legSwing * 0.3, 3.5, 0, Math.PI * 2); ctx.fill();

    // Head
    ctx.fillStyle = "#fcd9a8";
    ctx.strokeStyle = "#d97706";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, -8, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Hair
    ctx.fillStyle = "#78350f";
    ctx.beginPath();
    ctx.ellipse(0, -14, 7, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    // Eyes (facing forward = facing direction)
    ctx.fillStyle = "#1f2937";
    ctx.beginPath(); ctx.arc(-3, -8, 1.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(3, -8, 1.5, 0, Math.PI * 2); ctx.fill();

    ctx.restore();
  }

  function drawMob(ctx: CanvasRenderingContext2D, mob: Mob, timestamp: number) {
    const alpha = mob.dying ? Math.max(0, 1 - mob.dyingTimer / 350) : 1;
    ctx.globalAlpha = alpha;

    const bob = Math.sin(timestamp * 0.003 + mob.id) * 1.5;

    // Frozen tint
    if (mob.frozen > 0) {
      ctx.fillStyle = "rgba(125,211,252,0.4)";
      ctx.beginPath(); ctx.arc(mob.x, mob.y + bob, MOB_RADIUS + 4, 0, Math.PI * 2); ctx.fill();
    }

    // Mob body
    const gradient = ctx.createRadialGradient(mob.x - 4, mob.y - 4 + bob, 2, mob.x, mob.y + bob, MOB_RADIUS);
    gradient.addColorStop(0, mob.frozen > 0 ? "#bae6fd" : "#ef4444");
    gradient.addColorStop(1, mob.frozen > 0 ? "#0ea5e9" : "#7f1d1d");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(mob.x, mob.y + bob, MOB_RADIUS, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = mob.frozen > 0 ? "#7dd3fc" : "#fca5a5";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Horns
    ctx.fillStyle = "#fbbf24";
    ctx.beginPath(); ctx.moveTo(mob.x - 6, mob.y - MOB_RADIUS * 0.5 + bob); ctx.lineTo(mob.x - 3, mob.y - MOB_RADIUS * 1.1 + bob); ctx.lineTo(mob.x, mob.y - MOB_RADIUS * 0.5 + bob); ctx.fill();
    ctx.beginPath(); ctx.moveTo(mob.x, mob.y - MOB_RADIUS * 0.5 + bob); ctx.lineTo(mob.x + 3, mob.y - MOB_RADIUS * 1.1 + bob); ctx.lineTo(mob.x + 6, mob.y - MOB_RADIUS * 0.5 + bob); ctx.fill();

    // Eyes
    ctx.fillStyle = "#fff200";
    ctx.beginPath(); ctx.arc(mob.x - 5, mob.y - 2 + bob, 3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(mob.x + 5, mob.y - 2 + bob, 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#000";
    ctx.beginPath(); ctx.arc(mob.x - 4, mob.y - 2 + bob, 1.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(mob.x + 6, mob.y - 2 + bob, 1.5, 0, Math.PI * 2); ctx.fill();

    // Angry mouth
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(mob.x, mob.y + 4 + bob, 4, 0.2, Math.PI - 0.2);
    ctx.stroke();

    // HP bar
    if (!mob.dying && mob.maxHp > 1) {
      const bw = MOB_RADIUS * 2;
      const bx = mob.x - MOB_RADIUS;
      const by = mob.y - MOB_RADIUS - 10 + bob;
      ctx.fillStyle = "#450a0a";
      ctx.fillRect(bx, by, bw, 4);
      ctx.fillStyle = "#22c55e";
      ctx.fillRect(bx, by, bw * (mob.hp / mob.maxHp), 4);
    }

    ctx.globalAlpha = 1;
  }

  function drawGame(ctx: CanvasRenderingContext2D, s: typeof stateRef.current, timestamp: number) {
    // Background
    ctx.fillStyle = "#0f0f1a";
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Grid
    ctx.strokeStyle = "rgba(255,255,255,0.035)";
    ctx.lineWidth = 1;
    for (let x = 0; x < CANVAS_WIDTH; x += 60) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, CANVAS_HEIGHT); ctx.stroke();
    }
    for (let y = 0; y < CANVAS_HEIGHT; y += 60) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(CANVAS_WIDTH, y); ctx.stroke();
    }

    // Border
    ctx.strokeStyle = "#4a3f6b";
    ctx.lineWidth = 8;
    ctx.strokeRect(4, 4, CANVAS_WIDTH - 8, CANVAS_HEIGHT - 8);
    ctx.strokeStyle = "#6b5fa0";
    ctx.lineWidth = 2;
    ctx.strokeRect(10, 10, CANVAS_WIDTH - 20, CANVAS_HEIGHT - 20);

    // Fire trails
    s.fireTrails.forEach(fire => {
      const a = fire.life / fire.maxLife;
      const grad = ctx.createRadialGradient(fire.x, fire.y, 0, fire.x, fire.y, fire.radius);
      grad.addColorStop(0, `rgba(251,146,60,${a * 0.8})`);
      grad.addColorStop(0.5, `rgba(239,68,68,${a * 0.5})`);
      grad.addColorStop(1, "transparent");
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(fire.x, fire.y, fire.radius, 0, Math.PI * 2); ctx.fill();
    });

    // Lightning bolts
    s.lightningBolts.forEach(bolt => {
      ctx.globalAlpha = bolt.life / 15;
      ctx.strokeStyle = "#c4b5fd";
      ctx.lineWidth = 2;
      ctx.shadowBlur = 10;
      ctx.shadowColor = "#a78bfa";
      ctx.beginPath();
      ctx.moveTo(bolt.x1, bolt.y1);
      // Zigzag
      const mx = (bolt.x1 + bolt.x2) / 2 + (Math.random() - 0.5) * 30;
      const my = (bolt.y1 + bolt.y2) / 2 + (Math.random() - 0.5) * 30;
      ctx.lineTo(mx, my);
      ctx.lineTo(bolt.x2, bolt.y2);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    });

    // Particles
    s.particles.forEach(p => {
      ctx.globalAlpha = p.life / p.maxLife;
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
    });
    ctx.globalAlpha = 1;

    // Mobs
    s.mobs.forEach(mob => drawMob(ctx, mob, timestamp));

    // Sword swing
    if (s.sword !== null) {
      const { angle, progress } = s.sword;
      const swordRange = BASE_SWORD_RANGE * (s.abilities.has("giant_sword") ? 1.75 : 1);
      let arcHalf = BASE_SWORD_ARC;
      if (s.abilities.has("wide_slash")) arcHalf *= 2;
      if (s.abilities.has("berserker")) arcHalf *= 1.5;
      const startAngle = angle - arcHalf;
      const colors = getSwordColor(s);

      ctx.save();
      ctx.translate(s.player.x, s.player.y);

      ctx.globalAlpha = 0.45 * (1 - progress);
      ctx.strokeStyle = colors.arc;
      ctx.lineWidth = 10;
      ctx.lineCap = "round";
      ctx.shadowBlur = 25;
      ctx.shadowColor = colors.glow;
      ctx.beginPath();
      ctx.arc(0, 0, swordRange * 0.85, startAngle, startAngle + arcHalf * 2 * progress);
      ctx.stroke();
      ctx.shadowBlur = 0;

      ctx.globalAlpha = 1 - progress * 0.6;
      ctx.strokeStyle = colors.blade;
      ctx.lineWidth = 3;
      ctx.shadowBlur = 12;
      ctx.shadowColor = colors.glow;
      const tipX = Math.cos(startAngle + arcHalf * 2 * progress) * swordRange;
      const tipY = Math.sin(startAngle + arcHalf * 2 * progress) * swordRange;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(tipX, tipY);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;

      ctx.restore();
    }

    // Player
    drawPlayer(ctx, s.player.x, s.player.y, s.playerFacing, s.legAnim, s.invincible, timestamp, s.abilities);

    // Damage numbers
    s.damageNums.forEach(d => {
      ctx.globalAlpha = Math.min(1, d.life / 40);
      ctx.fillStyle = d.color ?? (d.text.startsWith("+") ? "#4ade80" : "#f87171");
      ctx.font = `bold ${d.text.length > 3 ? 13 : 15}px monospace`;
      ctx.textAlign = "center";
      ctx.fillText(d.text, d.x, d.y);
    });
    ctx.globalAlpha = 1;
    ctx.textAlign = "left";

    // Dead overlay
    if (s.dead) {
      ctx.fillStyle = "rgba(0,0,0,0.65)";
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    }
  }

  const abilityMeta = ABILITY_LIST.reduce<Record<string, (typeof ABILITY_LIST)[0]>>((acc, a) => { acc[a.id] = a; return acc; }, {});

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-950 select-none">
      {/* HUD */}
      <div className="mb-2 flex items-center gap-6 text-white">
        <div className="flex items-center gap-2">
          <span className="text-gray-400 text-sm font-mono">WAVE</span>
          <span className="text-purple-400 font-bold text-xl font-mono">{uiWave}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-gray-400 text-sm font-mono">KILLS</span>
          <span className="text-yellow-400 font-bold text-xl font-mono">{uiScore}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-gray-400 text-sm font-mono">HP</span>
          <div className="flex gap-1">
            {Array.from({ length: uiMaxHp }).map((_, i) => (
              <div key={i} className={`w-4 h-4 rounded-sm transition-colors ${i < uiHp ? "bg-red-500" : "bg-gray-700"}`} />
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-gray-400 text-sm font-mono">NEXT</span>
          <span className="text-green-400 font-bold text-sm font-mono">
            {(() => {
              const next = ABILITY_LIST.find(a => !uiAbilities.includes(a.id));
              return next ? `${next.icon} @${next.killsRequired}` : "MAX";
            })()}
          </span>
        </div>
      </div>

      {/* Abilities bar */}
      {uiAbilities.length > 0 && (
        <div className="mb-2 flex gap-1 flex-wrap justify-center max-w-[900px]">
          {uiAbilities.map(id => {
            const a = abilityMeta[id];
            if (!a) return null;
            return (
              <div key={id} title={`${a.name}: ${a.desc}`}
                className="flex items-center gap-1 px-2 py-0.5 bg-gray-800 border border-purple-700 rounded text-xs text-purple-200 font-mono">
                <span>{a.icon}</span>
                <span>{a.name}</span>
              </div>
            );
          })}
        </div>
      )}

      <div className="relative">
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          className="block rounded-lg border-2 border-purple-900 cursor-crosshair"
        />

        {/* Ability unlock notification */}
        {uiNotif && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 pointer-events-none">
            <div className="bg-gray-900 border-2 border-yellow-400 rounded-xl px-6 py-3 text-center shadow-lg shadow-yellow-500/30 animate-bounce">
              <div className="text-3xl mb-1">{uiNotif.icon}</div>
              <div className="text-yellow-300 font-bold font-mono text-lg">{uiNotif.name} UNLOCKED!</div>
              <div className="text-gray-300 text-sm font-mono">{uiNotif.desc}</div>
            </div>
          </div>
        )}

        {/* Death screen */}
        {uiDead && (
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <div className="text-center pointer-events-auto">
              <h2 className="text-5xl font-bold text-red-500 mb-2 font-mono tracking-widest drop-shadow-lg">YOU DIED</h2>
              <p className="text-yellow-400 text-xl font-mono mb-1">Kills: {uiScore}</p>
              <p className="text-purple-400 text-lg font-mono mb-2">Wave: {uiWave}</p>
              {uiAbilities.length > 0 && (
                <p className="text-gray-300 text-sm font-mono mb-4">
                  Abilities earned: {uiAbilities.map(id => abilityMeta[id]?.icon).join(" ")}
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

      <div className="mt-2 flex gap-8 text-gray-500 text-xs font-mono">
        <span>WASD — Move</span>
        <span>CLICK — Swing sword</span>
        <span>Abilities unlock every 5 kills!</span>
      </div>
    </div>
  );
}
