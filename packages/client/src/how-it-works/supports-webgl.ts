// One-time probe for a usable WebGL context. Used to decide whether the 3D
// stage is even worth mounting - jsdom, locked-down browsers and machines
// with GL disabled all fail here and fall through to `FallbackVisual`, so the
// three.js chunk is never fetched for them.
let cached: boolean | null = null;

export function supportsWebGL(): boolean {
  if (cached !== null) return cached;
  if (typeof document === 'undefined') return (cached = false);
  try {
    const canvas = document.createElement('canvas');
    cached = !!(
      canvas.getContext('webgl2') ||
      canvas.getContext('webgl') ||
      canvas.getContext('experimental-webgl')
    );
  } catch {
    cached = false;
  }
  return cached;
}
