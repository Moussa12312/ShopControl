import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      colors: {
        brand: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#172554',
        },
        forest: {
          950: '#060d19',
          900: '#0a1526',
          850: '#0e1d35',
          800: '#142847',
          700: '#1c365d',
          600: '#244577',
        },
        limeglow: {
          300: '#7dd3fc',
          400: '#38bdf8',
          500: '#0284c7',
        },
        porcelain: {
          50: '#f8fafc',
          100: '#f1f5f9',
          200: '#e2e8f0',
        },
      },
      boxShadow: {
        shell: '0 20px 50px -15px rgba(6, 13, 25, 0.4)',
        card: '0 1px 2px rgba(15, 23, 42, 0.04), 0 4px 16px -6px rgba(15, 23, 42, 0.06)',
        elevated: '0 12px 32px -10px rgba(15, 23, 42, 0.14)',
        lime: '0 6px 20px -5px rgba(56, 189, 248, 0.42)',
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
