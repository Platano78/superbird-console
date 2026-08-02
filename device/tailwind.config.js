/**
 * Motion encodes state; it never decorates.
 *   breathe — ATTENTION: a session is blocked on you. Slow, so it reads as
 *             "waiting", not "alarm". The only looping animation on a tile.
 *   sweep   — BUSY: work is happening. One travelling highlight.
 *   riseIn  — an ask ARRIVING. Fires once; the motion is the notification.
 * Chromium 69 supports all of these (transforms, keyframes, opacity).
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      keyframes: {
        breathe: { '0%, 100%': { opacity: '1' }, '50%': { opacity: '0.45' } },
        sweep: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(400%)' },
        },
        riseIn: {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        breathe: 'breathe 2.4s ease-in-out infinite',
        sweep: 'sweep 1.8s ease-in-out infinite',
        riseIn: 'riseIn 260ms ease-out',
      },
    },
  },
  plugins: [],
}
