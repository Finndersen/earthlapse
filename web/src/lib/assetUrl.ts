/** Resolves a manifest-relative media path against `Manifest.assetBase`, leaving an already
 *  absolute URL (a scheme, or protocol-relative) untouched. Same rule as `scene/scene.ts`'s
 *  `resolveAssetUrl`, shared here so the layers package need not import the scene package. */
export function resolveAssetUrl(assetBase: string, path: string): string {
  if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(path)) return path
  const base = assetBase.endsWith('/') ? assetBase : `${assetBase}/`
  const rel = path.startsWith('/') ? path.slice(1) : path
  return `${base}${rel}`
}
