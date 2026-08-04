/** Small gold coin: credits read as a tangible thing, not an abstract meter. */
export function Coin({ size = 14, dim = false }: { size?: number; dim?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden style={{ opacity: dim ? 0.45 : 1, flexShrink: 0 }}>
      <defs>
        <linearGradient id="scCoinFace" x1="0" y1="0" x2="0.7" y2="1">
          <stop offset="0%" stopColor="#FFE08A" />
          <stop offset="45%" stopColor="#F2B03C" />
          <stop offset="100%" stopColor="#C6871B" />
        </linearGradient>
        <linearGradient id="scCoinInner" x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0%" stopColor="#FFF3C4" />
          <stop offset="100%" stopColor="#E9A72C" />
        </linearGradient>
      </defs>
      <circle cx="12" cy="12" r="10.5" fill="url(#scCoinFace)" />
      <circle cx="12" cy="12" r="8" fill="url(#scCoinInner)" />
      <path
        d="M7.5 7.2a10 10 0 0 1 6.4-2.4"
        stroke="#FFF7D6"
        strokeWidth="1.4"
        strokeLinecap="round"
        fill="none"
        opacity="0.85"
      />
      <circle cx="12" cy="12" r="10.5" fill="none" stroke="#A66F12" strokeWidth="1" opacity="0.55" />
    </svg>
  );
}
