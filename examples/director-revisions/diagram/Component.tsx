import { useCurrentFrame } from 'remotion';
import type { ComponentProps } from './schema';

function Arrow({ y, length, color }: { y: number; length: number; color: string }) {
  const tip = 155 + length;
  return <g fill={color}>
    <rect x="155" y={y - 4} width={length - 16} height="8" />
    <polygon points={`${tip - 18},${y - 13} ${tip},${y} ${tip - 18},${y + 13}`} />
  </g>;
}

export default function Component({ title, lowerLength, cueFrame }: ComponentProps) {
  const frame = useCurrentFrame();
  return <svg viewBox="0 0 640 360" width="100%" height="100%" role="img" aria-label={title}>
    <rect width="640" height="360" fill="#142827" />
    <g stroke="#52716c" strokeWidth="2">
      <path d="M155 66V287M415 66V287" strokeDasharray="4 6" />
    </g>
    <g fill="#f5f2df" fontFamily="sans-serif" fontSize="21">
      <text x="100" y="134">A</text>
      <text x="100" y="232">B</text>
    </g>
    <Arrow y={126} length={260} color="#9fd9c9" />
    <Arrow y={224} length={lowerLength} color={frame >= cueFrame ? '#ffbd59' : '#9fd9c9'} />
  </svg>;
}
