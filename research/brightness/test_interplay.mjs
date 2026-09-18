import assert from 'node:assert/strict';
import {RECIPES,RecipeRouter,InterplayBank,defaultInterplaySettings} from '../../public/scope-interplay.mjs';
const settings=defaultInterplaySettings(),values=[.35,.55,.9,.65,.45,.6,.4,.3,.5,.25];
const cue=(at,extras={})=>({at,dt:.02,age:at,silent:false,hit:false,onset:0,airEvent:false,highNovelty:0,levelDb:0,lowDb:0,highDb:0,low:.2,lowBody:.1,midBody:.1,continuity:.3,density:0,regularity:0,spread:.05,widening:0,rough:.12,centroidRise:0,build:0,armed:false,bodySupport:false,energySupport:false,...extras});
function advance(r,start,end,extras){let result;for(let i=Math.round(start*50);i<=Math.round(end*50);i++)result=r.frame(cue(i/50,extras),values,settings[RECIPES[r.index].id]);return result;}
const preferred=new RecipeRouter(0);advance(preferred,0,1,{continuity:.8,rough:.4});const immediate=preferred.frame(cue(1.02,{hit:true,onset:.9,lowDb:8,low:.6,bodySupport:true}),values,settings.arrival);assert.equal(immediate.mode,'snap');assert.equal(immediate.brightness,values[2]);assert(immediate.provisional);
const confirmed=advance(preferred,1.04,1.5,{bodySupport:true,lowBody:.9});assert(confirmed.confirmed);assert.equal(confirmed.mode,'snap');
const departed=advance(preferred,1.52,3,{});assert.notEqual(departed.mode,'snap');assert(!departed.confirmed);
const returnedBody=advance(preferred,3.02,4,{bodySupport:true,lowBody:.9,density:3});assert.notEqual(returnedBody.mode,'snap','an expired arrival needs a new attack');
const isolated=new RecipeRouter(0);advance(isolated,0,1,{});isolated.frame(cue(1.02,{hit:true,onset:.9,levelDb:7}),values,settings.arrival);const rejected=advance(isolated,1.04,1.6,{});assert.equal(rejected.rejectedEntries,1);assert.notEqual(rejected.mode,'snap');
const roll=new RecipeRouter(0);for(let i=0;i<150;i++){const r=roll.frame(cue(i*.02,{hit:i%5===0,onset:.85,levelDb:7,centroidRise:.3,density:9}),values,settings.arrival);assert.notEqual(r.mode,'snap');assert(!r.confirmed);}
const expectations=[
 [1,'snap',{hit:true,onset:.8}], [2,'air',{highDb:8,centroidRise:.2}], [3,'sustain',{midBody:.9,continuity:.9}],
 [5,'breathe',{regularity:.9}], [6,'width',{spread:.7,widening:.4}], [8,'grain',{rough:.8}], [9,'weight',{lowBody:.95,lowDb:8}],
];
for(const [index,mode,inputs] of expectations){const r=new RecipeRouter(index);const result=advance(r,0,1.6,inputs);assert.equal(result.mode,mode,RECIPES[index].id);assert(result.brightness>=0&&result.brightness<=1);}
const lift=new RecipeRouter(4);advance(lift,0,1,{build:.6});lift.frame(cue(1.02,{hit:true,onset:.9,lowDb:8,low:.6,bodySupport:true}),values,settings.lift);assert.equal(advance(lift,1.04,2.4,{bodySupport:true,lowBody:.9}).mode,'weight');
const reply=new RecipeRouter(7);assert.equal(reply.frame(cue(1,{hit:true,onset:.9}),values,settings.reply).mode,'snap');assert.equal(reply.frame(cue(1.14,{airEvent:true,highNovelty:1}),values,settings.reply).mode,'air');assert.equal(advance(reply,1.16,1.6,{}).mode,'space');
const noReply=new RecipeRouter(7);noReply.frame(cue(1,{hit:true,onset:.9}),values,settings.reply);const rows=[];for(let i=51;i<90;i++)rows.push(noReply.frame(cue(i/50),values,settings.reply).mode);assert(!rows.includes('air'));
const tail=new RecipeRouter(10);assert.equal(tail.frame(cue(1,{hit:true,onset:.9}),values,settings.afterglow).mode,'snap');assert.equal(advance(tail,1.02,1.5,{midBody:.9,continuity:.9}).mode,'sustain');assert.equal(advance(tail,1.52,2,{}).mode,'space');
const mono=new RecipeRouter(6);assert.equal(advance(mono,0,2,{spread:0,widening:0}).mode,'circle');
// Interrupt a fade and preserve the current blended value as the new start.
const fade=new RecipeRouter(2);fade.switch('air',.75,cue(0),values,.4,'test');const middle=fade.mix(values,.1).value;fade.switch('grain',.75,cue(.1),values,.2,'interrupt');assert.equal(fade.mix(values,.1).value,middle);
const a=new InterplayBank(),b=new InterplayBank(),style={valid:true,values,metrics:{onset:.2,low:.4,mid:.4,texture:.4,spread:.3,flatness:.4,centroid:.4,build:.2}};
for(let i=0;i<150;i++){const f={at:i*.02,rms:.2,music:Array(16).fill(.3)};assert.deepEqual(a.frame(f,style),b.frame(f,style));}
const black=a.frame({at:3,rms:0,music:Array(16).fill(0)},{...style,values:Array(10).fill(0),metrics:{}});assert(black.values.every(v=>v===0));assert(a.context.history.length>100,'short silence retains router context');
assert.equal(a.frame({at:4,rms:.2,music:[NaN]},style).valid,false);const invalid=defaultInterplaySettings();invalid.arrival.restraint=NaN;assert.equal(a.frame({at:4,rms:.2,music:Array(16).fill(.3)},style,invalid).valid,false);
assert.equal(RECIPES.length,11);
console.log(JSON.stringify({passed:true,recipes:11,checks:['immediate provisional impact','continued evidence confirms','isolated transient is rejected','high roll without body does not confirm','all recipe route conditions','no invented high reply','mono width fallback','interrupted fade continuity','deterministic causal prefixes','short-rest context retention','silence and invalid/settings blackout']}));
