type IconProps = { className?: string; strokeWidth?: number };

const base = (className?: string) => className ?? "h-4 w-4";

function S({
  children,
  className,
  strokeWidth = 1.6,
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={base(className)}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const IconRadar = (p: IconProps) => (
  <S {...p}>
    <path d="M12 12 19 5" />
    <path d="M12 21a9 9 0 1 0-9-9" />
    <path d="M12 17a5 5 0 1 0-5-5" />
    <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
  </S>
);

export const IconScan = (p: IconProps) => (
  <S {...p}>
    <path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3" />
    <circle cx="11" cy="11" r="3.2" />
    <path d="m13.5 13.5 3.5 3.5" />
  </S>
);

export const IconLink = (p: IconProps) => (
  <S {...p}>
    <path d="M9.5 14.5 14.5 9.5" />
    <path d="M11 6.5 12.8 4.7a3.9 3.9 0 0 1 5.5 5.5L16.5 12" />
    <path d="M13 17.5 11.2 19.3a3.9 3.9 0 0 1-5.5-5.5L7.5 12" />
  </S>
);

export const IconCopy = (p: IconProps) => (
  <S {...p}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M15 5.5A1.5 1.5 0 0 0 13.5 4H6a2 2 0 0 0-2 2v7.5A1.5 1.5 0 0 0 5.5 15" />
  </S>
);

export const IconCheck = (p: IconProps) => (
  <S {...p}>
    <path d="m4.5 12.5 5 5 10-11" />
  </S>
);

export const IconDownload = (p: IconProps) => (
  <S {...p}>
    <path d="M12 4v11" />
    <path d="m7.5 10.5 4.5 4.5 4.5-4.5" />
    <path d="M4.5 19.5h15" />
  </S>
);

export const IconSave = (p: IconProps) => (
  <S {...p}>
    <path d="M6 3.5h12v17l-6-4-6 4z" />
  </S>
);

export const IconPlay = (p: IconProps) => (
  <S {...p}>
    <path d="M7.5 4.8v14.4L19.5 12z" fill="currentColor" />
  </S>
);

export const IconExternal = (p: IconProps) => (
  <S {...p}>
    <path d="M14 4.5h5.5V10" />
    <path d="M19 5 11 13" />
    <path d="M18.5 14.5v3a2 2 0 0 1-2 2h-10a2 2 0 0 1-2-2v-10a2 2 0 0 1 2-2h3" />
  </S>
);

export const IconTrash = (p: IconProps) => (
  <S {...p}>
    <path d="M4.5 7h15" />
    <path d="M9.5 7V4.8h5V7" />
    <path d="M6.5 7l1 12.2A1.8 1.8 0 0 0 9.3 21h5.4a1.8 1.8 0 0 0 1.8-1.8L17.5 7" />
    <path d="M10.5 11v6M13.5 11v6" />
  </S>
);

export const IconSliders = (p: IconProps) => (
  <S {...p}>
    <path d="M5 6.5h14M5 12h14M5 17.5h14" />
    <circle cx="9" cy="6.5" r="2" fill="var(--color-panel)" />
    <circle cx="15" cy="12" r="2" fill="var(--color-panel)" />
    <circle cx="8" cy="17.5" r="2" fill="var(--color-panel)" />
  </S>
);

export const IconQueue = (p: IconProps) => (
  <S {...p}>
    <rect x="3.5" y="4" width="17" height="5" rx="1.6" />
    <rect x="3.5" y="11" width="17" height="4" rx="1.4" opacity="0.75" />
    <rect x="3.5" y="17" width="17" height="3" rx="1.2" opacity="0.5" />
  </S>
);

export const IconRefresh = (p: IconProps) => (
  <S {...p}>
    <path d="M20 11a8 8 0 0 0-13.7-5.1L4 8" />
    <path d="M4 4.5V8h3.5" />
    <path d="M4 13a8 8 0 0 0 13.7 5.1L20 16" />
    <path d="M20 19.5V16h-3.5" />
  </S>
);

export const IconAlert = (p: IconProps) => (
  <S {...p}>
    <path d="M12 4.8 21 19.5H3z" />
    <path d="M12 10v4" />
    <circle cx="12" cy="16.8" r="0.9" fill="currentColor" stroke="none" />
  </S>
);

export const IconClose = (p: IconProps) => (
  <S {...p}>
    <path d="m6 6 12 12M18 6 6 18" />
  </S>
);

export const IconHeart = (p: IconProps) => (
  <S {...p}>
    <path d="M12 20s-7.5-4.4-7.5-9.4A4.1 4.1 0 0 1 12 7.6a4.1 4.1 0 0 1 7.5 3c0 5-7.5 9.4-7.5 9.4z" />
  </S>
);

export const IconComment = (p: IconProps) => (
  <S {...p}>
    <path d="M20.5 12c0 4-3.8 7-8.5 7-1 0-2-.1-2.9-.4L4 20.5l1.4-3.4C4.2 15.8 3.5 14 3.5 12c0-4 3.8-7 8.5-7s8.5 3 8.5 7z" />
  </S>
);

export const IconShare = (p: IconProps) => (
  <S {...p}>
    <path d="M4.5 12v6.5a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5V12" />
    <path d="M12 3.5v11" />
    <path d="m8 7 4-3.5L16 7" />
  </S>
);

export const IconEye = (p: IconProps) => (
  <S {...p}>
    <path d="M2.8 12S6.5 6 12 6s9.2 6 9.2 6-3.7 6-9.2 6-9.2-6-9.2-6z" />
    <circle cx="12" cy="12" r="2.6" />
  </S>
);

export const IconMusic = (p: IconProps) => (
  <S {...p}>
    <path d="M9 18V6.5l10-2V16" />
    <circle cx="6.8" cy="18" r="2.2" />
    <circle cx="16.8" cy="16" r="2.2" />
  </S>
);

export const IconSpark = (p: IconProps) => (
  <S {...p}>
    <path d="M12 3.5 13.8 9 19.5 10.8 13.8 12.6 12 18.2 10.2 12.6 4.5 10.8 10.2 9z" />
    <path d="M18.5 16.5 19.3 19 21.5 19.8 19.3 20.6 18.5 23 17.7 20.6 15.5 19.8 17.7 19z" opacity="0.6" />
  </S>
);

export const IconClock = (p: IconProps) => (
  <S {...p}>
    <circle cx="12" cy="12" r="8.2" />
    <path d="M12 7.5V12l3 1.8" />
  </S>
);

export const IconArrow = (p: IconProps) => (
  <S {...p}>
    <path d="M4.5 12h15" />
    <path d="m13.5 6 6 6-6 6" />
  </S>
);

export const IconChevron = (p: IconProps) => (
  <S {...p}>
    <path d="m9 5.5 6.5 6.5L9 18.5" />
  </S>
);

export const IconUpload = (p: IconProps) => (
  <S {...p}>
    <path d="M12 19.5V8.5" />
    <path d="m7.5 12.5 4.5-4 4.5 4" />
    <path d="M4.5 5.5h15" />
    <path d="M5.5 20.5h13" opacity="0.5" />
  </S>
);

export const IconTag = (p: IconProps) => (
  <S {...p}>
    <path d="M4 10.5V5.2A1.2 1.2 0 0 1 5.2 4h5.3a1.2 1.2 0 0 1 .85.35l8 8a1.2 1.2 0 0 1 0 1.7l-5.3 5.3a1.2 1.2 0 0 1-1.7 0l-8-8A1.2 1.2 0 0 1 4 10.5z" />
    <circle cx="8.2" cy="8.2" r="1.3" fill="currentColor" stroke="none" />
  </S>
);

export const IconUser = (p: IconProps) => (
  <S {...p}>
    <circle cx="12" cy="8.5" r="3.6" />
    <path d="M4.8 20c.9-3.6 3.7-5.6 7.2-5.6s6.3 2 7.2 5.6" />
  </S>
);

export function LogoMark({ className }: IconProps) {
  return (
    <svg viewBox="0 0 40 40" className={className ?? "h-9 w-9"} aria-hidden="true">
      <defs>
        <linearGradient id="lg-signal" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#24e0d2" />
          <stop offset="100%" stopColor="#12857d" />
        </linearGradient>
      </defs>
      <rect x="1.5" y="1.5" width="37" height="37" rx="10" fill="#0b0f15" stroke="#222d3a" />
      <path
        d="M12 11.5h9.5c3.6 0 6 2.2 6 5.4 0 3.3-2.5 5.6-6.2 5.6h-4.6v8"
        stroke="url(#lg-signal)"
        strokeWidth="3"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="28.4" cy="27.6" r="3.2" fill="#ff3b5c" />
      <circle cx="12" cy="11.5" r="2" fill="#24e0d2" />
    </svg>
  );
}
