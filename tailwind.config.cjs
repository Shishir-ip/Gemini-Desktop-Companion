/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/**/*.{html,ts,css}'],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          'Inter',
          'SF Pro Display',
          'SF Pro Text',
          'Segoe UI Variable Display',
          'Segoe UI',
          'system-ui',
          '-apple-system',
          'sans-serif'
        ]
      },
      colors: {
        glass: {
          900: 'rgba(18, 18, 20, 0.78)',
          800: 'rgba(24, 24, 27, 0.72)',
          700: 'rgba(32, 32, 36, 0.65)',
          border: 'rgba(255, 255, 255, 0.10)',
          borderStrong: 'rgba(255, 255, 255, 0.16)'
        }
      },
      borderRadius: {
        ios: '1.25rem',
        'ios-lg': '1.75rem'
      },
      transitionTimingFunction: {
        ios: 'cubic-bezier(0.32, 0.72, 0, 1)'
      }
    }
  },
  plugins: []
}
