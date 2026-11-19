import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eefaf6',
          100: '#d4f3e8',
          200: '#a9e6d2',
          500: '#16a388',
          600: '#0f8672',
          700: '#0d6f60',
          800: '#0c564b',
          900: '#0c2221',
        },
        forest: {
          950: '#071716',
          900: '#0c2221',
          800: '#14312f',
          700: '#1b3f3c',
          600: '#25524e',
        },
        limeglow: {
          400: '#a3e635',
          500: '#84cc16',
        },
      },
      boxShadow: {
        shell: '0 24px 60px -15px rgba(7, 23, 22, 0.22)',
        card: '0 2px 12px -2px rgba(12, 34, 33, 0.05)',
      },
    },
  },
  plugins: [],
};

export default config;
