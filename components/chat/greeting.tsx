import { motion, useReducedMotion } from "framer-motion";
import { getCopy } from "@/lib/ui-copy";

const copy = getCopy();

export const Greeting = () => {
  const reduceMotion = useReducedMotion();
  const initial = reduceMotion ? false : { opacity: 0, y: 10 };

  return (
    <div className="flex flex-col items-center px-4" key="overview">
      <motion.div
        animate={{ opacity: 1, y: 0 }}
        className="text-center font-semibold text-2xl tracking-tight text-foreground md:text-3xl"
        initial={initial}
        transition={{ delay: 0.35, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      >
        {copy.greetingTitle}
      </motion.div>
      <motion.div
        animate={{ opacity: 1, y: 0 }}
        className="mt-3 text-center text-muted-foreground text-sm"
        initial={initial}
        transition={{ delay: 0.5, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      >
        {copy.greetingSubtitle}
      </motion.div>
    </div>
  );
};
