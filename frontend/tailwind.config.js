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
        vmd: {
          bg: '#fafafa',
          elevated: '#ffffff',
          surface: '#ffffff',
          surfaceStrong: '#ffffff',
          surfaceSubtle: '#f5f5f5',
          border: '#e5e5e5',
          borderStrong: '#d4d4d4',
          text: '#262626',
          textStrong: '#171717',
          textMuted: '#525252',
          textSubtle: '#737373',
          link: '#171717',
          accent: '#171717',
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
