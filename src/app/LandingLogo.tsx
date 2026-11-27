"use client";

import { useState } from "react";
import { TPEVectorLogo } from "../components/templates/TPEVectorLogo";

export default function LandingLogo() {
  const [replayCount, setReplayCount] = useState(0);

  return (
    <button
      type="button"
      translate="no"
      className="tpe-landing-logo-button"
      aria-label="Replay The Pakistan Edit logo animation"
      onClick={() => setReplayCount((count) => count + 1)}
    >
      <TPEVectorLogo key={replayCount} scale={1.8} animateWordmark decorative />
    </button>
  );
}
