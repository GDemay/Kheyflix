export function playKheyflixSting() {
  if (
    typeof window === "undefined" ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  )
    return;
  try {
    const context = new window.AudioContext();
    const compressor = context.createDynamicsCompressor();
    const master = context.createGain();
    compressor.threshold.value = -15;
    compressor.knee.value = 12;
    compressor.ratio.value = 5;
    master.gain.setValueAtTime(0.0001, context.currentTime);
    master.gain.exponentialRampToValueAtTime(0.22, context.currentTime + 0.025);
    master.gain.setValueAtTime(0.2, context.currentTime + 1.15);
    master.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 2.2);
    master.connect(compressor).connect(context.destination);

    const strike = (when: number, frequency: number, peak: number) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency * 1.35, when);
      oscillator.frequency.exponentialRampToValueAtTime(frequency, when + 0.18);
      gain.gain.setValueAtTime(0.0001, when);
      gain.gain.exponentialRampToValueAtTime(peak, when + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.82);
      oscillator.connect(gain).connect(master);
      oscillator.start(when);
      oscillator.stop(when + 0.9);
    };
    strike(context.currentTime, 73.42, 1);
    strike(context.currentTime + 0.24, 110, 0.72);

    [146.83, 220, 293.66, 440].forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const when = context.currentTime + 0.36 + index * 0.055;
      oscillator.type = index % 2 ? "triangle" : "sine";
      oscillator.frequency.setValueAtTime(frequency, when);
      oscillator.frequency.exponentialRampToValueAtTime(
        frequency * 1.025,
        when + 1.35,
      );
      gain.gain.setValueAtTime(0.0001, when);
      gain.gain.exponentialRampToValueAtTime(0.24, when + 0.08);
      gain.gain.exponentialRampToValueAtTime(0.0001, when + 1.55);
      oscillator.connect(gain).connect(master);
      oscillator.start(when);
      oscillator.stop(when + 1.65);
    });
    setTimeout(() => void context.close(), 2500);
  } catch {}
}
