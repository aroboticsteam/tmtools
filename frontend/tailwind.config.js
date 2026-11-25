import preline from 'preline/plugin';

/**
 * Neutral, flat theme built on Tailwind + Preline (https://preline.co).
 *
 * The `vmd` colour keys are semantic names the pages already use
 * (`text-vmd-textMuted`, `border-vmd-border`, ...). They now point at the
 * neutral palette, so restyling happens here and not in every page.
 */
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}', './node_modules/preline/dist/*.js'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        neutral: {
          50: 'rgb(var(--n-50) / <alpha-value>)',
          100: 'rgb(var(--n-100) / <alpha-value>)',
          200: 'rgb(var(--n-200) / <alpha-value>)',
          300: 'rgb(var(--n-300) / <alpha-value>)',
          400: 'rgb(var(--n-400) / <alpha-value>)',
          500: 'rgb(var(--n-500) / <alpha-value>)',
          600: 'rgb(var(--n-600) / <alpha-value>)',
          700: 'rgb(var(--n-700) / <alpha-value>)',
          800: 'rgb(var(--n-800) / <alpha-value>)',
          900: 'rgb(var(--n-900) / <alpha-value>)',
        },
        red: {
          50: 'rgb(var(--red-50) / <alpha-value>)',
          200: 'rgb(var(--red-200) / <alpha-value>)',
          700: 'rgb(var(--red-700) / <alpha-value>)',
          800: 'rgb(var(--red-800) / <alpha-value>)',
          900: 'rgb(var(--red-900) / <alpha-value>)',
        },
        green: {
          50: 'rgb(var(--green-50) / <alpha-value>)',
          200: 'rgb(var(--green-200) / <alpha-value>)',
          800: 'rgb(var(--green-800) / <alpha-value>)',
          900: 'rgb(var(--green-900) / <alpha-value>)',
        },
        amber: {
          50: 'rgb(var(--amber-50) / <alpha-value>)',
          200: 'rgb(var(--amber-200) / <alpha-value>)',
          800: 'rgb(var(--amber-800) / <alpha-value>)',
          900: 'rgb(var(--amber-900) / <alpha-value>)',
        },
        blue: {
          200: 'rgb(var(--blue-200) / <alpha-value>)',
          700: 'rgb(var(--blue-700) / <alpha-value>)',
        },
        vmd: {
          bg: 'rgb(var(--bg) / <alpha-value>)',
          elevated: 'rgb(var(--surface) / <alpha-value>)',
          surface: 'rgb(var(--surface) / <alpha-value>)',
          surfaceStrong: 'rgb(var(--surface) / <alpha-value>)',
          surfaceSubtle: 'rgb(var(--n-100) / <alpha-value>)',
          border: 'rgb(var(--border) / <alpha-value>)',
          borderStrong: 'rgb(var(--border-strong) / <alpha-value>)',
          text: 'rgb(var(--text) / <alpha-value>)',
          textStrong: 'rgb(var(--text-strong) / <alpha-value>)',
          textMuted: 'rgb(var(--text-muted) / <alpha-value>)',
          textSubtle: 'rgb(var(--text-subtle) / <alpha-value>)',
          link: 'rgb(var(--text-strong) / <alpha-value>)',
          accent: 'rgb(var(--text-strong) / <alpha-value>)',
          success: '#15803d',
          danger: '#b91c1c',
          warning: '#b45309',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [preline],
};
