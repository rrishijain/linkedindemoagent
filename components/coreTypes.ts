// Shared contract between the console and whichever centerpiece is mounted.
// Kept in its own module so the type import doesn't drag a core's WebGL
// payload into the server bundle.

import type { CoreReadout, Strand } from "@/lib/strands";

export type CoreMode = "idle" | "working" | "listening" | "speaking" | "error";

/** celebration impulse tiers — "minor" never reaches the orb (panel shimmer
 *  + chime only); "major" blooms with a short gold swing; "record" is the
 *  full-wall moment */
export type CelebrateTier = "minor" | "major" | "record";

/** one-shot impulse: bump seq per event; tier sets the envelope */
export interface CelebrateSignal {
  seq: number;
  tier: CelebrateTier;
}

export interface CoreProps {
  mode?: CoreMode;
  /** one wire per channel of the wall — see lib/strands.ts */
  strands?: Strand[];
  /** the one big figure the nucleus holds — see lib/strands.ts */
  readout?: CoreReadout | null;
  /** real speech envelope 0..1, or null when no audio is playing */
  getLevel?: () => number | null;
  celebrate?: CelebrateSignal | null;
}
