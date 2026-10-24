/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './App.{js,jsx}',
    './src/**/*.{js,jsx}',
    './components/**/*.{js,jsx}',
  ],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        background: '#09090B',
        'background-elevated': '#0F0F12',
        'background-card': '#131316',
        'background-input': '#18181B',
        primary: '#3B82F6',
        'primary-dark': '#2563EB',
        'primary-light': '#60A5FA',
        success: '#22C55E',
        danger: '#EF4444',
        warning: '#F59E0B',
        muted: '#71717A',
        secondary: '#A1A1AA',
        surface: '#1C1C21',
        'glass-border': 'rgba(255, 255, 255, 0.06)',
      },
      fontFamily: {
        sans: ['System'],
      },
      borderRadius: {
        '4xl': '32px',
      },
    },
  },
  plugins: [],
};
