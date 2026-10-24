import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type HTMLAttributes,
  type Ref,
} from 'react'
import { GooeyContext, type GooeyContextValue } from './context'
import { GooFilterPrimitives } from './filter'
import { ImageMeltLayer, createImageMeltRegistry } from './imageMelt'
import { useIsoLayoutEffect } from './hooks'
import { ObserveEngine } from './observer'
import { parseShadow } from './shadow'

export interface GooeyProps extends HTMLAttributes<HTMLDivElement> {
  /** Goo blur sigma in px — how far apart pieces start bridging. Default 6. */
  blur?: number
  /** Alpha-contrast slope — how sharp the liquid edge is. Default 18. */
  contrast?: number
  /** Fill of the liquid surface. Any CSS color, `var()` welcome. Default '#fff'. */
  fill?: string
  /** `box-shadow` syntax; rendered on the MERGED silhouette. `inset` layers
   *  paint inside the liquid edge (inner rings / top highlights). */
  shadow?: string
  /** Extra filter-region slack in px for blobs travelling outside the group box. Default 24. */
  filterPadding?: number
  /** Max px the liquid boundary undulates — the silhouette (and its shadows)
   *  run through a gentle noise displacement, so edges read as fluid instead
   *  of geometric. 0 (default) keeps the calm edge. */
  waviness?: number
  /** Noise frequency of the undulation; lower = longer, lazier waves. */
  wavinessFreq?: number
  /** Escape hatch: raw SVG filter primitives that REPLACE the goo chain
   *  (`blur`, `contrast`, `waviness` and the SVG half of `shadow` are then
   *  yours to reproduce). The input is `SourceGraphic`; the last primitive's
   *  output is what paints. Inset and spread shadows normally read a
   *  binarised `shape` result — keep that name if you keep them. */
  filter?: string
}

/** Gooey group: renders the silhouette SVG layer (goo filter + shadow chain)
 *  behind its children. Children stay crisp; <Gooey.Item> mirrors each piece's
 *  geometry into the liquid layer.
 *
 *  Filters run on SVG content — not CSS url() filters on HTML — because that
 *  is the one variant WebKit renders correctly and promotes properly. */
