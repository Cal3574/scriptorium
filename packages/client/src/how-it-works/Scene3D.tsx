import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

import { useTheme } from '../theme';
import { STOPS } from './stops';
import { readSceneColors, type SceneColors } from './theme-colors';
import {
  QUESTION_POINT,
  SEEDS,
  bookOpacityFor,
  computeTarget,
  nearestToQuestion,
  pointCloudOpacityFor,
} from './scene-layouts';

// The 3-D pinned stage (#83). One book that comes apart into a cloud of points
// and settles into a "meaning space", then a question drops into that space
// and the nearest passages light up - the whole pipeline as one continuous
// object. Written as imperative three.js (no react-three-fiber): the scene is
// simple and self-contained, and owning the canvas, the resize handling and
// the render loop directly removes a whole class of mount/measure bugs. Only
// mounted when motion is allowed and WebGL is available (see `PinnedStage`);
// always a dark viewport in both app themes (see `theme-colors.ts`).

const HALF_LIFE = 0.16;
const damp = (current: number, target: number, dt: number) =>
  target + (current - target) * Math.pow(2, -dt / HALF_LIFE);

// The book model (a Sketchfab export, optimised to ~240 KB). Lives in
// public/, so it is only fetched once the 3-D scene actually mounts. A
// procedural slab stands in until it loads.
const BOOK_URL = `${import.meta.env.BASE_URL}how-it-works/book.glb`;
const BOOK_SIZE = 2.2; // world units for the model's largest dimension
// Applied after the model's own baked node transform is stripped: stands the
// book upright with the front cover toward the camera (and not mirrored).
const BOOK_ROTATION: [number, number, number] = [-Math.PI / 2, 0, 0];

function hexToRgbStr(hex: string): string {
  const h = hex.replace('#', '');
  const n = parseInt(
    h.length === 3 ? h[0] + h[0] + h[1] + h[1] + h[2] + h[2] : h || '7d9dc4',
    16,
  );
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

// Deep-dispose an Object3D: geometry, materials and every texture they hold.
function disposeTree(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    mesh.geometry?.dispose?.();
    const mats = Array.isArray(mesh.material)
      ? mesh.material
      : mesh.material
        ? [mesh.material]
        : [];
    for (const m of mats) {
      for (const key of Object.keys(m)) {
        const val = (m as unknown as Record<string, unknown>)[key];
        if (val instanceof THREE.Texture) val.dispose();
      }
      m.dispose();
    }
  });
}

function radialTexture(stops: [number, string][]): THREE.Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    for (const [offset, color] of stops) g.addColorStop(offset, color);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.Texture(canvas);
  tex.needsUpdate = true;
  return tex;
}

