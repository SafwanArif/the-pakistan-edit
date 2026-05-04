"use client";

import React from "react";
import Link from "next/link";
import { TPEVectorLogo } from "../components/templates/instagram/TPEVectorLogo";

/**
 * 2027 Institutional Standard: Branding Landing
 * Pure Vanilla CSS implementation using Institutional Tokens.
 * ZERO TAILWIND.
 */
export default function Home() {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      minBlockSize: '100vh',
      backgroundColor: 'var(--ui-bg)',
      color: 'var(--ui-text)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 'var(--space-lg)',
      fontFamily: 'var(--tpe-font-inter)'
    }}>
      <main style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 'var(--space-lg)',
        textAlign: 'center',
        width: '100%',
        maxWidth: '400px', // More compact for mobile-first institutional look
        margin: '0 auto',
        boxSizing: 'border-box'
      }}>
        <div style={{ 
          transform: 'scale(1.5)', 
          marginBottom: 'var(--space-md)', 
          display: 'flex', 
          justifyContent: 'center', 
          width: '100%'
        }}>
          <TPEVectorLogo scale={1.2} />
        </div>
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)' }}>
          <h1 style={{ 
            fontSize: '11px', 
            fontWeight: 800, 
            letterSpacing: '0.4em', 
            color: 'var(--ui-primary)', 
            textTransform: 'uppercase',
            margin: 0,
            width: '100%',
            textAlign: 'center'
          }}>
            Institutional<br />Content Engine
          </h1>
          <p style={{ 
            fontSize: '14px', 
            opacity: 0.5, 
            fontWeight: 400,
            letterSpacing: '0.02em',
            lineHeight: '1.4',
            width: '100%',
            textAlign: 'center'
          }}>
            The Pakistan Edit<br />Internal Dashboard v2027.4
          </p>
        </div>

        <Link
          href="/admin"
          style={{
            marginTop: 'var(--space-md)',
            paddingBlock: '14px',
            paddingInline: '40px',
            backgroundColor: 'var(--ui-primary)',
            color: 'black',
            fontSize: '12px',
            fontWeight: 900,
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
            borderRadius: 'var(--radius-sm)',
            textDecoration: 'none',
            transition: 'var(--transition-lux)',
            boxShadow: '0 0 40px oklch(from var(--ui-primary) l c h / 0.2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '12px'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'translateY(-2px)';
            e.currentTarget.style.boxShadow = '0 0 60px oklch(from var(--ui-primary) l c h / 0.4)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = '0 0 40px oklch(from var(--ui-primary) l c h / 0.2)';
          }}
        >
          <span style={{ marginInlineStart: '18px' }}>Enter Dashboard</span>
          <span style={{ fontSize: '16px', display: 'flex', alignItems: 'center' }}>&rarr;</span>
        </Link>
      </main>

      <footer style={{ 
        position: 'fixed', 
        bottom: 'var(--space-md)', 
        left: 0,
        right: 0,
        textAlign: 'center',
        fontSize: '9px', 
        opacity: 0.2, 
        letterSpacing: '0.2em', 
        textTransform: 'uppercase',
        pointerEvents: 'none'
      }}>
        Authorized Access Only
      </footer>
    </div>
  );
}