export const GooeyRoot = forwardRef<HTMLDivElement, GooeyProps>(function Gooey(
  {
    blur = 6,
    contrast = 18,
    fill = '#fff',
    shadow,
    filterPadding = 24,
    waviness = 0,
    wavinessFreq = 0.018,
    filter: customFilter,
    className,
    style,
    children,
    ...rest
  },
  fwd: Ref<HTMLDivElement>,
) {
  const groupRef = useRef<HTMLDivElement | null>(null)
  const [portal, setPortal] = useState<SVGGElement | null>(null)
  const [meltPortal, setMeltPortal] = useState<SVGGElement | null>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })

  const setRefs = useCallback(
    (node: HTMLDivElement | null) => {
      groupRef.current = node
      if (typeof fwd === 'function') fwd(node)
      else if (fwd) (fwd as { current: HTMLDivElement | null }).current = node
    },
    [fwd],
  )

  const filterId = `gooey-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const shadows = useMemo(() => parseShadow(shadow), [shadow])

  useIsoLayoutEffect(() => {
    const el = groupRef.current
    if (!el) return
    const measure = () =>
      setSize(prev =>
        prev.w === el.offsetWidth && prev.h === el.offsetHeight
          ? prev
          : { w: el.offsetWidth, h: el.offsetHeight },
      )
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const engine = useMemo(() => new ObserveEngine(() => groupRef.current), [])
  const imageMelt = useMemo(() => createImageMeltRegistry(), [])
  useEffect(() => () => engine.dispose(), [engine])
  useEffect(() => {
    engine.gooBlur = blur
  }, [engine, blur])

  const ctx = useMemo<GooeyContextValue>(
    () => ({ portal, meltPortal, fill, getGroup: () => groupRef.current, engine, imageMelt }),
    [portal, meltPortal, fill, engine, imageMelt],
  )

  // The filter raster is the whole performance story on WebKit, which runs
  // SVG filters on the CPU at full device scale — measured at 9fps for a
  // drag on an iPhone-class 3x screen. The heavy layers are the BLURRED
  // outer shadows: a 42px-blur pass re-rasterises the entire padded region
  // every animated frame. CSS drop-shadow() is mathematically the same
  // operation (blur-radius = 2σ, exactly box-shadow's convention, exactly
  // the stdDeviation = blur/2 the SVG pass used) — but a CSS filter list on
  // the element runs on the COMPOSITOR, GPU-accelerated in both WebKit and
  // Chromium. So the stack is split:
  //   - blurred/offset outer shadows  -> drop-shadow() on the svg element
  //   - spread rings and inset layers -> SVG passes (not expressible in
  //     CSS, but they are morphology/offset ops with no big blurs — cheap)
  //   - the goo chain itself          -> SVG, as before
  // One spec'd difference: chained drop-shadows each see the previous
  // result, so a later shadow also shadows an earlier one's pixels — at the
  // 5-25% alphas shadows use, that cross-term is under 1% alpha, invisible.
  // The filter pad also shrinks to what the REMAINING svg layers reach,
  // which cuts the rasterised area again.
  const svgShadows = shadows
  const shadowExtent = svgShadows.reduce(
    (m, s) => Math.max(m, Math.max(Math.abs(s.x), Math.abs(s.y)) + s.blur * 1.5 + Math.max(0, s.spread)),
    0,
  )
  const pad = Math.ceil(blur * 3 + shadowExtent + filterPadding)

  return (
    <div
      {...rest}
      ref={setRefs}
      className={className}
      style={{ position: 'relative', isolation: 'isolate', ...style }}
    >
      {/* zIndex -1 inside the isolated group: the liquid paints above the
          group's own background but below every child, positioned or not. */}
      <svg
        aria-hidden="true"
        focusable="false"
        data-gooey-svg=""
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          overflow: 'visible',
          pointerEvents: 'none',
          zIndex: -1,
          // Promote the filtered layer: WebKit otherwise repaints the goo a
          // frame or two behind the plain-DOM content.
          willChange: 'filter, transform',
        }}
      >
        <defs>
          {customFilter ? (
            <filter
              id={filterId}
              filterUnits="userSpaceOnUse"
              x={-pad}
              y={-pad}
              width={size.w + pad * 2}
              height={size.h + pad * 2}
              colorInterpolationFilters="sRGB"
              dangerouslySetInnerHTML={{ __html: customFilter }}
            />
          ) : (
            <filter
              id={filterId}
              filterUnits="userSpaceOnUse"
              x={-pad}
              y={-pad}
              width={size.w + pad * 2}
              height={size.h + pad * 2}
              colorInterpolationFilters="sRGB"
            >
              <GooFilterPrimitives
                blur={blur}
                contrast={contrast}
                shadows={svgShadows}
                waviness={waviness}
                wavinessFreq={wavinessFreq}
              />
            </filter>
          )}
        </defs>
        <g id={`${filterId}-sil`} ref={setPortal} filter={`url(#${filterId})`} style={{ fill }} />
      </svg>
      {/* Melt overlay: warped-image copies render here, ABOVE the content
          layer. SVG content so displacement/blur filters work in WebKit. */}
      <svg
        aria-hidden="true"
        focusable="false"
        data-gooey-overlay=""
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          overflow: 'visible',
          pointerEvents: 'none',
          // Above the content layer by design, and high enough that an app's
          // own stacking (e.g. a dragged item raised over its neighbours)
          // can't slip in front and hide the melt. Scoped: the group is an
          // isolated stacking context, so this can't escape it.
          zIndex: 9999,
        }}
      >
        <defs>
          {/* The melt may only paint where LIQUID exists: the mask re-renders
              the goo-filtered silhouette (same document, <use> across the two
              svgs), so the warped copies are clipped to the merged surface —
              without this the smear bled past the liquid edge onto the page
              background. Luminance mask: the white silhouette passes, the
              faint shadow layers (≤6% alpha) are negligible. */}
          <mask
            id={`${filterId}-meltmask`}
            maskUnits="userSpaceOnUse"
            x={-pad}
            y={-pad}
            width={size.w + pad * 2}
            height={size.h + pad * 2}
          >
            <use href={`#${filterId}-sil`} />
          </mask>
        </defs>
        <g mask={`url(#${filterId}-meltmask)`}>
          <g ref={setMeltPortal} />
        </g>
      </svg>
      <GooeyContext.Provider value={ctx}>
        {children}
        <ImageMeltLayer registry={imageMelt} />
      </GooeyContext.Provider>
    </div>
  )
})
