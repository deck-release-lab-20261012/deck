/// <reference types="vite/client" />

// The type set the build selected: vite.config.ts resolves this to
// src/styles/fonts/licensed.css or free.css.
declare module "@fonts";

// The type set the build selected, "licensed" or "free" (vite.config.ts).
declare const __NOISEDECK_FONTS__: "licensed" | "free";
