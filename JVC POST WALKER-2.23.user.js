// ==UserScript==
// @name         JVC POST WALKER
// @namespace    https://tampermonkey.net/
// @version      2.23
// @description  Last page via max-number, human-like scroll/hover. Posts templates to topics within allowed forums. Forum lists forced to page 1. UI mounting robust & private storage.
// @match        *://*.jeuxvideo.com/*
// @run-at       document-end
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.addValueChangeListener
// ==/UserScript==
(async function () {
  'use strict';

// Configure credentials locally via the account manager UI.


  /* ---------- state ---------- */
  // Allow external scripts to supply additional pseudos via
  // `window.__PW_PSEUDOS = ['pseudo1', 'pseudo2'];`

  const DEFAULTS = {
    me:'',
    activeHours:[8,23],
  // Accounts must be added through the UI; none are bundled by default.
    accounts: [],
    accountIdx:0,
    debug:false,
    dryRun:false,
    templates:[
      "grave https://image.noelshack.com/minis/2018/13/4/1522325846-jesusopti.png",
      "gg https://image.noelshack.com/minis/2018/29/6/1532128784-risitas33.png",
      "bien vu https://image.noelshack.com/minis/2018/27/4/1530827992-jesusreup.png",
      "on se calme https://image.noelshack.com/minis/2024/42/1/1728912096-eggish-fart-risitas-sticker.png",
      "ça part loin https://image.noelshack.com/minis/2016/26/1467335935-jesus1.png",
      "je m'installe https://image.noelshack.com/minis/2018/40/2/1538464049-ahibol.png",
      "mdr https://image.noelshack.com/minis/2023/44/7/1699147784-rire-ayaa-risitas-deforme-ayaaa-aya-deratiseur-zoom.png",
      "ptdr https://image.noelshack.com/minis/2016/24/1466366209-risitas24.png",
      "force https://image.noelshack.com/minis/2021/02/5/1610706605-3124-full.png",
      "bon courage https://image.noelshack.com/minis/2017/39/3/1506524542-ruth-perplexev2.png",
      "honteux https://image.noelshack.com/minis/2020/41/5/1602270996-204848-full.png",
      "intéressant https://image.noelshack.com/minis/2021/35/2/1630432176-chatmirroirstretch.png",
      "rien compris https://image.noelshack.com/minis/2021/09/2/1614646545-lacoste-airpods-ent.png",
      "ok https://image.noelshack.com/minis/2021/04/4/1611841177-ahiahiahi.png"
    ],
    maxTopicPosts:0  };



  /* ====== persistent and private storage ====== */
  const get = async (k, d) => {
    try { return await GM.getValue(k, d); }
    catch (err) { console.error('GM.getValue:', err); return d; }
  };
  const set = async (k, v) => {
    try { await GM.setValue(k, v); }
    catch (err) { console.error('GM.setValue:', err); }
  };

  /* ---------- utils ---------- */
  const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
  const rnd=(a,b)=>a+Math.random()*(b-a);
  const human=()=>sleep(Math.round(rnd(49,105)));
  const dwell=(a=350,b=950)=>sleep(Math.round(rnd(a,b)));
  const rndChar=()=>String.fromCharCode(97+Math.floor(Math.random()*26));
/**
 * Waits a random duration between `min` and `max` while simulating scrolls.
 * If `min >= max`, the values are swapped to ensure a valid interval.
 * The `min` parameter is clamped to `0` to avoid negative values.
  */
 async function randomScrollWait(min,max){
    if (min >= max) [min, max] = [max, min];
    min = Math.max(min, 0);
    const end = NOW() + Math.round(rnd(min,max));
    while(NOW() < end){
      if(Math.random()<0.3){
        try{ window.scrollBy({top:rnd(-120,120),behavior:'smooth'}); }
        catch(e){ console.error('[randomScrollWait]', e); }
      }
      await dwell(400,1200);
    }
  }
  
  function estimateReadingTime(element){
    if(!element) return 0;
    const text = element.innerText || '';
    const words = text.trim().split(/\s+/).filter(Boolean).length;
    const paragraphs = element.querySelectorAll('p').length;
    const wordsPerMinute = 200;
    const base = words / wordsPerMinute * 60 * 1000;
    const extra = paragraphs * 400;
    return Math.round(base + extra);
  }
  const q=(s,r=document)=>r.querySelector(s);
  const qa=(s,r=document)=>Array.from(r.querySelectorAll(s));
  const NOW=()=>Date.now();
  const ORIG=typeof location !== 'undefined' ? location.origin : '';
  let chronoEl=null, statusEl=null, logEl=null, postCountEl=null;
  let timerHandle=null;
  let updating=false;
  let ticking=false;
  // track any pending login retry to avoid duplicate reloads
  let loginReloadTimeout=null;
  let loginAttempted=false;

  let cursorX = (typeof window !== 'undefined' ? window.innerWidth/2 : 0);
  let cursorY = (typeof window !== 'undefined' ? window.innerHeight/2 : 0);
  if (typeof document !== 'undefined') {
    document.addEventListener('mousemove', e => {
      cursorX = e.clientX;
      cursorY = e.clientY;
    }, {passive:true});
  }

  const logBuffer=[]; let logIdx=0; const log=(s)=>{
    logBuffer[logIdx++ % 200] = s;
    if(!logEl) logEl=q('#jvc-postwalker-log');
    if(logEl){
    const idx=logIdx%200;
    const ordered=logBuffer.slice(idx).concat(logBuffer.slice(0,idx));
    logEl.textContent=ordered.filter(Boolean).join('\n');
    logEl.scrollTop=logEl.scrollHeight;
    }
  };

  // keep track of the UI MutationObserver so it can be cleaned up
  let uiMutationObserver = null;
  let uiRemountTimeout = null;
  if (typeof window !== 'undefined') {
    window.toggleKeyHandler = window.toggleKeyHandler || null;
      function cleanupUI(){
        if(uiMutationObserver){
          uiMutationObserver.disconnect();
          uiMutationObserver = null;
        }
        if(window.toggleKeyHandler){
          const toggleKeyHandler = window.toggleKeyHandler;
          document.removeEventListener('keydown', toggleKeyHandler);
          window.toggleKeyHandler = null;
        }
        if (uiRemountTimeout) {
          clearTimeout(uiRemountTimeout);
          uiRemountTimeout = null;
        }
        if (timerHandle) { clearInterval(timerHandle); timerHandle = null; }
        q('#jvc-postwalker')?.remove();
        q('#jvc-postwalker-badge')?.remove();
        chronoEl=null;
        statusEl=null;
        logEl=null;
        postCountEl=null;

    }
    window.addEventListener('unload', cleanupUI);
  }

  function setVal(el,v){
    if(!el) return;
    const d=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el),'value');
    d?.set ? d.set.call(el,v) : (el.value=v);
    el.dispatchEvent(new Event('input',{bubbles:true}));
    el.dispatchEvent(new Event('change',{bubbles:true}));
  }
  async function typeHuman(el, txt){
    if(!el) return;
    el.scrollIntoView?.({block:'center'});
    el.focus?.();
    const conf = await getFullConf();
    const WORD_PASTE_PROB = 0.1;
    const logDelay = () => {
      const u1 = Math.random();
      const u2 = Math.random();
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      return Math.round(Math.exp(4.2 + 0.4 * z));
    };
    for(let i=0;i<txt.length;i++){
      let ch = txt[i];
      if(!conf.debug && !conf.dryRun && /\S/.test(ch) && (i===0 || /\s/.test(txt[i-1])) && Math.random() < WORD_PASTE_PROB){
        const match = txt.slice(i).match(/^\S+/);
        if(match){
          await appendQuick(el, match[0]);
          ch = match[0].slice(-1);
          i += match[0].length - 1;
        }
      }else{
        if(!conf.debug && !conf.dryRun && Math.random() < 0.05){
          const typo = rndChar();
          await appendQuick(el, typo);
          await sleep(rnd(80,160));
          const corrected = getValue(el).slice(0,-1);
          setValue(el, corrected);
          el.dispatchEvent(new InputEvent('input', {inputType:'deleteContentBackward', bubbles:true}));
        }
        const prev=(el.value??el.textContent??'');
        if(el.isContentEditable){ el.textContent = prev + ch; }
        else setVal(el, prev + ch);
        el.dispatchEvent(new KeyboardEvent('keydown',{key:ch,bubbles:true}));
        el.dispatchEvent(new KeyboardEvent('keypress',{key:ch,bubbles:true}));
        el.dispatchEvent(new KeyboardEvent('keyup',{key:ch,bubbles:true}));
        await sleep(logDelay());
        if(Math.random()<0.03){
          try{ window.scrollBy({top:rnd(-60,60),behavior:'smooth'}); }
          catch(e){ console.error('[typeHuman scroll]', e); }
          await sleep(logDelay());
        }
      }
        if(/[\s.,!?;:]/.test(ch)) await sleep(Math.round(rnd(200,400)));
    }
    await sleep(logDelay());
  }

  // “Paste URLs, type everything else” for message field
  const URL_RX_GLOBAL = /https?:\/\/\S+/gi;
  const URL_RX_STRICT = /^https?:\/\/\S+$/i;
  function getValue(el){ return el?.isContentEditable ? (el.textContent||'') : (el.value||''); }
  function setValue(el,v){ if(el.isContentEditable){ el.textContent=v; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); } else setVal(el,v); }
  async function appendQuick(el, s){
    const prev = getValue(el);
    setValue(el, prev + s);
    await sleep(20);
  }
  async function typeMixed(el, text){
    if(!el) return;
    setValue(el, '');
    URL_RX_GLOBAL.lastIndex = 0;
    const parts = text.split(new RegExp('(' + URL_RX_GLOBAL.source + ')', 'gi'));
    for(const part of parts){
      if(!part) continue;
      if(URL_RX_STRICT.test(part)) await appendQuick(el, part);
      else await typeHuman(el, part);
      await sleep(20);
    }
  }

  /* ---------- human-like pre-click ---------- */
  async function humanHover(el){
    if(!el) return;
    try{
      let rect=el.getBoundingClientRect?.();
      if(!rect) return;
      const targetY = window.scrollY + rect.top - window.innerHeight/2 + rnd(-80,80);
      const behavior = Math.random()<0.5 ? 'smooth' : 'instant';
      try{ window.scrollTo({top: Math.max(0,targetY), behavior}); }
      catch(e){ console.error('[humanHover] initial scrollTo', e); window.scrollTo(0, Math.max(0,targetY)); }
      await sleep(200+Math.random()*300);
      if(Math.random()<0.3){
        const dir = targetY > window.scrollY ? 1 : -1;
        const overshoot = rnd(30,120);
        const overY = Math.max(0, targetY + dir*overshoot);
        try{ window.scrollTo({top:overY, behavior}); }
        catch(e){ console.error('[humanHover] overshoot scrollTo', e); window.scrollTo(0,overY); }
        await sleep(120+Math.random()*180);
        try{ window.scrollTo({top: Math.max(0,targetY), behavior}); }
        catch(e){ console.error('[humanHover] return scrollTo', e); window.scrollTo(0, Math.max(0,targetY)); }
        await sleep(120+Math.random()*180);
      }
      const wheelCount = Math.floor(rnd(1,4));
      for(let i=0;i<wheelCount;i++){
        const delta = (Math.random()<0.5?-1:1)*rnd(20,80);
        el.dispatchEvent(new WheelEvent('wheel',{bubbles:true,deltaY:delta}));
        await sleep(60+Math.random()*120);
      }
      try{ window.scrollTo({top: Math.max(0,targetY), behavior}); }
      catch(e){ console.error('[humanHover] final scrollTo', e); window.scrollTo(0, Math.max(0,targetY)); }
      await sleep(120+Math.random()*180);
      rect=el.getBoundingClientRect?.();
      if(!rect) return;
      const cx = rect.left + rect.width/2;
      const cy = rect.top + rect.height/2;
      for(let i=0;i<2+Math.floor(Math.random()*3);i++){
        el.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:cx+rnd(-15,15),clientY:cy+rnd(-8,8)}));
        await sleep(40+Math.random()*90);
      }
      const startX = cursorX;
      const startY = cursorY;
      const steps = 8 + Math.floor(Math.random()*8);
      await new Promise(res => {
        let step = 0;
        function animate(){
          step++;
          const t = step/steps;
          const x = startX + (cx - startX)*t + rnd(-2,2);
          const y = startY + (cy - startY)*t + rnd(-2,2);
          document.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:x,clientY:y}));
          cursorX = x;
          cursorY = y;
          if(step < steps) requestAnimationFrame(animate); else res();
        }
        requestAnimationFrame(animate);
      });
      el.dispatchEvent(new MouseEvent('mouseover',{bubbles:true,clientX:cx,clientY:cy}));
    }catch(e){ console.error('[humanHover]', e); }
    await dwell(120,260);
  }

  /* ---------- detectors ---------- */
  function isTopicPage(){
    if(!/\/forums\//i.test(location.pathname)) return false;
    if(qa('.bloc-message-forum').length>0) return true;
    return !!q('#forum-main-col .conteneur-message .bloc-header');
  }
  function isForumList(){
    if(!/\/forums\//i.test(location.pathname)) return false;
    if(isTopicPage()) return false;
    return true;
  }
  function isLoginPage(){
  const path = location.pathname;
  return path.startsWith('/login');  }

const STORE_CONF='jvc_postwalker_conf';
  let confCache = null;
  let fullConfCache = null;
  async function loadConf(force=false){
    if(force || confCache===null){
      confCache = await get(STORE_CONF,{});
      fullConfCache = null;
    }
    return confCache;
  }
  async function saveConf(conf){
    await set(STORE_CONF,conf);
    confCache = conf;
        fullConfCache = null;
  }
    async function getFullConf(){
      if(fullConfCache===null){
        fullConfCache = Object.assign({}, DEFAULTS, await loadConf());
      }
      return fullConfCache;
    }

const STORE_ON='jvc_postwalker_on';
const STORE_SESSION='jvc_postwalker_session';
const STORE_TARGET_FORUM='jvc_postwalker_target_forum';
const STORE_LAST_LIST='jvc_postwalker_last_list';
const STORE_PENDING_LOGIN='jvc_postwalker_pending_login';
const STORE_CF_RETRIES='jvc_postwalker_cf_retries';
const STORE_LOGIN_REFUSED='jvc_postwalker_login_refused';
const STORE_LOGIN_ATTEMPTS='jvc_postwalker_login_attempts';
const STORE_LOGIN_BLOCKED='jvc_postwalker_login_blocked';
const STORE_TOPIC_FAILS='jvc_postwalker_topic_fails';
const STORE_PENDING_POST='jvc_postwalker_pending_post';
const TOPIC_FAIL_THRESHOLD=3;
const TOPIC_FAIL_COOLDOWN=5*60*1000;


let onCache = false;
// DM-specific tracking removed: no sent memory or cooldown bookkeeping
let sessionCache = {active:false,startTs:0,stopTs:0,mpCount:0,mpNextDelay:Math.floor(rnd(2,5)),topicCount:0,watchdogFails:0};
let sessionCacheLoaded = false;
let initDoneEarly = false;

  try {
    if(typeof GM !== 'undefined' && GM.addValueChangeListener){
      GM.addValueChangeListener(STORE_CONF, async () => {
        try { await loadConf(true); }
        catch (e) { console.error('loadConf failed', e); }
      });
      GM.addValueChangeListener(STORE_ON, (_, __, v)=>{ onCache = v; updateSessionUI().catch(console.error); });
      GM.addValueChangeListener(STORE_SESSION, (_, __, v)=>{ sessionCache = v; sessionCacheLoaded = true; updateSessionUI().catch(console.error); });
    } else {
      throw new Error('GM.addValueChangeListener unavailable');
    }
  } catch (e) {
    console.error('GM.addValueChangeListener setup failed', e);
  } finally {
    try { await loadConf(true); }
    catch (e) { console.error('loadConf failed', e); }
    onCache = await get(STORE_ON,false);
    await ensureDefaults();
    await updateSessionUI();
  }

  const pendingLogin = await get(STORE_PENDING_LOGIN,false);
  if(pendingLogin){
    await set(STORE_PENDING_LOGIN,false);
    location.href='https://www.jeuxvideo.com/login';
    return;
  }

  async function ensureDefaults(){
    const cfg = await loadConf();
    let changed = false;
    if(!cfg.templates || !cfg.templates.length){
      cfg.templates = DEFAULTS.templates.slice();
      changed = true;
    }
    if(!Array.isArray(cfg.accounts)){
      cfg.accounts = [];
      changed = true;
    }
    if(!cfg.accounts.length){
      if(cfg.accountIdx !== 0){ cfg.accountIdx = 0; changed = true; }
    } else if(cfg.accountIdx >= cfg.accounts.length){
      cfg.accountIdx = 0;
      changed = true;
    }
    if(changed) await saveConf(cfg);
  }
  
  async function checkCdnResources(box){
    const domains=['cdn.lib.getjan.io','cdn.lib.getjad.io'];
    let ok=true;
    for(const d of domains){
      const hasScript=!!document.querySelector(`script[src*="${d}"]`);
      try{
        await fetch(`https://${d}/`,{mode:'no-cors'});
      }catch(e){
        ok=false;
      }
      if(!hasScript) ok=false;
    }
    if(!ok && box){
      console.warn('[Post Walker] Required libraries unreachable. Check blockers/firewall.');
      if(!q('#jvc-postwalker-libwarn')){
        const warn=document.createElement('div');
        warn.id='jvc-postwalker-libwarn';
        warn.textContent='Post Walker: required libraries blocked? Check blockers or firewall.';
        Object.assign(warn.style,{
          position:'fixed',top:'0',left:'0',right:'0',
          background:'#fdd',color:'#900',padding:'4px',textAlign:'center',
          zIndex:2147483647
        });
        document.body.appendChild(warn);
      }
      const uiWarn=document.createElement('div');
      uiWarn.textContent='Accès aux librairies getjan.io/getjad.io impossible. Certaines fonctionnalités peuvent ne pas marcher.';
      Object.assign(uiWarn.style,{color:'#f55',marginTop:'6px',fontWeight:'bold'});
      box.appendChild(uiWarn);
    }
  }

    /**
   * Fill and submit the login form on jeuxvideo.com using the currently
   * selected account from the script configuration. It looks for the
   * username and password fields using the selectors
   * `input[name="login_pseudo"]` and `input[name="login_password"]`
   * respectively. The function assumes the login page wraps these inputs
   * inside a standard HTML `<form>` element whose submission triggers the
   * authentication flow. Credentials are retrieved from local storage
   * managed via Tampermonkey's `GM.getValue`/`GM.setValue` APIs.
   */
 function hasCloudflareCaptcha(){
   return q('#cf-challenge, .cf-turnstile, iframe[title*="Cloudflare" i]');
 }

  async function autoLogin(){
    if(loginAttempted) return;
    loginAttempted=true;
    const blocked = await get(STORE_LOGIN_BLOCKED,false);
    if(blocked){
      console.warn('autoLogin: blocked after repeated failures');
      return;
    }
    const blockUntil = await get(STORE_LOGIN_REFUSED,0);
    const remaining = blockUntil - NOW();
    if(remaining>0){
      console.warn('autoLogin: login recently refused');
      clearTimeout(loginReloadTimeout);
      loginReloadTimeout=setTimeout(()=>location.reload(),remaining);
      return;
    }
    // clear any pending reload attempts from previous runs
    if(loginReloadTimeout){ clearTimeout(loginReloadTimeout); loginReloadTimeout=null; }
    if(hasCloudflareCaptcha()){
      const retries = await get(STORE_CF_RETRIES,0);
      if(retries>=3){
        console.warn('autoLogin: Cloudflare challenge limit reached');
        return;
      }
      await set(STORE_CF_RETRIES,retries+1);
      await dwell();
      clearTimeout(loginReloadTimeout);
      loginReloadTimeout=setTimeout(()=>location.reload(),0);
      return;
    }
    await set(STORE_CF_RETRIES,0);
    const cfg = Object.assign({}, DEFAULTS, await loadConf());
   const account = cfg.accounts?.[cfg.accountIdx];
    if(!account) return;
    const pseudoEl = q('input[name="login_pseudo"]');
    const passEl = q('input[name="login_password"]');
    if(!pseudoEl || !passEl) return;
    if(pseudoEl.value !== account.user || passEl.value !== account.pass){
      setValue(pseudoEl, '');
      setValue(passEl, '');
      await dwell(2000, 3000);
      await typeHuman(pseudoEl, account.user);
      await typeHuman(passEl, account.pass);
    }
    if(pseudoEl.value !== account.user || passEl.value !== account.pass){
      console.warn('autoLogin: credential fill mismatch');
      return;
    }
    const form = pseudoEl.closest('form') || passEl.closest('form');
    if(!form){
      console.warn('autoLogin: form not found');
      return;
    }
    await dwell();
    const btn = form.querySelector('button[type="submit"], input[type="submit"]');
    try{
      await humanHover(btn || form);
      if(btn){
        btn.click();
      }else if(form.requestSubmit){
        form.requestSubmit();
      }else{
        console.warn('autoLogin: no submission mechanism found');
      }
      const deadline = NOW() + 15000;
      let sandboxCount = 0;
      let sandboxSeen = 0;
      while(NOW() < deadline && /login/i.test(location.pathname)){
        await sleep(250);
        const cf=q('#cf-challenge, .cf-turnstile');
        const currentSandbox=qa('iframe[sandbox]').length;
        if(!cf && currentSandbox > sandboxCount){
          sandboxCount = currentSandbox;
          sandboxSeen++;
          if(sandboxSeen >= 3){
            clearTimeout(loginReloadTimeout);
            loginReloadTimeout=null;
            alert('autoLogin: Cloudflare challenge impossible, intervention requise');
            console.warn('autoLogin: Cloudflare challenge blocked');
            return;
          }
        }
        if(cf){
          const retries = await get(STORE_CF_RETRIES,0);
          if(retries>=3){
            console.warn('autoLogin: Cloudflare challenge limit reached');
          }else{
            await set(STORE_CF_RETRIES,retries+1);
            await dwell();
            clearTimeout(loginReloadTimeout);
            loginReloadTimeout=setTimeout(()=>location.reload(),0);
          }
          return;
        }
        const errEl=q('.alert--error, .alert.alert-danger, .msg-error, .alert-warning');
        if(errEl && /Votre tentative de connexion a été refusée/i.test(errEl.textContent)){
          const attempts=(await get(STORE_LOGIN_ATTEMPTS,0))+1;
          await set(STORE_LOGIN_ATTEMPTS,attempts);
          if(attempts>=2){
            await set(STORE_LOGIN_BLOCKED,true);
            await set(STORE_LOGIN_REFUSED,0);
            clearTimeout(loginReloadTimeout);
            console.warn('autoLogin: login refused, blocking auto retries');
            return;
          }
          const delay=rnd(10*60*1000,11*60*1000);
          await set(STORE_LOGIN_REFUSED,NOW()+delay);
          clearTimeout(loginReloadTimeout);
          loginReloadTimeout=setTimeout(()=>location.reload(),delay);
          console.warn('autoLogin: login refused, delaying retry');
          return;
        }
      }
      const errEl=q('.alert--error, .alert.alert-danger, .msg-error, .alert-warning');
      if(errEl && /Votre tentative de connexion a été refusée/i.test(errEl.textContent)){
        const attempts=(await get(STORE_LOGIN_ATTEMPTS,0))+1;
        await set(STORE_LOGIN_ATTEMPTS,attempts);
        if(attempts>=2){
          await set(STORE_LOGIN_BLOCKED,true);
          await set(STORE_LOGIN_REFUSED,0);
          clearTimeout(loginReloadTimeout);
          console.warn('autoLogin: login refused, blocking auto retries');
          return;
        }
        const delay=rnd(10*60*1000,11*60*1000);
        await set(STORE_LOGIN_REFUSED,NOW()+delay);
        clearTimeout(loginReloadTimeout);
        loginReloadTimeout=setTimeout(()=>location.reload(),delay);
        console.warn('autoLogin: login refused, delaying retry');
        return;
      }
      if(/login/i.test(location.pathname) && !errEl){
        const attempts=(await get(STORE_LOGIN_ATTEMPTS,0))+1;
        await set(STORE_LOGIN_ATTEMPTS,attempts);
        const delay=attempts===1 ? rnd(10*60*1000,11*60*1000) : rnd(5*60*1000,6*60*1000);
        await set(STORE_LOGIN_REFUSED,NOW()+delay);
        clearTimeout(loginReloadTimeout);
        loginReloadTimeout=setTimeout(()=>location.reload(),delay);
        console.warn('autoLogin: login page unchanged, delaying retries');
        return;
      }
      await set(STORE_LOGIN_ATTEMPTS,0);
      await set(STORE_LOGIN_BLOCKED,false);
      await set(STORE_LOGIN_REFUSED,0);
      }
    catch(err){
      console.error('autoLogin: submission failed', err);
    }
  }
    if(typeof window !== 'undefined') window.autoLogin = autoLogin;

    /* ---------- forums + weighted choice ---------- */
    const FORUMS = {
      '51':      { name:'18-25',               list:'https://www.jeuxvideo.com/forums/0-51-0-1-0-1-0-blabla-18-25-ans.htm' },
      '36':      { name:'Guerre des consoles', list:'https://www.jeuxvideo.com/forums/0-36-0-1-0-1-0-guerre-des-consoles.htm' },
      '20':      { name:'Football',            list:'https://www.jeuxvideo.com/forums/0-20-0-1-0-1-0-football.htm' },
      '3011927': { name:'Finance',             list:'https://www.jeuxvideo.com/forums/0-3011927-0-1-0-1-0-finance.htm' }
    };
    const ALLOWED_FORUMS = new Set(Object.keys(FORUMS));
    const FORUM_WEIGHTS = [
      { fid:'51', weight:0.80 },
      { fid:'36', weight:0.10 },
      { fid:'20', weight:0.05 },
      { fid:'3011927', weight:0.05 }
    ];
    function pickForumIdWeighted(){
      const r = Math.random();
      let cum = 0;
      for(const {fid, weight} of FORUM_WEIGHTS){
        cum += weight;
        if(r < cum) return fid;
      }
      return FORUM_WEIGHTS[0].fid;
    }
    function pickListWeighted(){ const fid=pickForumIdWeighted(); return FORUMS[fid].list; }

    if (isLoginPage()) {
    if (onCache && !(await get(STORE_LOGIN_BLOCKED,false))) await autoLogin();
    } else {
      await set(STORE_LOGIN_ATTEMPTS,0);
      await set(STORE_LOGIN_BLOCKED,false);
      await set(STORE_LOGIN_REFUSED,0);
    }

    try {
      await buildAndAutoStart();
      initDoneEarly = true;
    }
    catch(err){ console.error('[Post Walker] init failed', err); }

  async function setTargetForum(fid){ await set(STORE_TARGET_FORUM, {fid, ts:NOW()}); }
  async function getTargetForum(){ const o=await get(STORE_TARGET_FORUM,null); if(!o) return null; if(NOW()-o.ts>10*60*1000){ await set(STORE_TARGET_FORUM,null); return null; } return o.fid||null; }

  async function clearTargetForum(){ await set(STORE_TARGET_FORUM,null); }

  function myPseudo(){
  const selectors=[
    '.headerAccount__pseudo',
    '.account__pseudo',
    'a.headerAccount__user',
    '[data-testid="account-pseudo"]',
    '[data-testid="account-pseudo"]',
    'span[data-testid="account-pseudo"]',
    '[data-testid="user-account-menu"] span[data-testid="account-pseudo"]'
  ];
    for(const sel of selectors){
    const t=q(sel)?.textContent?.trim();
    if(t) return t;
  }
  const m=document.cookie.match(/(?:^|;\s*)md_mid=([^;]+)/);
  if(m){
    try{
      const pseudo=decodeURIComponent(m[1]);
      if(pseudo) return pseudo;
    }catch(e){ log('[myPseudo cookie]', e); }
  }
  try{
    const st=typeof window!=='undefined'?window.__REDUX_STATE__:null;
    if(st){
      const findPseudo=(obj,seen=new Set())=>{
        if(!obj||typeof obj!=='object'||seen.has(obj)) return '';
        seen.add(obj);
        if(typeof obj.pseudo==='string'&&obj.pseudo.trim()) return obj.pseudo.trim();
        for(const k of Object.keys(obj)){
          const res=findPseudo(obj[k],seen);
          if(res) return res;
        }
        return '';
      };
      const pseudo=findPseudo(st);
      if(pseudo) return pseudo;
    }
  }catch(e){ log('[myPseudo redux]', e); }
  const hasSession = document.cookie.includes('md_sid=');
  log(`Username not found${hasSession ? ' — session detected' : ' — no session detected'}.`);
  return '';
  }
  const rand32 = () => {
    if (typeof window !== 'undefined' && window.crypto?.getRandomValues) {
      const u32 = new Uint32Array(1);
      window.crypto.getRandomValues(u32);
      return u32[0];
    }
    return Math.floor(Math.random() * 0x100000000);
  };

  const randInt = max => {
    if (max <= 0) return 0;
    const limit = Math.floor(0x100000000 / max) * max;
    let u;
    do { u = rand32(); } while (u >= limit);
    return u % max;
  };

  const randomPick = arr => (Array.isArray(arr) && arr.length>0) ? arr[randInt(arr.length)] : undefined;
  const shuffle = arr => { for(let i=arr.length-1;i>0;i--){ const j=randInt(i+1); [arr[i],arr[j]]=[arr[j],arr[i]]; } return arr; };

  /* ---------- URL helpers + forum-list page parsing ---------- */
  function getTopicInfoFromPath(pathname){
    const m = pathname.match(/\/forums\/\d+-(\d+)-(\d+)-(\d+)-\d+-\d+-.*\.htm/i);
    if(!m) return {forumId:null, topicId:null, page:NaN};
    return {forumId:m[1], topicId:m[2], page:+m[3]};
  }
  function getInfoFromHref(href){
    try{ const u=new URL(href, ORIG); return getTopicInfoFromPath(u.pathname); }
    catch(e){ console.error('[getInfoFromHref]', e); return {forumId:null, topicId:null, page:NaN}; }
  }
  function currentTopicInfo(){ return getTopicInfoFromPath(location.pathname); }

  function getListInfoFromPath(pathname, search){
    const m = pathname.match(/\/forums\/0-(\d+)-0-(\d+)-\d+-\d+-\d+-/i);
    const fid = m ? m[1] : null;
    let page = m ? parseInt(m[2],10) : NaN;
    const mQ = (search||'').match(/[?&]page=(\d+)/i);
    if(mQ){ const qp = parseInt(mQ[1],10); if(!isNaN(qp)) page = qp; }
    return {fid, page};
  }
  function listForumIdFromPath(pathname){ return getListInfoFromPath(pathname, location.search).fid; }
  function pageIsAllowed(){
    if(isTopicPage()){
      const {forumId}=currentTopicInfo();
      return forumId && ALLOWED_FORUMS.has(forumId);
    }
    if(isForumList()){
      const {fid}=getListInfoFromPath(location.pathname, location.search);
      return fid && ALLOWED_FORUMS.has(fid);
    }
    return false;
  }
  function forumListPageOneURL(fid){
    return FORUMS[fid]?.list || pickListWeighted();
  }
  function normalizeListToPageOne(href){
    try{
      const u=new URL(href, ORIG);
      const {fid} = getListInfoFromPath(u.pathname, u.search);
      return fid && ALLOWED_FORUMS.has(fid) ? forumListPageOneURL(fid) : pickListWeighted();
    }catch(e){ console.error('[normalizeListToPageOne]', e); return pickListWeighted(); }
  }

  /* ---------- pagination : max-number (same topicId) ---------- */
  function findMaxPageLinkForCurrentTopic(){
    const {topicId} = currentTopicInfo();
    if(!topicId) return {el:null, num:NaN, abs:null};
    let best={el:null,num:NaN,abs:null};
    const anchors=qa('a[href*="/forums/"]');
    for(const a of anchors){
      const href=a.getAttribute('href'); if(!href) continue;
      const info=getInfoFromHref(href);
      if(info.topicId!==topicId) continue;
      const txt=(a.textContent||'').trim();
      let n = /^\d+$/.test(txt) ? parseInt(txt,10) : info.page;
      if(!isNaN(n) && (isNaN(best.num) || n>best.num)){
        try{ best={el:a,num:n,abs:new URL(href,ORIG).href}; }
        catch(e){ console.error('[findMaxPageLinkForCurrentTopic] URL parse', e); }
      }
    }
    return best;
  }
  const navGuardMap = {};
  function navGuardOk(targetHref){
    const now=NOW();
    const g=navGuardMap[targetHref];
    if(!g || (now-g.ts)>15000){
      navGuardMap[targetHref]={tries:1,ts:now};
      return true;
    }
    if(g.tries>=3){
      g.ts=now;
      log(`[Last] Abort after ${g.tries} tries`);
      return false;
    }
    g.tries+=1;
    g.ts=now;
    return true;
  }
  async function ensureAtLastPage(){
    const best=findMaxPageLinkForCurrentTopic();
    if(!best.el || isNaN(best.num)){ log('No pagination → stay.'); return true; }
    const cur=currentTopicInfo().page;
    log(`Page=${cur} | Max=${best.num}`);
    if(!isNaN(cur) && cur>=best.num) return true;
    if(best.abs && navGuardOk(best.abs)){
      await humanHover(best.el);
      best.el.setAttribute('target','_self');
      best.el.click();
      setTimeout(()=>{ if(location.href!==best.abs) location.href=best.abs; }, 600);
      return false;
    }
    return true;
  }

  /* ---------- error helpers ---------- */
  function hasVisibleError(){ return !!q('.alert--error, .alert.alert-danger, .msg-error, .alert-warning'); }
    function reachedDailyLimit() {
    const el = q('.alert--error, .alert.alert-danger, .msg-error, .alert-warning');
    return el && /limite.*messages.*journ/i.test(el.textContent);
  }
    async function reachedDailyLimitAsync() {
    const resp = await fetch(location.href, {credentials:'include'});
    const html = await resp.text();
    return /limite.*messages.*journ/i.test(html);
  }
  async function handleTopicPage(template){
    const currentUrl = location.href;
    let watchdog;
    const WATCHDOG_MS = 26000;
    try{
      await sessionGet();
      sessionCache.postedByUser = sessionCache.postedByUser || {};
      const cfg = Object.assign({}, DEFAULTS, await loadConf());
      const user = cfg.accounts[cfg.accountIdx]?.user;
      const limit = sessionCache.maxTopicPosts || cfg.maxTopicPosts;
      if(limit && sessionCache.topicCount >= limit){
        log('Post limit reached → switching account.');
        await switchAccount();
        return 'switch';
      }
        const locked = document.body.innerText.includes('Sujet fermé pour la raison suivante')
        || q('.topic-lock, .message-topic-lock');
      if(locked){
        log('Topic locked → back to list.');
        const lastList = await get(STORE_LAST_LIST, pickListWeighted());
        location.href = lastList;
        return false;
      }
      const openerSel='.btn-repondre, .btn-repondre-msg, .jv-editor-open-btn, .btn-poster-msg';
      const zoneSel='textarea[name="message_topic"], textarea[name="message"], #bloc-formulaire-forum textarea[name="texte"], .jv-editor [contenteditable="true"]';
      let zone=q(zoneSel);
      if(!zone){
        let opener=q(openerSel) || qa('#bloc-formulaire-forum button').find(b=>b.offsetParent);
        if(opener){
          opener.click();
          const end=NOW()+6000;
          while(!(zone=q('#bloc-formulaire-forum textarea[name="texte"], .jv-editor [contenteditable="true"]')) && NOW()<end){ await sleep(200); }
        }
      }
      if(!zone){
        const form=q('form[name="formulaire"]')||q('form');
        if(form && !q('textarea',form)){
          const ta=document.createElement('textarea');
          ta.name='message';
          ta.style.display='none';
          form.appendChild(ta);
          zone=ta;
        }
      }
      if(!zone){
        log('No message box found.');
        const lastList = await get(STORE_LAST_LIST, pickListWeighted());
        location.href = lastList;
        return false;
      }
      await human();
      zone.focus?.();
      await humanHover(zone);
      setValue(zone,'');
      await typeMixed(zone, template);
      await dwell(800,1400);
      const beforeMsgs=qa('.bloc-message-forum').length;
      const prevUrl=location.href;
      const postBtn = q('.postMessage__icon.icon-post-message, .jv-editor-submit, button[data-testid="submit"], .btn-poster-msg, input[type="submit"]');
      const { topicId: pendingTopicId } = currentTopicInfo();
      await set(STORE_PENDING_POST, { topicId: pendingTopicId, ts: NOW() });
      await humanHover(postBtn);
      postBtn?.click();
      watchdog = setTimeout(async () => {
        if(location.href === currentUrl){
          log('Watchdog timeout → back to list.');
          sessionCache.watchdogFails = (sessionCache.watchdogFails || 0) + 1;
          if(sessionCache.watchdogFails >= 3){
            sessionCache.cooldownUntil = NOW() + rnd(120000, 180000);
            sessionCache.watchdogFails = 0;
          } else {
            sessionCache.cooldownUntil = NOW() + rnd(25000, 35000);
          }
          await set(STORE_SESSION, sessionCache);
          const lastList = await get(STORE_LAST_LIST, pickListWeighted());
          sessionCache.cooldownUntil = NOW() + rnd(25000, 35000);
          await set(STORE_SESSION, sessionCache);
          location.href = lastList;
        }
      }, WATCHDOG_MS);
      let ok=false;
      const end=NOW()+WATCHDOG_MS;
      while(NOW()<end){
        await sleep(300);
        if(location.href!==prevUrl || qa('.bloc-message-forum').length>beforeMsgs){ ok=true; break; }
        if(hasVisibleError()) break;
      }
      const success = ok && !hasVisibleError();
      if(!success && reachedDailyLimit()){
        log('Daily limit reached → switching account.');
        await switchAccount();
        return 'switch';
      }
      if(success){
        clearTimeout(watchdog);
        sessionCache.topicCount = (sessionCache.topicCount||0) + 1;
        sessionCache.watchdogFails = 0;
        const { topicId } = currentTopicInfo();
        await set(STORE_PENDING_POST, null);
        sessionCache.postedTopics = sessionCache.postedTopics || [];
        if(topicId && !sessionCache.postedTopics.includes(topicId)){
          sessionCache.postedTopics.push(topicId);
        }
        if(topicId && user){
          const list = sessionCache.postedByUser[user] ||= [];
          if(!list.includes(topicId)) list.push(topicId);
        }
        sessionCache.cooldownUntil = NOW() + rnd(25000, 35000);
        await set(STORE_SESSION, sessionCache);
        if (await reachedDailyLimitAsync()) {
          log('Daily limit reached → switching account.');
          await switchAccount();
          return 'switch';
        }
        if(sessionCache.topicCount >= cfg.maxTopicPosts){
          log('Post limit reached → switching account.');
          await switchAccount();
          return 'switch';
        }
        const lastList = await get(STORE_LAST_LIST, pickListWeighted());
        window.location.assign(lastList);
        return 'posted';
      }
      return false;
    }catch(e){ console.error('[handleTopicPage]', e); return false; }
  }

    async function postTemplateToTopic(template){
    try{
      let zone = q('textarea[name="message"], .jv-editor [contenteditable="true"]');
      if(!zone){
        const opener = q('.postMessage__icon.icon-post-message');
        if(opener){
          opener.click();
        } else {
          q('#bloc-formulaire-forum')?.scrollIntoView({behavior:'smooth',block:'center'});
        }
        const end = NOW()+6000;
        while(!(zone = q('textarea[name="message"], .jv-editor [contenteditable="true"]')) && NOW() < end){
          await sleep(200);
        }
      }
      if(!zone) return false;
      await human();
      zone.focus?.();
      await humanHover(zone);
      setValue(zone,'');
      await typeMixed(zone, template);
      await dwell(800,1400);
      const postBtn = q('.jv-editor-submit, button[data-testid="submit"], .btn-poster-msg, input[type="submit"]');
      await humanHover(postBtn);
      postBtn?.click();
      return true;
    }catch(e){
      console.error('[postTemplateToTopic]', e);
      return false;
    }
  }

  async function switchAccount(){
    await ensureDefaults();
    const cfg = Object.assign({}, DEFAULTS, await loadConf());
    if(!Array.isArray(cfg.accounts) || cfg.accounts.length===0){
      console.error('[switchAccount] no accounts configured');
      log('No accounts configured — nothing to switch.');
      try{
        if(typeof confirm==='function' && confirm('No accounts configured. Open configuration UI to add one?')){
          await ensureUI();
        }
      }catch(e){
        console.error('[switchAccount] ensureUI failed', e);
      }
      return;
    }
    const avatar = q('.headerAccount__link');
    if(!avatar) return;
    await humanHover(avatar);
    avatar.click();
    await dwell(400,800);
    const logoutLink = q('.headerAccount__dropdownContainerBottom .headerAccount__button:last-child');
    if(!logoutLink){
      console.error('[switchAccount] logout link not found');
      log('Logout link not found — aborting rotation.');
      return;
    }
    const current = (cfg.accountIdx || 0) % cfg.accounts.length;
    cfg.accountIdx = (current + 1) % cfg.accounts.length;
    await saveConf(cfg);
    try { await sessionGet(); }
    catch (e) { console.error('sessionGet failed', e); }
    sessionCache.topicCount = 0;
    sessionCache.postedTopics = [];
    await set(STORE_SESSION, sessionCache);
    await updateSessionUI();
    await set(STORE_PENDING_LOGIN,true);

    await humanHover(logoutLink);
    await dwell();
    logoutLink.click();
    await new Promise(res=>{
      const check=()=>{ if(/\/login/i.test(location.pathname)) res(); else setTimeout(check,200); };
      check();
    });
  }

  /* ---------- session (timer only) ---------- */
  async function sessionGet(){
    if(!sessionCacheLoaded){ sessionCache = await get(STORE_SESSION,sessionCache); sessionCacheLoaded = true; }
    if(!Array.isArray(sessionCache.postedTopics)) sessionCache.postedTopics = [];
    if(!Array.isArray(sessionCache.templatePool)) sessionCache.templatePool = [];
    if(typeof sessionCache.maxTopicPosts !== 'number') sessionCache.maxTopicPosts = 0;
    if(typeof sessionCache.startOrigin !== 'string') sessionCache.startOrigin = '';
    if(typeof sessionCache.watchdogFails !== 'number') sessionCache.watchdogFails = 0;
    return sessionCache;
  }
  async function sessionStart(){
    try { await sessionGet(); }
    catch (e) { console.error('sessionGet failed', e); }
    sessionCache.startOrigin = location.origin;
    const cfg = Object.assign({}, DEFAULTS, await loadConf());
    if(!myPseudo()){
      log('Username not found — session started anyway.');
    }
    const wasActive = sessionCache.active;
    if(!sessionCache.active || !sessionCache.startTs) sessionCache.startTs = NOW();
    sessionCache.active = true;
    sessionCache.stopTs = 0;
    sessionCache.maxTopicPosts = cfg.maxTopicPosts;
    if(!wasActive){ sessionCache.topicCount = 0; sessionCache.postedTopics = []; }
    if(!Array.isArray(sessionCache.templatePool) || !sessionCache.templatePool.length){
      sessionCache.templatePool = shuffle([...cfg.templates]);
    }
    await set(STORE_SESSION, sessionCache);
    startTimerUpdater().catch(console.error);
  }
  async function sessionStop(){
    try { await sessionGet(); }
    catch (e) { console.error('sessionGet failed', e); }
    sessionCache.active=false;
    sessionCache.stopTs=NOW();
    await set(STORE_SESSION,sessionCache);
    clearInterval(timerHandle); timerHandle=null;
    await updateSessionUI().catch(console.error);
  }
  function formatHMS(ms){
    const sec=Math.floor(ms/1000);
    const h=Math.floor(sec/3600), m=Math.floor((sec%3600)/60), s=sec%60;
    const pad=n=>String(n).padStart(2,'0');
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
  }
  async function updateSessionUI(){
    if (updating) return;
    updating = true;
    try {
      const s=await sessionGet();
      let ms=0;
      if(s.startTs){
        if(s.active) ms = NOW()-s.startTs;
        else if(s.stopTs) ms = Math.max(0,s.stopTs - s.startTs);
        else ms = NOW()-s.startTs;
      }
      if(!chronoEl) chronoEl = q('#jvc-postwalker-chrono');
      if(chronoEl) chronoEl.textContent = formatHMS(ms);
      if(!statusEl) statusEl = q('#jvc-postwalker-status');
      if(statusEl){
        const on = onCache && s.active;
        statusEl.textContent = on?'ON':'OFF';
        statusEl.style.color = on?'#32d296':'#bbb';
      }

      const c = await getFullConf();
      const limit = s.maxTopicPosts || c.maxTopicPosts;
      if(!postCountEl) postCountEl = q('#jvc-postwalker-postcount');
      if(postCountEl){
        const current = s.topicCount || 0;
        postCountEl.textContent = limit ? `${current}/${limit}` : `${current}`;
      }
      const startEl = q('#jvc-postwalker-active-start');
      if(startEl) startEl.value = c.activeHours[0];
      const endEl = q('#jvc-postwalker-active-end');
      if(endEl) endEl.value = c.activeHours[1];
      const maxEl = q('#jvc-postwalker-max-posts');
      if(maxEl) maxEl.value = limit || 0;
      const accSel = q('#jvc-postwalker-account-select');
      if(accSel) accSel.value = String(c.accountIdx||0);
    } finally {
      updating = false;
    }
  }
  async function startTimerUpdater(){
    if(timerHandle) clearInterval(timerHandle);
    await getFullConf();
    timerHandle=setInterval(()=>{updateSessionUI().catch(console.error);},1000);
    updateSessionUI().catch(console.error);
  }

  /* ---------- scheduler ---------- */
  async function tickSoon(ms=300){
    const cfg = Object.assign({}, DEFAULTS, await loadConf());
    const [startHour,endHour]=cfg.activeHours;
    const now=new Date();
    const h=now.getHours();
    if(h<startHour||h>=endHour){
      await sessionStop();
      const next=new Date(now);
      if(h>=endHour) next.setDate(next.getDate()+1);
      next.setHours(startHour,0,0,0);
      const delay=next.getTime()-now.getTime();
      setTimeout(()=>{ tickSoon(ms).catch(console.error); }, delay);
      return;
    }
    setTimeout(() => { tick().catch(console.error); }, ms);
  }
  async function tick(){
    if (ticking) return;
    ticking = true;
    try {
    const s = await sessionGet();
    sessionCache.postedByUser = sessionCache.postedByUser || {};
    if(!onCache || !s.active) return;
    if(sessionCache.detourReturn){
      window.scrollTo({top: rnd(0, document.body.scrollHeight), behavior: 'smooth'});
      await randomScrollWait(2000, 5000);
      const back = sessionCache.detourReturn;
      delete sessionCache.detourReturn;
      await set(STORE_SESSION, sessionCache);
      location.href = back;
      return;
    }
    const cfg = Object.assign({}, DEFAULTS, await loadConf());
    const user = cfg.accounts[cfg.accountIdx]?.user;

    // 1) enforce forum scope with weighted target
    if(!pageIsAllowed()){
      const fid = pickForumIdWeighted(); await setTargetForum(fid);
      const target = FORUMS[fid].list;
      log(`Outside allowed forums → redirecting to ${FORUMS[fid].name} (page 1).`);
      location.href=target; return;
    }

   // 2) standard flow
    if(isTopicPage()){
      const {forumId, topicId}=currentTopicInfo();
      if(!ALLOWED_FORUMS.has(forumId)){ const fid = pickForumIdWeighted(); await setTargetForum(fid); location.href=FORUMS[fid].list; return; }
      await sessionGet();
      sessionCache.postedByUser = sessionCache.postedByUser || {};
      if(topicId){
        const list = sessionCache.postedByUser[user] || [];
        if(list.includes(topicId)){
          const lastList = await get(STORE_LAST_LIST, pickListWeighted());
          location.href = lastList;
          return;
        }
      }
      const failed = await get(STORE_TOPIC_FAILS, {});
      if(topicId){
        const f = failed[topicId];
        if(f && f.until && NOW() < f.until){
          log('Topic temporarily blacklisted → back to list.');
          const lastList = await get(STORE_LAST_LIST, pickListWeighted());
          location.href = lastList;
          return;
        }
        if(f && f.until && NOW() >= f.until){
          delete failed[topicId];
          await set(STORE_TOPIC_FAILS, failed);
        }
        if(sessionCache.postedTopics.includes(topicId)){
          const lastList = await get(STORE_LAST_LIST, pickListWeighted());
          location.href = lastList;
          return;
        }
      }
      const pending = await get(STORE_PENDING_POST, null);
      if(pending && pending.topicId === topicId && NOW() - pending.ts <= 30000){
        await set(STORE_PENDING_POST, null);
        sessionCache.postedTopics = sessionCache.postedTopics || [];
        if(topicId && !sessionCache.postedTopics.includes(topicId)){
          sessionCache.postedTopics.push(topicId);
        }
        if(topicId && user){
          const list = sessionCache.postedByUser[user] ||= [];
          if(!list.includes(topicId)) list.push(topicId);
        }
        await set(STORE_SESSION, sessionCache);
        const lastList = await get(STORE_LAST_LIST, pickListWeighted());
        location.href = lastList;
        return;
      }
      const atLast = await ensureAtLastPage();
      await dwell(800,2000);
      await randomScrollWait(0, estimateReadingTime(document.body));

      const templates = cfg.templates || [];
      if(!templates.length){
        log('No templates configured → back.');
        const lastList = await get(STORE_LAST_LIST, pickListWeighted());
        location.href = lastList;
        return;
      }
      await sessionGet();
      sessionCache.postedByUser = sessionCache.postedByUser || {};
      if(!Array.isArray(sessionCache.templatePool) || !sessionCache.templatePool.length){
          sessionCache.templatePool = shuffle([...templates]);
        }
        const tpl = sessionCache.templatePool.pop();
        const topicUrlBefore = location.href;
        const result = await handleTopicPage(tpl);
        if(result === 'posted'){
          sessionCache.templatePool = shuffle([...templates]);
          await set(STORE_SESSION, sessionCache);
          if(failed[topicId]){ delete failed[topicId]; await set(STORE_TOPIC_FAILS, failed); }
          await updateSessionUI();
          setTimeout(() => {
            if(location.href === topicUrlBefore) location.href = lastList;
          }, 3000);
          return;
        }
      if(result !== 'switch'){
        const entry = failed[topicId] || {count:0, until:0};
        entry.count++;
        if(entry.count >= TOPIC_FAIL_THRESHOLD){
          entry.count = 0;
          entry.until = NOW() + TOPIC_FAIL_COOLDOWN;
        }
        failed[topicId] = entry;
        await set(STORE_TOPIC_FAILS, failed);
      }
      if(result === 'switch'){
        sessionCache.templatePool = shuffle([...templates]);
        await set(STORE_SESSION, sessionCache);
        await updateSessionUI();
        return;
      }
      await set(STORE_SESSION, sessionCache);
      const lastList = await get(STORE_LAST_LIST, pickListWeighted());
      location.href = lastList;
      return;
      }

    if(isForumList()){
      const info = getListInfoFromPath(location.pathname, location.search);
      if(info.fid && info.page && info.page !== 1){
        const url = forumListPageOneURL(info.fid);
        log(`List on page ${info.page} → forcing page 1.`);
        location.href = url; return;
      }

      let targetF = await getTargetForum();
      const currentF = info.fid;
      if(!targetF){
        targetF = pickForumIdWeighted();
        await setTargetForum(targetF);
        log(`Forum target: ${FORUMS[targetF].name} (weighted)`);
      }
      if(currentF !== targetF){
        log(`Switching to ${FORUMS[targetF].name} (weighted target, page 1).`);
        location.href = FORUMS[targetF].list; return;
      }
      
      window.scrollTo({top: rnd(0, document.body.scrollHeight), behavior: 'smooth'});
      await randomScrollWait(0, estimateReadingTime(document.body));
      if(sessionCache.cooldownUntil){
        const remaining = sessionCache.cooldownUntil - NOW();
        if(remaining > 0){
          await randomScrollWait(remaining, remaining + 5000);
          await sessionGet();
          sessionCache.postedByUser = sessionCache.postedByUser || {};
          tickSoon(400); return;
        }
        delete sessionCache.cooldownUntil;
        await set(STORE_SESSION, sessionCache);
      }
      const links=collectTopicLinks(user);
      if(Math.random() < 0.05){
        const candidates = qa('#forum-main-col a[href*="/profil/"], .liste-sujets a[href*="/profil/"], #forum-main-col a[href*="/forums/"][href$=".htm"], .liste-sujets a[href*="/forums/"][href$=".htm"]');
        const misc = candidates.filter(a=>!links.includes(a));
        const detour = randomPick(misc);
        if(detour){
          log(`Random browse → ${(detour.textContent||'').trim().slice(0,80)}`);
          sessionCache.detourReturn = location.href;
          await set(STORE_SESSION, sessionCache);
          detour.setAttribute('target','_self'); detour.click();
          return;
        }
      }
      if(!links.length){ log('Forum list detected but no usable links.'); tickSoon(800); return; }
      const pick=randomPick(links);
      log(`Open topic → ${(pick.textContent||'').trim().slice(0,80)}`);
      await humanHover(pick);
      await clearTargetForum();
      await set(STORE_LAST_LIST, location.href);
      pick.setAttribute('target','_self'); pick.click();
      return;
    }

    // fallback: jump to weighted list (page 1)
    const fid = pickForumIdWeighted(); await setTargetForum(fid);
    location.href=FORUMS[fid].list;
    } finally { ticking = false; }

  }

  function collectTopicLinks(user){
    const all=Array.from(document.querySelectorAll('a[href*="/forums/"][href$=".htm"]'));
    let nodes=all.filter(a=>a.closest('#forum-main-col')||a.closest('.liste-sujets'));
    if(nodes.length===0){ console.warn('[collectTopicLinks] nodes empty, all anchors:', all); nodes=all; }
    console.debug(`[collectTopicLinks] ${nodes.length} links found`);
    const out=[], seen=new Set();
    const mine = myPseudo()?.trim().toLowerCase();
    const posted = sessionCache.postedByUser?.[user] || [];
    for(const a of nodes){
      const href=a.getAttribute('href')||'';
    if(nodes.length===0){ console.warn('[collectTopicLinks] nodes empty, all anchors:', all); nodes=all; }
      let abs, info;
      try{ abs=new URL(href,ORIG).href; info=getInfoFromHref(abs); }catch(e){ console.error('[collectTopicLinks] URL parse', e); console.debug('[collectTopicLinks] invalid URL', href); continue; }
      if(!info || !ALLOWED_FORUMS.has(info.forumId||'')){ console.debug(`[collectTopicLinks] ${!info?'missing info':'forum not allowed'}`, abs); continue; }
      if(seen.has(abs)){ console.debug('[collectTopicLinks] already seen', abs); continue; }
     if(posted.includes(info.topicId)){ console.debug('[collectTopicLinks] already posted', abs); continue; }
      if(mine){
        const row=a.closest('tr, li, div');
        const authorEl=row?.querySelector('[data-testid="topic-author"], .topic-author, .topic-author__name, .topic__pseudo');
        const author=authorEl?.textContent?.trim().toLowerCase();
        if(author && author===mine){ console.debug('[collectTopicLinks] same author', abs); continue; }
      }

      seen.add(abs); out.push(a);
    }
    return out;
  }
  /* ---------- robust compact English UI ---------- */
  async function buildAndAutoStart(){
    const tryUI=async()=>{
      try{
        console.log('[Post Walker] calling ensureUI');
        await ensureUI();
      }catch(e){
        console.error('[Post Walker] UI error', e);
      }
    };
    if (document.readyState === 'loading'){
      document.addEventListener('DOMContentLoaded', tryUI, {once:true});
    } else {
      await tryUI();
    }
    let retries=0;
    let mounting = false;
    const iv=setInterval(async ()=>{
      if(mounting) return;
      mounting = true;
      try {
        if(q('#jvc-postwalker')){
          clearInterval(iv);
        } else {
          await tryUI();
          if(++retries>10) clearInterval(iv);
        }
      } finally {
        mounting = false;
      }
    }, 700);
    if (!onCache || isLoginPage()) return;
    await sessionStart();
    if (!pageIsAllowed()) {
      const fid = pickForumIdWeighted();
      await setTargetForum(fid);
      location.href = FORUMS[fid].list;
      return;
    }
    tickSoon(400);
  }

  async function startHandler(){
    const c=await loadConf();
    if (!c.accounts.length || c.accountIdx >= c.accounts.length) {
      log('No accounts configured — session not started.');
      return;
    }
    const pseudo = myPseudo();
    if(!pseudo){
      log('Username not found — starting anyway.');
    }
    const startEl=q('#jvc-postwalker-active-start');
    const endEl=q('#jvc-postwalker-active-end');
    const maxEl=q('#jvc-postwalker-max-posts');
    const start=parseInt(startEl?startEl.value:c.activeHours[0],10);
    const end=parseInt(endEl?endEl.value:c.activeHours[1],10);
    const max=parseInt(maxEl?maxEl.value:c.maxTopicPosts,10)||0;
    if(max <= 0){
      log('Max topic posts must be greater than 0 — session not started.');
      return;
    }
    await saveConf({ ...c, me:pseudo||c.me, activeHours:[start,end], maxTopicPosts:max });
    try { await sessionGet(); }
    catch (e) { console.error('sessionGet failed', e); }
    sessionCache.maxTopicPosts = max;
    await set(STORE_SESSION, sessionCache);
    await set(STORE_ON,true);
    onCache = true;
    await sessionStart();
    log('Session started.');
    tickSoon(250);
  }

  async function stopHandler(){
    await set(STORE_ON,false);
    onCache = false;
    try { await sessionGet(); }
    catch (e) { console.error('sessionGet failed', e); }
    sessionCache.active = false;
    await set(STORE_SESSION, sessionCache);
    await sessionStop();
    log('Session stopped.');
    try{ location.href='/forums.htm'; }
    catch(e){ /* ignore */ }
    try{
      if(sessionCache.startOrigin && sessionCache.startOrigin !== location.origin){
        location.href='/forums.htm';
      }
    }
    catch(e){ console.error('Redirect after stop', e); }

  }

  async function ensureUI(){
    if(q('#jvc-postwalker')) return;
    await ensureDefaults();
    const conf = Object.assign({}, DEFAULTS, await loadConf());
    if(!conf.me){ conf.me = myPseudo(); await saveConf(conf); }
        if(!conf.me){
      const pseudo = myPseudo();
      if(pseudo){
        conf.me = pseudo;
        await saveConf(conf);
      }
    }

    const box=document.createElement('div');
    box.id='jvc-postwalker';
    Object.assign(box.style,{
      position:'fixed', right:'12px', bottom:'12px', width:'260px',
      background:'#0f1115', color:'#eee', border:'1px solid #333',
      borderRadius:'10px', padding:'8px', zIndex:2147483647,
      boxShadow:'0 8px 24px rgba(0,0,0,.5)',
      font:'12px/1.4 system-ui,Segoe UI,Roboto,Arial'
    });
    const header=document.createElement('div');
    Object.assign(header.style,{display:'flex',alignItems:'center',gap:'8px',marginBottom:'6px'});
    const title=document.createElement('strong');
    title.textContent='JVC POST WALKER';
    Object.assign(title.style,{fontSize:'12px',flex:'1'});
    const status=document.createElement('span');
    status.id='jvc-postwalker-status';
    status.textContent='OFF';
    Object.assign(status.style,{fontWeight:'700',color:'#bbb'});
    statusEl=status;
    header.append(title,status);

    const actions=document.createElement('div');
    Object.assign(actions.style,{display:'flex',alignItems:'center',gap:'8px',margin:'6px 0'});
    const startBtn=document.createElement('button');
    startBtn.id='jvc-postwalker-start';
    startBtn.textContent='Start';
    Object.assign(startBtn.style,{background:'#2a6ef5',border:'0',color:'#fff',padding:'5px 9px',borderRadius:'8px',cursor:'pointer'});
    const stopBtn=document.createElement('button');
    stopBtn.id='jvc-postwalker-stop';
    stopBtn.textContent='Stop';
    Object.assign(stopBtn.style,{background:'#8a2020',border:'0',color:'#fff',padding:'5px 9px',borderRadius:'8px',cursor:'pointer'});
    actions.append(startBtn,stopBtn);
    startBtn.addEventListener('click', startHandler);
    stopBtn.addEventListener('click', stopHandler);

    const hoursWrap=document.createElement('div');
    Object.assign(hoursWrap.style,{display:'flex',alignItems:'center',gap:'4px',margin:'6px 0'});
    const hoursLabel=document.createElement('span');
    hoursLabel.textContent='Active hours';
    const startInput=document.createElement('input');
    startInput.type='number';
    startInput.id='jvc-postwalker-active-start';
    startInput.value=conf.activeHours[0];
    startInput.min='0'; startInput.max='24';
    Object.assign(startInput.style,{width:'40px',background:'#0b0d12',color:'#eee',border:'1px solid #222',borderRadius:'4px'});
    const endInput=document.createElement('input');
    endInput.type='number';
    endInput.id='jvc-postwalker-active-end';
    endInput.value=conf.activeHours[1];
    endInput.min='0'; endInput.max='24';
    Object.assign(endInput.style,{width:'40px',background:'#0b0d12',color:'#eee',border:'1px solid #222',borderRadius:'4px'});
    hoursWrap.append(hoursLabel,startInput,endInput);

    const maxWrap=document.createElement('div');
    Object.assign(maxWrap.style,{display:'flex',alignItems:'center',gap:'4px',margin:'6px 0'});
    const maxLabel=document.createElement('span');
    maxLabel.textContent='Max posts';
    const maxInput=document.createElement('input');
    maxInput.type='number';
    maxInput.id='jvc-postwalker-max-posts';
    maxInput.value=conf.maxTopicPosts||0;
    maxInput.min='0';
  Object.assign(maxInput.style,{width:'60px',background:'#0b0d12',color:'#eee',border:'1px solid #222',borderRadius:'4px'});
  maxWrap.append(maxLabel,maxInput);

    maxInput.addEventListener('change', async ()=>{
      const val=parseInt(maxInput.value,10)||0;
      const c=await loadConf();
      c.maxTopicPosts=val;
      await saveConf(c);
      sessionCache.maxTopicPosts=val;
      await set(STORE_SESSION, sessionCache);
      await updateSessionUI();
    });
    const accountWrap=document.createElement('div');
    Object.assign(accountWrap.style,{display:'flex',alignItems:'center',gap:'4px',margin:'6px 0'});
    const accountLabel=document.createElement('span');
    accountLabel.textContent='Account';
    const accountSelect=document.createElement('select');
    accountSelect.id='jvc-postwalker-account-select';
    Object.assign(accountSelect.style,{flex:'1',background:'#0b0d12',color:'#eee',border:'1px solid #222',borderRadius:'4px'});
    (conf.accounts||[]).forEach((acc,i)=>{
      const opt=document.createElement('option');
      opt.value=String(i);
      opt.textContent=acc.user;
      accountSelect.appendChild(opt);
    });
    accountSelect.value=String(conf.accountIdx||0);
    accountSelect.addEventListener('change', async ()=>{
      const idx=parseInt(accountSelect.value,10)||0;
      const c=Object.assign({}, DEFAULTS, await loadConf());
      c.accountIdx=idx;
      await saveConf(c);
      await updateSessionUI();
    });
    const addAccBtn=document.createElement('button');
    addAccBtn.textContent='Add account';
    addAccBtn.title='Add or edit accounts';
    Object.assign(addAccBtn.style,{background:'#2a6ef5',border:'0',color:'#fff',padding:'2px 6px',borderRadius:'6px',cursor:'pointer'});
    accountWrap.append(accountLabel,accountSelect,addAccBtn);

    const accountMgr=document.createElement('div');
    Object.assign(accountMgr.style,{display:'none',flexDirection:'column',gap:'4px',margin:'4px 0',padding:'4px',background:'#0b0d12',border:'1px solid #222',borderRadius:'8px'});
    const accList=document.createElement('div');
    Object.assign(accList.style,{display:'flex',flexDirection:'column',gap:'2px',maxHeight:'70px',overflowY:'auto'});
    const form=document.createElement('div');
    Object.assign(form.style,{display:'flex',gap:'4px'});
    const userInput=document.createElement('input');
    userInput.placeholder='username';
    Object.assign(userInput.style,{flex:'1',background:'#0b0d12',color:'#eee',border:'1px solid #222',borderRadius:'4px'});
    const passInput=document.createElement('input');
    passInput.type='password';
    passInput.placeholder='password';
    Object.assign(passInput.style,{flex:'1',background:'#0b0d12',color:'#eee',border:'1px solid #222',borderRadius:'4px'});
    const saveAccBtn=document.createElement('button');
    saveAccBtn.textContent='Save';
    saveAccBtn.title='Click Save or press Enter to confirm';
    Object.assign(saveAccBtn.style,{background:'#2a6ef5',border:'0',color:'#fff',padding:'2px 6px',borderRadius:'6px',cursor:'pointer'});
    const handleEnterToSave = e => {
      if (e.key === 'Enter') { e.preventDefault(); saveAccBtn.click(); }
    };
    userInput.addEventListener('keydown', handleEnterToSave);
    passInput.addEventListener('keydown', handleEnterToSave);
    form.append(userInput,passInput,saveAccBtn);
    accountMgr.append(accList,form);
    let editIdx=-1;
    function refreshAccountSelect(){
      accountSelect.innerHTML='';
      (conf.accounts||[]).forEach((acc,i)=>{
        const opt=document.createElement('option');
        opt.value=String(i);
        opt.textContent=acc.user;
        accountSelect.appendChild(opt);
      });
      if(conf.accountIdx>=conf.accounts.length) conf.accountIdx=0;
      accountSelect.value=String(conf.accountIdx||0);
    }
    function populateAccList(){
      accList.innerHTML='';
      (conf.accounts||[]).forEach((acc,i)=>{
        const row=document.createElement('div');
        Object.assign(row.style,{display:'flex',alignItems:'center',gap:'4px'});
        const name=document.createElement('span');
        name.textContent=acc.user;
        Object.assign(name.style,{flex:'1'});
        const editBtn=document.createElement('button');
        editBtn.textContent='Edit';
        Object.assign(editBtn.style,{background:'#555',border:'0',color:'#fff',padding:'1px 4px',borderRadius:'4px',cursor:'pointer'});
        editBtn.addEventListener('click',()=>{ userInput.value=acc.user; passInput.value=acc.pass||''; editIdx=i; });
        const delBtn=document.createElement('button');
        delBtn.textContent='Del';
        Object.assign(delBtn.style,{background:'#8a2020',border:'0',color:'#fff',padding:'1px 4px',borderRadius:'4px',cursor:'pointer'});
        delBtn.addEventListener('click',async ()=>{
          conf.accounts.splice(i,1);
          if(conf.accountIdx>=conf.accounts.length) conf.accountIdx=0;
          await saveConf(conf);
          refreshAccountSelect();
          populateAccList();
        });
        row.append(name,editBtn,delBtn);
        accList.appendChild(row);
      });
    }
    addAccBtn.addEventListener('click',()=>{
      accountMgr.style.display=accountMgr.style.display==='none'?'flex':'none';
      if(accountMgr.style.display!=='none') { populateAccList(); log('Enter username and password then Save. Click Edit to modify or Del to remove.'); }
    });
    saveAccBtn.addEventListener('click', async ()=>{
      const u=userInput.value.trim(), p=passInput.value;
      if(!u){ log('User required.'); return; }
            if (conf.accounts.some(a => a.user === u && editIdx === -1)) {
        log('Account already exists.');
        const existingIdx = conf.accounts.findIndex(a => a.user === u);
        if(existingIdx !== -1) {
          const row = accList.children[existingIdx];
          if(row) {
            row.style.outline='1px solid #2a6ef5';
            row.scrollIntoView({block:'center'});
            setTimeout(()=>row.style.outline='',1000);
          }
          userInput.value = conf.accounts[existingIdx].user;
          passInput.value = conf.accounts[existingIdx].pass || '';
          editIdx = existingIdx;
        }
        return;
      }
      if(editIdx>=0) conf.accounts[editIdx]=p?{user:u,pass:p}:{user:u};
      else conf.accounts.push(p?{user:u,pass:p}:{user:u});
      editIdx=-1;
      userInput.value=''; passInput.value='';
      await saveConf(conf);
      refreshAccountSelect();
      populateAccList();
      log('Account saved');
    });
    
    let loginWrap=null;
    if(isLoginPage()){
      loginWrap=document.createElement('div');
      Object.assign(loginWrap.style,{display:'flex',alignItems:'center',gap:'4px',margin:'6px 0'});
      const retryBtn=document.createElement('button');
      retryBtn.textContent='Retry login';
      Object.assign(retryBtn.style,{background:'#2a6ef5',border:'0',color:'#fff',padding:'2px 6px',borderRadius:'6px',cursor:'pointer'});
      retryBtn.addEventListener('click',async ()=>{
        await set(STORE_LOGIN_ATTEMPTS,0);
        await set(STORE_LOGIN_BLOCKED,false);
        await set(STORE_LOGIN_REFUSED,0);
        loginAttempted=false;
        await autoLogin();
      });
      loginWrap.append(retryBtn);
    }

    const chronoWrap=document.createElement('div');
    Object.assign(chronoWrap.style,{display:'flex',alignItems:'center',gap:'4px',marginBottom:'4px',fontVariantNumeric:'tabular-nums'});
    const chronoLabel=document.createElement('span');
    chronoLabel.textContent='⏱';
    const chrono=document.createElement('span');
    chrono.id='jvc-postwalker-chrono';
    chrono.textContent='00:00:00';
    chronoEl=chrono;
    const postCount=document.createElement('span');
    postCount.id='jvc-postwalker-postcount';
    postCount.textContent = conf.maxTopicPosts ? `0/${conf.maxTopicPosts}` : '0';
    postCountEl=postCount;
    chronoWrap.append(chronoLabel, chrono, document.createTextNode(' | '), postCount);

    const logBox=document.createElement('div');
    logBox.id='jvc-postwalker-log';
    Object.assign(logBox.style,{
      marginTop:'2px',color:'#9ecbff',lineHeight:'1.4',height:'5.6em',
      overflow:'auto',whiteSpace:'pre-wrap',background:'#0b0d12',
      border:'1px solid #222',borderRadius:'8px',padding:'6px'
    });
    logEl=logBox;

    const appendEls=[header,actions,hoursWrap,maxWrap,accountWrap,accountMgr];
    if(loginWrap) appendEls.push(loginWrap);
    appendEls.push(chronoWrap,logBox);
    box.append(...appendEls);
    
    const parent=document.body||document.documentElement;
    parent.appendChild(box);
    
    checkCdnResources(box).catch(e=>console.error('CDN check failed',e));
    
    let b=q('#jvc-postwalker-badge');
    if(!b){
      b=document.createElement('div');
      b.id='jvc-postwalker-badge';
      Object.assign(b.style,{position:'fixed',top:'10px',right:'10px',background:'#2a6ef5',color:'#fff',padding:'5px 7px',borderRadius:'8px',font:'12px system-ui',zIndex:2147483647,cursor:'pointer',boxShadow:'0 6px 18px rgba(0,0,0,.35)'});
      b.textContent='PW';
      b.title='Toggle panel (Alt+J)';
      (document.body||document.documentElement).appendChild(b);
    }
    b.onclick = ()=>{ const box=q('#jvc-postwalker'); if(box) box.style.display = (box.style.display==='none'?'block':'none'); };

    if(!window.toggleKeyHandler){
      const toggleKeyHandler = (e)=>{
        if(e.altKey && /j/i.test(e.key)){
          const box=q('#jvc-postwalker');
          if(box) box.style.display=box.style.display==='none'?'block':'none';
        }
      };
      window.toggleKeyHandler = toggleKeyHandler;
      document.addEventListener('keydown', toggleKeyHandler);
    }

    let s = { active: false };
    try { s = await sessionGet(); }
    catch (e) { console.error('sessionGet failed', e); }
    if(onCache && s && s.active) {      startTimerUpdater().catch(console.error);
      tickSoon();
    } else await updateSessionUI();

    uiMutationObserver = new MutationObserver(()=>{
      if(!parent.contains(box)){
        uiMutationObserver.disconnect();
        uiMutationObserver = null;
        if(!uiRemountTimeout){
          uiRemountTimeout=setTimeout(async ()=>{
            uiRemountTimeout=null;
            try{ await ensureUI(); }
            catch(e){ console.error('UI remount failed',e); }
          },50);
        }
      }
    });
    uiMutationObserver.observe(parent,{childList:true,subtree:false});
  }
  if(!initDoneEarly){
    try {
      await buildAndAutoStart();
    } catch (e) {
      console.error('[Post Walker] init failed', e);
    }
  }
})();
