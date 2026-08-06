/* Menu w stylu Carenovy — cień pojawia sie przy przewinieciu */
(function(){var n=document.querySelector('nav');if(!n)return;var on=function(){n.classList.toggle('scrolled',window.scrollY>6)};on();window.addEventListener('scroll',on,{passive:true})})();
/* Karty dietetykow - jednorazowy wjazd 3D dla .d-grid > .d-card (progressive enhancement, ES5) */
(function(){
  var grid  = document.querySelector('.d-grid');
  var cards = document.querySelectorAll('.d-grid > .d-card');
  if(!grid || !cards.length) return;

  var reduce = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Brak ruchu / brak IntersectionObserver: NIE dodawaj .js-3d, wiec ukryty pre-stan
  // nigdy sie nie nakłada i karty po prostu zostaja widoczne. (Fallback = widoczne.)
  if(reduce || !('IntersectionObserver' in window)) return;

  // Wejscie w ukryty pre-stan. Bazowy transition .d-card NIE obejmuje transform/opacity,
  // wiec ukrycie jest natychmiastowe (bez odwrotnego slajdu, bezpieczne nawet nad zgieciem).
  grid.classList.add('js-3d');

  // Zwolnij warstwe kompozytora po zakonczeniu transformu wjazdu, zeby karta renderowala sie
  // normalnie (ostry tekst, poprawne przyciecie zaokraglen) i slabe telefony nie trzymaly
  // dwoch duzych warstw ze zdjeciami przez caly czas.
  function release(card){
    var done=false;
    function onEnd(e){
      if(e && e.propertyName && e.propertyName!=='transform') return; // transform = najdluzsza wlasciwosc
      if(done) return; done=true;
      card.removeEventListener('transitionend', onEnd);
      card.style.willChange='auto';
    }
    card.addEventListener('transitionend', onEnd);
    setTimeout(onEnd, 2000); // zabezpieczenie, gdyby transitionend nie przyszlo (karta w tle)
  }

  var io=new IntersectionObserver(function(entries){
    entries.forEach(function(en){
      if(!en.isIntersecting) return;
      var card=en.target;
      io.unobserve(card);

      // Promuj do warstwy PRZED dotknieciem transform/opacity.
      card.style.willChange='transform,opacity';
      release(card);

      // Dwa rAF: niech warstwa sie ustali, potem odpal na czystej granicy klatki,
      // zeby transition nie startowal w tej samej klatce co aktywny scroll.
      requestAnimationFrame(function(){
        requestAnimationFrame(function(){ card.classList.add('in3d'); });
      });
    });
  },{threshold:0.2, rootMargin:'0px 0px -8% 0px'});

  Array.prototype.forEach.call(cards, function(c){ io.observe(c); });
})();

/* Przycisk CTA w menu: na mobile trafia do rozwijanego menu, na desktopie zostaje w pasku */
(function(){
  var nav=document.querySelector('nav');if(!nav)return;
  var cta=nav.querySelector('.nav-cta'),links=nav.querySelector('.nav-links'),toggle=nav.querySelector('.nav-toggle');
  if(!cta||!links)return;
  var mq=window.matchMedia('(max-width:960px)');
  function place(){
    if(mq.matches){ if(cta.parentElement!==links) links.appendChild(cta); }
    else { if(cta.parentElement!==nav) nav.insertBefore(cta,toggle); }
  }
  place();
  if(mq.addEventListener) mq.addEventListener('change',place); else mq.addListener(place);
})();
/* Menu mobilne: zwijane podmenu (akordeon). Tap w pozycję z podmenu rozwija/zwija je;
   na desktopie bez zmian (podmenu na hover). */
(function(){
  var nav=document.querySelector('nav');if(!nav)return;
  var mq=window.matchMedia('(max-width:960px)');
  Array.prototype.slice.call(nav.querySelectorAll('.nav-links li.has-sub > a')).forEach(function(a){
    a.addEventListener('click',function(e){
      if(mq.matches){ e.preventDefault(); a.parentNode.classList.toggle('open'); }
    });
  });
})();
/* Taśma opinii — duplikacja kart dla płynnej, nieskończonej pętli.
   Kopie są oznaczone aria-hidden i wykluczone z tabulacji — treść strony bez zmian. */
