import { motion, useReducedMotion } from "framer-motion";
import type { MascotState } from "@/lib/mascot";
import { getCopy } from "@/lib/ui-copy";
import { AgentMascot } from "./agent-mascot";
import { useMascotPreference } from "./mascot-preference";

const copy = getCopy();

export const Greeting = ({ activity }: { activity: MascotState }) => {
  const reduceMotion = useReducedMotion();
  const { variant } = useMascotPreference();
  const initial = reduceMotion ? false : { opacity: 0, y: 10 };

  return (
    <div className="flex flex-col items-center px-4" key="overview">
      <AgentMascot
        animated
        priority
        size={156}
        state={activity}
        variant={variant}
      />
      <motion.h1
        animate={{ opacity: 1, y: 0 }}
        className="mt-3 text-balance text-center font-semibold text-[28px] leading-tight tracking-tight text-foreground md:text-[34px]"
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
