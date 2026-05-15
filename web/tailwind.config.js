/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // A small palette that reads against both the dark-themed
        // placeholder page from step 1 and the light fallback.
        // Borrow what you've already set up in cranberrylabs-web if
        // you want exact visual consistency.
        canvas: 'var(--cl-canvas, #0e0e10)',
        surface: 'var(--cl-surface, #1a1a1d)',
        ink: 'var(--cl-ink, #e4e4e7)',
        muted: 'var(--cl-muted, #71717a)',
        accent: 'var(--cl-accent, #b91c40)',
      },
    },
  },
  plugins: [],
};
