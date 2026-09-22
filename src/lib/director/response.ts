export const RESPONSE_MODES = {
 fast: {label:'Fast',description:'Quicker hits and earlier changes when the model is confident.',brightnessSeconds:.04,blendSeconds:.08,minHoldSeconds:.25,interruptMargin:.6,levelSamples:512},
 balanced: {label:'Balanced',description:'A little more movement between changes.',brightnessSeconds:.1,blendSeconds:.2,minHoldSeconds:.75,interruptMargin:.8,levelSamples:1024},
 original: {label:'Original',description:'The original two-second holds and softer transitions.',brightnessSeconds:.2,blendSeconds:.5,minHoldSeconds:2,interruptMargin:Infinity,levelSamples:2048},
} as const;
export type ResponseMode=keyof typeof RESPONSE_MODES;
