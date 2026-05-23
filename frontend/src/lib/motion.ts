import type { Variants, Transition } from 'framer-motion';

export const springSoft: Transition = {
  type: 'spring',
  stiffness: 380,
  damping: 28,
};

export const springSnappy: Transition = {
  type: 'spring',
  stiffness: 400,
  damping: 24,
};

export const cardEnter: Variants = {
  initial: { opacity: 0, y: 12, scale: 0.98 },
  animate: { opacity: 1, y: 0, scale: 1, transition: springSoft },
};

export const cardHover = {
  whileHover: { y: -2 },
  transition: springSnappy,
};

export const dialogEnter: Variants = {
  initial: { opacity: 0, scale: 0.94 },
  animate: { opacity: 1, scale: 1, transition: { type: 'spring', stiffness: 360, damping: 28 } },
  exit: { opacity: 0, scale: 0.96, transition: { duration: 0.15 } },
};

export const listStagger: Variants = {
  initial: {},
  animate: {
    transition: {
      staggerChildren: 0.04,
      delayChildren: 0.05,
    },
  },
};

export const listItem: Variants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: springSoft },
};

export const buttonTap = {
  whileTap: { scale: 0.97 },
  transition: { duration: 0.08 },
};
