import { afterEach, describe, expect, it } from "vitest";
import { Text } from "ink";
import { frameText, renderThemed, tick } from "../../test-utils/testRender.js";
import { SPINNERS, useBlink, useSpinnerFrame, type SpinnerStyle } from "../useSpinner.js";

function SpinnerProbe({ style }: { style: SpinnerStyle }) {
  const frame = useSpinnerFrame(true, style);
  return <Text>{frame}</Text>;
}

function BlinkProbe() {
  const on = useBlink(true);
  return <Text>{on ? "ON" : "OFF"}</Text>;
}

describe("SPINNERS registry", () => {
  it("defines four single-cell styles with positive intervals", () => {
    const styles = Object.keys(SPINNERS).sort();
    expect(styles).toEqual(["arrows", "blocks", "dots", "pulse"]);
    for (const style of styles as SpinnerStyle[]) {
      const { frames, interval } = SPINNERS[style];
      expect(frames.length).toBeGreaterThan(2);
      for (const frame of frames) expect([...frame].length).toBe(1);
      expect(interval).toBeGreaterThan(0);
    }
  });

  it("keeps the legacy dots frames byte-identical", () => {
    expect([...SPINNERS.dots.frames]).toEqual(["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]);
    expect(SPINNERS.dots.interval).toBe(80);
  });
});

describe("useSpinnerFrame", () => {
  it("renders the first frame on mount for every style", () => {
    for (const style of Object.keys(SPINNERS) as SpinnerStyle[]) {
      const rendered = renderThemed(<SpinnerProbe style={style} />);
      expect(frameText(rendered.lastFrame)).toBe(SPINNERS[style].frames[0]);
      rendered.unmount();
    }
  });
});

describe("useBlink", () => {
  it("starts visible for a deterministic first frame", () => {
    const rendered = renderThemed(<BlinkProbe />);
    expect(frameText(rendered.lastFrame)).toBe("ON");
    rendered.unmount();
  });
});

describe("ANVIL_NO_ANIM", () => {
  let saved: string | undefined;
  afterEach(() => {
    if (saved === undefined) delete process.env.ANVIL_NO_ANIM;
    else process.env.ANVIL_NO_ANIM = saved;
  });

  const withNoEnv = () => {
    saved = process.env.ANVIL_NO_ANIM;
    process.env.ANVIL_NO_ANIM = "1";
  };
  const restoreEnv = () => {
    if (saved === undefined) delete process.env.ANVIL_NO_ANIM;
    else process.env.ANVIL_NO_ANIM = saved;
  };

  it("freezes an ACTIVE spinner on its first frame (same contract as the wordmark)", async () => {
    withNoEnv();
    const rendered = renderThemed(<SpinnerProbe style="dots" />);
    await tick(250); // three 80 ms spinner frames have elapsed by now
    expect(frameText(rendered.lastFrame)).toBe(SPINNERS.dots.frames[0]);
    rendered.unmount();
    restoreEnv();
  });

  it("keeps the streaming cursor visible instead of blinking", async () => {
    withNoEnv();
    const rendered = renderThemed(<BlinkProbe />);
    await tick(700); // past SPINNER_BLINK_INTERVAL_MS (530)
    expect(frameText(rendered.lastFrame)).toBe("ON");
    rendered.unmount();
    restoreEnv();
  });
});
