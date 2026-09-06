// The pinned 3-D stage is always a dark "viewport into the machine", in both
// app themes - additive glow only reads on a dark ground, and a permanently
// dark panel never flashes light in dark mode (it is already dark). These are
// the exact `.dark` design tokens from index.css (scriptorium#52), copied -
// not re-picked - so the scene stays in lockstep with the token source.
export type SceneColors = {
  primary: string;
  bookA: string;
  bookB: string;
  foreground: string;
  background: string;
};

export const SCENE_COLORS: SceneColors = {
  primary: '#7d9dc4', // .dark --primary
  bookA: '#7d9dc4', // .dark --primary
  bookB: '#cf9a45', // .dark --status-progress
  foreground: '#e5e7ec', // .dark --foreground
  background: '#0e0f13', // .dark --background
};
