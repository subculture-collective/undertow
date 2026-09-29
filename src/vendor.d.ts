declare module 'butterchurn' {
  const butterchurn: {
    createVisualizer(ctx: AudioContext, canvas: HTMLCanvasElement, opts: { width: number; height: number; pixelRatio?: number; textureRatio?: number }): any;
  };
  export default butterchurn;
}
declare module 'butterchurn-presets' {
  const pack: { getPresets(): Record<string, object> };
  export default pack;
}
declare module 'butterchurn-presets/lib/*' {
  const pack: { getPresets(): Record<string, object> };
  export default pack;
}

/** package.json version, injected by vite.config.ts. */
declare const __APP_VERSION__: string;
