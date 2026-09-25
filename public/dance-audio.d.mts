export type Ridge = {mean:number[];std:number[];offset:number[];weights:number[][];indices:number[]};
export type DanceModel = {id:string;version:string;warmupSeconds:number;selectedByValidation:'movement'|'direct';models:{movement:Ridge;direct:Ridge;rms:Ridge}};
export type DanceFrame = {t:number;rms:number;ready:boolean;features:number[];components:number[];movement:number;direct:number;rmsModel:number;silent:boolean};
export const RATE:number,WINDOW:number,HOP:number;
export const LAGS:number[],EDGES:number[];
export class DanceAudio{constructor(model?:DanceModel|null);reset():void;step(chunk:Float32Array):DanceFrame;}
export function regress(model:Ridge,features:number[]):number[];
export function projectMovement(y:number[]):number;
export function inferBuffer(samples:Float32Array,model:DanceModel):DanceFrame[];