(function(){
  var track=document.querySelector('.op-track');
  if(!track||track.dataset.marquee) return;
  track.dataset.marquee='1';
  Array.prototype.slice.call(track.children).forEach(function(c){
    var k=c.cloneNode(true);
    k.setAttribute('aria-hidden','true');
    Array.prototype.forEach.call(k.querySelectorAll('a,button'),function(a){a.setAttribute('tabindex','-1')});
    track.appendChild(k);
  });

  /* STEROWANIE taśmą — spójne dla desktopu (animacja CSS) i mobile (autoscroll JS):
     • TAP/KLIK w taśmę = trwała pauza (klasa .op-stop na desktopie + flaga stopped
       na mobile); ponowny tap = wznowienie. To odpowiedź na „po kliknięciu się nie
       zatrzymuje".
     • SWIPE (palec przesunął się >10px) = user przejął sterowanie → zatrzymaj na stałe,
       niech przewija ręcznie.
     • hover pauzuje na desktopie przez samo CSS (.op-track:hover).
     Mobile autoscroll: scrollLeft bywa całkowity → pozycję trzymamy we float 'pos'
     (inaczej mały przyrost/klatkę zaokrągla się do zera i taśma stoi); pętla po połowie
     szerokości (duplikaty). */
  if(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches){
    track.classList.add('op-stop'); return;
  }
  var mq=window.matchMedia('(max-width:960px)');
  var stopped=false;    /* trwała pauza (tap/swipe) */
  var pressing=false;   /* palec/przycisk wciśnięty (chwilowa pauza w trakcie dotyku) */
  var pos=null, downX=null, moved=false;

  function applyStopped(){ track.classList.toggle('op-stop', stopped); }

  track.addEventListener('pointerdown',function(e){
    downX=e.clientX; moved=false; pressing=true; pos=null;
  },{passive:true});
  track.addEventListener('pointermove',function(e){
    if(downX!==null && Math.abs(e.clientX-downX)>10) moved=true;
  },{passive:true});
  track.addEventListener('pointerup',function(){
    pressing=false;
    if(downX===null) return;
    if(moved) stopped=true;        /* swipe → zatrzymaj i oddaj sterowanie */
    else stopped=!stopped;         /* tap → przełącz pauzę */
    applyStopped(); pos=null; downX=null;
  },{passive:true});
  track.addEventListener('pointercancel',function(){ pressing=false; downX=null; },{passive:true});

  var lastTs=null;
  function step(ts){
    var dt=lastTs===null?16:Math.min(ts-lastTs,64); /* cap: po powrocie do karty bez skoku */
    lastTs=ts;
    if(mq.matches && !stopped && !pressing && !document.hidden){
      var half=track.scrollWidth/2;
      if(half>0){
        if(pos===null) pos=track.scrollLeft;
        pos+=0.045*dt; /* 45 px/s niezależnie od Hz ekranu */
        if(pos>=half) pos-=half;
        track.scrollLeft=pos;
      }
    } else {
      pos=null;
    }
    window.requestAnimationFrame(step);
  }
  window.requestAnimationFrame(step);
})();