// Builds the whole scene onto `canvas`, drives it, and returns a teardown.
// `getStep` is read every frame so step changes never remount anything.
function mountScene(
  canvas: HTMLCanvasElement,
  host: HTMLElement,
  getStep: () => number,
  C: SceneColors,
): () => void {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  // Transparent canvas - the page background shows through so the scene reads
  // as part of the page, not a boxed viewport.
  renderer.setClearColor(0x000000, 0);

  // Additive glow only works on a dark ground; light theme uses normal blend.
  const blend = C.isDark ? THREE.AdditiveBlending : THREE.NormalBlending;
  const glowOpacity = C.isDark ? 1 : 0.45;

  const scene = new THREE.Scene();
  // Fog to the page colour so anything far just dissolves into the page - no
  // horizon, no visible extent to the "scene".
  scene.fog = new THREE.Fog(C.background, 5.5, 12);

  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  camera.position.set(0, 0.3, 6.9);

  // Just enough light to shape the object - no environment, no floor, nothing
  // for a wash to land on. The object floats in the page background.
  scene.add(new THREE.AmbientLight(0xffffff, 1.15));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(2, 3, 5);
  const front = new THREE.DirectionalLight(0xffffff, 1.1);
  front.position.set(-1, 0.5, 4);
  const warm = new THREE.PointLight(C.bookB, 18);
  warm.position.set(-3, -1, 3);
  const cool = new THREE.PointLight(C.primary, 30);
  cool.position.set(-4, 2, 1);
  scene.add(key, front, warm, cool);

  // A single tight aura hugging the object - a hint of glow, not a lit box.
  const rgb = hexToRgbStr(C.primary);
  const glowTex = radialTexture([
    [0, `rgba(${rgb},0.6)`],
    [0.5, `rgba(${rgb},0.14)`],
    [1, `rgba(${rgb},0)`],
  ]);
  const glow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowTex,
      transparent: true,
      opacity: 0.4 * glowOpacity,
      depthWrite: false,
      blending: blend,
      fog: false,
    }),
  );
  glow.scale.set(4, 5, 1);
  glow.position.set(0, 0, -0.6);
  scene.add(glow);

  // ---- the object ----
  const rotor = new THREE.Group();
  scene.add(rotor);

  // Placeholder slab shown for the moment before the book model loads (and
  // the fallback if the model fails to load).
  const coverMat = new THREE.MeshStandardMaterial({
    color: '#222c3b',
    emissive: C.primary,
    emissiveIntensity: 0.32,
    roughness: 0.14,
    metalness: 0.55,
    transparent: true,
    opacity: 1,
  });
  const pagesMat = new THREE.MeshStandardMaterial({
    color: C.foreground,
    roughness: 0.85,
    transparent: true,
    opacity: 0,
  });
  const spineMat = new THREE.MeshStandardMaterial({
    color: C.bookB,
    emissive: C.bookB,
    emissiveIntensity: 0.8,
    roughness: 0.4,
    transparent: true,
    opacity: 0.9,
  });
  const seamMat = new THREE.LineBasicMaterial({
    color: C.primary,
    transparent: true,
    opacity: 0.85,
    fog: false,
  });
  const coverGeo = new RoundedBoxGeometry(1.48, 2.1, 0.34, 4, 0.05);
  const cover = new THREE.Mesh(coverGeo, coverMat);
  cover.add(
    new THREE.LineSegments(new THREE.EdgesGeometry(coverGeo, 24), seamMat),
  );
  const pages = new THREE.Mesh(
    new THREE.BoxGeometry(1.5, 2.02, 0.24),
    pagesMat,
  );
  pages.position.x = 0.02;
  const spine = new THREE.Mesh(
    new RoundedBoxGeometry(0.07, 2.1, 0.34, 3, 0.03),
    spineMat,
  );
  spine.position.x = -0.735;
  const book = new THREE.Group();
  book.add(pages, cover, spine);
  rotor.add(book);

  // The book's opacity is driven as one number; `bookMats` is whatever meshes
  // currently represent the book (the placeholder slab, then the loaded
  // model). Kept transparent so it can dissolve into the point cloud.
  let bookMats: THREE.Material[] = [coverMat, pagesMat, spineMat, seamMat];
  let bookOpacity = bookOpacityFor(STOPS[getStep()]?.id);
  let gltfGone = false;

  new GLTFLoader().load(
    BOOK_URL,
    (gltf: GLTF) => {
      if (gltfGone) return disposeTree(gltf.scene);
      const model = gltf.scene;
      // Strip the exporter's baked node transform (a ~x100 scale + Z-up
      // rotation), then orient it ourselves in the raw mesh frame.
      model.traverse((o) => {
        if (o !== model) {
          o.position.set(0, 0, 0);
          o.rotation.set(0, 0, 0);
          o.scale.set(1, 1, 1);
        }
      });
      model.rotation.set(...BOOK_ROTATION);
      model.updateWorldMatrix(true, true);
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const centre = box.getCenter(new THREE.Vector3());
      const s = BOOK_SIZE / (Math.max(size.x, size.y, size.z) || 1);
      model.scale.setScalar(s);
      model.position.set(-centre.x * s, -centre.y * s, -centre.z * s);

      const mats: THREE.Material[] = [];
      model.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const list = Array.isArray(mesh.material)
          ? mesh.material
          : [mesh.material];
        for (const m of list) {
          const mm = m as THREE.MeshStandardMaterial;
          mm.transparent = true;
          mm.opacity = bookOpacity;
          mm.aoMapIntensity = 0.45;
          mm.emissive = new THREE.Color(C.primary);
          mm.emissiveIntensity = 0.12;
          if ('envMapIntensity' in mm) mm.envMapIntensity = 0.7;
          mm.needsUpdate = true;
          mats.push(mm);
        }
      });

      book.remove(cover, pages, spine);
      disposeTree(cover);
      disposeTree(pages);
      disposeTree(spine);
      book.add(model);
      bookMats = mats;
    },
    undefined,
    () => {
      /* network / decode failure: keep the procedural slab */
    },
  );

  const seed = computeTarget(STOPS[getStep()]?.id, SEEDS, C);
  const posArr = seed.pos.slice();
  const colArr = seed.col.slice();
  const cloudGeo = new THREE.BufferGeometry();
  cloudGeo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
  cloudGeo.setAttribute('color', new THREE.BufferAttribute(colArr, 3));
  const dotTex = radialTexture([
    [0, 'rgba(255,255,255,1)'],
    [0.4, 'rgba(255,255,255,0.7)'],
    [1, 'rgba(255,255,255,0)'],
  ]);
  const pointOpacity = C.isDark ? 1 : 0.85; // scale of pointCloudOpacityFor()
  const cloudMat = new THREE.PointsMaterial({
    size: C.isDark ? 0.085 : 0.055,
    map: dotTex,
    vertexColors: true,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
    sizeAttenuation: true,
    blending: blend,
    fog: false,
  });
  const cloud = new THREE.Points(cloudGeo, cloudMat);
  rotor.add(cloud);

  const probe = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 24, 24),
    new THREE.MeshBasicMaterial({ color: C.foreground, fog: false }),
  );
  probe.position.set(...QUESTION_POINT);
  const retrievePos = computeTarget('retrieve', SEEDS, C).pos;
  const near = nearestToQuestion(retrievePos, QUESTION_POINT, 9);
  const linePos = new Float32Array(near.length * 6);
  near.forEach((idx, n) => {
    linePos.set(QUESTION_POINT, n * 6);
    linePos[n * 6 + 3] = retrievePos[idx * 3];
    linePos[n * 6 + 4] = retrievePos[idx * 3 + 1];
    linePos[n * 6 + 5] = retrievePos[idx * 3 + 2];
  });
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.BufferAttribute(linePos, 3));
  const lineMat = new THREE.LineBasicMaterial({
    color: C.primary,
    transparent: true,
    opacity: 0,
    fog: false,
  });
  const lines = new THREE.LineSegments(lineGeo, lineMat);
  rotor.add(probe, lines);

  // ---- resize / pointer / loop ----
  const resize = () => {
    const w = host.clientWidth || canvas.clientWidth;
    const h = host.clientHeight || canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera); // repaint even if rAF is paused (hidden tab)
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(host);

  // A backgrounded tab pauses requestAnimationFrame; paint one frame the
  // moment it is shown again so the visual is never stale.
  const onVisible = () => {
    if (!document.hidden) renderer.render(scene, camera);
  };
  document.addEventListener('visibilitychange', onVisible);

  const pointer = { x: 0, y: 0 };
  const onPointer = (e: PointerEvent) => {
    const r = host.getBoundingClientRect();
    pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    pointer.y = -(((e.clientY - r.top) / r.height) * 2 - 1);
  };
  host.addEventListener('pointermove', onPointer);

  const target = { pos: seed.pos.slice(), col: seed.col.slice() };
  let currentId = STOPS[getStep()]?.id;
  let raf = 0;
  let elapsed = 0;

  const tick = (frameDt: number) => {
    const dt = Math.min(frameDt, 0.05);
    elapsed += dt;

    const id = STOPS[getStep()]?.id;
    if (id !== currentId) {
      currentId = id;
      const next = computeTarget(id, SEEDS, C);
      target.pos.set(next.pos);
      target.col.set(next.col);
    }

    for (let i = 0; i < posArr.length; i++) {
      posArr[i] = damp(posArr[i], target.pos[i], dt);
      colArr[i] = damp(colArr[i], target.col[i], dt);
    }
    cloudGeo.attributes.position.needsUpdate = true;
    cloudGeo.attributes.color.needsUpdate = true;

    bookOpacity = damp(bookOpacity, bookOpacityFor(id), dt);
    for (const m of bookMats) m.opacity = bookOpacity;
    book.visible = bookOpacity > 0.02;
    cloudMat.opacity = damp(
      cloudMat.opacity,
      pointCloudOpacityFor(id) * pointOpacity,
      dt,
    );

    const asking = id === 'retrieve';
    probe.scale.setScalar(asking ? 1 + Math.sin(elapsed * 3.5) * 0.1 : 0.0001);
    lineMat.opacity = damp(lineMat.opacity, asking ? 0.55 : 0, dt);

    // The object sways gently, never a full turn - the reader never sees the
    // spine-side or the back of the book.
    rotor.rotation.y = Math.sin(elapsed * 0.32) * 0.4;
    rotor.rotation.x = Math.sin(elapsed * 0.21) * 0.06;

    const zTarget = STOPS[getStep()]?.act === 'asking' ? 6.4 : 7.2;
    const driftX = Math.sin(elapsed * 0.13) * 0.14;
    camera.position.x = damp(camera.position.x, driftX + pointer.x * 0.3, dt);
    camera.position.y = damp(camera.position.y, 0.35 + pointer.y * 0.22, dt);
    camera.position.z = damp(camera.position.z, zTarget, dt);
    camera.lookAt(0, 0.05, 0);

    renderer.render(scene, camera);
  };

  // Render frame zero synchronously so there is never a blank canvas, even
  // before the first animation frame (or when the tab is hidden and rAF is
  // paused). Then run the loop.
  tick(0);
  let last = performance.now();
  const loop = () => {
    const now = performance.now();
    tick((now - last) / 1000);
    last = now;
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);

  return () => {
    gltfGone = true; // a still-in-flight GLTF load disposes itself on arrival
    cancelAnimationFrame(raf);
    ro.disconnect();
    document.removeEventListener('visibilitychange', onVisible);
    host.removeEventListener('pointermove', onPointer);
    disposeTree(scene);
    // dispose() only - never forceContextLoss(): that permanently kills the
    // canvas element's GL context, so a remount (React StrictMode does one in
    // dev, and the step-driven tree can too) can't get a context back.
    renderer.dispose();
  };
}

export default function Scene3D({ step }: { step: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stepRef = useRef(step);
  const { theme } = useTheme();

  useEffect(() => {
    stepRef.current = step;
  }, [step]);

  // Rebuild the scene when the theme flips so its palette, glow and blend mode
  // follow the page (rare event; a full rebuild is cheap and keeps the scene
  // code stateless about theme).
  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    if (!canvas || !host) return;
    return mountScene(canvas, host, () => stepRef.current, readSceneColors());
  }, [theme]);

  return (
    <canvas
      ref={canvasRef}
      style={{ display: 'block', width: '100%', height: '100%' }}
    />
  );
}
