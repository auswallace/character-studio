'use client'

import React from 'react'

interface Persona {
  id: string
  name: string
  face_ref_url?: string
}

interface IdentityLockProps {
  personas: Persona[]
  selectedId: string | null
  onSelect: (id: string) => void
}

export function IdentityLock({ personas, selectedId, onSelect }: IdentityLockProps) {
  return (
    <div>
      {/* Label */}
      <div
        style={{
          fontSize: 10,
          color: '#999',
          textTransform: 'uppercase',
          letterSpacing: 1,
          fontWeight: 600,
          marginBottom: 6,
        }}
      >
        Lock Identity
      </div>

      {/* Thumbnails container */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          gap: 8,
          padding: 12,
          background: 'var(--color-bg-surface)',
          borderRadius: 12,
          border: '1px solid var(--color-border)',
        }}
      >
        {personas.map((persona) => {
          const isSelected = persona.id === selectedId
          return (
            <button
              key={persona.id}
              type="button"
              onClick={() => onSelect(persona.id)}
              style={{
                position: 'relative',
                width: 48,
                height: 60,
                borderRadius: 8,
                overflow: 'hidden',
                cursor: 'pointer',
                border: isSelected
                  ? '2px solid var(--color-accent-blue-text)'
                  : '2px solid transparent',
                padding: 0,
                background: persona.face_ref_url
                  ? '#e5e7eb'
                  : 'linear-gradient(135deg, #a78bfa 0%, #f472b6 100%)',
                flexShrink: 0,
                transition: 'border-color 150ms, transform 150ms',
              }}
              onMouseEnter={(e) => {
                if (!isSelected) {
                  ;(e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(0,0,0,0.20)'
                }
                ;(e.currentTarget as HTMLButtonElement).style.transform = 'scale(1.05)'
              }}
              onMouseLeave={(e) => {
                if (!isSelected) {
                  ;(e.currentTarget as HTMLButtonElement).style.borderColor = 'transparent'
                }
                ;(e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)'
              }}
            >
              {/* Image or gradient placeholder */}
              {persona.face_ref_url && (
                <img
                  src={persona.face_ref_url}
                  alt={persona.name}
                  style={{
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                  }}
                />
              )}

              {/* Name label */}
              <div
                style={{
                  position: 'absolute',
                  bottom: 0,
                  left: 0,
                  right: 0,
                  padding: '2px 4px',
                  fontSize: 8,
                  fontWeight: 700,
                  color: '#fff',
                  textAlign: 'center',
                  background: 'linear-gradient(to top, rgba(0,0,0,0.6), transparent)',
                  lineHeight: 1.3,
                }}
              >
                {persona.name}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
