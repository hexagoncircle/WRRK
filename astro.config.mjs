// @ts-check
import { defineConfig } from "astro/config";

// https://astro.build/config
export default defineConfig({
  // Manual PWA assets live in /public (manifest + service worker).
  // @vite-pwa/astro does not yet declare Astro 7 peer support.
});
