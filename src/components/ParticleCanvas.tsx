import { memo, useLayoutEffect, useRef } from "react";
import type { TransferDirection } from "../lib/types";

type ParticleMode = "field" | "link";
type BorderMode = "border" | "link";

interface Particle {
  mode: ParticleMode;
  x: number;
  y: number;
  vx: number;
  vy: number;
  t: number;
  tVelocity: number;
  size: number;
  alpha: number;
  seed: number;
  age: number;
  maxAge: number;
  bandOffset: number;
  scatterY: number;
}

interface BorderParticle {
  mode: BorderMode;
  position: number;
  velocity: number;
  branch: 1 | -1;
  t: number;
  tVelocity: number;
  size: number;
  alpha: number;
  seed: number;
  bandOffset: number;
}

interface Point {
  x: number;
  y: number;
}

interface PathPoint extends Point {
  nx: number;
  ny: number;
}

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

function random(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function approach(current: number, target: number, speed: number, delta: number) {
  return current + (target - current) * (1 - Math.exp(-speed * delta));
}

function perimeterPoint(position: number, rect: Rect, portalY: number) {
  const inset = 3;
  const width = Math.max(1, rect.width - inset * 2);
  const height = Math.max(1, rect.height - inset * 2);
  const localPortalY = Math.min(height, Math.max(0, portalY - rect.top - inset));
  const perimeter = width * 2 + height * 2;
  let value = ((position % perimeter) + perimeter) % perimeter;

  if (value <= localPortalY) return { x: rect.left + inset, y: rect.top + inset + localPortalY - value };
  value -= localPortalY;
  if (value <= width) return { x: rect.left + inset + value, y: rect.top + inset };
  value -= width;
  if (value <= height) return { x: rect.left + inset + width, y: rect.top + inset + value };
  value -= height;
  if (value <= width) return { x: rect.left + inset + width - value, y: rect.top + inset + height };
  value -= width;
  return { x: rect.left + inset, y: rect.top + inset + height - value };
}

function ParticleCanvasComponent({
  active,
  direction,
  intensity,
  className = ""
}: {
  active: boolean;
  direction: TransferDirection;
  intensity: number;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationState = useRef({ active, direction, intensity });
  animationState.current = { active, direction, intensity };

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const host = canvas.closest<HTMLElement>(".network-stage") ?? canvas.parentElement ?? canvas;
    const context = canvas.getContext("2d");
    if (!context) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let width = 0;
    let height = 0;
    let remoteRect: Rect = { left: 1, top: 1, width: 1, height: 1 };
    let portalY = 1;
    let perimeter = 1;
    let pathPoints: PathPoint[] = [];
    let frame = 0;
    let previousTime = performance.now();
    let activeMix = animationState.current.active ? 1 : 0;
    let flow = animationState.current.direction === "upload" ? 1 : -1;
    let speedMix = Math.min(1, Math.max(0, animationState.current.intensity));
    let particleReleaseClock = 0;
    let borderReleaseClock = 0;
    let particles: Particle[] = [];
    let borderParticles: BorderParticle[] = [];

    const pathPointAt = (progress: number) => {
      const bounded = Math.min(1, Math.max(0, progress));
      const scaled = bounded * Math.max(0, pathPoints.length - 1);
      const index = Math.min(pathPoints.length - 1, Math.floor(scaled));
      const next = pathPoints[Math.min(pathPoints.length - 1, index + 1)] ?? pathPoints[index];
      const current = pathPoints[index] ?? { x: 0, y: portalY, nx: 0, ny: 1 };
      const amount = scaled - index;
      return {
        x: current.x + (next.x - current.x) * amount,
        y: current.y + (next.y - current.y) * amount,
        nx: current.nx + (next.nx - current.nx) * amount,
        ny: current.ny + (next.ny - current.ny) * amount
      };
    };

    const placeFieldParticle = (particle: Particle, randomPosition: boolean) => {
      particle.mode = "field";
      const scatterAngle = random(-Math.PI / 2, Math.PI / 2);
      const portalRatio = (portalY - remoteRect.top) / Math.max(1, remoteRect.height);
      particle.scatterY = Math.min(
        0.96,
        Math.max(0.04, portalRatio + Math.sin(scatterAngle) * random(0.4, 0.56))
      );
      particle.x = randomPosition
        ? random(remoteRect.left + 5, remoteRect.left + Math.max(6, remoteRect.width - 5))
        : remoteRect.left + 3;
      particle.y = randomPosition
        ? random(remoteRect.top + 5, remoteRect.top + Math.max(6, remoteRect.height - 5))
        : portalY + particle.bandOffset;
      const burstSpeed = random(52, 78) * (1.08 + speedMix * 0.92);
      particle.vx = randomPosition ? random(-5, 5) : random(7, 14) + Math.cos(scatterAngle) * burstSpeed;
      particle.vy = randomPosition
        ? random(-7, 7)
        : Math.sin(scatterAngle) * burstSpeed;
      particle.age = 0;
      particle.maxAge = random(3.4, 6.4);
    };

    const placeLinkParticle = (particle: Particle, progress: number) => {
      particle.mode = "link";
      particle.t = progress;
      particle.tVelocity = 0;
      particle.age = 0;
    };

    const createParticle = () => {
      const particle: Particle = {
        mode: "field",
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        t: 0,
        tVelocity: 0,
        size: random(0.88, 1.52),
        alpha: random(0.4, 0.86),
        seed: random(0, Math.PI * 2),
        age: random(0, 5),
        maxAge: random(3.4, 6.4),
        bandOffset: (Math.random() > 0.5 ? 1 : -1) * random(4.6, 9.4),
        scatterY: random(0.08, 0.92)
      };
      placeFieldParticle(particle, true);
      particle.age = random(0, particle.maxAge);
      return particle;
    };

    const createBorderParticle = (): BorderParticle => ({
      mode: "border",
      position: random(0, perimeter),
      velocity: random(-8, 8),
      branch: Math.random() > 0.5 ? 1 : -1,
      t: 0,
      tVelocity: 0,
      size: random(0.82, 1.34),
      alpha: random(0.42, 0.86),
      seed: random(0, Math.PI * 2),
      bandOffset: (Math.random() > 0.5 ? 1 : -1) * random(5.2, 10.2)
    });

    const sampleCablePath = (hostBounds: DOMRect) => {
      const rail = host.querySelector<SVGPathElement>(".energy-rail");
      const matrix = rail?.getScreenCTM();
      if (rail && matrix) {
        const total = rail.getTotalLength();
        const samples = 180;
        const raw = Array.from({ length: samples + 1 }, (_, index) => {
          const point = rail.getPointAtLength((total * index) / samples);
          const transformed = new DOMPoint(point.x, point.y).matrixTransform(matrix);
          return { x: transformed.x - hostBounds.left, y: transformed.y - hostBounds.top };
        });
        pathPoints = raw.map((point, index) => {
          const before = raw[Math.max(0, index - 1)];
          const after = raw[Math.min(raw.length - 1, index + 1)];
          const dx = after.x - before.x;
          const dy = after.y - before.y;
          const length = Math.max(0.001, Math.hypot(dx, dy));
          return { ...point, nx: -dy / length, ny: dx / length };
        });
        return;
      }

      const start = { x: Math.max(0, remoteRect.left - 180), y: portalY };
      pathPoints = Array.from({ length: 181 }, (_, index) => {
        const t = index / 180;
        const x = start.x + (remoteRect.left - start.x) * t;
        const y = portalY + Math.sin(t * Math.PI) * 28;
        return { x, y, nx: 0, ny: 1 };
      });
    };

    const rebuild = () => {
      const hostBounds = host.getBoundingClientRect();
      const remoteBounds = host.querySelector<HTMLElement>(".remote-node")?.getBoundingClientRect();
      const previousRect = remoteRect;
      const previousPerimeter = perimeter;
      width = Math.max(1, hostBounds.width);
      height = Math.max(1, hostBounds.height);
      remoteRect = remoteBounds
        ? {
            left: remoteBounds.left - hostBounds.left,
            top: remoteBounds.top - hostBounds.top,
            width: remoteBounds.width,
            height: remoteBounds.height
          }
        : { left: width * 0.52, top: height * 0.05, width: width * 0.46, height: height * 0.9 };
      portalY = remoteRect.top + remoteRect.height * 0.44;
      perimeter = Math.max(1, (remoteRect.width - 6) * 2 + (remoteRect.height - 6) * 2);

      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      sampleCablePath(hostBounds);

      if (particles.length) {
        particles.forEach((particle) => {
          if (particle.mode !== "field") return;
          const relativeX = (particle.x - previousRect.left) / Math.max(1, previousRect.width);
          const relativeY = (particle.y - previousRect.top) / Math.max(1, previousRect.height);
          particle.x = remoteRect.left + relativeX * remoteRect.width;
          particle.y = remoteRect.top + relativeY * remoteRect.height;
        });
        borderParticles.forEach((particle) => {
          if (particle.mode === "border") {
            particle.position = (particle.position / Math.max(1, previousPerimeter)) * perimeter;
          }
        });
      }

      const particleCount = Math.max(112, Math.min(168, Math.round((remoteRect.width * remoteRect.height) / 2050)));
      const borderCount = Math.max(38, Math.min(58, Math.round(perimeter / 30)));
      while (particles.length < particleCount) particles.push(createParticle());
      if (particles.length > particleCount) particles.length = particleCount;
      while (borderParticles.length < borderCount) borderParticles.push(createBorderParticle());
      if (borderParticles.length > borderCount) borderParticles.length = borderCount;

    };

    const releaseUploadParticles = (delta: number) => {
      if (reduceMotion || activeMix < 0.2 || flow < 0.14) {
        particleReleaseClock = 0;
        borderReleaseClock = 0;
        return;
      }

      const particleTarget = Math.max(18, Math.round(particles.length * 0.17));
      const movementScale = 1.08 + speedMix * 0.92;
      const particleInterval = Math.max(0.045, Math.min(0.12, 1 / (0.46 * movementScale * particleTarget)));
      particleReleaseClock = Math.min(particleInterval * 1.1, particleReleaseClock + delta * activeMix);
      if (
        particleReleaseClock >= particleInterval &&
        particles.filter((particle) => particle.mode === "link").length < particleTarget
      ) {
        const candidate = particles
          .filter((particle) => particle.mode === "field")
          .sort((left, right) => right.age / right.maxAge - left.age / left.maxAge)[0];
        if (candidate) {
          placeLinkParticle(candidate, 0);
          particleReleaseClock -= particleInterval;
        }
      }

      const borderTarget = Math.max(5, Math.round(borderParticles.length * 0.12));
      const borderInterval = Math.max(0.16, Math.min(0.4, 1 / (0.48 * movementScale * borderTarget)));
      borderReleaseClock = Math.min(borderInterval * 1.1, borderReleaseClock + delta * activeMix);
      if (
        borderReleaseClock >= borderInterval &&
        borderParticles.filter((particle) => particle.mode === "link").length < borderTarget
      ) {
        const candidate = borderParticles.find((particle) => particle.mode === "border");
        if (candidate) {
          candidate.mode = "link";
          candidate.t = 0;
          candidate.tVelocity = 0;
          borderReleaseClock -= borderInterval;
        }
      }
    };

    const drawTrail = (x: number, y: number, vx: number, vy: number, size: number, alpha: number, enabled: boolean) => {
      const speed = Math.hypot(vx, vy);
      if (!enabled || reduceMotion || speed < 7) return;
      const length = Math.min(38, Math.max(8, speed * 0.19));
      const tailX = x - (vx / speed) * length;
      const tailY = y - (vy / speed) * length;

      context.beginPath();
      context.moveTo(tailX, tailY);
      context.lineTo(x, y);
      context.lineCap = "round";
      context.lineWidth = Math.max(1.6, size * 2.3);
      context.strokeStyle = `rgba(65, 139, 233, ${alpha * 0.24})`;
      context.stroke();

      context.beginPath();
      context.moveTo(x - (vx / speed) * length * 0.48, y - (vy / speed) * length * 0.48);
      context.lineTo(x, y);
      context.lineWidth = Math.max(1.05, size * 1.38);
      context.strokeStyle = `rgba(218, 239, 255, ${alpha * 0.88})`;
      context.stroke();
    };

    const drawHead = (x: number, y: number, size: number, alpha: number, energized: boolean) => {
      if (energized) {
        context.beginPath();
        context.arc(x, y, size * 3.8, 0, Math.PI * 2);
        context.fillStyle = `rgba(73, 148, 241, ${alpha * 0.15})`;
        context.fill();
      }
      context.beginPath();
      context.arc(x, y, energized ? size * 1.24 : size * 0.84, 0, Math.PI * 2);
      context.fillStyle = `rgba(218, 239, 255, ${energized ? alpha : alpha * 0.56})`;
      context.fill();
    };

    const tick = (time: number) => {
      const delta = Math.min(0.034, Math.max(0.001, (time - previousTime) / 1000));
      previousTime = time;
      const targetActive = animationState.current.active ? 1 : 0;
      const targetFlow = animationState.current.direction === "upload" ? 1 : -1;
      const targetSpeed = Math.min(1, Math.max(0, animationState.current.intensity));
      activeMix = approach(activeMix, targetActive, targetActive ? 3.8 : 0.9, delta);
      flow = approach(flow, targetFlow, 2.25, delta);
      speedMix = approach(speedMix, targetSpeed, 2.4, delta);
      releaseUploadParticles(delta);
      const energized = activeMix > 0.035;
      const flowStrength = Math.abs(flow) * activeMix;
      const movementScale = 1.08 + speedMix * 0.92;

      context.clearRect(0, 0, width, height);
      context.globalCompositeOperation = energized ? "lighter" : "source-over";

      particles.forEach((particle) => {
        let drawX = particle.x;
        let drawY = particle.y;
        let drawVx = particle.vx;
        let drawVy = particle.vy;

        if (!reduceMotion && particle.mode === "field") {
          particle.age += delta * Math.max(0.25, activeMix);
          const portalTargetY = portalY + particle.bandOffset;

          if (activeMix < 0.08) {
            particle.vx += Math.sin(time * 0.0007 + particle.seed) * delta * 2.4;
            particle.vy += Math.cos(time * 0.0006 + particle.seed) * delta * 2;
            particle.vx *= 0.995;
            particle.vy *= 0.995;
          } else if (flow < -0.04) {
            const dx = remoteRect.left - particle.x;
            const dy = portalTargetY - particle.y;
            const distance = Math.max(1, Math.hypot(dx, dy));
            const speed =
              (34 + Math.max(0, 1 - (particle.x - remoteRect.left) / 112) * 94) *
              flowStrength *
              movementScale;
            particle.vx = approach(particle.vx, (dx / distance) * speed, 2.6 + flowStrength * 2.2, delta);
            particle.vy = approach(particle.vy, (dy / distance) * speed, 2.6 + flowStrength * 2.8, delta);
          } else if (flow > 0.04) {
            const leftChannel = Math.max(0, 1 - (particle.x - remoteRect.left) / 104);
            const spread = Math.min(1, Math.max(0, (particle.x - remoteRect.left) / Math.max(1, remoteRect.width * 0.58)));
            const scatterTargetY = remoteRect.top + remoteRect.height * particle.scatterY;
            const desiredVx = (23 + (1 - leftChannel) * 13) * flowStrength * movementScale;
            const turbulence =
              Math.sin(time * 0.00135 + particle.seed) *
              (7 + 18 * spread) *
              flowStrength *
              movementScale;
            const desiredVy =
              (scatterTargetY - particle.y) *
                (0.2 + spread * 0.34) *
                flowStrength *
                movementScale +
              turbulence;
            particle.vx = approach(particle.vx, desiredVx, 2.1, delta);
            particle.vy = approach(particle.vy, desiredVy, 1.65 + spread * 0.9, delta);
          } else {
            particle.vx *= Math.exp(-2.6 * delta);
            particle.vy *= Math.exp(-2.6 * delta);
          }

          particle.x += particle.vx * delta;
          particle.y += particle.vy * delta;

          if (
            activeMix > 0.3 &&
            flow < -0.16 &&
            particle.x <= remoteRect.left + 7 &&
            Math.abs(particle.y - portalTargetY) < 9
          ) {
            placeLinkParticle(particle, 1);
          } else {
            const left = remoteRect.left + 3;
            const right = remoteRect.left + remoteRect.width - 3;
            const top = remoteRect.top + 3;
            const bottom = remoteRect.top + remoteRect.height - 3;
            if (particle.x < left && (activeMix < 0.08 || flow >= -0.16)) particle.x = right;
            if (particle.x > right) {
              if (activeMix < 0.08) particle.x = left;
              else {
                particle.x = right;
                particle.vx = -Math.abs(particle.vx) * 0.36;
              }
            }
            if (particle.y < top) {
              if (activeMix < 0.08) particle.y = bottom;
              else {
                particle.y = top;
                particle.vy = Math.abs(particle.vy) * 0.42;
              }
            }
            if (particle.y > bottom) {
              if (activeMix < 0.08) particle.y = top;
              else {
                particle.y = bottom;
                particle.vy = -Math.abs(particle.vy) * 0.42;
              }
            }
          }
        }

        if (!reduceMotion && particle.mode === "link") {
          const previous = pathPointAt(particle.t);
          const cruise = (0.46 + Math.sin(particle.seed * 1.73) * 0.07) * movementScale;
          const targetVelocity = flow * activeMix * cruise;
          particle.tVelocity = approach(particle.tVelocity, targetVelocity, 3.4, delta);
          particle.t += particle.tVelocity * delta;
          const current = pathPointAt(particle.t);
          drawX = current.x + current.nx * particle.bandOffset;
          drawY = current.y + current.ny * particle.bandOffset;
          drawVx = delta > 0 ? (current.x - previous.x) / delta : 0;
          drawVy = delta > 0 ? (current.y - previous.y) / delta : 0;

          if (particle.t >= 1 && particle.tVelocity > 0) {
            placeFieldParticle(particle, false);
            drawX = particle.x;
            drawY = particle.y;
            drawVx = particle.vx;
            drawVy = particle.vy;
          } else if (particle.t <= 0 && particle.tVelocity < 0) {
            placeFieldParticle(particle, true);
            particle.age = random(0, particle.maxAge * 0.45);
          }
        }

        const shimmer = 0.72 + Math.sin(time * 0.0022 + particle.seed) * 0.28;
        const visibility = particle.mode === "link" ? activeMix : 0.62 + activeMix * 0.38;
        const alpha = particle.alpha * shimmer * visibility;
        drawTrail(drawX, drawY, drawVx, drawVy, particle.size, alpha, energized);
        drawHead(drawX, drawY, particle.size, alpha, energized);
      });

      borderParticles.forEach((particle) => {
        let drawX = 0;
        let drawY = 0;
        let drawVx = 0;
        let drawVy = 0;

        if (particle.mode === "border") {
          const previous = perimeterPoint(particle.position, remoteRect, portalY);
          if (!reduceMotion) {
            const outwardDirection = particle.branch;
            const inwardDirection = particle.branch === 1 ? -1 : 1;
            const targetDirection = flow >= 0 ? outwardDirection : inwardDirection;
            const targetVelocity = targetDirection * (8 + flowStrength * 62) * movementScale;
            particle.velocity = approach(particle.velocity, targetVelocity, 2.8, delta);
            particle.position += particle.velocity * delta;

            if (flow > 0.12) {
              if (particle.branch === 1 && particle.position >= perimeter) particle.position -= perimeter;
              if (particle.branch === -1 && particle.position <= 0) particle.position += perimeter;
            } else if (flow < -0.12) {
              const reachedPortal =
                (particle.branch === 1 && particle.position <= 0) ||
                (particle.branch === -1 && particle.position >= perimeter);
              if (reachedPortal) {
                particle.mode = "link";
                particle.t = 1;
                particle.tVelocity = 0;
              }
            }
          }

          if (particle.mode === "border") {
            const current = perimeterPoint(particle.position, remoteRect, portalY);
            drawX = current.x;
            drawY = current.y;
            drawVx = delta > 0 ? (current.x - previous.x) / delta : 0;
            drawVy = delta > 0 ? (current.y - previous.y) / delta : 0;
          }
        }

        if (particle.mode === "link") {
          const previous = pathPointAt(particle.t);
          if (!reduceMotion) {
            const cruise = (0.48 + Math.sin(particle.seed * 1.91) * 0.07) * movementScale;
            const targetVelocity = flow * activeMix * cruise;
            particle.tVelocity = approach(particle.tVelocity, targetVelocity, 3.4, delta);
            particle.t += particle.tVelocity * delta;
          }
          const current = pathPointAt(particle.t);
          drawX = current.x + current.nx * particle.bandOffset;
          drawY = current.y + current.ny * particle.bandOffset;
          drawVx = delta > 0 ? (current.x - previous.x) / delta : 0;
          drawVy = delta > 0 ? (current.y - previous.y) / delta : 0;

          if (particle.t >= 1 && particle.tVelocity > 0) {
            particle.mode = "border";
            particle.position = particle.branch === 1 ? 0 : perimeter;
            particle.velocity = particle.branch * 18;
          } else if (particle.t <= 0 && particle.tVelocity < 0) {
            particle.mode = "border";
            particle.position = random(perimeter * 0.26, perimeter * 0.74);
            particle.velocity = particle.branch * 4;
          }
        }

        const shimmer = 0.76 + Math.sin(time * 0.002 + particle.seed) * 0.24;
        const visibility = particle.mode === "link" ? activeMix : 0.58 + activeMix * 0.42;
        const alpha = particle.alpha * shimmer * visibility;
        drawTrail(drawX, drawY, drawVx, drawVy, particle.size, alpha, energized);
        drawHead(drawX, drawY, particle.size, alpha, energized);
      });

      context.globalCompositeOperation = "source-over";
      frame = requestAnimationFrame(tick);
    };

    const observer = new ResizeObserver(rebuild);
    observer.observe(host);
    rebuild();
    tick(performance.now());

    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);

  return <canvas ref={canvasRef} className={`particle-canvas ${className}`} aria-hidden="true" />;
}

export const ParticleCanvas = memo(ParticleCanvasComponent);
