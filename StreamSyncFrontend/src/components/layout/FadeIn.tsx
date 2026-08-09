import { motion, useReducedMotion } from 'framer-motion'
import type { ReactNode } from 'react'

/**
 * Entrance animation for page sections.
 *
 * Deliberately small: 6px and 220ms, staggered by index. Motion here has one
 * job — to signal that content arrived in a sensible order — and anything
 * larger turns a dashboard into a performance every time it loads. (§70)
 *
 * `prefers-reduced-motion` removes the movement entirely rather than shortening
 * it, and the content still renders. (§20)
 */
export function FadeIn({
  children,
  /** Position in the sequence; each step delays by 45ms. */
  index = 0,
  className,
}: {
  children: ReactNode
  index?: number
  className?: string
}) {
  const reduceMotion = useReducedMotion()

  if (reduceMotion) return <div className={className}>{children}</div>

  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.22,
        // Capped so a long page never leaves the last section waiting a second.
        delay: Math.min(index * 0.045, 0.27),
        ease: [0.25, 1, 0.5, 1],
      }}
    >
      {children}
    </motion.div>
  )
}
