import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-noto)', 'Noto Serif TC', 'serif'],
        mono: ['var(--font-mono)', 'Space Mono', 'monospace'],
      },
    },
  },
  plugins: [],
}
export default config
