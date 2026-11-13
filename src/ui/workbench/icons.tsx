import type { ReactElement, SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

const base: IconProps = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'square',
  strokeLinejoin: 'miter',
  'aria-hidden': true,
};

export const IconInput = (p: IconProps): ReactElement => (
  <svg {...base} {...p}><path d="M4 7h16v10H4z" /><path d="M8 12h3M14 10v4" /></svg>
);
export const IconTable = (p: IconProps): ReactElement => (
  <svg {...base} {...p}><path d="M4 5h16v14H4z" /><path d="M4 10h16M10 5v14" /></svg>
);
export const IconSimplify = (p: IconProps): ReactElement => (
  <svg {...base} {...p}><path d="M4 6h16l-6 7v5l-4 2v-7z" /></svg>
);
export const IconCircuit = (p: IconProps): ReactElement => (
  <svg {...base} {...p}><path d="M3 8h5M3 16h5M8 5h5a7 7 0 0 1 0 14H8z" /><path d="M20 12h2" /></svg>
);
export const IconVerify = (p: IconProps): ReactElement => (
  <svg {...base} {...p}><path d="M4 4h16v16H4z" /><path d="M8 12.5l3 3 5-6" /></svg>
);
export const IconArrow = (p: IconProps): ReactElement => (
  <svg {...base} width={16} height={16} {...p}><path d="M5 12h14M13 6l6 6-6 6" /></svg>
);
