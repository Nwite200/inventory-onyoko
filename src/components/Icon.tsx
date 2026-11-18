import type { ReactNode, SVGProps } from 'react';

/**
 * A small, hand-drawn stroke icon set. Icons are inline SVG so they work offline,
 * inherit `currentColor` and never trigger a font or network request.
 */
const paths = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="8" rx="1.6" />
      <rect x="14" y="3" width="7" height="5" rx="1.6" />
      <rect x="14" y="12" width="7" height="9" rx="1.6" />
      <rect x="3" y="15" width="7" height="6" rx="1.6" />
    </>
  ),
  pos: (
    <>
      <path d="M4 7h16l-1.2 12.2a2 2 0 0 1-2 1.8H7.2a2 2 0 0 1-2-1.8L4 7Z" />
      <path d="M9 7V5.4A3 3 0 0 1 12 2.4a3 3 0 0 1 3 3V7" />
      <path d="M8.5 12h7" />
    </>
  ),
  receipt: (
    <>
      <path d="M6 2.8h12v18.4l-3-1.8-3 1.8-3-1.8-3 1.8V2.8Z" />
      <path d="M9 7h6M9 11h6M9 15h4" />
    </>
  ),
  refund: (
    <>
      <path d="M3.5 10.5A8.5 8.5 0 1 1 6 16.5" />
      <path d="M3.5 4.5v6h6" />
    </>
  ),
  register: (
    <>
      <rect x="3" y="7" width="18" height="14" rx="2.2" />
      <path d="M3 12h18M7 7V4h10v3M8 16h3" />
    </>
  ),
  products: (
    <>
      <path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5v-9Z" />
      <path d="M3.5 7.5 12 12l8.5-4.5M12 12v9" />
    </>
  ),
  inventory: (
    <>
      <path d="M3 8.5 12 4l9 4.5-9 4.5-9-4.5Z" />
      <path d="M3 12.5 12 17l9-4.5M3 16.5 12 21l9-4.5" />
    </>
  ),
  truck: (
    <>
      <path d="M2.5 6.5h11v10h-11zM13.5 9.5h4l3 3.2v3.8h-7z" />
      <circle cx="6.5" cy="18.5" r="1.8" />
      <circle cx="17.5" cy="18.5" r="1.8" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.4" />
      <path d="M2.8 20c.5-3.4 3-5 6.2-5s5.7 1.6 6.2 5" />
      <path d="M16 5.1a3.4 3.4 0 0 1 0 5.9M18.5 15.4c2 .7 3.2 2.3 3.5 4.6" />
    </>
  ),
  wallet: (
    <>
      <path d="M3.2 7.2A2.2 2.2 0 0 1 5.4 5h13.4A2.2 2.2 0 0 1 21 7.2v10.6a2.2 2.2 0 0 1-2.2 2.2H5.4a2.2 2.2 0 0 1-2.2-2.2V7.2Z" />
      <path d="M16 12h5v4h-5a2 2 0 0 1 0-4Z" />
      <path d="M3.2 8.5h13" />
    </>
  ),
  chart: (
    <>
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3.1" />
      <path d="M12 2.7v2.6M12 18.7v2.6M4.4 4.4l1.9 1.9M17.7 17.7l1.9 1.9M2.7 12h2.6M18.7 12h2.6M4.4 19.6l1.9-1.9M17.7 6.3l1.9-1.9" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.8" />
      <path d="m16.2 16.2 4.3 4.3" />
    </>
  ),
  bell: (
    <>
      <path d="M6 9.5a6 6 0 0 1 12 0c0 5 2 6.2 2 6.2H4s2-1.2 2-6.2Z" />
      <path d="M9.8 19.3a2.4 2.4 0 0 0 4.4 0" />
    </>
  ),
  menu: <path d="M3.5 6.5h17M3.5 12h17M3.5 17.5h17" />,
  chevronLeft: <path d="m14.5 5-7 7 7 7" />,
  chevronRight: <path d="m9.5 5 7 7-7 7" />,
  chevronDown: <path d="m5 9.5 7 7 7-7" />,
  plus: <path d="M12 4.5v15M4.5 12h15" />,
  minus: <path d="M4.5 12h15" />,
  trash: (
    <>
      <path d="M4 7h16M9.5 7V4.5h5V7M6.2 7l1 13.2a1.8 1.8 0 0 0 1.8 1.8h6a1.8 1.8 0 0 0 1.8-1.8L17.8 7" />
      <path d="M10 11v6.5M14 11v6.5" />
    </>
  ),
  moon: <path d="M20.5 14.2A8.8 8.8 0 0 1 9.8 3.5a8.8 8.8 0 1 0 10.7 10.7Z" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  logout: (
    <>
      <path d="M14.5 3.5H20v17h-5.5" />
      <path d="M4 12h11M11 7.5 15.5 12 11 16.5" />
    </>
  ),
  check: <path d="m4 12.5 5.2 5.2L20 6.5" />,
  alert: (
    <>
      <path d="M12 3 2.6 20h18.8L12 3Z" />
      <path d="M12 9v5M12 17.2v.3" />
    </>
  ),
  trendUp: (
    <>
      <path d="m3 16.5 5.5-5.5 4 4L21 6.5" />
      <path d="M15.5 6.5H21v5.5" />
    </>
  ),
  trendDown: (
    <>
      <path d="m3 7.5 5.5 5.5 4-4L21 17.5" />
      <path d="M15.5 17.5H21V12" />
    </>
  ),
  download: (
    <>
      <path d="M12 3v12M7.5 10.5 12 15l4.5-4.5" />
      <path d="M4 17.5V21h16v-3.5" />
    </>
  ),
  printer: (
    <>
      <path d="M7 8V3.5h10V8M7 17H4V9h16v8h-3" />
      <path d="M7 14h10v6.5H7z" />
    </>
  ),
  more: (
    <>
      <circle cx="5" cy="12" r="1.2" />
      <circle cx="12" cy="12" r="1.2" />
      <circle cx="19" cy="12" r="1.2" />
    </>
  ),
  close: <path d="M5.5 5.5l13 13M18.5 5.5l-13 13" />,
  barcode: (
    <>
      <path d="M3.5 5.5v13M7 5.5v13M11 5.5v13M14.5 5.5v9M18 5.5v13M20.5 5.5v13" />
    </>
  ),
  store: (
    <>
      <path d="M3.5 9.5V20h17V9.5" />
      <path d="M2.5 9.5 4.6 4h14.8l2.1 5.5a3 3 0 0 1-5.6 1.4 3 3 0 0 1-5.8 0 3 3 0 0 1-5.6-1.4Z" />
      <path d="M9.5 20v-5.5h5V20" />
    </>
  ),
  cart: (
    <>
      <path d="M3 4h2.4l2.3 11.2h9.9L20 7.5H6" />
      <circle cx="9" cy="19.2" r="1.4" />
      <circle cx="17" cy="19.2" r="1.4" />
    </>
  ),
  banknote: (
    <>
      <rect x="2.6" y="6" width="18.8" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.6" />
      <path d="M6 9.5v.2M18 14.3v.2" />
    </>
  ),
  card: (
    <>
      <rect x="2.6" y="5" width="18.8" height="14" rx="2.2" />
      <path d="M2.6 9.5h18.8M6 15h4" />
    </>
  ),
  package: (
    <>
      <rect x="3.5" y="6.5" width="17" height="14" rx="1.8" />
      <path d="M3.5 10.5h17M12 6.5v14" />
      <path d="M7.5 3.5h9" />
    </>
  ),
  clipboard: (
    <>
      <rect x="5" y="4.5" width="14" height="17" rx="2" />
      <path d="M9 4.5V2.8h6v1.7M9 10h6M9 14h6M9 18h3" />
    </>
  ),
  lock: (
    <>
      <rect x="4.5" y="10" width="15" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3M12 14.5v2.5" />
    </>
  ),
  filter: <path d="M3 5h18l-7 8v6l-4 2v-8L3 5Z" />,
  arrowRight: <path d="M4 12h16M14 6l6 6-6 6" />,
  arrowUp: <path d="M12 20V4M6 10l6-6 6 6" />,
  arrowDown: <path d="M12 4v16M6 14l6 6 6-6" />,
  sparkle: (
    <>
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" />
      <path d="M18.5 16.5 19.3 19l2.5.8-2.5.8-.8 2.4-.8-2.4-2.4-.8 2.4-.8.8-2.5Z" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 21c.6-4.2 3.6-6.2 7.5-6.2s6.9 2 7.5 6.2" />
    </>
  ),
  creditCard: (
    <>
      <rect x="2.6" y="5" width="18.8" height="14" rx="2.2" />
      <path d="M2.6 10h18.8" />
    </>
  ),
  history: (
    <>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.5-6" />
      <path d="M3.5 4v5h5M12 7.5V12l3 2" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="2.8" width="6" height="11.4" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3.2M8.5 21.2h7" />
    </>
  ),
  camera: (
    <>
      <path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h1.7l1.2-2h6.2l1.2 2h1.7A2.5 2.5 0 0 1 21 8.5v9A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5v-9Z" />
      <circle cx="12" cy="13" r="3.4" />
    </>
  ),
  palette: (
    <>
      <path d="M12 3a9 9 0 1 0 0 18h1.4a1.8 1.8 0 0 0 1.2-3.1 1.8 1.8 0 0 1 1.2-3.1H18A3 3 0 0 0 21 12a9 9 0 0 0-9-9Z" />
      <circle cx="7.5" cy="10" r="1" fill="currentColor" stroke="none" />
      <circle cx="10" cy="6.8" r="1" fill="currentColor" stroke="none" />
      <circle cx="14.5" cy="6.8" r="1" fill="currentColor" stroke="none" />
      <circle cx="17" cy="10" r="1" fill="currentColor" stroke="none" />
    </>
  ),
} as const;

export type IconName = keyof typeof paths;

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  size?: number;
}

export function Icon({ name, size = 18, ...rest }: IconProps): ReactNode {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {paths[name]}
    </svg>
  );
}
