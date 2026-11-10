import { motion, useReducedMotion } from "framer-motion";
import { getCopy } from "@/lib/ui-copy";

const copy = getCopy();

export const Greeting = () => {
  const reduceMotion = useReducedMotion();
  const initial = reduceMotion ? false : { opacity: 0, y: 10 };

  return (
    <div className="flex flex-col items-center px-4" key="overview">
      <motion.h1
        animate={{ opacity: 1, y: 0 }}
        className="text-balance text-center font-semibold text-[28px] leading-tight tracking-tight text-foreground md:text-[34px]"
        initial={initial}
        transition={{ delay: 0.05, duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      >
        {copy.greetingTitle}
      </motion.h1>
      <motion.p
        animate={{ opacity: 1, y: 0 }}
        className="mt-2 max-w-sm text-balance text-center text-[17px] leading-snug text-muted-foreground"
        initial={initial}
        transition={{ delay: 0.1, duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      >
        {copy.greetingSubtitle}
      </motion.p>
    </div>
  );
};
