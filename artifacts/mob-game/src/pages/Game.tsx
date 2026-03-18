import { useEffect, useRef, useState, useCallback } from "react";

const CANVAS_WIDTH = 900;
const CANVAS_HEIGHT = 650;
const PLAYER_SPEED = 3.5;
const PLAYER_RADIUS = 18;
const MOB_RADIUS = 14;
const SWORD_RANGE = 80;
const SWORD_ANGLE_HALF = Math.PI / 3;
const MOB_SPEED_BASE = 1.2;
const MOB_SPAWN_INTERVAL = 1500;
const MOB_SPEED_SCALE = 0.015;

interface Vec2 {
  x: number;
  y: number;
}

interface Mob {
  id: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  dying: boolean;
  dyingTimer: number;
}

interface SwordSwing {
  angle: number;
  progress: number;
  duration: number;
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
}

interface DamageNumber {
  x: number;
  y: number;
  vy: number;
  life: number;
  text: string;
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

  const hp = 1 + Math.floor(score / 20);
  return { id: ++mobIdCounter, x, y, hp, maxHp: hp, dying: false, dyingTimer: 0 };
}

export default function Game() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef({
    player: { x: CANVAS_WIDTH / 2, y: CANVAS_HEIGHT / 2 },
    playerFacing: 0,
    keys: new Set<string>(),
    mobs: [] as Mob[],
    particles: [] as Particle[],
    damageNums: [] as DamageNumber[],
    sword: null as SwordSwing | null,
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
  });
  const animRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const [uiScore, setUiScore] = useState(0);
  const [uiHp, setUiHp] = useState(5);
  const [uiDead, setUiDead] = useState(false);
  const [uiWave, setUiWave] = useState(1);

  const restartGame = useCallback(() => {
    const s = stateRef.current;
    s.player = { x: CANVAS_WIDTH / 2, y: CANVAS_HEIGHT / 2 };
    s.playerFacing = 0;
    s.mobs = [];
    s.particles = [];
    s.damageNums = [];
    s.sword = null;
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
    mobIdCounter = 0;
    setUiScore(0);
    setUiHp(5);
    setUiDead(false);
    setUiWave(1);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      stateRef.current.keys.add(e.key.toLowerCase());
      e.preventDefault();
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      stateRef.current.keys.delete(e.key.toLowerCase());
    };

    const handleMouseDown = (e: MouseEvent) => {
      const s = stateRef.current;
      if (s.dead) return;
      if (s.sword !== null) return;
      const rect = canvas.getBoundingClientRect();
      const mx = (e.clientX - rect.left) * (CANVAS_WIDTH / rect.width);
      const my = (e.clientY - rect.top) * (CANVAS_HEIGHT / rect.height);
      const dx = mx - s.player.x;
      const dy = my - s.player.y;
      const angle = Math.atan2(dy, dx);
      s.sword = { angle, progress: 0, duration: 300 };
      s.playerFacing = angle;
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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;

    function spawnParticles(x: number, y: number, color: string, count: number) {
      const s = stateRef.current;
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 1 + Math.random() * 3;
        s.particles.push({
          x, y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 30 + Math.random() * 20,
          maxLife: 50,
          color,
          size: 2 + Math.random() * 3,
        });
      }
    }

    function gameLoop(timestamp: number) {
      const dt = Math.min(timestamp - lastTimeRef.current, 50);
      lastTimeRef.current = timestamp;
      const s = stateRef.current;

      if (!s.dead) {
        s.gameTime += dt;
        s.invincible = Math.max(0, s.invincible - dt);

        // Movement
        let dx = 0, dy = 0;
        if (s.keys.has("a") || s.keys.has("arrowleft")) dx -= 1;
        if (s.keys.has("d") || s.keys.has("arrowright")) dx += 1;
        if (s.keys.has("w") || s.keys.has("arrowup")) dy -= 1;
        if (s.keys.has("s") || s.keys.has("arrowdown")) dy += 1;
        if (dx !== 0 && dy !== 0) { dx *= 0.707; dy *= 0.707; }

        if (dx !== 0 || dy !== 0) {
          s.playerFacing = Math.atan2(dy, dx);
        }

        s.player.x = Math.max(PLAYER_RADIUS, Math.min(CANVAS_WIDTH - PLAYER_RADIUS, s.player.x + dx * PLAYER_SPEED));
        s.player.y = Math.max(PLAYER_RADIUS, Math.min(CANVAS_HEIGHT - PLAYER_RADIUS, s.player.y + dy * PLAYER_SPEED));

        // Sword swing progress
        if (s.sword !== null) {
          s.sword.progress += dt / s.sword.duration;
          if (s.sword.progress >= 1) {
            s.sword = null;
          } else {
            // Check sword hits
            const swingAngle = s.sword.angle;
            const t = s.sword.progress;
            const currentAngle = swingAngle - SWORD_ANGLE_HALF + t * SWORD_ANGLE_HALF * 2;
            s.mobs.forEach(mob => {
              if (mob.dying) return;
              const ddx = mob.x - s.player.x;
              const ddy = mob.y - s.player.y;
              const dist = Math.sqrt(ddx * ddx + ddy * ddy);
              if (dist > SWORD_RANGE + MOB_RADIUS) return;
              const mobAngle = Math.atan2(ddy, ddx);
              let angDiff = mobAngle - currentAngle;
              while (angDiff > Math.PI) angDiff -= Math.PI * 2;
              while (angDiff < -Math.PI) angDiff += Math.PI * 2;
              if (Math.abs(angDiff) < SWORD_ANGLE_HALF * 0.6) {
                mob.hp -= 1;
                spawnParticles(mob.x, mob.y, "#ef4444", 5);
                s.damageNums.push({ x: mob.x, y: mob.y - 10, vy: -1.5, life: 45, text: "1" });
                if (mob.hp <= 0) {
                  mob.dying = true;
                  mob.dyingTimer = 0;
                  s.score += 1;
                  spawnParticles(mob.x, mob.y, "#f97316", 10);
                  s.damageNums.push({ x: mob.x, y: mob.y - 20, vy: -2, life: 60, text: "+1" });
                }
              }
            });
          }
        }

        // Wave / spawn timing
        s.waveTimer += dt;
        if (s.waveTimer > 15000) {
          s.wave += 1;
          s.waveTimer = 0;
          s.spawnInterval = Math.max(400, MOB_SPAWN_INTERVAL - (s.wave - 1) * 120);
        }

        // Mob spawning
        if (timestamp - s.lastSpawn > s.spawnInterval) {
          s.lastSpawn = timestamp;
          const count = 1 + Math.floor(s.wave / 3);
          for (let i = 0; i < count; i++) {
            s.mobs.push(spawnMob(s.score));
          }
        }

        // Mob movement and collision
        const mobSpeed = MOB_SPEED_BASE + s.wave * MOB_SPEED_SCALE * 30;
        s.mobs.forEach(mob => {
          if (mob.dying) {
            mob.dyingTimer += dt;
            return;
          }
          const ddx = s.player.x - mob.x;
          const ddy = s.player.y - mob.y;
          const dist = Math.sqrt(ddx * ddx + ddy * ddy);
          if (dist > 0) {
            mob.x += (ddx / dist) * mobSpeed;
            mob.y += (ddy / dist) * mobSpeed;
          }

          // Player-mob collision
          if (s.invincible <= 0 && dist < PLAYER_RADIUS + MOB_RADIUS) {
            s.hp -= 1;
            s.invincible = 800;
            spawnParticles(s.player.x, s.player.y, "#facc15", 8);
            if (s.hp <= 0) {
              s.dead = true;
              setUiDead(true);
            }
          }
        });

        // Remove dead mobs after animation
        s.mobs = s.mobs.filter(m => !(m.dying && m.dyingTimer > 300));

        // Update particles
        s.particles.forEach(p => {
          p.x += p.vx;
          p.y += p.vy;
          p.vx *= 0.93;
          p.vy *= 0.93;
          p.life -= 1;
        });
        s.particles = s.particles.filter(p => p.life > 0);

        // Update damage numbers
        s.damageNums.forEach(d => {
          d.y += d.vy;
          d.life -= 1;
        });
        s.damageNums = s.damageNums.filter(d => d.life > 0);

        setUiScore(s.score);
        setUiHp(s.hp);
        setUiWave(s.wave);
      }

      // Drawing
      drawGame(ctx, s, timestamp);
      animRef.current = requestAnimationFrame(gameLoop);
    }

    animRef.current = requestAnimationFrame(gameLoop);
    return () => cancelAnimationFrame(animRef.current);
  }, []);

  function drawGame(ctx: CanvasRenderingContext2D, s: typeof stateRef.current, timestamp: number) {
    // Background: dark dungeon floor
    ctx.fillStyle = "#1a1a2e";
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Grid pattern
    ctx.strokeStyle = "rgba(255,255,255,0.04)";
    ctx.lineWidth = 1;
    for (let x = 0; x < CANVAS_WIDTH; x += 60) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, CANVAS_HEIGHT); ctx.stroke();
    }
    for (let y = 0; y < CANVAS_HEIGHT; y += 60) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(CANVAS_WIDTH, y); ctx.stroke();
    }

    // Wall border
    ctx.strokeStyle = "#4a3f6b";
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, CANVAS_WIDTH - 6, CANVAS_HEIGHT - 6);
    ctx.strokeStyle = "#6b5fa0";
    ctx.lineWidth = 2;
    ctx.strokeRect(8, 8, CANVAS_WIDTH - 16, CANVAS_HEIGHT - 16);

    // Draw particles
    s.particles.forEach(p => {
      ctx.globalAlpha = p.life / p.maxLife;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    // Draw mobs
    s.mobs.forEach(mob => {
      const alpha = mob.dying ? Math.max(0, 1 - mob.dyingTimer / 300) : 1;
      ctx.globalAlpha = alpha;

      // Mob body
      const gradient = ctx.createRadialGradient(mob.x - 4, mob.y - 4, 2, mob.x, mob.y, MOB_RADIUS);
      gradient.addColorStop(0, "#ef4444");
      gradient.addColorStop(1, "#7f1d1d");
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(mob.x, mob.y, MOB_RADIUS, 0, Math.PI * 2);
      ctx.fill();

      // Mob outline
      ctx.strokeStyle = "#fca5a5";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Mob eyes
      ctx.fillStyle = "#fff";
      const eyeOffset = 5;
      ctx.beginPath(); ctx.arc(mob.x - eyeOffset, mob.y - 3, 3, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(mob.x + eyeOffset, mob.y - 3, 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#1f2937";
      ctx.beginPath(); ctx.arc(mob.x - eyeOffset + 1, mob.y - 3, 1.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(mob.x + eyeOffset + 1, mob.y - 3, 1.5, 0, Math.PI * 2); ctx.fill();

      // HP bar
      if (!mob.dying && mob.maxHp > 1) {
        const barW = MOB_RADIUS * 2;
        const barH = 4;
        const barX = mob.x - MOB_RADIUS;
        const barY = mob.y - MOB_RADIUS - 8;
        ctx.fillStyle = "#450a0a";
        ctx.fillRect(barX, barY, barW, barH);
        ctx.fillStyle = "#22c55e";
        ctx.fillRect(barX, barY, barW * (mob.hp / mob.maxHp), barH);
      }

      ctx.globalAlpha = 1;
    });

    // Draw sword swing arc
    if (s.sword !== null) {
      const { angle, progress } = s.sword;
      const startAngle = angle - SWORD_ANGLE_HALF;
      const sweepAngle = SWORD_ANGLE_HALF * 2;
      const currentSweep = sweepAngle * progress;

      ctx.save();
      ctx.translate(s.player.x, s.player.y);

      // Sword arc glow
      ctx.globalAlpha = 0.5 * (1 - progress);
      ctx.strokeStyle = "#fbbf24";
      ctx.lineWidth = 8;
      ctx.lineCap = "round";
      ctx.shadowBlur = 20;
      ctx.shadowColor = "#fbbf24";
      ctx.beginPath();
      ctx.arc(0, 0, SWORD_RANGE * 0.9, startAngle, startAngle + currentSweep);
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Sword blade line
      ctx.globalAlpha = 1 - progress * 0.7;
      ctx.strokeStyle = "#fef3c7";
      ctx.lineWidth = 3;
      ctx.shadowBlur = 10;
      ctx.shadowColor = "#fbbf24";
      const tipX = Math.cos(startAngle + currentSweep) * SWORD_RANGE;
      const tipY = Math.sin(startAngle + currentSweep) * SWORD_RANGE;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(tipX, tipY);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;

      ctx.restore();
    }

    // Draw player
    const px = s.player.x;
    const py = s.player.y;

    // Player shadow
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.beginPath();
    ctx.ellipse(px, py + PLAYER_RADIUS - 3, PLAYER_RADIUS * 0.8, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Player body glow when invincible
    if (s.invincible > 0 && Math.floor(timestamp / 100) % 2 === 0) {
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = "#fbbf24";
      ctx.beginPath();
      ctx.arc(px, py, PLAYER_RADIUS + 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Player body
    const playerGrad = ctx.createRadialGradient(px - 5, py - 5, 3, px, py, PLAYER_RADIUS);
    playerGrad.addColorStop(0, "#93c5fd");
    playerGrad.addColorStop(1, "#1d4ed8");
    ctx.fillStyle = playerGrad;
    ctx.beginPath();
    ctx.arc(px, py, PLAYER_RADIUS, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "#bfdbfe";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Player facing direction dot
    const faceX = px + Math.cos(s.playerFacing) * (PLAYER_RADIUS - 5);
    const faceY = py + Math.sin(s.playerFacing) * (PLAYER_RADIUS - 5);
    ctx.fillStyle = "#e0f2fe";
    ctx.beginPath();
    ctx.arc(faceX, faceY, 4, 0, Math.PI * 2);
    ctx.fill();

    // Sword idle (small visible sword in facing direction)
    if (!s.sword) {
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(s.playerFacing);
      ctx.fillStyle = "#d4af37";
      ctx.strokeStyle = "#fef3c7";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(PLAYER_RADIUS - 2, -3, 22, 6, 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#6b7280";
      ctx.beginPath();
      ctx.roundRect(PLAYER_RADIUS - 6, -2, 5, 4, 1);
      ctx.fill();
      ctx.restore();
    }

    // Damage numbers
    s.damageNums.forEach(d => {
      const alpha = d.life / 60;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = d.text.startsWith("+") ? "#4ade80" : "#f87171";
      ctx.font = `bold ${d.text.startsWith("+") ? 16 : 14}px monospace`;
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

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-950 select-none">
      <div className="mb-3 flex items-center gap-6 text-white">
        <div className="flex items-center gap-2">
          <span className="text-gray-400 text-sm font-mono">WAVE</span>
          <span className="text-purple-400 font-bold text-xl font-mono">{uiWave}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-gray-400 text-sm font-mono">SCORE</span>
          <span className="text-yellow-400 font-bold text-xl font-mono">{uiScore}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-gray-400 text-sm font-mono">HP</span>
          <div className="flex gap-1">
            {Array.from({ length: stateRef.current.maxHp }).map((_, i) => (
              <div
                key={i}
                className={`w-4 h-4 rounded-sm ${i < uiHp ? "bg-red-500" : "bg-gray-700"}`}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="relative">
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          className="block rounded-lg border-2 border-purple-900 cursor-crosshair"
          style={{ imageRendering: "pixelated" }}
        />
        {uiDead && (
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <div className="text-center pointer-events-auto">
              <h2 className="text-5xl font-bold text-red-500 mb-2 font-mono tracking-widest drop-shadow-lg">
                YOU DIED
              </h2>
              <p className="text-yellow-400 text-xl font-mono mb-1">Score: {uiScore}</p>
              <p className="text-purple-400 text-lg font-mono mb-6">Wave: {uiWave}</p>
              <button
                onClick={restartGame}
                className="px-8 py-3 bg-purple-700 hover:bg-purple-600 text-white font-bold font-mono rounded-lg text-lg border border-purple-400 transition-colors"
              >
                PLAY AGAIN
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="mt-3 flex gap-8 text-gray-500 text-xs font-mono">
        <span>WASD / ARROWS — Move</span>
        <span>CLICK — Swing sword</span>
      </div>
    </div>
  );
}
