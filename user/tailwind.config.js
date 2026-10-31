/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      screens: {
        xs: '475px',
      },
      spacing: {
        xs: '0.25rem',
        sm: '0.5rem',
        md: '0.75rem',
        lg: '1rem',
        xl: '1.25rem',
        '2xl': '1.5rem',
      },
      fontSize: {
        xs: ['0.75rem', { lineHeight: '1rem' }],
        sm: ['0.875rem', { lineHeight: '1.25rem' }],
        base: ['1rem', { lineHeight: '1.5rem' }],
        lg: ['1.125rem', { lineHeight: '1.5rem' }],
        xl: ['1.25rem', { lineHeight: '1.75rem' }],
        '2xl': ['1.5rem', { lineHeight: '2rem' }],
        '3xl': ['1.875rem', { lineHeight: '2.25rem' }],
      },
      colors: {
        // Core dark palette matching StakeX-like theme
        background: '#0B0B0D',
        surface: '#121215',
        surface2: '#1A1A1F',
        muted: '#2A2A32',
        border: '#2E2E36',
        text: '#E7E7EA',
        subtle: '#9EA0A8',
        primary: '#FF3B30',
        primary2: '#EF233C',
        accent: '#8B5CF6',
        success: '#22C55E',
        warning: '#F59E0B',
      },
      boxShadow: {
        soft: '0 10px 30px rgba(0,0,0,0.40)',
        card: '0 6px 16px rgba(0,0,0,0.35)',
        inner: 'inset 0 1px 0 rgba(255,255,255,0.06), inset 0 -1px 0 rgba(0,0,0,0.5)'
      },
      borderRadius: {
        none: '0px',
        sm: '5px',
        DEFAULT: '5px',
        md: '5px',
        lg: '5px',
        xl: '5px',
        '2xl': '5px',
        '3xl': '5px',
        full: '9999px',
      },
      fontFamily: {
        inter: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      backgroundImage: {
        bannerRed: 'linear-gradient(135deg, #FF3B30 0%, #D4145A 100%)',
        bannerPurple: 'linear-gradient(135deg, #8B5CF6 0%, #6D28D9 100%)',
        tile: 'linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02))',
      }
    },
  },
  plugins: [],
}


