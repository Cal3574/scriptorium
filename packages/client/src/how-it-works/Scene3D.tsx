import { useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Edges, RoundedBox, Sparkles } from '@react-three/drei';
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';

import { STOPS } from './stops';
import { useSceneColors, type SceneColors } from './theme-colors';
import {
  POINT_COUNT,
  QUESTION_POINT,
  bookOpacityFor,
  computeTarget,
  makeSeeds,
  nearestToQuestion,
} from './scene-layouts';

// The 3-D pinned stage (#83, futuristic revision): one fixed cloud of points
// that morphs between the eleven stops - a book, then its text, chapters,
// passages, a volumetric "meaning space", and back again for the question.
// Only ever mounted when motion is allowed and WebGL is available; otherwise
// the screen renders `FallbackVisual` instead. The stage is a deliberate dark
// "viewport into the machine" in both app themes (see `theme-colors.ts`) - the
// additive glow only reads on a dark ground. No external assets - every object
// here is generated in code.

const LERP_HALF_LIFE = 0.18; // seconds to close half the distance to target

function damp(current: number, target: number, dt: number): number {
  return target + (current - target) * Math.pow(2, -dt / LERP_HALF_LIFE);
}

/** Soft round sprite so every point reads as a glowing mote, not a square. */
function useDotTexture(): THREE.Texture {
  return useMemo(() => {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const g = ctx.createRadialGradient(
        size / 2,
        size / 2,
        0,
        size / 2,
        size / 2,
        size / 2,
      );
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.35, 'rgba(255,255,255,0.85)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
    }
    const tex = new THREE.Texture(canvas);
    tex.needsUpdate = true;
    return tex;
  }, []);
}

function PointCloud({ step, colors }: { step: number; colors: SceneColors }) {
  const seeds = useMemo(() => makeSeeds(), []);
  const geomRef = useRef<THREE.BufferGeometry>(null);
  const dot = useDotTexture();

  // Live buffers the frame loop writes into - seeded once at the mount step,
  // then only ever mutated in place by `useFrame` (never re-created, so the
  // morph is continuous across step changes).
  const live = useRef<{ pos: Float32Array; col: Float32Array }>(null);
  if (live.current === null) {
    const { pos, col } = computeTarget(STOPS[step]?.id, seeds, colors);
    live.current = { pos: pos.slice(), col: col.slice() };
  }
  const buffers = live.current;

  const target = useMemo(
    () => computeTarget(STOPS[step]?.id, seeds, colors),
    [step, seeds, colors],
  );

  useFrame((_, delta) => {
    const geom = geomRef.current;
    if (!geom) return;
    const dt = Math.min(delta, 0.05);
    const { pos, col } = buffers;
    for (let i = 0; i < pos.length; i++) {
      pos[i] = damp(pos[i], target.pos[i], dt);
      col[i] = damp(col[i], target.col[i], dt);
    }
    (geom.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (geom.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  });

  return (
    <points>
      <bufferGeometry ref={geomRef}>
        <bufferAttribute
          attach="attributes-position"
          args={[buffers.pos, 3]}
          count={POINT_COUNT}
        />
        <bufferAttribute
          attach="attributes-color"
          args={[buffers.col, 3]}
          count={POINT_COUNT}
        />
      </bufferGeometry>
      <pointsMaterial
        size={0.075}
        map={dot}
        vertexColors
        transparent
        depthWrite={false}
        sizeAttenuation
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

function QuestionProbe({
  step,
  colors,
}: {
  step: number;
  colors: SceneColors;
}) {
  const id = STOPS[step]?.id;
  const active = id === 'retrieve';
  const meshRef = useRef<THREE.Mesh>(null);
  const linesRef = useRef<THREE.LineSegments>(null);
  const seeds = useMemo(() => makeSeeds(), []);

  const linePositions = useMemo(() => {
    const { pos } = computeTarget('retrieve', seeds, colors);
    const near = nearestToQuestion(pos, QUESTION_POINT, 9);
    const arr = new Float32Array(near.length * 6);
    near.forEach((idx, n) => {
      arr[n * 6] = QUESTION_POINT[0];
      arr[n * 6 + 1] = QUESTION_POINT[1];
      arr[n * 6 + 2] = QUESTION_POINT[2];
      arr[n * 6 + 3] = pos[idx * 3];
      arr[n * 6 + 4] = pos[idx * 3 + 1];
      arr[n * 6 + 5] = pos[idx * 3 + 2];
    });
    return arr;
  }, [seeds, colors]);

  useFrame((state) => {
    const scale = active
      ? 1 + Math.sin(state.clock.elapsedTime * 4) * 0.12
      : 0.001;
    meshRef.current?.scale.setScalar(scale);
    if (linesRef.current)
      (linesRef.current.material as THREE.LineBasicMaterial).opacity = active
        ? 0.55
        : 0;
  });

  return (
    <group>
      <mesh ref={meshRef} position={QUESTION_POINT}>
        <sphereGeometry args={[0.09, 24, 24]} />
        <meshBasicMaterial color={colors.foreground} toneMapped={false} />
      </mesh>
      <lineSegments ref={linesRef}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[linePositions, 3]}
            count={linePositions.length / 3}
          />
        </bufferGeometry>
        <lineBasicMaterial
          color={colors.primary}
          transparent
          opacity={0}
          toneMapped={false}
        />
      </lineSegments>
    </group>
  );
}

function BookMesh({ step, colors }: { step: number; colors: SceneColors }) {
  const ref = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshStandardMaterial>(null);
  const targetOpacity = bookOpacityFor(STOPS[step]?.id);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    const mat = matRef.current;
    if (!mat) return;
    mat.opacity = damp(mat.opacity, targetOpacity, dt);
    if (ref.current) ref.current.visible = mat.opacity > 0.01;
  });

  return (
    <RoundedBox ref={ref} args={[1.5, 2.1, 0.32]} radius={0.05} smoothness={4}>
      <meshStandardMaterial
        ref={matRef}
        color={colors.primary}
        emissive={colors.primary}
        emissiveIntensity={0.55}
        roughness={0.25}
        metalness={0.35}
        transparent
        opacity={1}
      />
      <Edges threshold={15} color={colors.foreground} />
    </RoundedBox>
  );
}

function Rig({ step }: { step: number }) {
  const { camera, pointer } = useThree();
  // A gentle push in/out per act so the scroll feels like travel.
  const zTarget = STOPS[step]?.act === 'asking' ? 5.4 : 6.1;

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    camera.position.x = damp(camera.position.x, pointer.x * 0.6, dt);
    camera.position.y = damp(camera.position.y, pointer.y * 0.4, dt);
    camera.position.z = damp(camera.position.z, zTarget, dt);
    camera.lookAt(0, 0, 0);
  });

  return null;
}

