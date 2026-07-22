export function shouldScheduleParticleFrame({
  active,
  activeMix,
  reducedMotion,
  pageVisible
}: {
  active: boolean;
  activeMix: number;
  reducedMotion: boolean;
  pageVisible: boolean;
}) {
  return pageVisible && !reducedMotion && (active || activeMix > 0.01);
}
