/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
    },
  },
  plugins: [
    // @tailwindcss/typography is already in package.json, so we can assume it's intended.
    // If it was meant to be configured differently, that would require more investigation.
    require('@tailwindcss/typography'),
  ],
}
