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
          300: '#6dd4b7',
          400: '#35ba99',
          500: '#149e7f',
          600: '#0d7e67',
          700: '#0b6654',
          800: '#0a5144',
          900: '#092220',
        },
        forest: {
          950: '#051413',
          900: '#091f1e',
          850: '#0d2927',
          800: '#123330',
          700: '#1a423e',
          600: '#245651',
        },
        limeglow: {
          300: '#bef264',
          400: '#a3e635',
          500: '#84cc16',
        },
        porcelain: {
          50: '#fafcfb',
          100: '#f3f7f6',
          200: '#e6eeec',
        },
      },
      boxShadow: {
        shell: '0 24px 60px -15px rgba(5, 20, 19, 0.25)',
        card: '0 1px 2px rgba(9, 31, 30, 0.04), 0 6px 20px -6px rgba(9, 31, 30, 0.06)',
        elevated: '0 14px 36px -10px rgba(5, 20, 19, 0.14)',
        lime: '0 8px 24px -6px rgba(163, 230, 53, 0.45)',
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.35rem',
      },
    },
  },
  plugins: [],
};

export default config;
