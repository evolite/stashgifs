(function(Ct){typeof define=="function"&&define.amd?define(Ct):Ct()})((function(){"use strict";/*!
 * Font Awesome Free 6.7.2 by @fontawesome - https://fontawesome.com
 * License - https://fontawesome.com/license/free (Icons: CC BY 4.0, Fonts: SIL OFL 1.1, Code: MIT License)
 * Copyright 2024 Fonticons, Inc.
 */const Gn={prefix:"fas",iconName:"tv",icon:[640,512,[63717,"television","tv-alt"],"f26c","M64 64l0 288 512 0 0-288L64 64zM0 64C0 28.7 28.7 0 64 0L576 0c35.3 0 64 28.7 64 64l0 288c0 35.3-28.7 64-64 64L64 416c-35.3 0-64-28.7-64-64L0 64zM128 448l384 0c17.7 0 32 14.3 32 32s-14.3 32-32 32l-384 0c-17.7 0-32-14.3-32-32s14.3-32 32-32z"]};/*!
 * Font Awesome Free 6.7.2 by @fontawesome - https://fontawesome.com
 * License - https://fontawesome.com/license/free (Icons: CC BY 4.0, Fonts: SIL OFL 1.1, Code: MIT License)
 * Copyright 2024 Fonticons, Inc.
 */function Vn(t,e,n){return(e=Kn(e))in t?Object.defineProperty(t,e,{value:n,enumerable:!0,configurable:!0,writable:!0}):t[e]=n,t}function Ae(t,e){var n=Object.keys(t);if(Object.getOwnPropertySymbols){var r=Object.getOwnPropertySymbols(t);e&&(r=r.filter(function(a){return Object.getOwnPropertyDescriptor(t,a).enumerable})),n.push.apply(n,r)}return n}function f(t){for(var e=1;e<arguments.length;e++){var n=arguments[e]!=null?arguments[e]:{};e%2?Ae(Object(n),!0).forEach(function(r){Vn(t,r,n[r])}):Object.getOwnPropertyDescriptors?Object.defineProperties(t,Object.getOwnPropertyDescriptors(n)):Ae(Object(n)).forEach(function(r){Object.defineProperty(t,r,Object.getOwnPropertyDescriptor(n,r))})}return t}function Xn(t,e){if(typeof t!="object"||!t)return t;var n=t[Symbol.toPrimitive];if(n!==void 0){var r=n.call(t,e);if(typeof r!="object")return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return(e==="string"?String:Number)(t)}function Kn(t){var e=Xn(t,"string");return typeof e=="symbol"?e:e+""}const we=()=>{};let It={},Oe={},Se=null,Pe={mark:we,measure:we};try{typeof window<"u"&&(It=window),typeof document<"u"&&(Oe=document),typeof MutationObserver<"u"&&(Se=MutationObserver),typeof performance<"u"&&(Pe=performance)}catch{}const{userAgent:ke=""}=It.navigator||{},G=It,w=Oe,Ee=Se,ht=Pe;G.document;const Y=!!w.documentElement&&!!w.head&&typeof w.addEventListener=="function"&&typeof w.createElement=="function",_e=~ke.indexOf("MSIE")||~ke.indexOf("Trident/");var Qn=/fa(s|r|l|t|d|dr|dl|dt|b|k|kd|ss|sr|sl|st|sds|sdr|sdl|sdt)?[\-\ ]/,Jn=/Font ?Awesome ?([56 ]*)(Solid|Regular|Light|Thin|Duotone|Brands|Free|Pro|Sharp Duotone|Sharp|Kit)?.*/i,Ce={classic:{fa:"solid",fas:"solid","fa-solid":"solid",far:"regular","fa-regular":"regular",fal:"light","fa-light":"light",fat:"thin","fa-thin":"thin",fab:"brands","fa-brands":"brands"},duotone:{fa:"solid",fad:"solid","fa-solid":"solid","fa-duotone":"solid",fadr:"regular","fa-regular":"regular",fadl:"light","fa-light":"light",fadt:"thin","fa-thin":"thin"},sharp:{fa:"solid",fass:"solid","fa-solid":"solid",fasr:"regular","fa-regular":"regular",fasl:"light","fa-light":"light",fast:"thin","fa-thin":"thin"},"sharp-duotone":{fa:"solid",fasds:"solid","fa-solid":"solid",fasdr:"regular","fa-regular":"regular",fasdl:"light","fa-light":"light",fasdt:"thin","fa-thin":"thin"}},Zn={GROUP:"duotone-group",PRIMARY:"primary",SECONDARY:"secondary"},Ie=["fa-classic","fa-duotone","fa-sharp","fa-sharp-duotone"],R="classic",gt="duotone",tr="sharp",er="sharp-duotone",Te=[R,gt,tr,er],nr={classic:{900:"fas",400:"far",normal:"far",300:"fal",100:"fat"},duotone:{900:"fad",400:"fadr",300:"fadl",100:"fadt"},sharp:{900:"fass",400:"fasr",300:"fasl",100:"fast"},"sharp-duotone":{900:"fasds",400:"fasdr",300:"fasdl",100:"fasdt"}},rr={"Font Awesome 6 Free":{900:"fas",400:"far"},"Font Awesome 6 Pro":{900:"fas",400:"far",normal:"far",300:"fal",100:"fat"},"Font Awesome 6 Brands":{400:"fab",normal:"fab"},"Font Awesome 6 Duotone":{900:"fad",400:"fadr",normal:"fadr",300:"fadl",100:"fadt"},"Font Awesome 6 Sharp":{900:"fass",400:"fasr",normal:"fasr",300:"fasl",100:"fast"},"Font Awesome 6 Sharp Duotone":{900:"fasds",400:"fasdr",normal:"fasdr",300:"fasdl",100:"fasdt"}},ar=new Map([["classic",{defaultShortPrefixId:"fas",defaultStyleId:"solid",styleIds:["solid","regular","light","thin","brands"],futureStyleIds:[],defaultFontWeight:900}],["sharp",{defaultShortPrefixId:"fass",defaultStyleId:"solid",styleIds:["solid","regular","light","thin"],futureStyleIds:[],defaultFontWeight:900}],["duotone",{defaultShortPrefixId:"fad",defaultStyleId:"solid",styleIds:["solid","regular","light","thin"],futureStyleIds:[],defaultFontWeight:900}],["sharp-duotone",{defaultShortPrefixId:"fasds",defaultStyleId:"solid",styleIds:["solid","regular","light","thin"],futureStyleIds:[],defaultFontWeight:900}]]),or={classic:{solid:"fas",regular:"far",light:"fal",thin:"fat",brands:"fab"},duotone:{solid:"fad",regular:"fadr",light:"fadl",thin:"fadt"},sharp:{solid:"fass",regular:"fasr",light:"fasl",thin:"fast"},"sharp-duotone":{solid:"fasds",regular:"fasdr",light:"fasdl",thin:"fasdt"}},ir=["fak","fa-kit","fakd","fa-kit-duotone"],Ne={kit:{fak:"kit","fa-kit":"kit"},"kit-duotone":{fakd:"kit-duotone","fa-kit-duotone":"kit-duotone"}},sr=["kit"],lr={kit:{"fa-kit":"fak"}},fr=["fak","fakd"],cr={kit:{fak:"fa-kit"}},Fe={kit:{kit:"fak"},"kit-duotone":{"kit-duotone":"fakd"}},yt={GROUP:"duotone-group",SWAP_OPACITY:"swap-opacity",PRIMARY:"primary",SECONDARY:"secondary"},ur=["fa-classic","fa-duotone","fa-sharp","fa-sharp-duotone"],mr=["fak","fa-kit","fakd","fa-kit-duotone"],dr={"Font Awesome Kit":{400:"fak",normal:"fak"},"Font Awesome Kit Duotone":{400:"fakd",normal:"fakd"}},pr={classic:{"fa-brands":"fab","fa-duotone":"fad","fa-light":"fal","fa-regular":"far","fa-solid":"fas","fa-thin":"fat"},duotone:{"fa-regular":"fadr","fa-light":"fadl","fa-thin":"fadt"},sharp:{"fa-solid":"fass","fa-regular":"fasr","fa-light":"fasl","fa-thin":"fast"},"sharp-duotone":{"fa-solid":"fasds","fa-regular":"fasdr","fa-light":"fasdl","fa-thin":"fasdt"}},hr={classic:["fas","far","fal","fat","fad"],duotone:["fadr","fadl","fadt"],sharp:["fass","fasr","fasl","fast"],"sharp-duotone":["fasds","fasdr","fasdl","fasdt"]},Tt={classic:{fab:"fa-brands",fad:"fa-duotone",fal:"fa-light",far:"fa-regular",fas:"fa-solid",fat:"fa-thin"},duotone:{fadr:"fa-regular",fadl:"fa-light",fadt:"fa-thin"},sharp:{fass:"fa-solid",fasr:"fa-regular",fasl:"fa-light",fast:"fa-thin"},"sharp-duotone":{fasds:"fa-solid",fasdr:"fa-regular",fasdl:"fa-light",fasdt:"fa-thin"}},gr=["fa-solid","fa-regular","fa-light","fa-thin","fa-duotone","fa-brands"],Nt=["fa","fas","far","fal","fat","fad","fadr","fadl","fadt","fab","fass","fasr","fasl","fast","fasds","fasdr","fasdl","fasdt",...ur,...gr],yr=["solid","regular","light","thin","duotone","brands"],Re=[1,2,3,4,5,6,7,8,9,10],br=Re.concat([11,12,13,14,15,16,17,18,19,20]),vr=[...Object.keys(hr),...yr,"2xs","xs","sm","lg","xl","2xl","beat","border","fade","beat-fade","bounce","flip-both","flip-horizontal","flip-vertical","flip","fw","inverse","layers-counter","layers-text","layers","li","pull-left","pull-right","pulse","rotate-180","rotate-270","rotate-90","rotate-by","shake","spin-pulse","spin-reverse","spin","stack-1x","stack-2x","stack","ul",yt.GROUP,yt.SWAP_OPACITY,yt.PRIMARY,yt.SECONDARY].concat(Re.map(t=>"".concat(t,"x"))).concat(br.map(t=>"w-".concat(t))),xr={"Font Awesome 5 Free":{900:"fas",400:"far"},"Font Awesome 5 Pro":{900:"fas",400:"far",normal:"far",300:"fal"},"Font Awesome 5 Brands":{400:"fab",normal:"fab"},"Font Awesome 5 Duotone":{900:"fad"}};const B="___FONT_AWESOME___",Ft=16,je="fa",Me="svg-inline--fa",Z="data-fa-i2svg",Rt="data-fa-pseudo-element",Ar="data-fa-pseudo-element-pending",jt="data-prefix",Mt="data-icon",Le="fontawesome-i2svg",wr="async",Or=["HTML","HEAD","STYLE","SCRIPT"],De=(()=>{try{return!0}catch{return!1}})();function lt(t){return new Proxy(t,{get(e,n){return n in e?e[n]:e[R]}})}const ze=f({},Ce);ze[R]=f(f(f(f({},{"fa-duotone":"duotone"}),Ce[R]),Ne.kit),Ne["kit-duotone"]);const Sr=lt(ze),Lt=f({},or);Lt[R]=f(f(f(f({},{duotone:"fad"}),Lt[R]),Fe.kit),Fe["kit-duotone"]);const Ue=lt(Lt),Dt=f({},Tt);Dt[R]=f(f({},Dt[R]),cr.kit);const zt=lt(Dt),Ut=f({},pr);Ut[R]=f(f({},Ut[R]),lr.kit),lt(Ut);const Pr=Qn,We="fa-layers-text",kr=Jn,Er=f({},nr);lt(Er);const _r=["class","data-prefix","data-icon","data-fa-transform","data-fa-mask"],Wt=Zn,Cr=[...sr,...vr],ft=G.FontAwesomeConfig||{};function Ir(t){var e=w.querySelector("script["+t+"]");if(e)return e.getAttribute(t)}function Tr(t){return t===""?!0:t==="false"?!1:t==="true"?!0:t}w&&typeof w.querySelector=="function"&&[["data-family-prefix","familyPrefix"],["data-css-prefix","cssPrefix"],["data-family-default","familyDefault"],["data-style-default","styleDefault"],["data-replacement-class","replacementClass"],["data-auto-replace-svg","autoReplaceSvg"],["data-auto-add-css","autoAddCss"],["data-auto-a11y","autoA11y"],["data-search-pseudo-elements","searchPseudoElements"],["data-observe-mutations","observeMutations"],["data-mutate-approach","mutateApproach"],["data-keep-original-source","keepOriginalSource"],["data-measure-performance","measurePerformance"],["data-show-missing-icons","showMissingIcons"]].forEach(e=>{let[n,r]=e;const a=Tr(Ir(n));a!=null&&(ft[r]=a)});const $e={styleDefault:"solid",familyDefault:R,cssPrefix:je,replacementClass:Me,autoReplaceSvg:!0,autoAddCss:!0,autoA11y:!0,searchPseudoElements:!1,observeMutations:!0,mutateApproach:"async",keepOriginalSource:!0,measurePerformance:!1,showMissingIcons:!0};ft.familyPrefix&&(ft.cssPrefix=ft.familyPrefix);const nt=f(f({},$e),ft);nt.autoReplaceSvg||(nt.observeMutations=!1);const p={};Object.keys($e).forEach(t=>{Object.defineProperty(p,t,{enumerable:!0,set:function(e){nt[t]=e,ct.forEach(n=>n(p))},get:function(){return nt[t]}})}),Object.defineProperty(p,"familyPrefix",{enumerable:!0,set:function(t){nt.cssPrefix=t,ct.forEach(e=>e(p))},get:function(){return nt.cssPrefix}}),G.FontAwesomeConfig=p;const ct=[];function Nr(t){return ct.push(t),()=>{ct.splice(ct.indexOf(t),1)}}const V=Ft,z={size:16,x:0,y:0,rotate:0,flipX:!1,flipY:!1};function Fr(t){if(!t||!Y)return;const e=w.createElement("style");e.setAttribute("type","text/css"),e.innerHTML=t;const n=w.head.childNodes;let r=null;for(let a=n.length-1;a>-1;a--){const o=n[a],s=(o.tagName||"").toUpperCase();["STYLE","LINK"].indexOf(s)>-1&&(r=o)}return w.head.insertBefore(e,r),t}const Rr="0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";function ut(){let t=12,e="";for(;t-- >0;)e+=Rr[Math.random()*62|0];return e}function rt(t){const e=[];for(let n=(t||[]).length>>>0;n--;)e[n]=t[n];return e}function $t(t){return t.classList?rt(t.classList):(t.getAttribute("class")||"").split(" ").filter(e=>e)}function Ye(t){return"".concat(t).replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/'/g,"&#39;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}function jr(t){return Object.keys(t||{}).reduce((e,n)=>e+"".concat(n,'="').concat(Ye(t[n]),'" '),"").trim()}function bt(t){return Object.keys(t||{}).reduce((e,n)=>e+"".concat(n,": ").concat(t[n].trim(),";"),"")}function Yt(t){return t.size!==z.size||t.x!==z.x||t.y!==z.y||t.rotate!==z.rotate||t.flipX||t.flipY}function Mr(t){let{transform:e,containerWidth:n,iconWidth:r}=t;const a={transform:"translate(".concat(n/2," 256)")},o="translate(".concat(e.x*32,", ").concat(e.y*32,") "),s="scale(".concat(e.size/16*(e.flipX?-1:1),", ").concat(e.size/16*(e.flipY?-1:1),") "),l="rotate(".concat(e.rotate," 0 0)"),c={transform:"".concat(o," ").concat(s," ").concat(l)},u={transform:"translate(".concat(r/2*-1," -256)")};return{outer:a,inner:c,path:u}}function Lr(t){let{transform:e,width:n=Ft,height:r=Ft,startCentered:a=!1}=t,o="";return a&&_e?o+="translate(".concat(e.x/V-n/2,"em, ").concat(e.y/V-r/2,"em) "):a?o+="translate(calc(-50% + ".concat(e.x/V,"em), calc(-50% + ").concat(e.y/V,"em)) "):o+="translate(".concat(e.x/V,"em, ").concat(e.y/V,"em) "),o+="scale(".concat(e.size/V*(e.flipX?-1:1),", ").concat(e.size/V*(e.flipY?-1:1),") "),o+="rotate(".concat(e.rotate,"deg) "),o}var Dr=`:root, :host {
  --fa-font-solid: normal 900 1em/1 "Font Awesome 6 Free";
  --fa-font-regular: normal 400 1em/1 "Font Awesome 6 Free";
  --fa-font-light: normal 300 1em/1 "Font Awesome 6 Pro";
  --fa-font-thin: normal 100 1em/1 "Font Awesome 6 Pro";
  --fa-font-duotone: normal 900 1em/1 "Font Awesome 6 Duotone";
  --fa-font-duotone-regular: normal 400 1em/1 "Font Awesome 6 Duotone";
  --fa-font-duotone-light: normal 300 1em/1 "Font Awesome 6 Duotone";
  --fa-font-duotone-thin: normal 100 1em/1 "Font Awesome 6 Duotone";
  --fa-font-brands: normal 400 1em/1 "Font Awesome 6 Brands";
  --fa-font-sharp-solid: normal 900 1em/1 "Font Awesome 6 Sharp";
  --fa-font-sharp-regular: normal 400 1em/1 "Font Awesome 6 Sharp";
  --fa-font-sharp-light: normal 300 1em/1 "Font Awesome 6 Sharp";
  --fa-font-sharp-thin: normal 100 1em/1 "Font Awesome 6 Sharp";
  --fa-font-sharp-duotone-solid: normal 900 1em/1 "Font Awesome 6 Sharp Duotone";
  --fa-font-sharp-duotone-regular: normal 400 1em/1 "Font Awesome 6 Sharp Duotone";
  --fa-font-sharp-duotone-light: normal 300 1em/1 "Font Awesome 6 Sharp Duotone";
  --fa-font-sharp-duotone-thin: normal 100 1em/1 "Font Awesome 6 Sharp Duotone";
}

svg:not(:root).svg-inline--fa, svg:not(:host).svg-inline--fa {
  overflow: visible;
  box-sizing: content-box;
}

.svg-inline--fa {
  display: var(--fa-display, inline-block);
  height: 1em;
  overflow: visible;
  vertical-align: -0.125em;
}
.svg-inline--fa.fa-2xs {
  vertical-align: 0.1em;
}
.svg-inline--fa.fa-xs {
  vertical-align: 0em;
}
.svg-inline--fa.fa-sm {
  vertical-align: -0.0714285705em;
}
.svg-inline--fa.fa-lg {
  vertical-align: -0.2em;
}
.svg-inline--fa.fa-xl {
  vertical-align: -0.25em;
}
.svg-inline--fa.fa-2xl {
  vertical-align: -0.3125em;
}
.svg-inline--fa.fa-pull-left {
  margin-right: var(--fa-pull-margin, 0.3em);
  width: auto;
}
.svg-inline--fa.fa-pull-right {
  margin-left: var(--fa-pull-margin, 0.3em);
  width: auto;
}
.svg-inline--fa.fa-li {
  width: var(--fa-li-width, 2em);
  top: 0.25em;
}
.svg-inline--fa.fa-fw {
  width: var(--fa-fw-width, 1.25em);
}

.fa-layers svg.svg-inline--fa {
  bottom: 0;
  left: 0;
  margin: auto;
  position: absolute;
  right: 0;
  top: 0;
}

.fa-layers-counter, .fa-layers-text {
  display: inline-block;
  position: absolute;
  text-align: center;
}

.fa-layers {
  display: inline-block;
  height: 1em;
  position: relative;
  text-align: center;
  vertical-align: -0.125em;
  width: 1em;
}
.fa-layers svg.svg-inline--fa {
  transform-origin: center center;
}

.fa-layers-text {
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  transform-origin: center center;
}

.fa-layers-counter {
  background-color: var(--fa-counter-background-color, #ff253a);
  border-radius: var(--fa-counter-border-radius, 1em);
  box-sizing: border-box;
  color: var(--fa-inverse, #fff);
  line-height: var(--fa-counter-line-height, 1);
  max-width: var(--fa-counter-max-width, 5em);
  min-width: var(--fa-counter-min-width, 1.5em);
  overflow: hidden;
  padding: var(--fa-counter-padding, 0.25em 0.5em);
  right: var(--fa-right, 0);
  text-overflow: ellipsis;
  top: var(--fa-top, 0);
  transform: scale(var(--fa-counter-scale, 0.25));
  transform-origin: top right;
}

.fa-layers-bottom-right {
  bottom: var(--fa-bottom, 0);
  right: var(--fa-right, 0);
  top: auto;
  transform: scale(var(--fa-layers-scale, 0.25));
  transform-origin: bottom right;
}

.fa-layers-bottom-left {
  bottom: var(--fa-bottom, 0);
  left: var(--fa-left, 0);
  right: auto;
  top: auto;
  transform: scale(var(--fa-layers-scale, 0.25));
  transform-origin: bottom left;
}

.fa-layers-top-right {
  top: var(--fa-top, 0);
  right: var(--fa-right, 0);
  transform: scale(var(--fa-layers-scale, 0.25));
  transform-origin: top right;
}

.fa-layers-top-left {
  left: var(--fa-left, 0);
  right: auto;
  top: var(--fa-top, 0);
  transform: scale(var(--fa-layers-scale, 0.25));
  transform-origin: top left;
}

.fa-1x {
  font-size: 1em;
}

.fa-2x {
  font-size: 2em;
}

.fa-3x {
  font-size: 3em;
}

.fa-4x {
  font-size: 4em;
}

.fa-5x {
  font-size: 5em;
}

.fa-6x {
  font-size: 6em;
}

.fa-7x {
  font-size: 7em;
}

.fa-8x {
  font-size: 8em;
}

.fa-9x {
  font-size: 9em;
}

.fa-10x {
  font-size: 10em;
}

.fa-2xs {
  font-size: 0.625em;
  line-height: 0.1em;
  vertical-align: 0.225em;
}

.fa-xs {
  font-size: 0.75em;
  line-height: 0.0833333337em;
  vertical-align: 0.125em;
}

.fa-sm {
  font-size: 0.875em;
  line-height: 0.0714285718em;
  vertical-align: 0.0535714295em;
}

.fa-lg {
  font-size: 1.25em;
  line-height: 0.05em;
  vertical-align: -0.075em;
}

.fa-xl {
  font-size: 1.5em;
  line-height: 0.0416666682em;
  vertical-align: -0.125em;
}

.fa-2xl {
  font-size: 2em;
  line-height: 0.03125em;
  vertical-align: -0.1875em;
}

.fa-fw {
  text-align: center;
  width: 1.25em;
}

.fa-ul {
  list-style-type: none;
  margin-left: var(--fa-li-margin, 2.5em);
  padding-left: 0;
}
.fa-ul > li {
  position: relative;
}

.fa-li {
  left: calc(-1 * var(--fa-li-width, 2em));
  position: absolute;
  text-align: center;
  width: var(--fa-li-width, 2em);
  line-height: inherit;
}

.fa-border {
  border-color: var(--fa-border-color, #eee);
  border-radius: var(--fa-border-radius, 0.1em);
  border-style: var(--fa-border-style, solid);
  border-width: var(--fa-border-width, 0.08em);
  padding: var(--fa-border-padding, 0.2em 0.25em 0.15em);
}

.fa-pull-left {
  float: left;
  margin-right: var(--fa-pull-margin, 0.3em);
}

.fa-pull-right {
  float: right;
  margin-left: var(--fa-pull-margin, 0.3em);
}

.fa-beat {
  animation-name: fa-beat;
  animation-delay: var(--fa-animation-delay, 0s);
  animation-direction: var(--fa-animation-direction, normal);
  animation-duration: var(--fa-animation-duration, 1s);
  animation-iteration-count: var(--fa-animation-iteration-count, infinite);
  animation-timing-function: var(--fa-animation-timing, ease-in-out);
}

.fa-bounce {
  animation-name: fa-bounce;
  animation-delay: var(--fa-animation-delay, 0s);
  animation-direction: var(--fa-animation-direction, normal);
  animation-duration: var(--fa-animation-duration, 1s);
  animation-iteration-count: var(--fa-animation-iteration-count, infinite);
  animation-timing-function: var(--fa-animation-timing, cubic-bezier(0.28, 0.84, 0.42, 1));
}

.fa-fade {
  animation-name: fa-fade;
  animation-delay: var(--fa-animation-delay, 0s);
  animation-direction: var(--fa-animation-direction, normal);
  animation-duration: var(--fa-animation-duration, 1s);
  animation-iteration-count: var(--fa-animation-iteration-count, infinite);
  animation-timing-function: var(--fa-animation-timing, cubic-bezier(0.4, 0, 0.6, 1));
}

.fa-beat-fade {
  animation-name: fa-beat-fade;
  animation-delay: var(--fa-animation-delay, 0s);
  animation-direction: var(--fa-animation-direction, normal);
  animation-duration: var(--fa-animation-duration, 1s);
  animation-iteration-count: var(--fa-animation-iteration-count, infinite);
  animation-timing-function: var(--fa-animation-timing, cubic-bezier(0.4, 0, 0.6, 1));
}

.fa-flip {
  animation-name: fa-flip;
  animation-delay: var(--fa-animation-delay, 0s);
  animation-direction: var(--fa-animation-direction, normal);
  animation-duration: var(--fa-animation-duration, 1s);
  animation-iteration-count: var(--fa-animation-iteration-count, infinite);
  animation-timing-function: var(--fa-animation-timing, ease-in-out);
}

.fa-shake {
  animation-name: fa-shake;
  animation-delay: var(--fa-animation-delay, 0s);
  animation-direction: var(--fa-animation-direction, normal);
  animation-duration: var(--fa-animation-duration, 1s);
  animation-iteration-count: var(--fa-animation-iteration-count, infinite);
  animation-timing-function: var(--fa-animation-timing, linear);
}

.fa-spin {
  animation-name: fa-spin;
  animation-delay: var(--fa-animation-delay, 0s);
  animation-direction: var(--fa-animation-direction, normal);
  animation-duration: var(--fa-animation-duration, 2s);
  animation-iteration-count: var(--fa-animation-iteration-count, infinite);
  animation-timing-function: var(--fa-animation-timing, linear);
}

.fa-spin-reverse {
  --fa-animation-direction: reverse;
}

.fa-pulse,
.fa-spin-pulse {
  animation-name: fa-spin;
  animation-direction: var(--fa-animation-direction, normal);
  animation-duration: var(--fa-animation-duration, 1s);
  animation-iteration-count: var(--fa-animation-iteration-count, infinite);
  animation-timing-function: var(--fa-animation-timing, steps(8));
}

@media (prefers-reduced-motion: reduce) {
  .fa-beat,
.fa-bounce,
.fa-fade,
.fa-beat-fade,
.fa-flip,
.fa-pulse,
.fa-shake,
.fa-spin,
.fa-spin-pulse {
    animation-delay: -1ms;
    animation-duration: 1ms;
    animation-iteration-count: 1;
    transition-delay: 0s;
    transition-duration: 0s;
  }
}
@keyframes fa-beat {
  0%, 90% {
    transform: scale(1);
  }
  45% {
    transform: scale(var(--fa-beat-scale, 1.25));
  }
}
@keyframes fa-bounce {
  0% {
    transform: scale(1, 1) translateY(0);
  }
  10% {
    transform: scale(var(--fa-bounce-start-scale-x, 1.1), var(--fa-bounce-start-scale-y, 0.9)) translateY(0);
  }
  30% {
    transform: scale(var(--fa-bounce-jump-scale-x, 0.9), var(--fa-bounce-jump-scale-y, 1.1)) translateY(var(--fa-bounce-height, -0.5em));
  }
  50% {
    transform: scale(var(--fa-bounce-land-scale-x, 1.05), var(--fa-bounce-land-scale-y, 0.95)) translateY(0);
  }
  57% {
    transform: scale(1, 1) translateY(var(--fa-bounce-rebound, -0.125em));
  }
  64% {
    transform: scale(1, 1) translateY(0);
  }
  100% {
    transform: scale(1, 1) translateY(0);
  }
}
@keyframes fa-fade {
  50% {
    opacity: var(--fa-fade-opacity, 0.4);
  }
}
@keyframes fa-beat-fade {
  0%, 100% {
    opacity: var(--fa-beat-fade-opacity, 0.4);
    transform: scale(1);
  }
  50% {
    opacity: 1;
    transform: scale(var(--fa-beat-fade-scale, 1.125));
  }
}
@keyframes fa-flip {
  50% {
    transform: rotate3d(var(--fa-flip-x, 0), var(--fa-flip-y, 1), var(--fa-flip-z, 0), var(--fa-flip-angle, -180deg));
  }
}
@keyframes fa-shake {
  0% {
    transform: rotate(-15deg);
  }
  4% {
    transform: rotate(15deg);
  }
  8%, 24% {
    transform: rotate(-18deg);
  }
  12%, 28% {
    transform: rotate(18deg);
  }
  16% {
    transform: rotate(-22deg);
  }
  20% {
    transform: rotate(22deg);
  }
  32% {
    transform: rotate(-12deg);
  }
  36% {
    transform: rotate(12deg);
  }
  40%, 100% {
    transform: rotate(0deg);
  }
}
@keyframes fa-spin {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}
.fa-rotate-90 {
  transform: rotate(90deg);
}

.fa-rotate-180 {
  transform: rotate(180deg);
}

.fa-rotate-270 {
  transform: rotate(270deg);
}

.fa-flip-horizontal {
  transform: scale(-1, 1);
}

.fa-flip-vertical {
  transform: scale(1, -1);
}

.fa-flip-both,
.fa-flip-horizontal.fa-flip-vertical {
  transform: scale(-1, -1);
}

.fa-rotate-by {
  transform: rotate(var(--fa-rotate-angle, 0));
}

.fa-stack {
  display: inline-block;
  vertical-align: middle;
  height: 2em;
  position: relative;
  width: 2.5em;
}

.fa-stack-1x,
.fa-stack-2x {
  bottom: 0;
  left: 0;
  margin: auto;
  position: absolute;
  right: 0;
  top: 0;
  z-index: var(--fa-stack-z-index, auto);
}

.svg-inline--fa.fa-stack-1x {
  height: 1em;
  width: 1.25em;
}
.svg-inline--fa.fa-stack-2x {
  height: 2em;
  width: 2.5em;
}

.fa-inverse {
  color: var(--fa-inverse, #fff);
}

.sr-only,
.fa-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border-width: 0;
}

.sr-only-focusable:not(:focus),
.fa-sr-only-focusable:not(:focus) {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border-width: 0;
}

.svg-inline--fa .fa-primary {
  fill: var(--fa-primary-color, currentColor);
  opacity: var(--fa-primary-opacity, 1);
}

.svg-inline--fa .fa-secondary {
  fill: var(--fa-secondary-color, currentColor);
  opacity: var(--fa-secondary-opacity, 0.4);
}

.svg-inline--fa.fa-swap-opacity .fa-primary {
  opacity: var(--fa-secondary-opacity, 0.4);
}

.svg-inline--fa.fa-swap-opacity .fa-secondary {
  opacity: var(--fa-primary-opacity, 1);
}

.svg-inline--fa mask .fa-primary,
.svg-inline--fa mask .fa-secondary {
  fill: black;
}`;function Be(){const t=je,e=Me,n=p.cssPrefix,r=p.replacementClass;let a=Dr;if(n!==t||r!==e){const o=new RegExp("\\.".concat(t,"\\-"),"g"),s=new RegExp("\\--".concat(t,"\\-"),"g"),l=new RegExp("\\.".concat(e),"g");a=a.replace(o,".".concat(n,"-")).replace(s,"--".concat(n,"-")).replace(l,".".concat(r))}return a}let He=!1;function Bt(){p.autoAddCss&&!He&&(Fr(Be()),He=!0)}var zr={mixout(){return{dom:{css:Be,insertCss:Bt}}},hooks(){return{beforeDOMElementCreation(){Bt()},beforeI2svg(){Bt()}}}};const H=G||{};H[B]||(H[B]={}),H[B].styles||(H[B].styles={}),H[B].hooks||(H[B].hooks={}),H[B].shims||(H[B].shims=[]);var U=H[B];const qe=[],Ge=function(){w.removeEventListener("DOMContentLoaded",Ge),vt=1,qe.map(t=>t())};let vt=!1;Y&&(vt=(w.documentElement.doScroll?/^loaded|^c/:/^loaded|^i|^c/).test(w.readyState),vt||w.addEventListener("DOMContentLoaded",Ge));function Ur(t){Y&&(vt?setTimeout(t,0):qe.push(t))}function mt(t){const{tag:e,attributes:n={},children:r=[]}=t;return typeof t=="string"?Ye(t):"<".concat(e," ").concat(jr(n),">").concat(r.map(mt).join(""),"</").concat(e,">")}function Ve(t,e,n){if(t&&t[e]&&t[e][n])return{prefix:e,iconName:n,icon:t[e][n]}}var Ht=function(e,n,r,a){var o=Object.keys(e),s=o.length,l=n,c,u,d;for(r===void 0?(c=1,d=e[o[0]]):(c=0,d=r);c<s;c++)u=o[c],d=l(d,e[u],u,e);return d};function Wr(t){const e=[];let n=0;const r=t.length;for(;n<r;){const a=t.charCodeAt(n++);if(a>=55296&&a<=56319&&n<r){const o=t.charCodeAt(n++);(o&64512)==56320?e.push(((a&1023)<<10)+(o&1023)+65536):(e.push(a),n--)}else e.push(a)}return e}function qt(t){const e=Wr(t);return e.length===1?e[0].toString(16):null}function $r(t,e){const n=t.length;let r=t.charCodeAt(e),a;return r>=55296&&r<=56319&&n>e+1&&(a=t.charCodeAt(e+1),a>=56320&&a<=57343)?(r-55296)*1024+a-56320+65536:r}function Xe(t){return Object.keys(t).reduce((e,n)=>{const r=t[n];return!!r.icon?e[r.iconName]=r.icon:e[n]=r,e},{})}function Gt(t,e){let n=arguments.length>2&&arguments[2]!==void 0?arguments[2]:{};const{skipHooks:r=!1}=n,a=Xe(e);typeof U.hooks.addPack=="function"&&!r?U.hooks.addPack(t,Xe(e)):U.styles[t]=f(f({},U.styles[t]||{}),a),t==="fas"&&Gt("fa",e)}const{styles:dt,shims:Yr}=U,Ke=Object.keys(zt),Br=Ke.reduce((t,e)=>(t[e]=Object.keys(zt[e]),t),{});let Vt=null,Qe={},Je={},Ze={},tn={},en={};function Hr(t){return~Cr.indexOf(t)}function qr(t,e){const n=e.split("-"),r=n[0],a=n.slice(1).join("-");return r===t&&a!==""&&!Hr(a)?a:null}const nn=()=>{const t=r=>Ht(dt,(a,o,s)=>(a[s]=Ht(o,r,{}),a),{});Qe=t((r,a,o)=>(a[3]&&(r[a[3]]=o),a[2]&&a[2].filter(l=>typeof l=="number").forEach(l=>{r[l.toString(16)]=o}),r)),Je=t((r,a,o)=>(r[o]=o,a[2]&&a[2].filter(l=>typeof l=="string").forEach(l=>{r[l]=o}),r)),en=t((r,a,o)=>{const s=a[2];return r[o]=o,s.forEach(l=>{r[l]=o}),r});const e="far"in dt||p.autoFetchSvg,n=Ht(Yr,(r,a)=>{const o=a[0];let s=a[1];const l=a[2];return s==="far"&&!e&&(s="fas"),typeof o=="string"&&(r.names[o]={prefix:s,iconName:l}),typeof o=="number"&&(r.unicodes[o.toString(16)]={prefix:s,iconName:l}),r},{names:{},unicodes:{}});Ze=n.names,tn=n.unicodes,Vt=xt(p.styleDefault,{family:p.familyDefault})};Nr(t=>{Vt=xt(t.styleDefault,{family:p.familyDefault})}),nn();function Xt(t,e){return(Qe[t]||{})[e]}function Gr(t,e){return(Je[t]||{})[e]}function tt(t,e){return(en[t]||{})[e]}function rn(t){return Ze[t]||{prefix:null,iconName:null}}function Vr(t){const e=tn[t],n=Xt("fas",t);return e||(n?{prefix:"fas",iconName:n}:null)||{prefix:null,iconName:null}}function X(){return Vt}const an=()=>({prefix:null,iconName:null,rest:[]});function Xr(t){let e=R;const n=Ke.reduce((r,a)=>(r[a]="".concat(p.cssPrefix,"-").concat(a),r),{});return Te.forEach(r=>{(t.includes(n[r])||t.some(a=>Br[r].includes(a)))&&(e=r)}),e}function xt(t){let e=arguments.length>1&&arguments[1]!==void 0?arguments[1]:{};const{family:n=R}=e,r=Sr[n][t];if(n===gt&&!t)return"fad";const a=Ue[n][t]||Ue[n][r],o=t in U.styles?t:null;return a||o||null}function Kr(t){let e=[],n=null;return t.forEach(r=>{const a=qr(p.cssPrefix,r);a?n=a:r&&e.push(r)}),{iconName:n,rest:e}}function on(t){return t.sort().filter((e,n,r)=>r.indexOf(e)===n)}function At(t){let e=arguments.length>1&&arguments[1]!==void 0?arguments[1]:{};const{skipLookups:n=!1}=e;let r=null;const a=Nt.concat(mr),o=on(t.filter(g=>a.includes(g))),s=on(t.filter(g=>!Nt.includes(g))),l=o.filter(g=>(r=g,!Ie.includes(g))),[c=null]=l,u=Xr(o),d=f(f({},Kr(s)),{},{prefix:xt(c,{family:u})});return f(f(f({},d),ta({values:t,family:u,styles:dt,config:p,canonical:d,givenPrefix:r})),Qr(n,r,d))}function Qr(t,e,n){let{prefix:r,iconName:a}=n;if(t||!r||!a)return{prefix:r,iconName:a};const o=e==="fa"?rn(a):{},s=tt(r,a);return a=o.iconName||s||a,r=o.prefix||r,r==="far"&&!dt.far&&dt.fas&&!p.autoFetchSvg&&(r="fas"),{prefix:r,iconName:a}}const Jr=Te.filter(t=>t!==R||t!==gt),Zr=Object.keys(Tt).filter(t=>t!==R).map(t=>Object.keys(Tt[t])).flat();function ta(t){const{values:e,family:n,canonical:r,givenPrefix:a="",styles:o={},config:s={}}=t,l=n===gt,c=e.includes("fa-duotone")||e.includes("fad"),u=s.familyDefault==="duotone",d=r.prefix==="fad"||r.prefix==="fa-duotone";if(!l&&(c||u||d)&&(r.prefix="fad"),(e.includes("fa-brands")||e.includes("fab"))&&(r.prefix="fab"),!r.prefix&&Jr.includes(n)&&(Object.keys(o).find(h=>Zr.includes(h))||s.autoFetchSvg)){const h=ar.get(n).defaultShortPrefixId;r.prefix=h,r.iconName=tt(r.prefix,r.iconName)||r.iconName}return(r.prefix==="fa"||a==="fa")&&(r.prefix=X()||"fas"),r}class ea{constructor(){this.definitions={}}add(){for(var e=arguments.length,n=new Array(e),r=0;r<e;r++)n[r]=arguments[r];const a=n.reduce(this._pullDefinitions,{});Object.keys(a).forEach(o=>{this.definitions[o]=f(f({},this.definitions[o]||{}),a[o]),Gt(o,a[o]);const s=zt[R][o];s&&Gt(s,a[o]),nn()})}reset(){this.definitions={}}_pullDefinitions(e,n){const r=n.prefix&&n.iconName&&n.icon?{0:n}:n;return Object.keys(r).map(a=>{const{prefix:o,iconName:s,icon:l}=r[a],c=l[2];e[o]||(e[o]={}),c.length>0&&c.forEach(u=>{typeof u=="string"&&(e[o][u]=l)}),e[o][s]=l}),e}}let sn=[],at={};const ot={},na=Object.keys(ot);function ra(t,e){let{mixoutsTo:n}=e;return sn=t,at={},Object.keys(ot).forEach(r=>{na.indexOf(r)===-1&&delete ot[r]}),sn.forEach(r=>{const a=r.mixout?r.mixout():{};if(Object.keys(a).forEach(o=>{typeof a[o]=="function"&&(n[o]=a[o]),typeof a[o]=="object"&&Object.keys(a[o]).forEach(s=>{n[o]||(n[o]={}),n[o][s]=a[o][s]})}),r.hooks){const o=r.hooks();Object.keys(o).forEach(s=>{at[s]||(at[s]=[]),at[s].push(o[s])})}r.provides&&r.provides(ot)}),n}function Kt(t,e){for(var n=arguments.length,r=new Array(n>2?n-2:0),a=2;a<n;a++)r[a-2]=arguments[a];return(at[t]||[]).forEach(s=>{e=s.apply(null,[e,...r])}),e}function et(t){for(var e=arguments.length,n=new Array(e>1?e-1:0),r=1;r<e;r++)n[r-1]=arguments[r];(at[t]||[]).forEach(o=>{o.apply(null,n)})}function K(){const t=arguments[0],e=Array.prototype.slice.call(arguments,1);return ot[t]?ot[t].apply(null,e):void 0}function Qt(t){t.prefix==="fa"&&(t.prefix="fas");let{iconName:e}=t;const n=t.prefix||X();if(e)return e=tt(n,e)||e,Ve(ln.definitions,n,e)||Ve(U.styles,n,e)}const ln=new ea,j={noAuto:()=>{p.autoReplaceSvg=!1,p.observeMutations=!1,et("noAuto")},config:p,dom:{i2svg:function(){let t=arguments.length>0&&arguments[0]!==void 0?arguments[0]:{};return Y?(et("beforeI2svg",t),K("pseudoElements2svg",t),K("i2svg",t)):Promise.reject(new Error("Operation requires a DOM of some kind."))},watch:function(){let t=arguments.length>0&&arguments[0]!==void 0?arguments[0]:{};const{autoReplaceSvgRoot:e}=t;p.autoReplaceSvg===!1&&(p.autoReplaceSvg=!0),p.observeMutations=!0,Ur(()=>{aa({autoReplaceSvgRoot:e}),et("watch",t)})}},parse:{icon:t=>{if(t===null)return null;if(typeof t=="object"&&t.prefix&&t.iconName)return{prefix:t.prefix,iconName:tt(t.prefix,t.iconName)||t.iconName};if(Array.isArray(t)&&t.length===2){const e=t[1].indexOf("fa-")===0?t[1].slice(3):t[1],n=xt(t[0]);return{prefix:n,iconName:tt(n,e)||e}}if(typeof t=="string"&&(t.indexOf("".concat(p.cssPrefix,"-"))>-1||t.match(Pr))){const e=At(t.split(" "),{skipLookups:!0});return{prefix:e.prefix||X(),iconName:tt(e.prefix,e.iconName)||e.iconName}}if(typeof t=="string"){const e=X();return{prefix:e,iconName:tt(e,t)||t}}}},library:ln,findIconDefinition:Qt,toHtml:mt},aa=function(){let t=arguments.length>0&&arguments[0]!==void 0?arguments[0]:{};const{autoReplaceSvgRoot:e=w}=t;(Object.keys(U.styles).length>0||p.autoFetchSvg)&&Y&&p.autoReplaceSvg&&j.dom.i2svg({node:e})};function wt(t,e){return Object.defineProperty(t,"abstract",{get:e}),Object.defineProperty(t,"html",{get:function(){return t.abstract.map(n=>mt(n))}}),Object.defineProperty(t,"node",{get:function(){if(!Y)return;const n=w.createElement("div");return n.innerHTML=t.html,n.children}}),t}function oa(t){let{children:e,main:n,mask:r,attributes:a,styles:o,transform:s}=t;if(Yt(s)&&n.found&&!r.found){const{width:l,height:c}=n,u={x:l/c/2,y:.5};a.style=bt(f(f({},o),{},{"transform-origin":"".concat(u.x+s.x/16,"em ").concat(u.y+s.y/16,"em")}))}return[{tag:"svg",attributes:a,children:e}]}function ia(t){let{prefix:e,iconName:n,children:r,attributes:a,symbol:o}=t;const s=o===!0?"".concat(e,"-").concat(p.cssPrefix,"-").concat(n):o;return[{tag:"svg",attributes:{style:"display: none;"},children:[{tag:"symbol",attributes:f(f({},a),{},{id:s}),children:r}]}]}function Jt(t){const{icons:{main:e,mask:n},prefix:r,iconName:a,transform:o,symbol:s,title:l,maskId:c,titleId:u,extra:d,watchable:g=!1}=t,{width:h,height:k}=n.found?n:e,E=fr.includes(r),_=[p.replacementClass,a?"".concat(p.cssPrefix,"-").concat(a):""].filter(L=>d.classes.indexOf(L)===-1).filter(L=>L!==""||!!L).concat(d.classes).join(" ");let O={children:[],attributes:f(f({},d.attributes),{},{"data-prefix":r,"data-icon":a,class:_,role:d.attributes.role||"img",xmlns:"http://www.w3.org/2000/svg",viewBox:"0 0 ".concat(h," ").concat(k)})};const x=E&&!~d.classes.indexOf("fa-fw")?{width:"".concat(h/k*16*.0625,"em")}:{};g&&(O.attributes[Z]=""),l&&(O.children.push({tag:"title",attributes:{id:O.attributes["aria-labelledby"]||"title-".concat(u||ut())},children:[l]}),delete O.attributes.title);const S=f(f({},O),{},{prefix:r,iconName:a,main:e,mask:n,maskId:c,transform:o,symbol:s,styles:f(f({},x),d.styles)}),{children:I,attributes:M}=n.found&&e.found?K("generateAbstractMask",S)||{children:[],attributes:{}}:K("generateAbstractIcon",S)||{children:[],attributes:{}};return S.children=I,S.attributes=M,s?ia(S):oa(S)}function fn(t){const{content:e,width:n,height:r,transform:a,title:o,extra:s,watchable:l=!1}=t,c=f(f(f({},s.attributes),o?{title:o}:{}),{},{class:s.classes.join(" ")});l&&(c[Z]="");const u=f({},s.styles);Yt(a)&&(u.transform=Lr({transform:a,startCentered:!0,width:n,height:r}),u["-webkit-transform"]=u.transform);const d=bt(u);d.length>0&&(c.style=d);const g=[];return g.push({tag:"span",attributes:c,children:[e]}),o&&g.push({tag:"span",attributes:{class:"sr-only"},children:[o]}),g}function sa(t){const{content:e,title:n,extra:r}=t,a=f(f(f({},r.attributes),n?{title:n}:{}),{},{class:r.classes.join(" ")}),o=bt(r.styles);o.length>0&&(a.style=o);const s=[];return s.push({tag:"span",attributes:a,children:[e]}),n&&s.push({tag:"span",attributes:{class:"sr-only"},children:[n]}),s}const{styles:Zt}=U;function te(t){const e=t[0],n=t[1],[r]=t.slice(4);let a=null;return Array.isArray(r)?a={tag:"g",attributes:{class:"".concat(p.cssPrefix,"-").concat(Wt.GROUP)},children:[{tag:"path",attributes:{class:"".concat(p.cssPrefix,"-").concat(Wt.SECONDARY),fill:"currentColor",d:r[0]}},{tag:"path",attributes:{class:"".concat(p.cssPrefix,"-").concat(Wt.PRIMARY),fill:"currentColor",d:r[1]}}]}:a={tag:"path",attributes:{fill:"currentColor",d:r}},{found:!0,width:e,height:n,icon:a}}const la={found:!1,width:512,height:512};function fa(t,e){!De&&!p.showMissingIcons&&t&&console.error('Icon with name "'.concat(t,'" and prefix "').concat(e,'" is missing.'))}function ee(t,e){let n=e;return e==="fa"&&p.styleDefault!==null&&(e=X()),new Promise((r,a)=>{if(n==="fa"){const o=rn(t)||{};t=o.iconName||t,e=o.prefix||e}if(t&&e&&Zt[e]&&Zt[e][t]){const o=Zt[e][t];return r(te(o))}fa(t,e),r(f(f({},la),{},{icon:p.showMissingIcons&&t?K("missingIconAbstract")||{}:{}}))})}const cn=()=>{},ne=p.measurePerformance&&ht&&ht.mark&&ht.measure?ht:{mark:cn,measure:cn},pt='FA "6.7.2"',ca=t=>(ne.mark("".concat(pt," ").concat(t," begins")),()=>un(t)),un=t=>{ne.mark("".concat(pt," ").concat(t," ends")),ne.measure("".concat(pt," ").concat(t),"".concat(pt," ").concat(t," begins"),"".concat(pt," ").concat(t," ends"))};var re={begin:ca,end:un};const Ot=()=>{};function mn(t){return typeof(t.getAttribute?t.getAttribute(Z):null)=="string"}function ua(t){const e=t.getAttribute?t.getAttribute(jt):null,n=t.getAttribute?t.getAttribute(Mt):null;return e&&n}function ma(t){return t&&t.classList&&t.classList.contains&&t.classList.contains(p.replacementClass)}function da(){return p.autoReplaceSvg===!0?St.replace:St[p.autoReplaceSvg]||St.replace}function pa(t){return w.createElementNS("http://www.w3.org/2000/svg",t)}function ha(t){return w.createElement(t)}function dn(t){let e=arguments.length>1&&arguments[1]!==void 0?arguments[1]:{};const{ceFn:n=t.tag==="svg"?pa:ha}=e;if(typeof t=="string")return w.createTextNode(t);const r=n(t.tag);return Object.keys(t.attributes||[]).forEach(function(o){r.setAttribute(o,t.attributes[o])}),(t.children||[]).forEach(function(o){r.appendChild(dn(o,{ceFn:n}))}),r}function ga(t){let e=" ".concat(t.outerHTML," ");return e="".concat(e,"Font Awesome fontawesome.com "),e}const St={replace:function(t){const e=t[0];if(e.parentNode)if(t[1].forEach(n=>{e.parentNode.insertBefore(dn(n),e)}),e.getAttribute(Z)===null&&p.keepOriginalSource){let n=w.createComment(ga(e));e.parentNode.replaceChild(n,e)}else e.remove()},nest:function(t){const e=t[0],n=t[1];if(~$t(e).indexOf(p.replacementClass))return St.replace(t);const r=new RegExp("".concat(p.cssPrefix,"-.*"));if(delete n[0].attributes.id,n[0].attributes.class){const o=n[0].attributes.class.split(" ").reduce((s,l)=>(l===p.replacementClass||l.match(r)?s.toSvg.push(l):s.toNode.push(l),s),{toNode:[],toSvg:[]});n[0].attributes.class=o.toSvg.join(" "),o.toNode.length===0?e.removeAttribute("class"):e.setAttribute("class",o.toNode.join(" "))}const a=n.map(o=>mt(o)).join(`
`);e.setAttribute(Z,""),e.innerHTML=a}};function pn(t){t()}function hn(t,e){const n=typeof e=="function"?e:Ot;if(t.length===0)n();else{let r=pn;p.mutateApproach===wr&&(r=G.requestAnimationFrame||pn),r(()=>{const a=da(),o=re.begin("mutate");t.map(a),o(),n()})}}let ae=!1;function gn(){ae=!0}function oe(){ae=!1}let Pt=null;function yn(t){if(!Ee||!p.observeMutations)return;const{treeCallback:e=Ot,nodeCallback:n=Ot,pseudoElementsCallback:r=Ot,observeMutationsRoot:a=w}=t;Pt=new Ee(o=>{if(ae)return;const s=X();rt(o).forEach(l=>{if(l.type==="childList"&&l.addedNodes.length>0&&!mn(l.addedNodes[0])&&(p.searchPseudoElements&&r(l.target),e(l.target)),l.type==="attributes"&&l.target.parentNode&&p.searchPseudoElements&&r(l.target.parentNode),l.type==="attributes"&&mn(l.target)&&~_r.indexOf(l.attributeName))if(l.attributeName==="class"&&ua(l.target)){const{prefix:c,iconName:u}=At($t(l.target));l.target.setAttribute(jt,c||s),u&&l.target.setAttribute(Mt,u)}else ma(l.target)&&n(l.target)})}),Y&&Pt.observe(a,{childList:!0,attributes:!0,characterData:!0,subtree:!0})}function ya(){Pt&&Pt.disconnect()}function ba(t){const e=t.getAttribute("style");let n=[];return e&&(n=e.split(";").reduce((r,a)=>{const o=a.split(":"),s=o[0],l=o.slice(1);return s&&l.length>0&&(r[s]=l.join(":").trim()),r},{})),n}function va(t){const e=t.getAttribute("data-prefix"),n=t.getAttribute("data-icon"),r=t.innerText!==void 0?t.innerText.trim():"";let a=At($t(t));return a.prefix||(a.prefix=X()),e&&n&&(a.prefix=e,a.iconName=n),a.iconName&&a.prefix||(a.prefix&&r.length>0&&(a.iconName=Gr(a.prefix,t.innerText)||Xt(a.prefix,qt(t.innerText))),!a.iconName&&p.autoFetchSvg&&t.firstChild&&t.firstChild.nodeType===Node.TEXT_NODE&&(a.iconName=t.firstChild.data)),a}function xa(t){const e=rt(t.attributes).reduce((a,o)=>(a.name!=="class"&&a.name!=="style"&&(a[o.name]=o.value),a),{}),n=t.getAttribute("title"),r=t.getAttribute("data-fa-title-id");return p.autoA11y&&(n?e["aria-labelledby"]="".concat(p.replacementClass,"-title-").concat(r||ut()):(e["aria-hidden"]="true",e.focusable="false")),e}function Aa(){return{iconName:null,title:null,titleId:null,prefix:null,transform:z,symbol:!1,mask:{iconName:null,prefix:null,rest:[]},maskId:null,extra:{classes:[],styles:{},attributes:{}}}}function bn(t){let e=arguments.length>1&&arguments[1]!==void 0?arguments[1]:{styleParser:!0};const{iconName:n,prefix:r,rest:a}=va(t),o=xa(t),s=Kt("parseNodeAttributes",{},t);let l=e.styleParser?ba(t):[];return f({iconName:n,title:t.getAttribute("title"),titleId:t.getAttribute("data-fa-title-id"),prefix:r,transform:z,mask:{iconName:null,prefix:null,rest:[]},maskId:null,symbol:!1,extra:{classes:a,styles:l,attributes:o}},s)}const{styles:wa}=U;function vn(t){const e=p.autoReplaceSvg==="nest"?bn(t,{styleParser:!1}):bn(t);return~e.extra.classes.indexOf(We)?K("generateLayersText",t,e):K("generateSvgReplacementMutation",t,e)}function Oa(){return[...ir,...Nt]}function xn(t){let e=arguments.length>1&&arguments[1]!==void 0?arguments[1]:null;if(!Y)return Promise.resolve();const n=w.documentElement.classList,r=d=>n.add("".concat(Le,"-").concat(d)),a=d=>n.remove("".concat(Le,"-").concat(d)),o=p.autoFetchSvg?Oa():Ie.concat(Object.keys(wa));o.includes("fa")||o.push("fa");const s=[".".concat(We,":not([").concat(Z,"])")].concat(o.map(d=>".".concat(d,":not([").concat(Z,"])"))).join(", ");if(s.length===0)return Promise.resolve();let l=[];try{l=rt(t.querySelectorAll(s))}catch{}if(l.length>0)r("pending"),a("complete");else return Promise.resolve();const c=re.begin("onTree"),u=l.reduce((d,g)=>{try{const h=vn(g);h&&d.push(h)}catch(h){De||h.name==="MissingIcon"&&console.error(h)}return d},[]);return new Promise((d,g)=>{Promise.all(u).then(h=>{hn(h,()=>{r("active"),r("complete"),a("pending"),typeof e=="function"&&e(),c(),d()})}).catch(h=>{c(),g(h)})})}function Sa(t){let e=arguments.length>1&&arguments[1]!==void 0?arguments[1]:null;vn(t).then(n=>{n&&hn([n],e)})}function Pa(t){return function(e){let n=arguments.length>1&&arguments[1]!==void 0?arguments[1]:{};const r=(e||{}).icon?e:Qt(e||{});let{mask:a}=n;return a&&(a=(a||{}).icon?a:Qt(a||{})),t(r,f(f({},n),{},{mask:a}))}}const ka=function(t){let e=arguments.length>1&&arguments[1]!==void 0?arguments[1]:{};const{transform:n=z,symbol:r=!1,mask:a=null,maskId:o=null,title:s=null,titleId:l=null,classes:c=[],attributes:u={},styles:d={}}=e;if(!t)return;const{prefix:g,iconName:h,icon:k}=t;return wt(f({type:"icon"},t),()=>(et("beforeDOMElementCreation",{iconDefinition:t,params:e}),p.autoA11y&&(s?u["aria-labelledby"]="".concat(p.replacementClass,"-title-").concat(l||ut()):(u["aria-hidden"]="true",u.focusable="false")),Jt({icons:{main:te(k),mask:a?te(a.icon):{found:!1,width:null,height:null,icon:{}}},prefix:g,iconName:h,transform:f(f({},z),n),symbol:r,title:s,maskId:o,titleId:l,extra:{attributes:u,styles:d,classes:c}})))};var Ea={mixout(){return{icon:Pa(ka)}},hooks(){return{mutationObserverCallbacks(t){return t.treeCallback=xn,t.nodeCallback=Sa,t}}},provides(t){t.i2svg=function(e){const{node:n=w,callback:r=()=>{}}=e;return xn(n,r)},t.generateSvgReplacementMutation=function(e,n){const{iconName:r,title:a,titleId:o,prefix:s,transform:l,symbol:c,mask:u,maskId:d,extra:g}=n;return new Promise((h,k)=>{Promise.all([ee(r,s),u.iconName?ee(u.iconName,u.prefix):Promise.resolve({found:!1,width:512,height:512,icon:{}})]).then(E=>{let[_,O]=E;h([e,Jt({icons:{main:_,mask:O},prefix:s,iconName:r,transform:l,symbol:c,maskId:d,title:a,titleId:o,extra:g,watchable:!0})])}).catch(k)})},t.generateAbstractIcon=function(e){let{children:n,attributes:r,main:a,transform:o,styles:s}=e;const l=bt(s);l.length>0&&(r.style=l);let c;return Yt(o)&&(c=K("generateAbstractTransformGrouping",{main:a,transform:o,containerWidth:a.width,iconWidth:a.width})),n.push(c||a.icon),{children:n,attributes:r}}}},_a={mixout(){return{layer(t){let e=arguments.length>1&&arguments[1]!==void 0?arguments[1]:{};const{classes:n=[]}=e;return wt({type:"layer"},()=>{et("beforeDOMElementCreation",{assembler:t,params:e});let r=[];return t(a=>{Array.isArray(a)?a.map(o=>{r=r.concat(o.abstract)}):r=r.concat(a.abstract)}),[{tag:"span",attributes:{class:["".concat(p.cssPrefix,"-layers"),...n].join(" ")},children:r}]})}}}},Ca={mixout(){return{counter(t){let e=arguments.length>1&&arguments[1]!==void 0?arguments[1]:{};const{title:n=null,classes:r=[],attributes:a={},styles:o={}}=e;return wt({type:"counter",content:t},()=>(et("beforeDOMElementCreation",{content:t,params:e}),sa({content:t.toString(),title:n,extra:{attributes:a,styles:o,classes:["".concat(p.cssPrefix,"-layers-counter"),...r]}})))}}}},Ia={mixout(){return{text(t){let e=arguments.length>1&&arguments[1]!==void 0?arguments[1]:{};const{transform:n=z,title:r=null,classes:a=[],attributes:o={},styles:s={}}=e;return wt({type:"text",content:t},()=>(et("beforeDOMElementCreation",{content:t,params:e}),fn({content:t,transform:f(f({},z),n),title:r,extra:{attributes:o,styles:s,classes:["".concat(p.cssPrefix,"-layers-text"),...a]}})))}}},provides(t){t.generateLayersText=function(e,n){const{title:r,transform:a,extra:o}=n;let s=null,l=null;if(_e){const c=parseInt(getComputedStyle(e).fontSize,10),u=e.getBoundingClientRect();s=u.width/c,l=u.height/c}return p.autoA11y&&!r&&(o.attributes["aria-hidden"]="true"),Promise.resolve([e,fn({content:e.innerHTML,width:s,height:l,transform:a,title:r,extra:o,watchable:!0})])}}};const Ta=new RegExp('"',"ug"),An=[1105920,1112319],wn=f(f(f(f({},{FontAwesome:{normal:"fas",400:"fas"}}),rr),xr),dr),ie=Object.keys(wn).reduce((t,e)=>(t[e.toLowerCase()]=wn[e],t),{}),Na=Object.keys(ie).reduce((t,e)=>{const n=ie[e];return t[e]=n[900]||[...Object.entries(n)][0][1],t},{});function Fa(t){const e=t.replace(Ta,""),n=$r(e,0),r=n>=An[0]&&n<=An[1],a=e.length===2?e[0]===e[1]:!1;return{value:qt(a?e[0]:e),isSecondary:r||a}}function Ra(t,e){const n=t.replace(/^['"]|['"]$/g,"").toLowerCase(),r=parseInt(e),a=isNaN(r)?"normal":r;return(ie[n]||{})[a]||Na[n]}function On(t,e){const n="".concat(Ar).concat(e.replace(":","-"));return new Promise((r,a)=>{if(t.getAttribute(n)!==null)return r();const s=rt(t.children).filter(h=>h.getAttribute(Rt)===e)[0],l=G.getComputedStyle(t,e),c=l.getPropertyValue("font-family"),u=c.match(kr),d=l.getPropertyValue("font-weight"),g=l.getPropertyValue("content");if(s&&!u)return t.removeChild(s),r();if(u&&g!=="none"&&g!==""){const h=l.getPropertyValue("content");let k=Ra(c,d);const{value:E,isSecondary:_}=Fa(h),O=u[0].startsWith("FontAwesome");let x=Xt(k,E),S=x;if(O){const I=Vr(E);I.iconName&&I.prefix&&(x=I.iconName,k=I.prefix)}if(x&&!_&&(!s||s.getAttribute(jt)!==k||s.getAttribute(Mt)!==S)){t.setAttribute(n,S),s&&t.removeChild(s);const I=Aa(),{extra:M}=I;M.attributes[Rt]=e,ee(x,k).then(L=>{const st=Jt(f(f({},I),{},{icons:{main:L,mask:an()},prefix:k,iconName:S,extra:M,watchable:!0})),$=w.createElementNS("http://www.w3.org/2000/svg","svg");e==="::before"?t.insertBefore($,t.firstChild):t.appendChild($),$.outerHTML=st.map(J=>mt(J)).join(`
`),t.removeAttribute(n),r()}).catch(a)}else r()}else r()})}function ja(t){return Promise.all([On(t,"::before"),On(t,"::after")])}function Ma(t){return t.parentNode!==document.head&&!~Or.indexOf(t.tagName.toUpperCase())&&!t.getAttribute(Rt)&&(!t.parentNode||t.parentNode.tagName!=="svg")}function Sn(t){if(Y)return new Promise((e,n)=>{const r=rt(t.querySelectorAll("*")).filter(Ma).map(ja),a=re.begin("searchPseudoElements");gn(),Promise.all(r).then(()=>{a(),oe(),e()}).catch(()=>{a(),oe(),n()})})}var La={hooks(){return{mutationObserverCallbacks(t){return t.pseudoElementsCallback=Sn,t}}},provides(t){t.pseudoElements2svg=function(e){const{node:n=w}=e;p.searchPseudoElements&&Sn(n)}}};let Pn=!1;var Da={mixout(){return{dom:{unwatch(){gn(),Pn=!0}}}},hooks(){return{bootstrap(){yn(Kt("mutationObserverCallbacks",{}))},noAuto(){ya()},watch(t){const{observeMutationsRoot:e}=t;Pn?oe():yn(Kt("mutationObserverCallbacks",{observeMutationsRoot:e}))}}}};const kn=t=>{let e={size:16,x:0,y:0,flipX:!1,flipY:!1,rotate:0};return t.toLowerCase().split(" ").reduce((n,r)=>{const a=r.toLowerCase().split("-"),o=a[0];let s=a.slice(1).join("-");if(o&&s==="h")return n.flipX=!0,n;if(o&&s==="v")return n.flipY=!0,n;if(s=parseFloat(s),isNaN(s))return n;switch(o){case"grow":n.size=n.size+s;break;case"shrink":n.size=n.size-s;break;case"left":n.x=n.x-s;break;case"right":n.x=n.x+s;break;case"up":n.y=n.y-s;break;case"down":n.y=n.y+s;break;case"rotate":n.rotate=n.rotate+s;break}return n},e)};var za={mixout(){return{parse:{transform:t=>kn(t)}}},hooks(){return{parseNodeAttributes(t,e){const n=e.getAttribute("data-fa-transform");return n&&(t.transform=kn(n)),t}}},provides(t){t.generateAbstractTransformGrouping=function(e){let{main:n,transform:r,containerWidth:a,iconWidth:o}=e;const s={transform:"translate(".concat(a/2," 256)")},l="translate(".concat(r.x*32,", ").concat(r.y*32,") "),c="scale(".concat(r.size/16*(r.flipX?-1:1),", ").concat(r.size/16*(r.flipY?-1:1),") "),u="rotate(".concat(r.rotate," 0 0)"),d={transform:"".concat(l," ").concat(c," ").concat(u)},g={transform:"translate(".concat(o/2*-1," -256)")},h={outer:s,inner:d,path:g};return{tag:"g",attributes:f({},h.outer),children:[{tag:"g",attributes:f({},h.inner),children:[{tag:n.icon.tag,children:n.icon.children,attributes:f(f({},n.icon.attributes),h.path)}]}]}}}};const se={x:0,y:0,width:"100%",height:"100%"};function En(t){let e=arguments.length>1&&arguments[1]!==void 0?arguments[1]:!0;return t.attributes&&(t.attributes.fill||e)&&(t.attributes.fill="black"),t}function Ua(t){return t.tag==="g"?t.children:[t]}var Wa={hooks(){return{parseNodeAttributes(t,e){const n=e.getAttribute("data-fa-mask"),r=n?At(n.split(" ").map(a=>a.trim())):an();return r.prefix||(r.prefix=X()),t.mask=r,t.maskId=e.getAttribute("data-fa-mask-id"),t}}},provides(t){t.generateAbstractMask=function(e){let{children:n,attributes:r,main:a,mask:o,maskId:s,transform:l}=e;const{width:c,icon:u}=a,{width:d,icon:g}=o,h=Mr({transform:l,containerWidth:d,iconWidth:c}),k={tag:"rect",attributes:f(f({},se),{},{fill:"white"})},E=u.children?{children:u.children.map(En)}:{},_={tag:"g",attributes:f({},h.inner),children:[En(f({tag:u.tag,attributes:f(f({},u.attributes),h.path)},E))]},O={tag:"g",attributes:f({},h.outer),children:[_]},x="mask-".concat(s||ut()),S="clip-".concat(s||ut()),I={tag:"mask",attributes:f(f({},se),{},{id:x,maskUnits:"userSpaceOnUse",maskContentUnits:"userSpaceOnUse"}),children:[k,O]},M={tag:"defs",children:[{tag:"clipPath",attributes:{id:S},children:Ua(g)},I]};return n.push(M,{tag:"rect",attributes:f({fill:"currentColor","clip-path":"url(#".concat(S,")"),mask:"url(#".concat(x,")")},se)}),{children:n,attributes:r}}}},$a={provides(t){let e=!1;G.matchMedia&&(e=G.matchMedia("(prefers-reduced-motion: reduce)").matches),t.missingIconAbstract=function(){const n=[],r={fill:"currentColor"},a={attributeType:"XML",repeatCount:"indefinite",dur:"2s"};n.push({tag:"path",attributes:f(f({},r),{},{d:"M156.5,447.7l-12.6,29.5c-18.7-9.5-35.9-21.2-51.5-34.9l22.7-22.7C127.6,430.5,141.5,440,156.5,447.7z M40.6,272H8.5 c1.4,21.2,5.4,41.7,11.7,61.1L50,321.2C45.1,305.5,41.8,289,40.6,272z M40.6,240c1.4-18.8,5.2-37,11.1-54.1l-29.5-12.6 C14.7,194.3,10,216.7,8.5,240H40.6z M64.3,156.5c7.8-14.9,17.2-28.8,28.1-41.5L69.7,92.3c-13.7,15.6-25.5,32.8-34.9,51.5 L64.3,156.5z M397,419.6c-13.9,12-29.4,22.3-46.1,30.4l11.9,29.8c20.7-9.9,39.8-22.6,56.9-37.6L397,419.6z M115,92.4 c13.9-12,29.4-22.3,46.1-30.4l-11.9-29.8c-20.7,9.9-39.8,22.6-56.8,37.6L115,92.4z M447.7,355.5c-7.8,14.9-17.2,28.8-28.1,41.5 l22.7,22.7c13.7-15.6,25.5-32.9,34.9-51.5L447.7,355.5z M471.4,272c-1.4,18.8-5.2,37-11.1,54.1l29.5,12.6 c7.5-21.1,12.2-43.5,13.6-66.8H471.4z M321.2,462c-15.7,5-32.2,8.2-49.2,9.4v32.1c21.2-1.4,41.7-5.4,61.1-11.7L321.2,462z M240,471.4c-18.8-1.4-37-5.2-54.1-11.1l-12.6,29.5c21.1,7.5,43.5,12.2,66.8,13.6V471.4z M462,190.8c5,15.7,8.2,32.2,9.4,49.2h32.1 c-1.4-21.2-5.4-41.7-11.7-61.1L462,190.8z M92.4,397c-12-13.9-22.3-29.4-30.4-46.1l-29.8,11.9c9.9,20.7,22.6,39.8,37.6,56.9 L92.4,397z M272,40.6c18.8,1.4,36.9,5.2,54.1,11.1l12.6-29.5C317.7,14.7,295.3,10,272,8.5V40.6z M190.8,50 c15.7-5,32.2-8.2,49.2-9.4V8.5c-21.2,1.4-41.7,5.4-61.1,11.7L190.8,50z M442.3,92.3L419.6,115c12,13.9,22.3,29.4,30.5,46.1 l29.8-11.9C470,128.5,457.3,109.4,442.3,92.3z M397,92.4l22.7-22.7c-15.6-13.7-32.8-25.5-51.5-34.9l-12.6,29.5 C370.4,72.1,384.4,81.5,397,92.4z"})});const o=f(f({},a),{},{attributeName:"opacity"}),s={tag:"circle",attributes:f(f({},r),{},{cx:"256",cy:"364",r:"28"}),children:[]};return e||s.children.push({tag:"animate",attributes:f(f({},a),{},{attributeName:"r",values:"28;14;28;28;14;28;"})},{tag:"animate",attributes:f(f({},o),{},{values:"1;0;1;1;0;1;"})}),n.push(s),n.push({tag:"path",attributes:f(f({},r),{},{opacity:"1",d:"M263.7,312h-16c-6.6,0-12-5.4-12-12c0-71,77.4-63.9,77.4-107.8c0-20-17.8-40.2-57.4-40.2c-29.1,0-44.3,9.6-59.2,28.7 c-3.9,5-11.1,6-16.2,2.4l-13.1-9.2c-5.6-3.9-6.9-11.8-2.6-17.2c21.2-27.2,46.4-44.7,91.2-44.7c52.3,0,97.4,29.8,97.4,80.2 c0,67.6-77.4,63.5-77.4,107.8C275.7,306.6,270.3,312,263.7,312z"}),children:e?[]:[{tag:"animate",attributes:f(f({},o),{},{values:"1;0;0;0;0;1;"})}]}),e||n.push({tag:"path",attributes:f(f({},r),{},{opacity:"0",d:"M232.5,134.5l7,168c0.3,6.4,5.6,11.5,12,11.5h9c6.4,0,11.7-5.1,12-11.5l7-168c0.3-6.8-5.2-12.5-12-12.5h-23 C237.7,122,232.2,127.7,232.5,134.5z"}),children:[{tag:"animate",attributes:f(f({},o),{},{values:"0;0;1;1;0;0;"})}]}),{tag:"g",attributes:{class:"missing"},children:n}}}},Ya={hooks(){return{parseNodeAttributes(t,e){const n=e.getAttribute("data-fa-symbol"),r=n===null?!1:n===""?!0:n;return t.symbol=r,t}}}},Ba=[zr,Ea,_a,Ca,Ia,La,Da,za,Wa,$a,Ya];ra(Ba,{mixoutsTo:j}),j.noAuto,j.config,j.library,j.dom;const le=j.parse;j.findIconDefinition,j.toHtml;const Ha=j.icon;j.layer,j.text,j.counter;function _n(t){return t&&t.__esModule&&Object.prototype.hasOwnProperty.call(t,"default")?t.default:t}var fe={exports:{}},ce,Cn;function qa(){if(Cn)return ce;Cn=1;var t="SECRET_DO_NOT_PASS_THIS_OR_YOU_WILL_BE_FIRED";return ce=t,ce}var ue,In;function Ga(){if(In)return ue;In=1;var t=qa();function e(){}function n(){}return n.resetWarningCache=e,ue=function(){function r(s,l,c,u,d,g){if(g!==t){var h=new Error("Calling PropTypes validators directly is not supported by the `prop-types` package. Use PropTypes.checkPropTypes() to call them. Read more at http://fb.me/use-check-prop-types");throw h.name="Invariant Violation",h}}r.isRequired=r;function a(){return r}var o={array:r,bigint:r,bool:r,func:r,number:r,object:r,string:r,symbol:r,any:r,arrayOf:a,element:r,elementType:r,instanceOf:a,node:r,objectOf:a,oneOf:a,oneOfType:a,shape:a,exact:a,checkPropTypes:n,resetWarningCache:e};return o.PropTypes=o,o},ue}var Tn;function Va(){return Tn||(Tn=1,fe.exports=Ga()()),fe.exports}var Xa=Va();const y=_n(Xa);var me={exports:{}},b={};/*
object-assign
(c) Sindre Sorhus
@license MIT
*/var de,Nn;function Ka(){if(Nn)return de;Nn=1;var t=Object.getOwnPropertySymbols,e=Object.prototype.hasOwnProperty,n=Object.prototype.propertyIsEnumerable;function r(o){if(o==null)throw new TypeError("Object.assign cannot be called with null or undefined");return Object(o)}function a(){try{if(!Object.assign)return!1;var o=new String("abc");if(o[5]="de",Object.getOwnPropertyNames(o)[0]==="5")return!1;for(var s={},l=0;l<10;l++)s["_"+String.fromCharCode(l)]=l;var c=Object.getOwnPropertyNames(s).map(function(d){return s[d]});if(c.join("")!=="0123456789")return!1;var u={};return"abcdefghijklmnopqrst".split("").forEach(function(d){u[d]=d}),Object.keys(Object.assign({},u)).join("")==="abcdefghijklmnopqrst"}catch{return!1}}return de=a()?Object.assign:function(o,s){for(var l,c=r(o),u,d=1;d<arguments.length;d++){l=Object(arguments[d]);for(var g in l)e.call(l,g)&&(c[g]=l[g]);if(t){u=t(l);for(var h=0;h<u.length;h++)n.call(l,u[h])&&(c[u[h]]=l[u[h]])}}return c},de}/** @license React v17.0.2
 * react.production.min.js
 *
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */var Fn;function Qa(){if(Fn)return b;Fn=1;var t=Ka(),e=60103,n=60106;b.Fragment=60107,b.StrictMode=60108,b.Profiler=60114;var r=60109,a=60110,o=60112;b.Suspense=60113;var s=60115,l=60116;if(typeof Symbol=="function"&&Symbol.for){var c=Symbol.for;e=c("react.element"),n=c("react.portal"),b.Fragment=c("react.fragment"),b.StrictMode=c("react.strict_mode"),b.Profiler=c("react.profiler"),r=c("react.provider"),a=c("react.context"),o=c("react.forward_ref"),b.Suspense=c("react.suspense"),s=c("react.memo"),l=c("react.lazy")}var u=typeof Symbol=="function"&&Symbol.iterator;function d(i){return i===null||typeof i!="object"?null:(i=u&&i[u]||i["@@iterator"],typeof i=="function"?i:null)}function g(i){for(var m="https://reactjs.org/docs/error-decoder.html?invariant="+i,v=1;v<arguments.length;v++)m+="&args[]="+encodeURIComponent(arguments[v]);return"Minified React error #"+i+"; visit "+m+" for the full message or use the non-minified dev environment for full errors and additional helpful warnings."}var h={isMounted:function(){return!1},enqueueForceUpdate:function(){},enqueueReplaceState:function(){},enqueueSetState:function(){}},k={};function E(i,m,v){this.props=i,this.context=m,this.refs=k,this.updater=v||h}E.prototype.isReactComponent={},E.prototype.setState=function(i,m){if(typeof i!="object"&&typeof i!="function"&&i!=null)throw Error(g(85));this.updater.enqueueSetState(this,i,m,"setState")},E.prototype.forceUpdate=function(i){this.updater.enqueueForceUpdate(this,i,"forceUpdate")};function _(){}_.prototype=E.prototype;function O(i,m,v){this.props=i,this.context=m,this.refs=k,this.updater=v||h}var x=O.prototype=new _;x.constructor=O,t(x,E.prototype),x.isPureReactComponent=!0;var S={current:null},I=Object.prototype.hasOwnProperty,M={key:!0,ref:!0,__self:!0,__source:!0};function L(i,m,v){var P,A={},T=null,F=null;if(m!=null)for(P in m.ref!==void 0&&(F=m.ref),m.key!==void 0&&(T=""+m.key),m)I.call(m,P)&&!M.hasOwnProperty(P)&&(A[P]=m[P]);var N=arguments.length-2;if(N===1)A.children=v;else if(1<N){for(var C=Array(N),D=0;D<N;D++)C[D]=arguments[D+2];A.children=C}if(i&&i.defaultProps)for(P in N=i.defaultProps,N)A[P]===void 0&&(A[P]=N[P]);return{$$typeof:e,type:i,key:T,ref:F,props:A,_owner:S.current}}function st(i,m){return{$$typeof:e,type:i.type,key:m,ref:i.ref,props:i.props,_owner:i._owner}}function $(i){return typeof i=="object"&&i!==null&&i.$$typeof===e}function J(i){var m={"=":"=0",":":"=2"};return"$"+i.replace(/[=:]/g,function(v){return m[v]})}var Hn=/\/+/g;function xe(i,m){return typeof i=="object"&&i!==null&&i.key!=null?J(""+i.key):m.toString(36)}function Et(i,m,v,P,A){var T=typeof i;(T==="undefined"||T==="boolean")&&(i=null);var F=!1;if(i===null)F=!0;else switch(T){case"string":case"number":F=!0;break;case"object":switch(i.$$typeof){case e:case n:F=!0}}if(F)return F=i,A=A(F),i=P===""?"."+xe(F,0):P,Array.isArray(A)?(v="",i!=null&&(v=i.replace(Hn,"$&/")+"/"),Et(A,m,v,"",function(D){return D})):A!=null&&($(A)&&(A=st(A,v+(!A.key||F&&F.key===A.key?"":(""+A.key).replace(Hn,"$&/")+"/")+i)),m.push(A)),1;if(F=0,P=P===""?".":P+":",Array.isArray(i))for(var N=0;N<i.length;N++){T=i[N];var C=P+xe(T,N);F+=Et(T,m,v,C,A)}else if(C=d(i),typeof C=="function")for(i=C.call(i),N=0;!(T=i.next()).done;)T=T.value,C=P+xe(T,N++),F+=Et(T,m,v,C,A);else if(T==="object")throw m=""+i,Error(g(31,m==="[object Object]"?"object with keys {"+Object.keys(i).join(", ")+"}":m));return F}function _t(i,m,v){if(i==null)return i;var P=[],A=0;return Et(i,P,"","",function(T){return m.call(v,T,A++)}),P}function wo(i){if(i._status===-1){var m=i._result;m=m(),i._status=0,i._result=m,m.then(function(v){i._status===0&&(v=v.default,i._status=1,i._result=v)},function(v){i._status===0&&(i._status=2,i._result=v)})}if(i._status===1)return i._result;throw i._result}var qn={current:null};function q(){var i=qn.current;if(i===null)throw Error(g(321));return i}var Oo={ReactCurrentDispatcher:qn,ReactCurrentBatchConfig:{transition:0},ReactCurrentOwner:S,IsSomeRendererActing:{current:!1},assign:t};return b.Children={map:_t,forEach:function(i,m,v){_t(i,function(){m.apply(this,arguments)},v)},count:function(i){var m=0;return _t(i,function(){m++}),m},toArray:function(i){return _t(i,function(m){return m})||[]},only:function(i){if(!$(i))throw Error(g(143));return i}},b.Component=E,b.PureComponent=O,b.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED=Oo,b.cloneElement=function(i,m,v){if(i==null)throw Error(g(267,i));var P=t({},i.props),A=i.key,T=i.ref,F=i._owner;if(m!=null){if(m.ref!==void 0&&(T=m.ref,F=S.current),m.key!==void 0&&(A=""+m.key),i.type&&i.type.defaultProps)var N=i.type.defaultProps;for(C in m)I.call(m,C)&&!M.hasOwnProperty(C)&&(P[C]=m[C]===void 0&&N!==void 0?N[C]:m[C])}var C=arguments.length-2;if(C===1)P.children=v;else if(1<C){N=Array(C);for(var D=0;D<C;D++)N[D]=arguments[D+2];P.children=N}return{$$typeof:e,type:i.type,key:A,ref:T,props:P,_owner:F}},b.createContext=function(i,m){return m===void 0&&(m=null),i={$$typeof:a,_calculateChangedBits:m,_currentValue:i,_currentValue2:i,_threadCount:0,Provider:null,Consumer:null},i.Provider={$$typeof:r,_context:i},i.Consumer=i},b.createElement=L,b.createFactory=function(i){var m=L.bind(null,i);return m.type=i,m},b.createRef=function(){return{current:null}},b.forwardRef=function(i){return{$$typeof:o,render:i}},b.isValidElement=$,b.lazy=function(i){return{$$typeof:l,_payload:{_status:-1,_result:i},_init:wo}},b.memo=function(i,m){return{$$typeof:s,type:i,compare:m===void 0?null:m}},b.useCallback=function(i,m){return q().useCallback(i,m)},b.useContext=function(i,m){return q().useContext(i,m)},b.useDebugValue=function(){},b.useEffect=function(i,m){return q().useEffect(i,m)},b.useImperativeHandle=function(i,m,v){return q().useImperativeHandle(i,m,v)},b.useLayoutEffect=function(i,m){return q().useLayoutEffect(i,m)},b.useMemo=function(i,m){return q().useMemo(i,m)},b.useReducer=function(i,m,v){return q().useReducer(i,m,v)},b.useRef=function(i){return q().useRef(i)},b.useState=function(i){return q().useState(i)},b.version="17.0.2",b}var Rn;function Ja(){return Rn||(Rn=1,me.exports=Qa()),me.exports}var Za=Ja();const jn=_n(Za);function pe(t,e){(e==null||e>t.length)&&(e=t.length);for(var n=0,r=Array(e);n<e;n++)r[n]=t[n];return r}function to(t){if(Array.isArray(t))return t}function eo(t){if(Array.isArray(t))return pe(t)}function Q(t,e,n){return(e=fo(e))in t?Object.defineProperty(t,e,{value:n,enumerable:!0,configurable:!0,writable:!0}):t[e]=n,t}function no(t){if(typeof Symbol<"u"&&t[Symbol.iterator]!=null||t["@@iterator"]!=null)return Array.from(t)}function ro(t,e){var n=t==null?null:typeof Symbol<"u"&&t[Symbol.iterator]||t["@@iterator"];if(n!=null){var r,a,o,s,l=[],c=!0,u=!1;try{if(o=(n=n.call(t)).next,e!==0)for(;!(c=(r=o.call(n)).done)&&(l.push(r.value),l.length!==e);c=!0);}catch(d){u=!0,a=d}finally{try{if(!c&&n.return!=null&&(s=n.return(),Object(s)!==s))return}finally{if(u)throw a}}return l}}function ao(){throw new TypeError(`Invalid attempt to destructure non-iterable instance.
In order to be iterable, non-array objects must have a [Symbol.iterator]() method.`)}function oo(){throw new TypeError(`Invalid attempt to spread non-iterable instance.
In order to be iterable, non-array objects must have a [Symbol.iterator]() method.`)}function Mn(t,e){var n=Object.keys(t);if(Object.getOwnPropertySymbols){var r=Object.getOwnPropertySymbols(t);e&&(r=r.filter(function(a){return Object.getOwnPropertyDescriptor(t,a).enumerable})),n.push.apply(n,r)}return n}function W(t){for(var e=1;e<arguments.length;e++){var n=arguments[e]!=null?arguments[e]:{};e%2?Mn(Object(n),!0).forEach(function(r){Q(t,r,n[r])}):Object.getOwnPropertyDescriptors?Object.defineProperties(t,Object.getOwnPropertyDescriptors(n)):Mn(Object(n)).forEach(function(r){Object.defineProperty(t,r,Object.getOwnPropertyDescriptor(n,r))})}return t}function io(t,e){if(t==null)return{};var n,r,a=so(t,e);if(Object.getOwnPropertySymbols){var o=Object.getOwnPropertySymbols(t);for(r=0;r<o.length;r++)n=o[r],e.indexOf(n)===-1&&{}.propertyIsEnumerable.call(t,n)&&(a[n]=t[n])}return a}function so(t,e){if(t==null)return{};var n={};for(var r in t)if({}.hasOwnProperty.call(t,r)){if(e.indexOf(r)!==-1)continue;n[r]=t[r]}return n}function Ln(t,e){return to(t)||ro(t,e)||Dn(t,e)||ao()}function he(t){return eo(t)||no(t)||Dn(t)||oo()}function lo(t,e){if(typeof t!="object"||!t)return t;var n=t[Symbol.toPrimitive];if(n!==void 0){var r=n.call(t,e);if(typeof r!="object")return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return(e==="string"?String:Number)(t)}function fo(t){var e=lo(t,"string");return typeof e=="symbol"?e:e+""}function kt(t){"@babel/helpers - typeof";return kt=typeof Symbol=="function"&&typeof Symbol.iterator=="symbol"?function(e){return typeof e}:function(e){return e&&typeof Symbol=="function"&&e.constructor===Symbol&&e!==Symbol.prototype?"symbol":typeof e},kt(t)}function Dn(t,e){if(t){if(typeof t=="string")return pe(t,e);var n={}.toString.call(t).slice(8,-1);return n==="Object"&&t.constructor&&(n=t.constructor.name),n==="Map"||n==="Set"?Array.from(t):n==="Arguments"||/^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)?pe(t,e):void 0}}var co="7.0.0-alpha1",ge;try{var uo=require("@fortawesome/fontawesome-svg-core/package.json");ge=uo.version}catch{ge="sss"}function mo(t){var e=t.beat,n=t.fade,r=t.beatFade,a=t.bounce,o=t.shake,s=t.flash,l=t.spin,c=t.spinPulse,u=t.spinReverse,d=t.pulse,g=t.fixedWidth,h=t.inverse,k=t.border,E=t.listItem,_=t.flip,O=t.size,x=t.rotation,S=t.pull,I=t.swapOpacity,M=t.rotateBy,L=t.widthAuto,st=po(ge,co),$=Q(Q(Q(Q(Q(Q({"fa-beat":e,"fa-fade":n,"fa-beat-fade":r,"fa-bounce":a,"fa-shake":o,"fa-flash":s,"fa-spin":l,"fa-spin-reverse":u,"fa-spin-pulse":c,"fa-pulse":d,"fa-fw":g,"fa-inverse":h,"fa-border":k,"fa-li":E,"fa-flip":_===!0,"fa-flip-horizontal":_==="horizontal"||_==="both","fa-flip-vertical":_==="vertical"||_==="both"},"fa-".concat(O),typeof O<"u"&&O!==null),"fa-rotate-".concat(x),typeof x<"u"&&x!==null&&x!==0),"fa-pull-".concat(S),typeof S<"u"&&S!==null),"fa-swap-opacity",I),"fa-rotate-by",st&&M),"fa-width-auto",st&&L);return Object.keys($).map(function(J){return $[J]?J:null}).filter(function(J){return J})}function po(t,e){for(var n=t.split("-"),r=Ln(n,2),a=r[0],o=r[1],s=e.split("-"),l=Ln(s,2),c=l[0],u=l[1],d=a.split("."),g=c.split("."),h=0;h<Math.max(d.length,g.length);h++){var k=d[h]||"0",E=g[h]||"0",_=parseInt(k,10),O=parseInt(E,10);if(_!==O)return _>O}for(var x=0;x<Math.max(d.length,g.length);x++){var S=d[x]||"0",I=g[x]||"0";if(S!==I&&S.length!==I.length)return S.length<I.length}return!(o&&!u)}function ho(t){return t=t-0,t===t}function zn(t){return ho(t)?t:(t=t.replace(/[\-_\s]+(.)?/g,function(e,n){return n?n.toUpperCase():""}),t.substr(0,1).toLowerCase()+t.substr(1))}var go=["style"];function yo(t){return t.charAt(0).toUpperCase()+t.slice(1)}function bo(t){return t.split(";").map(function(e){return e.trim()}).filter(function(e){return e}).reduce(function(e,n){var r=n.indexOf(":"),a=zn(n.slice(0,r)),o=n.slice(r+1).trim();return a.startsWith("webkit")?e[yo(a)]=o:e[a]=o,e},{})}function Un(t,e){var n=arguments.length>2&&arguments[2]!==void 0?arguments[2]:{};if(typeof e=="string")return e;var r=(e.children||[]).map(function(c){return Un(t,c)}),a=Object.keys(e.attributes||{}).reduce(function(c,u){var d=e.attributes[u];switch(u){case"class":c.attrs.className=d,delete e.attributes.class;break;case"style":c.attrs.style=bo(d);break;default:u.indexOf("aria-")===0||u.indexOf("data-")===0?c.attrs[u.toLowerCase()]=d:c.attrs[zn(u)]=d}return c},{attrs:{}}),o=n.style,s=o===void 0?{}:o,l=io(n,go);return a.attrs.style=W(W({},a.attrs.style),s),t.apply(void 0,[e.tag,W(W({},a.attrs),l)].concat(he(r)))}var Wn=!1;try{Wn=!0}catch{}function vo(){if(!Wn&&console&&typeof console.error=="function"){var t;(t=console).error.apply(t,arguments)}}function $n(t){if(t&&kt(t)==="object"&&t.prefix&&t.iconName&&t.icon)return t;if(le.icon)return le.icon(t);if(t===null)return null;if(t&&kt(t)==="object"&&t.prefix&&t.iconName)return t;if(Array.isArray(t)&&t.length===2)return{prefix:t[0],iconName:t[1]};if(typeof t=="string")return{prefix:"fas",iconName:t}}function ye(t,e){return Array.isArray(e)&&e.length>0||!Array.isArray(e)&&e?Q({},t,e):{}}var Yn={border:!1,className:"",mask:null,maskId:null,fixedWidth:!1,inverse:!1,flip:!1,icon:null,listItem:!1,pull:null,pulse:!1,rotation:null,rotateBy:!1,size:null,spin:!1,spinPulse:!1,spinReverse:!1,beat:!1,fade:!1,beatFade:!1,bounce:!1,shake:!1,symbol:!1,title:"",titleId:null,transform:null,swapOpacity:!1,widthAuto:!1},be=jn.forwardRef(function(t,e){var n=W(W({},Yn),t),r=n.icon,a=n.mask,o=n.symbol,s=n.className,l=n.title,c=n.titleId,u=n.maskId,d=$n(r),g=ye("classes",[].concat(he(mo(n)),he((s||"").split(" ")))),h=ye("transform",typeof n.transform=="string"?le.transform(n.transform):n.transform),k=ye("mask",$n(a)),E=Ha(d,W(W(W(W({},g),h),k),{},{symbol:o,title:l,titleId:c,maskId:u}));if(!E)return vo("Could not find icon",d),null;var _=E.abstract,O={ref:e};return Object.keys(n).forEach(function(x){Yn.hasOwnProperty(x)||(O[x]=n[x])}),xo(_[0],O)});be.displayName="FontAwesomeIcon",be.propTypes={beat:y.bool,border:y.bool,beatFade:y.bool,bounce:y.bool,className:y.string,fade:y.bool,flash:y.bool,mask:y.oneOfType([y.object,y.array,y.string]),maskId:y.string,fixedWidth:y.bool,inverse:y.bool,flip:y.oneOf([!0,!1,"horizontal","vertical","both"]),icon:y.oneOfType([y.object,y.array,y.string]),listItem:y.bool,pull:y.oneOf(["right","left"]),pulse:y.bool,rotation:y.oneOf([0,90,180,270]),rotateBy:y.bool,shake:y.bool,size:y.oneOf(["2xs","xs","sm","lg","xl","2xl","1x","2x","3x","4x","5x","6x","7x","8x","9x","10x"]),spin:y.bool,spinPulse:y.bool,spinReverse:y.bool,symbol:y.oneOfType([y.bool,y.string]),title:y.string,titleId:y.string,transform:y.oneOfType([y.string,y.object]),swapOpacity:y.bool,widthAuto:y.bool};var xo=Un.bind(null,jn.createElement);const Bn="stash-tv",{PluginApi:ve}=window,{React:it}=ve;ve.patch.instead("MainNavBar.MenuItems",function({children:t,...e},n,r){const{data:a,loading:o}=ve.GQL.useConfigurationQuery(),s=a?.configuration?.plugins?.[Bn]?.hideNavButton??!1;return[it.createElement(r,{...e},t,!o&&!s&&it.createElement(Ao,null))]});const Ao=()=>{const t="/plugin/"+Bn+"/assets/app/";return it.createElement("div",{"data-rb-event-key":t,className:"col-4 col-sm-3 col-md-2 col-lg-auto nav-link",id:"StashTVButton"},it.createElement("a",{href:t,className:"minimal p-4 p-xl-2 d-flex d-xl-inline-block flex-column justify-content-between align-items-center btn btn-primary",target:"_blank"},it.createElement(be,{className:"fa-icon nav-menu-icon d-block d-xl-inline mb-2 mb-xl-0",icon:Gn}),it.createElement("span",null,"TV")))}}));
