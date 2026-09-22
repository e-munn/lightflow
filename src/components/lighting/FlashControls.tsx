'use client';
import {useEffect,useId,useState,type ButtonHTMLAttributes,type ReactNode,type RefObject} from 'react';

export function IconButton({label,detail,children,...props}:ButtonHTMLAttributes<HTMLButtonElement>&{label:string;detail?:string;children:ReactNode}){
 const id=useId();
 return <span className="flash-tool"><button type="button" className="flash-icon" aria-label={label} aria-describedby={id} {...props}>{children}</button><span id={id} role="tooltip" className="flash-tooltip"><strong>{label}</strong>{detail&&<span>{detail}</span>}</span></span>;
}

export function useFlashControls(surface:RefObject<HTMLElement|null>){
 const [controlsVisible,setControlsVisible]=useState(true),[isFullscreen,setIsFullscreen]=useState(false);
 useEffect(()=>{
  const root=surface.current;if(!root)return;
  let timer:ReturnType<typeof setTimeout>,pointerHeld=false,keyboardFocus=false;
  const reveal=()=>{
   setControlsVisible(true);clearTimeout(timer);
   timer=setTimeout(()=>{const focused=keyboardFocus&&root.contains(document.activeElement)&&document.activeElement?.closest('[data-flash-ui]');if(!pointerHeld&&!focused)setControlsVisible(false);},3000);
  };
  const pointerMove=()=>{keyboardFocus=false;reveal();};
  const pointerDown=()=>{pointerHeld=true;keyboardFocus=false;reveal();};
  const pointerUp=()=>{pointerHeld=false;reveal();};
  const key=()=>{keyboardFocus=true;reveal();};
  const fullscreenChange=()=>{setIsFullscreen(document.fullscreenElement===root);reveal();};
  root.addEventListener('pointermove',pointerMove);root.addEventListener('pointerdown',pointerDown);root.addEventListener('focusin',reveal);root.addEventListener('focusout',reveal);root.addEventListener('wheel',reveal,{passive:true});window.addEventListener('pointerup',pointerUp);window.addEventListener('pointercancel',pointerUp);window.addEventListener('keydown',key);document.addEventListener('fullscreenchange',fullscreenChange);reveal();
  return()=>{clearTimeout(timer);root.removeEventListener('pointermove',pointerMove);root.removeEventListener('pointerdown',pointerDown);root.removeEventListener('focusin',reveal);root.removeEventListener('focusout',reveal);root.removeEventListener('wheel',reveal);window.removeEventListener('pointerup',pointerUp);window.removeEventListener('pointercancel',pointerUp);window.removeEventListener('keydown',key);document.removeEventListener('fullscreenchange',fullscreenChange);};
 },[surface]);
 return {controlsVisible,isFullscreen};
}
