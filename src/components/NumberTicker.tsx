import { motion, useReducedMotion } from "framer-motion";

const digits = Array.from({ length: 10 }, (_, index) => index);

function RollingDigit({ digit, delay }: { digit: number; delay: number }) {
  const reduceMotion = useReducedMotion();
  return (
    <span className="ticker-column" aria-hidden="true">
      <motion.span
        className="ticker-strip"
        animate={{ y: `${digit * -10}%` }}
        transition={
          reduceMotion
            ? { duration: 0 }
            : { type: "spring", stiffness: 170, damping: 22, mass: 0.72, delay }
        }
      >
        {digits.map((item) => (
          <span key={item}>{item}</span>
        ))}
      </motion.span>
    </span>
  );
}

export function NumberTicker({ value, suffix }: { value: string; suffix: string }) {
  const characters = value.split("");
  return (
    <div className="number-ticker" aria-label={`${value} ${suffix}`}>
      <div className="ticker-value">
        {characters.map((character, index) =>
          /\d/.test(character) ? (
            <RollingDigit
              key={`${index}-${characters.length}`}
              digit={Number(character)}
              delay={(characters.length - index) * 0.018}
            />
          ) : (
            <span className="ticker-symbol" key={`${character}-${index}`} aria-hidden="true">
              {character}
            </span>
          )
        )}
      </div>
      <span className="ticker-unit">{suffix}</span>
    </div>
  );
}
