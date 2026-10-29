import type { CSSProperties } from 'react'

export interface WatermarkProps {
  /** Text shown in the badge. */
  label?: string
  /** Where clicking the badge goes (e.g. your pricing page). */
  href?: string
  position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left'
  className?: string
  style?: CSSProperties
}

/** A small, unobtrusive badge. Purely presentational; style or replace it freely. */
export function Watermark({ label = 'Unlicensed', href, position = 'bottom-right', className, style }: WatermarkProps) {
  const [v, h] = position.split('-') as ['top' | 'bottom', 'left' | 'right']
  const css: CSSProperties = {
    position: 'absolute',
    [v]: 8,
    [h]: 8,
    zIndex: 2147483000,
    padding: '3px 8px',
    borderRadius: 6,
    font: '500 11px/1.4 system-ui, -apple-system, sans-serif',
    color: '#0b3b46',
    background: 'rgba(224, 247, 250, 0.92)',
    border: '1px solid rgba(0, 151, 167, 0.35)',
    textDecoration: 'none',
    userSelect: 'none',
    ...style,
  }
  return href ? (
    <a data-cyanoff-watermark="" href={href} target="_blank" rel="noopener noreferrer" className={className} style={css}>
      {label}
    </a>
  ) : (
    <span data-cyanoff-watermark="" className={className} style={css}>
      {label}
    </span>
  )
}
