/**
 * Turns a live, CSS-styled SVG into a standalone one.
 * The on-page waveform is coloured by stylesheet classes and CSS variables, so a plain
 * serialisation opens as black shapes anywhere else. Here every drawn element gets its
 * resolved paint inlined, and interaction-only parts (playhead, click targets) are dropped.
 */
const PROPS = [
  'fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray', 'stroke-linejoin', 'stroke-linecap',
  'opacity', 'font-family', 'font-size', 'font-weight', 'letter-spacing', 'text-transform', 'text-anchor', 'dominant-baseline',
];

const DROP = '.timing-cursor, .timing-row-background';

export function standaloneSvg(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.querySelectorAll(DROP).forEach((node) => node.remove());
  const live = [svg, ...Array.from(svg.querySelectorAll('*'))].filter((node) => !node.matches(DROP));
  const copy = [clone, ...Array.from(clone.querySelectorAll('*'))];
  live.forEach((node, index) => {
    const target = copy[index];
    if (!target) return;
    const computed = getComputedStyle(node);
    const style = PROPS.map((prop) => `${prop}:${computed.getPropertyValue(prop)}`).join(';');
    target.setAttribute('style', style);
    target.removeAttribute('class');
    target.removeAttribute('pointer-events');
  });
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  return new XMLSerializer().serializeToString(clone);
}
