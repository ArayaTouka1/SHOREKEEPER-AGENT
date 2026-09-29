import React from 'react'

/* ==================================================================
   设置页共享 UI 原语
   ------------------------------------------------------------------
   这几个结构的 JSX 在 SettingsPage 与 pages/settings/* 里被反复手写，
   这里收敛成一套组件。只搬运结构，不改样式类名与文案，
   所以渲染结果与原来逐字一致。
   ================================================================== */

export function SectionHeader({ title, desc }: { title: React.ReactNode; desc?: React.ReactNode }): React.ReactElement {
  return (
    <>
      <div className="sec-title">{title}</div>
      {desc !== undefined && <div className="sec-desc">{desc}</div>}
    </>
  )
}

export function SwitchRow({
  title,
  desc,
  on,
  onChange
}: {
  title: React.ReactNode
  desc: React.ReactNode
  on: boolean
  onChange: (v: boolean) => void
}): React.ReactElement {
  return (
    <div className="switch-row">
      <div className="switch-row-text">
        <span className="switch-row-title">{title}</span>
        <span className="switch-row-desc">{desc}</span>
      </div>
      <button className={`switch ${on ? 'on' : ''}`} onClick={() => onChange(!on)} />
    </div>
  )
}

export function Field({
  label,
  hint,
  hintStyle,
  className,
  style,
  children
}: {
  label?: React.ReactNode
  hint?: React.ReactNode
  hintStyle?: React.CSSProperties
  className?: string
  style?: React.CSSProperties
  children: React.ReactNode
}): React.ReactElement {
  return (
    <div className={className ? `field ${className}` : 'field'} style={style}>
      {label !== undefined && <span className="field-label">{label}</span>}
      {children}
      {hint !== undefined && (
        <div className="field-hint" style={hintStyle}>
          {hint}
        </div>
      )}
    </div>
  )
}

export function SliderField({
  label,
  value,
  min,
  max,
  step,
  onChange,
  className,
  style
}: {
  label: React.ReactNode
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  className?: string
  style?: React.CSSProperties
}): React.ReactElement {
  return (
    <div className={className ? `field ${className}` : 'field'} style={style}>
      <span className="field-label">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  )
}

/**
 *
 *
 */
export function Collapsible({
  title,
  subtitle,
  defaultOpen = false,
  count,
  testId,
  children
}: {
  title: React.ReactNode
  subtitle?: React.ReactNode
  defaultOpen?: boolean
  count?: React.ReactNode
  testId?: string
  children: React.ReactNode
}): React.ReactElement {
  const [open, setOpen] = React.useState(defaultOpen)
  const toggle = (): void => setOpen((v) => !v)

  return (
    <div
      className={`collapsible card ${open ? 'open' : ''}`}
      data-testid={testId}
      data-open={open ? '1' : '0'}
    >
      <div
        className="collapsible-head"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        data-testid={testId ? `${testId}-head` : undefined}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
            e.preventDefault()
            toggle()
          }
        }}
      >
        <span className="collapsible-chevron" aria-hidden="true">
          ▸
        </span>
        <span className="collapsible-title">{title}</span>
        {subtitle !== undefined && <span className="collapsible-subtitle">{subtitle}</span>}
        {count !== undefined && <span className="collapsible-count">{count}</span>}
      </div>

      <div className="collapsible-body">
        <div className="collapsible-clip">
          <div className="collapsible-inner">{children}</div>
        </div>
      </div>
    </div>
  )
}

export function EmptyHint({
  children,
  style,
  testId,
  className
}: {
  children: React.ReactNode
  style?: React.CSSProperties
  testId?: string
  className?: string
}): React.ReactElement {
  return (
    <div className={className} style={{ fontSize: 12, color: 'var(--text-4)', ...style }} data-testid={testId}>
      {children}
    </div>
  )
}
