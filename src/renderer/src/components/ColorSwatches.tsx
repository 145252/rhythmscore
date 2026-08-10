import React from 'react'

/** 预设 5 个固定色(可覆盖) */
export const PRESET_COLORS = ['#378ADD', '#E24B4A', '#F59E0B', '#22C55E', '#111827']

interface Props {
  value: string
  onChange: (c: string) => void
  /** 固定色列表,默认 5 色;最后一项固定是自定义色板 */
  colors?: string[]
  disabled?: boolean
}

/** 一行 6 个色板:前 5 个固定色 + 第 6 个自定义取色器 */
export default function ColorSwatches({
  value,
  onChange,
  colors = PRESET_COLORS,
  disabled
}: Props): React.JSX.Element {
  const isCustom = !colors.includes(value)
  return (
    <div className="cursor-colors">
      {colors.map((c) => (
        <button
          key={c}
          className={`swatch ${value === c ? 'active' : ''}`}
          style={{ background: c }}
          title={c}
          onClick={() => onChange(c)}
          disabled={disabled}
        />
      ))}
      <label className={`swatch custom ${isCustom ? 'active' : ''}`} title="自定义颜色">
        <input
          type="color"
          value={isCustom ? value : '#000000'}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
        />
      </label>
    </div>
  )
}
