/**
 * 区域模式（港澳台 / 大陆）—— 统一由 src/shared/region.js 提供实现，
 * 沙箱与主世界钩子经 esbuild 共用同一份代码，避免双份维护静默漂移。
 */
export { REGION_MODES, DEFAULT_REGION_MODE, patchRegion } from '../shared/region.js';