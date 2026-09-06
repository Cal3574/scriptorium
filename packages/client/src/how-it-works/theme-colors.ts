// The 3-D stage always renders on a dark ground - additive glow, pale points
// and a low-key lit book only read against dark. In dark app theme the canvas
// is transparent and composites straight onto the page; in light app theme
// the stage supplies its own soft dark backdrop (see `HowItWorks`). Either
// way the scene palette is fixed - these are the `.dark` design tokens from
// index.css (scriptorium#52), copied, not re-picked.
export type SceneColors = {
  primary: string;
  bookA: string;
  bookB: string;
  foreground: string;
  background: string;
};

export const SCENE_COLORS: SceneColors = {
  primary: '#7d9dc4', // .dark --primary
  bookA: '#7d9dc4',
  bookB: '#cf9a45', // .dark --status-progress
  foreground: '#e5e7ec', // .dark --foreground
  background: '#0e0f13', // .dark --background
};
