import { MotionConfig } from "framer-motion";
import { GlassShell } from "./components/GlassShell";
import { I18nProvider } from "./lib/i18n";

export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <I18nProvider>
        <GlassShell />
      </I18nProvider>
    </MotionConfig>
  );
}
