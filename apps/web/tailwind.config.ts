import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      colors: {
        brand: {
          50: '#eefaf6',
          100: '#d4f3e8',
          200: '#a9e6d2',
          300: '#6dd4b7',
          400: '#35ba99',
          500: '#149e7f',
          600: '#0d7e67',
          700: '#0b6654',
          800: '#0a5144',
          900: '#092220',
        },
        forest: {
          950: '#061514',
          900: '#0b2220',
          850: '#0f2c2a',
          800: '#143633',
          700: '#1d4743',
          600: '#275c56',
        },
        limeglow: {
          300: '#bef264',
          400: '#a3e635',
          500: '#84cc16',
        },
        porcelain: {
          50: '#f7f9fb',
          100: '#edf1f5',
          200: '#dfe6ed',
        },
      },
      boxShadow: {
        shell: '0 20px 50px -15px rgba(6, 21, 20, 0.22)',
        card: '0 1px 2px rgba(15, 23, 42, 0.04), 0 4px 16px -6px rgba(15, 23, 42, 0.06)',
        elevated: '0 12px 32px -10px rgba(15, 23, 42, 0.14)',
        lime: '0 6px 20px -5px rgba(163, 230, 53, 0.42)',
      },
      borderRadius: {
        '2xl': '0.95rem',
        '3xl': '1.25rem',
      },
    },
  },
  plugins: [],
};

export default config;
