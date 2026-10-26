// Vendored from @dgreenheck/ez-tree 1.1.0 (MIT, see LICENSE). Imports
// patched for the unbundled dev page by tools/vendor-eztree.mjs.
// The game's textures, set by src/trees.js.
export const TEX = { bark: null, barkNormal: null, barkRough: null, leaf: null };
export function getBarkTexture(type, file) {
  return file === 'normal' ? TEX.barkNormal : file === 'roughness' ? TEX.barkRough : file === 'ao' ? null : TEX.bark;
}
export function getLeafTexture() { return TEX.leaf; }
