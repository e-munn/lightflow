import {readFile} from 'node:fs/promises';
export const PHRASE_DIRECTORY='/Volumes/ExtremePro/Code/lightflow/research/brightness_phrase_target_v2';
export type PhraseFrame={time:number;at:number;rms:number;values:number[];music:number[];styleValues:number[];metrics:{onset:number;[key:string]:number};scope:{brightness:number;coverage:number;q60:number;outsideFraction:number}};
export type PhraseData={version:string;name:string;source:{path:string;startSeconds:number;durationSeconds:number;excerptFile:string;excerptSha256:string;pcmMatchesAnalysis:boolean};fps:number;analysisPrefixSeconds:number;provisionalImpactSeconds:number;impactProvenance:string;preferredCircle:Record<string,number>;unobservedCircleDefaults:Record<string,number>;styleSettings:Record<string,Record<string,number>>;trainedModel:boolean;frames:PhraseFrame[]};
export async function readPhrase():Promise<PhraseData>{return JSON.parse(await readFile(`${PHRASE_DIRECTORY}/data.json`,'utf8'));}
