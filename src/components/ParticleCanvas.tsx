import { memo, useLayoutEffect, useRef } from "react";
import { shouldScheduleParticleFrame } from "../lib/motion";
import type { TransferDirection } from "../lib/types";

type ParticleMode = "field" | "fan" | "link";
type BorderMode = "border" | "link" | "idle";
type FanDestination = "field" | "border";

const BORDER_DIFFUSION_RATIO = 0.1;
const TRAIL_CAPACITY = 16;
const IDLE_FRAME_INTERVAL_MS = 1000 / 30;

function readCanvasPalette() {
  const styles = getComputedStyle(document.documentElement);
  return {
    upload: styles.getPropertyValue("--canvas-upload").trim() || "255, 138, 114",
    download: styles.getPropertyValue("--canvas-download").trim() || "105, 191, 255",
    idle: styles.getPropertyValue("--canvas-idle").trim() || "125, 151, 177"
  };
}

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
  fanT: number;
  fanVelocity: number;
  fanStart: Point;
  fanControlA: Point;
  fanControlB: Point;
  fanEnd: Point;
  fanDestination: FanDestination;
  borderPosition: number;
  borderBranch: 1 | -1;
  trail: Trail;
}

interface BorderParticle {
  mode: BorderMode;
  primed: boolean;
  position: number;
  velocity: number;
  branch: 1 | -1;
  t: number;
  tVelocity: number;
  size: number;
  alpha: number;
  seed: number;
  bandOffset: number;
  wait: number;
  trail: Trail;
}

interface Point {
  x: number;
  y: number;
}

interface PathPoint extends Point {
  nx: number;
  ny: number;
}

interface BorderPathPoint extends PathPoint {
  length: number;
}

