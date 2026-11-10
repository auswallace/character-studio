'use client'

import React, { useCallback, useRef } from 'react'

// --- ToolbarButton ---

interface ToolbarButtonProps {
  children: React.ReactNode
  onClick?: () => void
}

export function ToolbarButton({ children, onClick }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '5px 12px',
        borderRadius: 16,
        fontSize: 11,
        fontWeight: 500,
        border: '1px solid rgba(0,0,0,0.10)',
        background: '#fff',
        color: '#666',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        fontFamily: 'inherit',
        lineHeight: 1.4,
        transition: 'border-color 150ms',
      }}
      onMouseEnter={(e) => {
        ;(e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(0,0,0,0.25)'
      }}
      onMouseLeave={(e) => {
        ;(e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(0,0,0,0.10)'
      }}
    >
      {children}
    </button>
  )
}

// --- GenerationBox ---

interface GenerationBoxProps {
  placeholder?: string
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  disabled?: boolean
  toolbarItems?: React.ReactNode
  children?: React.ReactNode
}

export function GenerationBox({
  placeholder = 'Describe what you want to create...',
  value,
  onChange,
  onSubmit,
  disabled = false,
  toolbarItems,
  children,
}: GenerationBoxProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        if (!disabled && value.trim()) {
          onSubmit()
        }
      }
    },
    [disabled, value, onSubmit],
  )

  const canSubmit = !disabled && value.trim().length > 0

  return (
    <div
      style={{
        border: '1px solid var(--color-border-hover)',
        borderRadius: 14,
        overflow: 'hidden',
        background: '#fff',
      }}
    >
      {/* Textarea */}
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        style={{
          display: 'block',
          width: '100%',
          border: 'none',
          outline: 'none',
          background: 'transparent',
          padding: '16px 18px',
          fontSize: 14,
          minHeight: 120,
          resize: 'none',
          fontFamily: 'inherit',
          lineHeight: 1.6,
          color: 'var(--color-text-primary)',
        }}
      />

      {/* Children area (e.g. reference image strip) */}
      {children && (
        <div style={{ padding: '0 18px 12px' }}>{children}</div>
      )}

      {/* Bottom toolbar */}
      <div
        style={{
          borderTop: '1px solid var(--color-border)',
          background: 'var(--color-bg-surface)',
          padding: '10px 12px',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        {/* Left: toolbar items */}
        {toolbarItems}

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Send button */}
        <button
          type="button"
          onClick={() => {
            if (canSubmit) onSubmit()
          }}
          disabled={!canSubmit}
          aria-label="Send"
          style={{
            width: 32,
            height: 32,
            borderRadius: '50%',
            background: 'var(--color-accent-green)',
            border: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: canSubmit ? 'pointer' : 'not-allowed',
            opacity: canSubmit ? 1 : 0.5,
            transition: 'background 150ms, opacity 150ms',
            flexShrink: 0,
          }}
          onMouseEnter={(e) => {
            if (canSubmit) {
              ;(e.currentTarget as HTMLButtonElement).style.background =
                'var(--color-accent-green-hover)'
            }
          }}
          onMouseLeave={(e) => {
            ;(e.currentTarget as HTMLButtonElement).style.background =
              'var(--color-accent-green)'
          }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M8 13V3M8 3L3.5 7.5M8 3L12.5 7.5"
              stroke="white"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>

      {/* Placeholder color override */}
      <style>{`
        div textarea::placeholder {
          color: #bbb;
        }
      `}</style>
    </div>
  )
}