/* Scroll-reveal — elementy wjeżdżają z dołu z fade-in, karty kaskadowo. */
(function(){
  'use strict';
  if(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var singles=[
    ['.breadcrumb',0],['.hero-eye',.05],['.hero-h1',.12],['.hero-name',.12],['.hero-da',.2],
    ['.hero-lead',.28],['.hero-stats',.36],['.hero-btns',.44],['.hero-right',.25],
    ['.section-eye',0],['.section-title',.08],['.steps-title',.08],['.sec-sub',.16],['.steps-sub',.16],['.da-box',.16],
    ['.map-embed',.1],['.tabs-wrap',0],['.uwagi',0],
    ['.cta-sec h2',0],['.cta-sec p',.1],['.cta-btns',.2],['.faq2-btns',.24],['.komp-head',0],['.certy-note',0]
  ];
  /* .op-track wyłączony — taśma opinii ma własną, ciągłą animację (styl przyjazny-dietetyk.pl) */
  var groups=['.exp-grid','.svc-bento','.svc-grid','.steps-grid','.kroki','.cennik-grid','.kontakt-grid','.faq-inner','.faq2-list','.stats-bar','.spec-grid','.komp-list','.certy-grid'];

  var els=[];
  function tag(el,delay){
    if(el.dataset.rv) return;
    el.dataset.rv='1';
    el.style.setProperty('--rvd',delay+'s');
    el.classList.add('rv');
    els.push({el:el,delay:delay});
  }
  singles.forEach(function(s){
    document.querySelectorAll(s[0]).forEach(function(el){tag(el,s[1])});
  });
  groups.forEach(function(sel){
    document.querySelectorAll(sel).forEach(function(g){
      Array.prototype.forEach.call(g.children,function(k,i){tag(k,Math.min(i*.09,.54))});
    });
  });

  function finish(item){
    /* po zakończeniu animacji zdejmij klasy, żeby nie kolidowały z transition/transform hoverów */
    setTimeout(function(){
      item.el.classList.remove('rv','in');
      item.el.style.removeProperty('--rvd');
    },800+item.delay*1000);
  }

  if(!('IntersectionObserver' in window)){
    els.forEach(function(item){item.el.classList.add('in');finish(item)});
    return;
  }
  var io=new IntersectionObserver(function(entries){
    entries.forEach(function(e){
      if(!e.isIntersecting) return;
      io.unobserve(e.target);
      var item=null;
      for(var i=0;i<els.length;i++){if(els[i].el===e.target){item=els[i];break}}
      e.target.classList.add('in');
      if(item) finish(item);
    });
  },{rootMargin:'0px 0px -8% 0px',threshold:.05});
  els.forEach(function(item){io.observe(item.el)});
})();

/* Liczniki statystyk — rolowane cyfry (odometr). Animacja NIE startuje po wczytaniu
   strony; naliczanie rusza przy pierwszym przewinieciu, gdy sekcja jest w kadrze. */
(function(){
  var els=document.querySelectorAll('.hs-n,.stat-n');
  var hero=document.querySelectorAll('.hero-cn-sn');
  if(!els.length&&!hero.length) return;
  var reduce=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(reduce||!('IntersectionObserver' in window)) return;

  function nalicz(el){
    if(el.dataset.odo) return;
    var text=el.textContent.trim();
    if(!/\d/.test(text)||!/^[\d.,+\/★ ]+$/.test(text)) return;
    el.dataset.odo='1';
    el.textContent='';
    el.classList.add('odo-wrap');
    text.split('').forEach(function(ch){
      if(/\d/.test(ch)){
        var col=document.createElement('span');col.className='odo';
        var strip=document.createElement('span');strip.className='odo-strip';
        var target=parseInt(ch,10);
        for(var d=0;d<=9;d++){var r=document.createElement('span');r.textContent=d;strip.appendChild(r)}
        for(var d2=0;d2<=target;d2++){var r2=document.createElement('span');r2.textContent=d2;strip.appendChild(r2)}
        col.appendChild(strip);el.appendChild(col);
      }else{
        var s=document.createElement('span');s.className='odo-ch';s.textContent=(ch===' '?' ':ch);el.appendChild(s);
      }
    });
    var strips=el.querySelectorAll('.odo-strip');
    strips.forEach(function(st,i){
      st.style.transitionDelay=(i*0.12)+'s';
      var rows=st.children.length;
      requestAnimationFrame(function(){requestAnimationFrame(function(){
        st.style.transform='translateY(-'+(rows-1)+'em)';
      })});
    });
    /* Po zakonczeniu rolowania podmien kolumny na czysty tekst. Kazda kolumna .odo przesuwa
       sie o INNA wielokrotnosc em (rows-1 zalezy od cyfry), wiec przy ulamkowym font-size
       (clamp/vw) cyfry siadaja na minimalnie roznych wysokosciach = schodki. Zwykly tekst
       jest wyrownany idealnie. */
    var restoreMs=(strips.length-1)*120+1900+240;
    setTimeout(function(){
      el.textContent=text;
      el.classList.remove('odo-wrap');
    },restoreMs);
  }

  /* Liczniki w hero sa nad zgieciem — scroll moze nigdy nie nastapic, wiec startuja same
     po wczytaniu, zgrane z animacja wjazdu .rv-up (--d:.54s). */
  if(hero.length){
    setTimeout(function(){
      Array.prototype.forEach.call(hero,function(el){nalicz(el)});
    },800);
  }

  /* uzbrojenie dopiero przy pierwszym przewinieciu — nie po samym wczytaniu strony */
  var armed=false;
  function arm(){
    if(armed) return; armed=true;
    els.forEach(function(el){
      var r=el.getBoundingClientRect();
      if(r.top<window.innerHeight*0.9 && r.bottom>0) nalicz(el);
    });
  }
  window.addEventListener('scroll',arm,{passive:true,once:true});

  els.forEach(function(el){
    var io=new IntersectionObserver(function(entries){
      entries.forEach(function(e){
        if(!e.isIntersecting||!armed) return;
        io.disconnect();
        nalicz(el);
      });
    },{rootMargin:'0px 0px -12% 0px',threshold:.4});
    io.observe(el);
  });
})();

/* Przepis — odhaczanie składników (klik) + skalowanie gramatury przy zmianie liczby porcji */
(function(){
  var ings=document.querySelectorAll('.rcp-ing li');
  Array.prototype.forEach.call(ings,function(li){
    li.addEventListener('click',function(){ li.classList.toggle('on'); });
  });
  var wrap=document.querySelector('.rcp-portions');
  if(!wrap) return;
  var base=parseFloat(wrap.getAttribute('data-base'))||1;
  var out=wrap.querySelector('[data-portions]');
  var dec=wrap.querySelector('[data-dec]'), inc=wrap.querySelector('[data-inc]');
  var cur=base;
  function fmt(n){ n=Math.round(n*100)/100; return Number.isInteger(n)?String(n):String(n).replace('.',','); }
  function render(){
    out.textContent=cur;
    dec.disabled=cur<=1; inc.disabled=cur>=12;
    var mult=cur/base;
    Array.prototype.forEach.call(ings,function(li){
      var n=parseFloat(li.getAttribute('data-n')), q=li.querySelector('[data-q]');
      if(q&&!isNaN(n)){ var unit=q.textContent.replace(/^[\d.,]+\s*/,''); q.textContent=fmt(n*mult)+' '+unit; }
      var gn=parseFloat(li.getAttribute('data-gn')), gt=li.querySelector('[data-gtxt]');
      if(gt&&!isNaN(gn)){ gt.textContent=fmt(gn*mult)+' '+li.getAttribute('data-gu'); }
    });
  }
  inc.addEventListener('click',function(){ if(cur<12){cur++;render();} });
  dec.addEventListener('click',function(){ if(cur>1){cur--;render();} });
  render();
})();

/* Baner cookies / RODO - pokazuje sie raz, zapamietuje zgode w localStorage */
(function(){
  try{ if(localStorage.getItem('ck-ok')==='1') return; }catch(e){}
  function init(){
    if(document.querySelector('.ck-bar')) return;
    var bar=document.createElement('div');
    bar.className='ck-bar';
    bar.setAttribute('role','dialog');
    bar.setAttribute('aria-label','Zgoda na pliki cookies');
    bar.innerHTML='<div>Ta strona używa plików cookies, aby działać poprawnie i ułatwić korzystanie z serwisu. Korzystając z niej, akceptujesz <a href="/polityka-prywatnosci/">Politykę prywatności</a>.</div><div class="ck-bar-row"><button class="ck-accept" type="button">Akceptuję</button></div>';
    document.body.appendChild(bar);
    requestAnimationFrame(function(){requestAnimationFrame(function(){bar.classList.add('show')})});
    bar.querySelector('.ck-accept').addEventListener('click',function(){
      try{ localStorage.setItem('ck-ok','1'); }catch(e){}
      bar.classList.remove('show');
      setTimeout(function(){ if(bar.parentNode) bar.parentNode.removeChild(bar); },500);
    });
  }
  if(document.body){ init(); } else { document.addEventListener('DOMContentLoaded',init); }
})();

/* Pigułkowe menu — panel mobilny (hamburger + akordeon), wszystkie strony. */
(function(){
  var burger=document.getElementById('pnavBurger');
  if(!burger) return;
  var mobile=document.getElementById('pnavMobile'),scrim=document.getElementById('pnavScrim'),close=document.getElementById('pnavClose');
  function open(){mobile.classList.add('open');scrim.classList.add('open');burger.classList.add('open');burger.setAttribute('aria-expanded','true');document.body.style.overflow='hidden';}
  function shut(){mobile.classList.remove('open');scrim.classList.remove('open');burger.classList.remove('open');burger.setAttribute('aria-expanded','false');document.body.style.overflow='';}
  burger.addEventListener('click',function(){mobile.classList.contains('open')?shut():open();});
  if(scrim) scrim.addEventListener('click',shut);
  if(close) close.addEventListener('click',shut);
  Array.prototype.forEach.call(document.querySelectorAll('.pnav-msubt'),function(b){b.addEventListener('click',function(){b.parentElement.classList.toggle('open');});});
})();