interface Trail {
  coordinates: Float32Array;
  start: number;
  length: number;
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

function createTrail(): Trail {
  return {
    coordinates: new Float32Array(TRAIL_CAPACITY * 2),
    start: 0,
    length: 0
  };
}

function clearTrail(trail: Trail) {
  trail.start = 0;
  trail.length = 0;
}

function trimTrail(trail: Trail, limit: number) {
  if (trail.length <= limit) return;
  trail.start = (trail.start + trail.length - limit) % TRAIL_CAPACITY;
  trail.length = limit;
}

function updateTrail(trail: Trail, x: number, y: number, limit = 16) {
  const boundedLimit = Math.min(TRAIL_CAPACITY, Math.max(1, limit));
  if (trail.length > 0) {
    const previousIndex = ((trail.start + trail.length - 1) % TRAIL_CAPACITY) * 2;
    if (
      Math.hypot(
        x - trail.coordinates[previousIndex],
        y - trail.coordinates[previousIndex + 1]
      ) > 48
    ) {
      clearTrail(trail);
    }
  }
  trimTrail(trail, boundedLimit);

  let writeIndex: number;
  if (trail.length < boundedLimit) {
    writeIndex = (trail.start + trail.length) % TRAIL_CAPACITY;
    trail.length += 1;
  } else {
    trail.start = (trail.start + 1) % TRAIL_CAPACITY;
    writeIndex = (trail.start + trail.length - 1) % TRAIL_CAPACITY;
  }
  const coordinateIndex = writeIndex * 2;
  trail.coordinates[coordinateIndex] = x;
  trail.coordinates[coordinateIndex + 1] = y;
}

function copyTrailTail(source: Trail, target: Trail, count: number) {
  const copyCount = Math.min(count, source.length);
  target.start = 0;
  target.length = copyCount;
  for (let index = 0; index < copyCount; index += 1) {
    const sourceIndex =
      ((source.start + source.length - copyCount + index) % TRAIL_CAPACITY) * 2;
    const targetIndex = index * 2;
    target.coordinates[targetIndex] = source.coordinates[sourceIndex];
    target.coordinates[targetIndex + 1] = source.coordinates[sourceIndex + 1];
  }
}

function roundedBorderPoint(
  position: number,
  rect: Rect,
  portalY: number,
  branch: 1 | -1,
  output: BorderPathPoint
) {
  const inset = 3;
  const left = rect.left + inset;
  const right = rect.left + rect.width - inset;
  const top = rect.top + inset;
  const bottom = rect.top + rect.height - inset;
  const radius = Math.max(6, Math.min(21, (right - left) * 0.5, (bottom - top) * 0.5));
  const centerY = Math.min(bottom - radius, Math.max(top + radius, portalY));
  const vertical = branch === 1 ? centerY - top - radius : bottom - radius - centerY;
  const horizontal = Math.max(0, right - left - radius * 2);
  const arc = radius * Math.PI * 0.5;
  const total = vertical * 2 + horizontal + arc * 2;
  let distance = Math.min(1, Math.max(0, position)) * Math.max(1, total);
  let x = left;
  let y = centerY;
  let tx = 0;
  let ty = branch === 1 ? -1 : 1;

  if (distance <= vertical) {
    y = centerY + ty * distance;
  } else {
    distance -= vertical;
    if (distance <= arc) {
      const progress = distance / arc;
      const angle = branch === 1
        ? Math.PI + progress * Math.PI * 0.5
        : Math.PI - progress * Math.PI * 0.5;
      x = left + radius + Math.cos(angle) * radius;
      y = branch === 1
        ? top + radius + Math.sin(angle) * radius
        : bottom - radius + Math.sin(angle) * radius;
      tx = branch === 1 ? -Math.sin(angle) : Math.sin(angle);
      ty = branch === 1 ? Math.cos(angle) : -Math.cos(angle);
    } else {
      distance -= arc;
      if (distance <= horizontal) {
        x = left + radius + distance;
        y = branch === 1 ? top : bottom;
        tx = 1;
        ty = 0;
      } else {
        distance -= horizontal;
        if (distance <= arc) {
          const progress = distance / arc;
          const angle = branch === 1
            ? -Math.PI * 0.5 + progress * Math.PI * 0.5
            : Math.PI * 0.5 - progress * Math.PI * 0.5;
          x = right - radius + Math.cos(angle) * radius;
          y = branch === 1
            ? top + radius + Math.sin(angle) * radius
            : bottom - radius + Math.sin(angle) * radius;
          tx = branch === 1 ? -Math.sin(angle) : Math.sin(angle);
          ty = branch === 1 ? Math.cos(angle) : -Math.cos(angle);
        } else {
          distance -= arc;
          x = right;
          y = branch === 1 ? top + radius + distance : bottom - radius - distance;
          tx = 0;
          ty = branch === 1 ? 1 : -1;
        }
      }
    }
  }

  output.x = x;
  output.y = y;
  output.nx = -ty;
  output.ny = tx;
  output.length = total;
  return output;
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
  const wakeFrameRef = useRef<() => void>(() => undefined);
  const animationState = useRef({ active, direction, intensity });
  animationState.current = { active, direction, intensity };

  useLayoutEffect(() => {
    wakeFrameRef.current();
  }, [active, direction, intensity]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const host = canvas.closest<HTMLElement>(".network-stage") ?? canvas.parentElement ?? canvas;
    const context = canvas.getContext("2d");
    if (!context) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let palette = readCanvasPalette();
    let width = 0;
    let height = 0;
    let remoteRect: Rect = { left: 1, top: 1, width: 1, height: 1 };
    let portalY = 1;
    let cablePathPoints: PathPoint[] = [];
    let fieldGatherProgress = 1;
    let frame = 0;
    let previousTime = performance.now();
    let activeMix = animationState.current.active ? 1 : 0;
    let flow = animationState.current.direction === "upload" ? 1 : -1;
    let speedMix = Math.min(1, Math.max(0, animationState.current.intensity));
    let particleReleaseClock = 0;
    let particles: Particle[] = [];
    let borderParticles: BorderParticle[] = [];
    let pageVisible = !document.hidden;
    let wasEnergized = activeMix > 0.035;
    const gatherPoint: PathPoint = { x: 0, y: 0, nx: 0, ny: 1 };
    const nextGatherPoint: PathPoint = { x: 0, y: 0, nx: 0, ny: 1 };
    const pathPoint: PathPoint = { x: 0, y: 0, nx: 0, ny: 1 };
    const borderPoint: BorderPathPoint = { x: 0, y: 0, nx: 0, ny: 1, length: 1 };

    const pathPointAt = (points: PathPoint[], progress: number, output: PathPoint) => {
      if (points.length === 0) {
        output.x = 0;
        output.y = portalY;
        output.nx = 0;
        output.ny = 1;
        return output;
      }
      const bounded = Math.min(1, Math.max(0, progress));
      const scaled = bounded * Math.max(0, points.length - 1);
      const index = Math.min(points.length - 1, Math.floor(scaled));
      const next = points[Math.min(points.length - 1, index + 1)];
      const current = points[index];
      const amount = scaled - index;
      output.x = current.x + (next.x - current.x) * amount;
      output.y = current.y + (next.y - current.y) * amount;
      output.nx = current.nx + (next.nx - current.nx) * amount;
      output.ny = current.ny + (next.ny - current.ny) * amount;
      return output;
    };

    const placeFieldParticle = (particle: Particle, resetTrail = true) => {
      particle.mode = "field";
      const scatterAngle = random(-Math.PI / 2, Math.PI / 2);
      const portalRatio = (portalY - remoteRect.top) / Math.max(1, remoteRect.height);
      particle.scatterY = Math.min(
        0.96,
        Math.max(0.04, portalRatio + Math.sin(scatterAngle) * random(0.4, 0.56))
      );
      particle.x = random(remoteRect.left + 5, remoteRect.left + Math.max(6, remoteRect.width - 5));
      particle.y = random(remoteRect.top + 5, remoteRect.top + Math.max(6, remoteRect.height - 5));
      particle.vx = random(-5, 5);
      particle.vy = random(-7, 7);
      particle.age = 0;
      particle.maxAge = random(3.4, 6.4);
      if (resetTrail) clearTrail(particle.trail);
    };

    const placeLinkParticle = (particle: Particle, progress: number, resetTrail = true) => {
      particle.mode = "link";
      particle.t = progress;
      particle.tVelocity = 0;
      particle.age = 0;
      if (resetTrail) clearTrail(particle.trail);
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
        scatterY: random(0.08, 0.92),
        fanT: 0,
        fanVelocity: 0,
        fanStart: { x: 0, y: 0 },
        fanControlA: { x: 0, y: 0 },
        fanControlB: { x: 0, y: 0 },
        fanEnd: { x: 0, y: 0 },
        fanDestination: "field",
        borderPosition: 0,
        borderBranch: 1,
        trail: createTrail()
      };
      placeFieldParticle(particle);
      particle.age = random(0, particle.maxAge);
      return particle;
    };

    const createBorderParticle = (): BorderParticle => ({
      mode: "idle",
      primed: false,
      position: 1,
      velocity: 0,
      branch: Math.random() > 0.5 ? 1 : -1,
      t: 0,
      tVelocity: 0,
      size: random(0.82, 1.34),
      alpha: random(0.42, 0.86),
      seed: random(0, Math.PI * 2),
      bandOffset: (Math.random() > 0.5 ? 1 : -1) * random(5.2, 10.2),
      wait: 0,
      trail: createTrail()
    });

    const withNormals = (raw: Point[]) => raw.map((point, index) => {
      const before = raw[Math.max(0, index - 1)];
      const after = raw[Math.min(raw.length - 1, index + 1)];
      const dx = after.x - before.x;
      const dy = after.y - before.y;
      const length = Math.max(0.001, Math.hypot(dx, dy));
      return { ...point, nx: -dy / length, ny: dx / length };
    });

    const cubicPoint = (start: Point, controlA: Point, controlB: Point, end: Point, t: number) => {
      const inverse = 1 - t;
      return {
        x:
          inverse ** 3 * start.x +
          3 * inverse ** 2 * t * controlA.x +
          3 * inverse * t ** 2 * controlB.x +
          t ** 3 * end.x,
        y:
          inverse ** 3 * start.y +
          3 * inverse ** 2 * t * controlA.y +
          3 * inverse * t ** 2 * controlB.y +
          t ** 3 * end.y
      };
    };

    const placeFanParticle = (
      particle: Particle,
      fieldEnd?: Point,
      borderEntry?: { position: number; branch: 1 | -1 }
    ) => {
      const gather = pathPointAt(cablePathPoints, fieldGatherProgress, gatherPoint);
      const next = pathPointAt(
        cablePathPoints,
        Math.min(1, fieldGatherProgress + 0.012),
        nextGatherPoint
      );
      const rawTangentX = next.x - gather.x;
      const rawTangentY = next.y - gather.y;
      const rawTangentLength = Math.max(0.001, Math.hypot(rawTangentX, rawTangentY));
      const guardedTangentX = Math.max(0.16, rawTangentX / rawTangentLength);
      const guardedTangentY = rawTangentY / rawTangentLength;
      const guardedTangentLength = Math.hypot(guardedTangentX, guardedTangentY);
      const tangentX = guardedTangentX / guardedTangentLength;
      const tangentY = guardedTangentY / guardedTangentLength;
      const start = {
        x: gather.x + gather.nx * particle.bandOffset,
        y: gather.y + gather.ny * particle.bandOffset
      };
      const angle = (particle.scatterY - 0.5) * Math.PI * 0.86;
      const borderEnd = borderEntry
        ? roundedBorderPoint(borderEntry.position, remoteRect, portalY, borderEntry.branch, {
            x: 0,
            y: 0,
            nx: 0,
            ny: 1,
            length: 1
          })
        : null;
      const end =
        borderEnd ??
        fieldEnd ?? {
          x: remoteRect.left + random(remoteRect.width * 0.2, remoteRect.width * 0.56),
          y: Math.min(
            remoteRect.top + remoteRect.height - 22,
            Math.max(
              remoteRect.top + 22,
              portalY + Math.sin(angle) * random(remoteRect.height * 0.27, remoteRect.height * 0.46)
            )
          )
        };
      const distance = Math.max(1, Math.hypot(end.x - start.x, end.y - start.y));
      const entryHandle = Math.min(72, Math.max(34, distance * 0.28));
      const horizontalDistance = Math.max(12, end.x - start.x);
      const startHandle = Math.min(entryHandle, horizontalDistance * 0.34);
      const endHandle = Math.min(entryHandle * 0.72, horizontalDistance * 0.3);

      particle.mode = "fan";
      particle.fanStart = start;
      particle.fanControlA = {
        x: start.x + tangentX * startHandle,
        y: start.y + tangentY * startHandle
      };
      particle.fanControlB = {
        x: Math.max(start.x + startHandle, end.x - endHandle),
        y: end.y
      };
      particle.fanEnd = end;
      particle.fanDestination = borderEntry ? "border" : "field";
      particle.borderPosition = borderEntry?.position ?? 0;
      particle.borderBranch = borderEntry?.branch ?? 1;
      particle.fanT = fieldEnd && !borderEntry ? 1 + random(0, 0.28) : 0;
      particle.fanVelocity = 0;
      trimTrail(particle.trail, 8);
    };

    const finishFanAsField = (particle: Particle) => {
      const tangentX = particle.fanEnd.x - particle.fanControlB.x;
      const tangentY = particle.fanEnd.y - particle.fanControlB.y;
      const tangentLength = Math.max(0.001, Math.hypot(tangentX, tangentY));
      const speed = random(28, 46) * (1.08 + speedMix * 0.92);
      particle.mode = "field";
      particle.x = particle.fanEnd.x;
      particle.y = particle.fanEnd.y;
      particle.vx = (tangentX / tangentLength) * speed;
      particle.vy = (tangentY / tangentLength) * speed;
      particle.age = 0;
    };

    const finishFanAsBorder = (particle: Particle) => {
      const borderParticle = borderParticles.find(
        (candidate) => candidate.mode === "idle" && !candidate.primed
      );
      if (!borderParticle) return false;

      borderParticle.mode = "border";
      borderParticle.primed = true;
      borderParticle.position = particle.borderPosition;
      borderParticle.velocity = 0;
      borderParticle.branch = particle.borderBranch;
      borderParticle.size = particle.size;
      borderParticle.alpha = particle.alpha;
      borderParticle.seed = particle.seed;
      borderParticle.wait = 0;
      copyTrailTail(particle.trail, borderParticle.trail, 6);
      placeFieldParticle(particle);
      particle.age = random(0, particle.maxAge * 0.45);
      return true;
    };

    const sampleCablePath = (hostBounds: DOMRect) => {
      const rail = host.querySelector<SVGPathElement>(".energy-rail");
      const matrix = rail?.getScreenCTM();
      let raw: Point[];
      if (rail && matrix) {
        const total = rail.getTotalLength();
        const samples = 180;
        raw = Array.from({ length: samples + 1 }, (_, index) => {
          const point = rail.getPointAtLength((total * index) / samples);
          const transformed = new DOMPoint(point.x, point.y).matrixTransform(matrix);
          return { x: transformed.x - hostBounds.left, y: transformed.y - hostBounds.top };
        });
      } else {
        const start = { x: Math.max(0, remoteRect.left - 180), y: portalY };
        raw = Array.from({ length: 181 }, (_, index) => {
          const t = index / 180;
          const x = start.x + (remoteRect.left - start.x) * t;
          const y = portalY + Math.sin(t * Math.PI) * 28;
          return { x, y };
        });
      }

      const railEnd = raw.at(-1) ?? { x: remoteRect.left, y: portalY };
      const radius = Math.min(24, remoteRect.height * 0.12);
      portalY = Math.min(
        remoteRect.top + remoteRect.height - radius - 8,
        Math.max(remoteRect.top + radius + 8, railEnd.y)
      );
      const portal = { x: remoteRect.left + 3, y: portalY };
      const beforeRailEnd = raw.at(-2) ?? { x: railEnd.x - 1, y: railEnd.y };
      const tangentX = railEnd.x - beforeRailEnd.x;
      const tangentY = railEnd.y - beforeRailEnd.y;
      const tangentLength = Math.max(0.001, Math.hypot(tangentX, tangentY));
      const connectorDistance = Math.hypot(portal.x - railEnd.x, portal.y - railEnd.y);
      if (connectorDistance > 0.5) {
        const handle = Math.max(8, Math.min(34, connectorDistance * 0.62));
        const controlA = {
          x: railEnd.x + (tangentX / tangentLength) * handle,
          y: railEnd.y + (tangentY / tangentLength) * handle
        };
        const controlB = { x: portal.x - handle * 0.72, y: portal.y };
        for (let index = 1; index <= 20; index += 1) {
          raw.push(cubicPoint(railEnd, controlA, controlB, portal, index / 20));
        }
      } else {
        raw[raw.length - 1] = portal;
      }

      cablePathPoints = withNormals(raw);
      const gatherTarget = { x: remoteRect.left - 20, y: portalY };
      const gatherIndex = raw.reduce(
        (closest, point, index) =>
          Math.abs(point.x - gatherTarget.x) < Math.abs(raw[closest].x - gatherTarget.x)
            ? index
            : closest,
        0
      );
      fieldGatherProgress = gatherIndex / Math.max(1, raw.length - 1);
    };

    const rebuild = () => {
      const hostBounds = host.getBoundingClientRect();
      const remoteBounds = host.querySelector<HTMLElement>(".remote-node")?.getBoundingClientRect();
      const previousRect = remoteRect;
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

      const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.lineCap = "round";
      context.lineJoin = "round";
      sampleCablePath(hostBounds);

      if (particles.length) {
        const remapPoint = (point: Point) => ({
          x:
            remoteRect.left +
            ((point.x - previousRect.left) / Math.max(1, previousRect.width)) * remoteRect.width,
          y:
            remoteRect.top +
            ((point.y - previousRect.top) / Math.max(1, previousRect.height)) * remoteRect.height
        });
        particles.forEach((particle) => {
          if (particle.mode === "field") {
            const remapped = remapPoint(particle);
            particle.x = remapped.x;
            particle.y = remapped.y;
          } else if (particle.mode === "fan") {
            particle.fanStart = remapPoint(particle.fanStart);
            particle.fanControlA = remapPoint(particle.fanControlA);
            particle.fanControlB = remapPoint(particle.fanControlB);
            particle.fanEnd = remapPoint(particle.fanEnd);
          }
        });
      }

      const particleCount = Math.max(72, Math.min(120, Math.round((remoteRect.width * remoteRect.height) / 2500)));
      const roundedPerimeter = Math.max(1, (remoteRect.width - 6) * 2 + (remoteRect.height - 6) * 2);
      const borderCount = Math.max(26, Math.min(42, Math.round(roundedPerimeter / 38)));
      while (particles.length < particleCount) particles.push(createParticle());
      if (particles.length > particleCount) particles.length = particleCount;
      while (borderParticles.length < borderCount) borderParticles.push(createBorderParticle());
      if (borderParticles.length > borderCount) borderParticles.length = borderCount;

    };

    const releaseUploadParticles = (delta: number) => {
      if (reduceMotion || activeMix < 0.2 || flow < 0.14) {
        particleReleaseClock = 0;
        return;
      }

      const particleTarget = Math.max(18, Math.round(particles.length * 0.17));
      const movementScale = 1.08 + speedMix * 0.92;
      const particleInterval = Math.max(0.045, Math.min(0.12, 1 / (0.46 * movementScale * particleTarget)));
      particleReleaseClock = Math.min(particleInterval * 1.1, particleReleaseClock + delta * activeMix);
      if (particleReleaseClock < particleInterval) return;

      let linkCount = 0;
      let candidate: Particle | null = null;
      let candidateAge = -1;
      for (const particle of particles) {
        if (particle.mode === "link") {
          linkCount += 1;
        } else if (particle.mode === "field") {
          const normalizedAge = particle.age / particle.maxAge;
          if (normalizedAge > candidateAge) {
            candidate = particle;
            candidateAge = normalizedAge;
          }
        }
      }

      if (linkCount < particleTarget && candidate) {
        placeLinkParticle(candidate, 0);
        particleReleaseClock -= particleInterval;
      } else {
        // Avoid rescanning the full pool every frame while the link is saturated.
        particleReleaseClock = 0;
      }
    };

    const drawTrail = (trail: Trail, size: number, alpha: number, energized: boolean) => {
      if (trail.length < 3) return;
      let bufferIndex = trail.start;
      let coordinateIndex = bufferIndex * 2;
      context.beginPath();
      context.moveTo(
        trail.coordinates[coordinateIndex],
        trail.coordinates[coordinateIndex + 1]
      );
      for (let index = 1; index < trail.length; index += 1) {
        bufferIndex = bufferIndex + 1 === TRAIL_CAPACITY ? 0 : bufferIndex + 1;
        coordinateIndex = bufferIndex * 2;
        context.lineTo(
          trail.coordinates[coordinateIndex],
          trail.coordinates[coordinateIndex + 1]
        );
      }
      context.lineWidth = Math.max(1.6, size * 2.3);
      const color = energized
        ? animationState.current.direction === "upload" ? palette.upload : palette.download
        : palette.idle;
      context.strokeStyle = `rgba(${color}, ${alpha * 0.34})`;
      context.stroke();

      const coreStart = Math.floor(trail.length * 0.46);
      bufferIndex = (trail.start + coreStart) % TRAIL_CAPACITY;
      coordinateIndex = bufferIndex * 2;
      context.beginPath();
      context.moveTo(
        trail.coordinates[coordinateIndex],
        trail.coordinates[coordinateIndex + 1]
      );
      for (let index = coreStart + 1; index < trail.length; index += 1) {
        bufferIndex = bufferIndex + 1 === TRAIL_CAPACITY ? 0 : bufferIndex + 1;
        coordinateIndex = bufferIndex * 2;
        context.lineTo(
          trail.coordinates[coordinateIndex],
          trail.coordinates[coordinateIndex + 1]
        );
      }
      context.lineWidth = Math.max(1.05, size * 1.38);
      context.strokeStyle = `rgba(${color}, ${alpha * 0.88})`;
      context.stroke();
    };

    const drawHead = (x: number, y: number, size: number, alpha: number, energized: boolean) => {
      if (energized) {
        context.beginPath();
        context.arc(x, y, size * 3.8, 0, Math.PI * 2);
        const color = animationState.current.direction === "upload" ? palette.upload : palette.download;
        context.fillStyle = `rgba(${color}, ${alpha * 0.24})`;
        context.fill();
      }
      context.beginPath();
      context.arc(x, y, energized ? size * 1.24 : size * 0.84, 0, Math.PI * 2);
      const color = energized
        ? animationState.current.direction === "upload" ? palette.upload : palette.download
        : palette.idle;
      context.fillStyle = `rgba(${color}, ${energized ? alpha : alpha * 0.58})`;
      context.fill();
    };

    const tick = (time: number) => {
      // Pause the render loop while the window is backgrounded; resume on the
      // next frame after it becomes visible so elapsed motion does not jump.
      if (!pageVisible) {
        frame = 0;
        return;
      }
      const targetActive = animationState.current.active;
      // Keep tests fluid while lowering redraw cost for idle and reduced-motion states.
      const minimumFrameInterval = reduceMotion
        ? 0
        : targetActive || activeMix > 0.08
          ? 0
          : IDLE_FRAME_INTERVAL_MS;
      if (minimumFrameInterval > 0 && time - previousTime < minimumFrameInterval) {
        frame = requestAnimationFrame(tick);
        return;
      }

      const delta = Math.min(reduceMotion ? 0.1 : 0.034, Math.max(0.001, (time - previousTime) / 1000));
      previousTime = time;
      const targetActiveMix = targetActive ? 1 : 0;
      const targetFlow = animationState.current.direction === "upload" ? 1 : -1;
      const targetSpeed = Math.min(1, Math.max(0, animationState.current.intensity));
      activeMix = reduceMotion ? targetActiveMix : approach(activeMix, targetActiveMix, targetActive ? 3.8 : 0.9, delta);
      flow = reduceMotion ? targetFlow : approach(flow, targetFlow, 2.25, delta);
      speedMix = reduceMotion ? targetSpeed : approach(speedMix, targetSpeed, 2.4, delta);
      releaseUploadParticles(delta);
      const energized = activeMix > 0.035;
      if (!reduceMotion && energized && !wasEnergized) {
        particles.forEach((particle) => clearTrail(particle.trail));
        borderParticles.forEach((particle) => clearTrail(particle.trail));
      }
      wasEnergized = energized;
      const flowStrength = Math.abs(flow) * activeMix;
      const movementScale = 1.08 + speedMix * 0.92;

      context.clearRect(0, 0, width, height);
      context.globalCompositeOperation = energized ? "lighter" : "source-over";

      particles.forEach((particle) => {
        let drawX = particle.x;
        let drawY = particle.y;

        if (!reduceMotion && particle.mode === "field") {
          particle.age += delta * Math.max(0.25, activeMix);
          if (activeMix >= 0.08 && flow < -0.04) {
            placeFanParticle(particle, { x: particle.x, y: particle.y });
          } else if (activeMix < 0.08) {
            particle.vx += Math.sin(time * 0.0007 + particle.seed) * delta * 2.4;
            particle.vy += Math.cos(time * 0.0006 + particle.seed) * delta * 2;
            particle.vx *= 0.995;
            particle.vy *= 0.995;
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

          if (particle.mode === "field") {
            particle.x += particle.vx * delta;
            particle.y += particle.vy * delta;
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

        if (!reduceMotion && particle.mode === "fan") {
          const cruise = (0.42 + Math.sin(particle.seed * 1.37) * 0.055) * movementScale;
          const targetVelocity = flow * activeMix * cruise;
          particle.fanVelocity = approach(particle.fanVelocity, targetVelocity, 3.2, delta);
          particle.fanT += particle.fanVelocity * delta;
          const fanProgress = Math.min(1, Math.max(0, particle.fanT));
          const inverse = 1 - fanProgress;
          drawX =
            inverse ** 3 * particle.fanStart.x +
            3 * inverse ** 2 * fanProgress * particle.fanControlA.x +
            3 * inverse * fanProgress ** 2 * particle.fanControlB.x +
            fanProgress ** 3 * particle.fanEnd.x;
          drawY =
            inverse ** 3 * particle.fanStart.y +
            3 * inverse ** 2 * fanProgress * particle.fanControlA.y +
            3 * inverse * fanProgress ** 2 * particle.fanControlB.y +
            fanProgress ** 3 * particle.fanEnd.y;

          if (particle.fanT >= 1 && particle.fanVelocity > 0) {
            if (particle.fanDestination === "border" && finishFanAsBorder(particle)) return;
            finishFanAsField(particle);
            drawX = particle.x;
            drawY = particle.y;
          } else if (particle.fanT <= 0 && particle.fanVelocity < 0) {
            placeLinkParticle(particle, fieldGatherProgress, false);
          }
        }

        if (!reduceMotion && particle.mode === "link") {
          const cruise = (0.46 + Math.sin(particle.seed * 1.73) * 0.07) * movementScale;
          const targetVelocity = flow * activeMix * cruise;
          particle.tVelocity = approach(particle.tVelocity, targetVelocity, 3.4, delta);
          particle.t += particle.tVelocity * delta;
          const current = pathPointAt(cablePathPoints, particle.t, pathPoint);
          drawX = current.x + current.nx * particle.bandOffset;
          drawY = current.y + current.ny * particle.bandOffset;

          if (particle.t >= fieldGatherProgress && particle.tVelocity > 0) {
            particle.t = fieldGatherProgress;
            const borderEntry =
              Math.random() < BORDER_DIFFUSION_RATIO
                ? {
                    position: random(0.08, 0.92),
                    branch: (Math.random() > 0.5 ? 1 : -1) as 1 | -1
                  }
                : undefined;
            placeFanParticle(particle, undefined, borderEntry);
            drawX = particle.fanStart.x;
            drawY = particle.fanStart.y;
          } else if (particle.t <= 0 && particle.tVelocity < 0) {
            placeFieldParticle(particle);
            particle.age = random(0, particle.maxAge * 0.45);
          }
        }

        const shimmer = 0.72 + Math.sin(time * 0.0022 + particle.seed) * 0.28;
        const visibility = particle.mode === "link" ? activeMix : 0.62 + activeMix * 0.38;
        const alpha = particle.alpha * shimmer * visibility;
        const fanTrail = particle.mode === "fan";
        if (!reduceMotion && energized) {
          updateTrail(particle.trail, drawX, drawY, fanTrail ? 16 : 12);
          drawTrail(particle.trail, particle.size, fanTrail ? alpha * 0.72 : alpha, energized);
        }
        drawHead(drawX, drawY, particle.size, alpha, energized);
      });

      borderParticles.forEach((particle) => {
        let drawX = 0;
        let drawY = 0;

        if (particle.mode === "idle") {
          particle.wait -= delta * Math.max(0.35, activeMix);
          if (particle.primed && flow < -0.12 && activeMix > 0.12 && particle.wait <= 0) {
            particle.mode = "border";
            particle.position = 1;
            particle.velocity = 0;
            clearTrail(particle.trail);
          } else {
            return;
          }
        }

        if (particle.mode === "border") {
          const route = roundedBorderPoint(
            particle.position,
            remoteRect,
            portalY,
            particle.branch,
            borderPoint
          );
          if (!reduceMotion) {
            const pixelsPerSecond = (20 + flowStrength * 115) * movementScale;
            const targetVelocity = flow * flowStrength * pixelsPerSecond / Math.max(1, route.length);
            particle.velocity = approach(particle.velocity, targetVelocity, 2.8, delta);
            particle.position += particle.velocity * delta;

            if (particle.position >= 1 && particle.velocity > 0) {
              particle.mode = "idle";
              particle.position = 1;
              particle.wait = random(0.12, 0.72);
              clearTrail(particle.trail);
            } else if (particle.position <= 0 && particle.velocity < 0) {
              particle.mode = "link";
              particle.position = 0;
              particle.t = 1;
              particle.tVelocity = 0;
              trimTrail(particle.trail, 6);
            }
          }

          if (particle.mode === "border") {
            const current = roundedBorderPoint(
              particle.position,
              remoteRect,
              portalY,
              particle.branch,
              borderPoint
            );
            drawX = current.x;
            drawY = current.y;
          }
        }

        if (particle.mode === "link") {
          if (!reduceMotion) {
            const cruise = (0.48 + Math.sin(particle.seed * 1.91) * 0.07) * movementScale;
            const targetVelocity = flow * activeMix * cruise;
            particle.tVelocity = approach(particle.tVelocity, targetVelocity, 3.4, delta);
            particle.t += particle.tVelocity * delta;
          }
          const current = pathPointAt(cablePathPoints, particle.t, pathPoint);
          const laneMix = Math.min(1, Math.max(0, (1 - particle.t) * 4));
          drawX = current.x + current.nx * particle.bandOffset * laneMix;
          drawY = current.y + current.ny * particle.bandOffset * laneMix;

          if (particle.t >= 1 && particle.tVelocity > 0) {
            particle.mode = "border";
            particle.position = 0;
            particle.velocity = 0;
          } else if (particle.t <= 0 && particle.tVelocity < 0) {
            particle.mode = "idle";
            particle.primed = false;
            particle.position = 1;
            particle.wait = random(0.12, 0.72);
            clearTrail(particle.trail);
            return;
          }
        }

        const shimmer = 0.76 + Math.sin(time * 0.002 + particle.seed) * 0.24;
        const visibility = particle.mode === "link" ? activeMix : 0.58 + activeMix * 0.42;
        const alpha = particle.alpha * shimmer * visibility;
        if (!reduceMotion && energized) {
          updateTrail(particle.trail, drawX, drawY);
          drawTrail(particle.trail, particle.size, alpha, energized);
        }
        drawHead(drawX, drawY, particle.size, alpha, energized);
      });

      context.globalCompositeOperation = "source-over";
      frame = shouldScheduleParticleFrame({
        active: targetActive,
        activeMix,
        reducedMotion: reduceMotion,
        pageVisible
      })
        ? requestAnimationFrame(tick)
        : 0;
    };

    const wakeFrame = () => {
      if (!pageVisible || frame !== 0) return;
      previousTime = performance.now();
      frame = requestAnimationFrame(tick);
    };
    wakeFrameRef.current = wakeFrame;

    const handleVisibilityChange = () => {
      pageVisible = !document.hidden;
      if (pageVisible) wakeFrame();
    };

    const observer = new ResizeObserver(() => {
      rebuild();
      wakeFrame();
    });
    const themeObserver = new MutationObserver(() => {
      palette = readCanvasPalette();
      wakeFrame();
    });
    document.addEventListener("visibilitychange", handleVisibilityChange);
    observer.observe(host);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-color-theme"]
    });
    rebuild();
    tick(performance.now());

    return () => {
      observer.disconnect();
      themeObserver.disconnect();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      cancelAnimationFrame(frame);
      wakeFrameRef.current = () => undefined;
    };
  }, []);

  return <canvas ref={canvasRef} className={`particle-canvas ${className}`} aria-hidden="true" />;
}

export const ParticleCanvas = memo(ParticleCanvasComponent);
