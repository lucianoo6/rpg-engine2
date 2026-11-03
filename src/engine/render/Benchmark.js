/**
 * In-game benchmark: renders the same scripted sequence at each quality
 * level and reports average fps, the slowest 1% of frames, CPU time per
 * frame and draw calls. Run it on the machine you care about; numbers from
 * one GPU say little about another.
 */
export async function runBenchmark(engine, quality, {
  levels = ['low', 'medium', 'high', 'ultra'],
  warmup = 1.5,
  duration = 5,
  drive = null, // (t: seconds into the run, level) => void, moves camera/actors identically per run
  onProgress = null, // (text) => void
} = {}) {
  const prev = { level: quality.level, auto: quality.auto };
  quality.auto = false;
  const results = [];
  for (const level of levels) {
    quality.apply(level);
    onProgress?.(`Benchmarking ${level}…`);
    const frames = [];
    let calls = 0, cpu = 0, n = 0;
    let t = 0;
    await new Promise((resolve) => {
      const sys = () => {
        // real elapsed time (rawDt is clamped), so slow machines still get 5 s per preset
        t += engine.frameTime / 1000;
        drive?.(t, level);
        if (t > warmup) {
          frames.push(engine.frameTime);
          calls += engine.stats.calls;
          cpu += engine.stats.cpuMs;
          n++;
        }
        if (t >= warmup + duration) {
          engine.removeSystem(sys);
          resolve();
        }
      };
      engine.addSystem(sys);
    });
    const sorted = frames.slice().sort((a, b) => b - a);
    const avgMs = frames.reduce((a, b) => a + b, 0) / Math.max(1, frames.length);
    const worst = sorted.slice(0, Math.max(1, Math.floor(frames.length / 100)));
    const lowMs = worst.reduce((a, b) => a + b, 0) / worst.length;
    results.push({
      level,
      fps: Math.round((1000 / avgMs) * 10) / 10,
      low1: Math.round((1000 / lowMs) * 10) / 10,
      frameMs: Math.round(avgMs * 10) / 10,
      cpuMs: Math.round((cpu / Math.max(1, n)) * 10) / 10,
      drawCalls: Math.round(calls / Math.max(1, n)),
      frames: frames.length,
    });
  }
  quality.set(prev.level, { auto: prev.auto });
  onProgress?.(null);
  return results;
}
