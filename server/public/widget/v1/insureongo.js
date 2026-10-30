"use strict";(()=>{var P=e=>{throw TypeError(e)};var S=(e,n,t)=>n.has(e)||P("Cannot "+t);var i=(e,n,t)=>(S(e,n,"read from private field"),t?t.call(e):n.get(e)),u=(e,n,t)=>n.has(e)?P("Cannot add the same private member more than once"):n instanceof WeakSet?n.add(e):n.set(e,t),s=(e,n,t,r)=>(S(e,n,"write to private field"),r?r.call(e,t):n.set(e,t),t),h=(e,n,t)=>(S(e,n,"access private method"),t);var F=(e,n,t,r)=>({set _(o){s(e,n,o,t)},get _(){return i(e,n,r)}});function I(e){return new Intl.NumberFormat("en-NG",{style:"currency",currency:"NGN",maximumFractionDigits:Number.isInteger(e)?0:2}).format(e)}var D=30;function $(e,n){return`Protect ${e.length<=D?e:"this item"} for ${I(n)}`}var O="x-insureongo-public-key";function K(e){if(typeof e!="object"||e===null)return null;let n=e,t=Number(n.premium);return typeof n.id!="number"||!Number.isFinite(t)||typeof n.insurerName!="string"||typeof n.planName!="string"?null:{id:n.id,insurerName:n.insurerName,planName:n.planName,premium:t}}async function U(e,n,t){let r=new AbortController,o=setTimeout(()=>r.abort(),5e3);try{let d=await fetch(`${e}/v1/quotes`,{method:"POST",headers:{"Content-Type":"application/json",[O]:n},body:JSON.stringify(t),signal:r.signal});if(d.status!==200)return[];let a=await d.json();if(!Array.isArray(a)||a.length===0)return[];let l=a.map(K);return l.every(m=>m!==null)?l:[]}catch{return[]}finally{clearTimeout(o)}}var z=300,G="insureongo_quote_id",V=["item-name","item-category","item-price","item-condition"],Y=["new","used"];function J(){let e=document.currentScript;if(e?.src)try{return new URL(e.src).origin}catch{}return location.origin}var X=J(),W=`
  :host {
    display: block;
    font-family: var(--insureongo-font, inherit);
    font-size: 14px;
    line-height: 1.4;
    color: inherit;
  }
  .row { display: flex; align-items: center; gap: 8px; }
  input { accent-color: var(--insureongo-accent, #0b6b3a); margin: 0; }
  label { cursor: pointer; }
  .meta { margin: 2px 0 0 24px; font-size: 12px; opacity: 0.75; }
  .more {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    background: none;
    border: 0;
    padding: 4px;
    cursor: pointer;
    color: var(--insureongo-accent, #0b6b3a);
    border-radius: 4px;
  }
  .more:focus-visible { outline: 2px solid var(--insureongo-accent, #0b6b3a); }
  .options { margin: 6px 0 0 24px; padding: 0; list-style: none; }
  .options[hidden] { display: none; }
  .options button {
    display: block;
    width: 100%;
    text-align: left;
    background: none;
    border: 0;
    border-radius: 4px;
    padding: 6px 4px;
    font: inherit;
    color: inherit;
    cursor: pointer;
  }
  .options button:hover { background: rgba(0, 0, 0, 0.05); }
`,E,x,b,f,g,p,T,k,v,w,y,A,C,L,q,c,B,Q,_,j,M,R,N=class extends HTMLElement{constructor(){super();u(this,c);u(this,E);u(this,x);u(this,b,[]);u(this,f,0);u(this,g,!1);u(this,p,!1);u(this,T,!1);u(this,k,!1);u(this,v);u(this,w,0);u(this,y);u(this,A);u(this,C);u(this,L);u(this,q);s(this,E,this.attachInternals()),s(this,x,this.attachShadow({mode:"open"}))}get value(){let t=i(this,b)[i(this,f)];return i(this,g)&&t?String(t.id):""}connectedCallback(){this.hasAttribute("name")||this.setAttribute("name",G),s(this,k,!0),h(this,c,Q).call(this)}disconnectedCallback(){clearTimeout(i(this,v))}attributeChangedCallback(t,r,o){r===o||!i(this,k)||(clearTimeout(i(this,v)),s(this,v,setTimeout(()=>{h(this,c,Q).call(this)},z)))}};E=new WeakMap,x=new WeakMap,b=new WeakMap,f=new WeakMap,g=new WeakMap,p=new WeakMap,T=new WeakMap,k=new WeakMap,v=new WeakMap,w=new WeakMap,y=new WeakMap,A=new WeakMap,C=new WeakMap,L=new WeakMap,q=new WeakMap,c=new WeakSet,B=function(){let t=this.getAttribute("public-key")?.trim()??"",r=this.getAttribute("item-name")?.trim()??"",o=this.getAttribute("item-category")?.trim()??"",d=this.getAttribute("item-condition")?.trim()??"",a=this.getAttribute("store-item-ref")?.trim(),l=Number(this.getAttribute("item-price")?.trim()),m=[];if(t||m.push("public-key"),r||m.push("item-name"),o||m.push("item-category"),(!Number.isFinite(l)||l<=0)&&m.push("item-price"),Y.includes(d)||m.push("item-condition"),m.length>0)return i(this,T)||(s(this,T,!0),console.warn(`<insureongo-offer> missing or invalid: ${m.join(", ")}`)),null;let H={itemName:r,itemCategory:o,itemPrice:l,itemCondition:d};return a&&(H.storeItemRef=a),{publicKey:t,request:H}},Q=async function(){let t=h(this,c,B).call(this);if(!t){h(this,c,_).call(this,[]);return}let r=++F(this,w)._,o=await U(X,t.publicKey,t.request);r===i(this,w)&&h(this,c,_).call(this,o)},_=function(t){let r=this.value;s(this,b,t),s(this,f,0),s(this,g,!1),s(this,p,!1),i(this,x).replaceChildren(),s(this,y,void 0),t.length>0&&h(this,c,j).call(this),r!==this.value?h(this,c,R).call(this):i(this,E).setFormValue(this.value||null)},j=function(){let t=document.createElement("style");t.textContent=W;let r=document.createElement("div");r.className="row";let o=document.createElement("input");o.type="checkbox",o.id="accept",o.addEventListener("change",()=>{s(this,g,o.checked),h(this,c,R).call(this)});let d=document.createElement("label");d.htmlFor="accept",r.append(o,d);let a=document.createElement("button");a.type="button",a.className="more",a.setAttribute("aria-label","Other options"),a.innerHTML='<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><circle cx="3" cy="8" r="1.5" fill="currentColor"/><circle cx="8" cy="8" r="1.5" fill="currentColor"/><circle cx="13" cy="8" r="1.5" fill="currentColor"/></svg>',a.addEventListener("click",()=>{s(this,p,!i(this,p)),h(this,c,M).call(this)});let l=document.createElement("p");l.className="meta";let m=document.createElement("ul");m.className="options",i(this,x).append(t,r,l,m),s(this,y,o),s(this,A,d),s(this,C,l),s(this,L,a),s(this,q,m),i(this,b).length>1&&r.append(a),h(this,c,M).call(this)},M=function(){let t=i(this,b)[i(this,f)];if(!t||!i(this,y))return;i(this,y).checked=i(this,g),i(this,A).textContent=$(this.getAttribute("item-name")?.trim()??"",t.premium),i(this,C).textContent=`${t.planName} \u2014 ${t.insurerName}`,i(this,L)?.setAttribute("aria-expanded",String(i(this,p)));let r=i(this,q);r.hidden=!i(this,p),r.replaceChildren(),i(this,p)&&i(this,b).forEach((o,d)=>{if(d===i(this,f))return;let a=document.createElement("li"),l=document.createElement("button");l.type="button",l.textContent=`${o.planName} \u2014 ${o.insurerName} \xB7 ${I(o.premium)}`,l.addEventListener("click",()=>{s(this,f,d),s(this,g,!0),s(this,p,!1),h(this,c,M).call(this),h(this,c,R).call(this)}),a.append(l),r.append(a)})},R=function(){i(this,E).setFormValue(this.value||null),this.dispatchEvent(new Event("change",{bubbles:!0,composed:!0}));let t=i(this,g)?i(this,b)[i(this,f)]:void 0;this.dispatchEvent(new CustomEvent("insureongo:change",{bubbles:!0,composed:!0,detail:t?{quoteId:t.id,premium:t.premium}:{quoteId:null}}))},N.formAssociated=!0,N.observedAttributes=[...V,"store-item-ref","public-key"];customElements.get("insureongo-offer")||customElements.define("insureongo-offer",N);})();
