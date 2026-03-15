/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Work Sans"', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        spin: {
          seagreen:      '#34E8BD',
          midgreen:      '#1FBCA0',
          oxfordblue:    '#0D203F',
          navy:          '#162D50',
          darkplum:      '#525776',
          darkspace:     '#213762',
          lavender:      '#BEA7E5',
          lightplum:     '#D3C3D9',
          lightgrey:     '#D9DBE8',
          lightlavender: '#ECE5EE',
          lightlemon:    '#F9F7EE',
          rust:          '#EF946C',
          colablue:      '#0E8FDD',
        },
      },
      boxShadow: {
        card: '0 1px 3px 0 rgba(0,0,0,.06), 0 1px 2px -1px rgba(0,0,0,.06)',
        'card-hover': '0 4px 14px 0 rgba(0,0,0,.08), 0 2px 4px -1px rgba(0,0,0,.05)',
      },
      keyframes: {
        shimmer: {
          '0%':   { backgroundPosition: '-400px 0' },
          '100%': { backgroundPosition: '400px 0' },
        },
      },
      animation: {
        shimmer: 'shimmer 1.4s ease infinite',
      },
    },
  },
  plugins: [],
}