function Scene({ step }: { step: number }) {
  const colors = useSceneColors();
  const rotor = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);

  useFrame((_, delta) => {
    if (rotor.current) rotor.current.rotation.y += delta * 0.075;
    if (ring.current) ring.current.rotation.z += delta * 0.04;
  });

  return (
    <>
      <fog attach="fog" args={[colors.background, 7, 16]} />
      <ambientLight intensity={0.5} />
      <pointLight position={[3, 4, 5]} intensity={45} color={colors.primary} />
      <pointLight position={[-4, -2, 2]} intensity={22} color={colors.bookB} />

      {/* A far, slowly turning ring - depth and a touch of the futuristic. */}
      <mesh ref={ring} position={[0, 0, -3.5]} rotation={[Math.PI / 2.4, 0, 0]}>
        <torusGeometry args={[4.6, 0.015, 8, 120]} />
        <meshBasicMaterial
          color={colors.primary}
          transparent
          opacity={0.35}
          toneMapped={false}
        />
      </mesh>

      <group ref={rotor}>
        <BookMesh step={step} colors={colors} />
        <PointCloud step={step} colors={colors} />
        <QuestionProbe step={step} colors={colors} />
      </group>

      <Sparkles
        count={50}
        scale={[10, 7, 7]}
        size={2.5}
        speed={0.25}
        opacity={0.4}
        color={colors.primary}
      />

      <Rig step={step} />

      <EffectComposer>
        <Bloom
          mipmapBlur
          intensity={1.7}
          luminanceThreshold={0.1}
          luminanceSmoothing={0.4}
        />
        <Vignette eskil={false} offset={0.25} darkness={0.55} />
      </EffectComposer>
    </>
  );
}

export default function Scene3D({ step }: { step: number }) {
  return (
    <Canvas
      className="!absolute inset-0"
      camera={{ position: [0, 0, 6], fov: 42 }}
      dpr={[1, 1.75]}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
    >
      <Scene step={step} />
    </Canvas>
  );
}
