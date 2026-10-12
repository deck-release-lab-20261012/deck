// Lucide icons, rendered from the lucide-static package: icons-data.ts is
// generated from node_modules by tools/generate-icons.mjs, and
// icons.test.ts fails on any drift, so no path data is ever written by
// hand. Inline SVG rather than files under public/: the workspace builds
// its chrome by string concatenation, and an <img> cannot inherit
// currentColor, which every one of these relies on.
//
// Icons are decorative here — every control that carries one also carries
// its own accessible name — so each is marked aria-hidden. The 1.75
// stroke is the design handoff's icon weight; lucide ships 2.
import { ICON_PATHS, type IconName } from "./icons-data.ts";

export type { IconName };

export function lucideIcon(name: IconName, size: number): string {
  return `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" class="flex-none">${ICON_PATHS[name]}</svg>`;
}
