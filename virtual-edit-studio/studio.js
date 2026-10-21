(function(){
  'use strict';
  var plans={
    essential:{name:'Essential',price:599,hours:40,storage:.5,ram:32,iconik:'Standard access',setup:299,hourRate:4.5},
    production:{name:'Production',price:1499,hours:160,storage:2,ram:32,iconik:'Standard access',setup:299,hourRate:4.5},
    studio:{name:'Studio',price:2999,hours:200,storage:5,ram:64,iconik:'Power access',setup:499,hourRate:7.5}
  };
  var get=function(id){return document.getElementById(id)};
  var currency=function(v){return '$'+v.toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:0})};
  var radios=Array.from(document.querySelectorAll('input[name="plan-choice"]'));
  function update(){
    var selected=radios.find(function(r){return r.checked});
    if(!selected)return;
    var c=plans[selected.value];
    var storage=Number(get('storage').value),hours=Number(get('hours').value);
    var custom=get('workflow').value==='custom';
    var monthly=c.price+storage*149+hours*c.hourRate;
    var setup=c.setup+(custom?249:0);
    var allHours=c.hours+hours,allStorage=c.storage+storage;
    document.querySelectorAll('.tier-option').forEach(function(el){el.classList.toggle('selected',el.querySelector('input').checked)});
    get('summary-name').textContent=c.name;
    get('monthly-price').textContent=currency(monthly);
    get('spec-hours').textContent=allHours+' hours / mo';
    get('spec-ram').textContent=c.ram+'GB';
    get('spec-storage').textContent=allStorage+'TB';
    get('spec-iconik').textContent=c.iconik;
    get('spec-workflow').textContent=custom?'Custom standards':'PostOpz Framework';
    get('setup-price').textContent=currency(setup);
    get('form-tier').value=c.name;
    get('form-hours').value=String(allHours);
    get('form-storage').value=String(allStorage);
    get('form-workflow').value=custom?'Custom standards requested':'PostOpz Framework';
    get('form-monthly').value=String(monthly);
    get('form-setup').value=String(setup);
    get('form-config-summary').textContent='Your selection: '+c.name+' · '+allHours+' GPU hrs · '+allStorage+'TB · '+currency(monthly)+'/mo estimate';
  }
  radios.forEach(function(el){el.addEventListener('change',update)});
  ['storage','hours','workflow'].forEach(function(id){get(id).addEventListener('change',update)});
  update();
  // Compare the live frontend estimate against PostOpz's independently
  // calculated server quote; never use the browser estimate to authorize spend.
  var quoteRequestNumber=0;
  async function verifyQuote(){
    var ticket=++quoteRequestNumber;
    var status=get('server-verification');
    status.textContent='Verifying your estimate…';
    try{
      var result=await fetch('/api/studio/quote',{
        method:'POST',
        headers:{'content-type':'application/json'},
        body:JSON.stringify({
          tier:get('form-tier').value,
          monthlyGpuHours:Number(get('form-hours').value),
          sharedStorageTB:Number(get('form-storage').value),
          workflow:get('form-workflow').value
        })
      });
      if(!result.ok)throw new Error('Cannot verify configuration');
      var response=await result.json();
      if(ticket!==quoteRequestNumber)return;
      if(response.configuration.estimate.monthlyUSD!==Number(get('form-monthly').value)||
        response.configuration.estimate.onboardingUSD!==Number(get('form-setup').value))
        throw new Error('Price mismatch');
      status.textContent='✓ Estimate validated by the PostOpz pricing service · Formal quote required';
      status.dataset.verified='true';
    }catch{
      if(ticket!==quoteRequestNumber)return;
      status.textContent='Estimated pricing only · Final amount confirmed by PostOpz';
      status.dataset.verified='false';
    }
  }
  radios.forEach(function(el){el.addEventListener('change',verifyQuote)});
  ['storage','hours','workflow'].forEach(function(id){get(id).addEventListener('change',verifyQuote)});
  verifyQuote();

  var menuButton=document.querySelector('.menu-button');
  var mobileNav=get('mobile-nav');
  function closeMenu(){menuButton.setAttribute('aria-expanded','false');menuButton.setAttribute('aria-label','Open menu');mobileNav.hidden=true}
  menuButton.addEventListener('click',function(){
    var open=menuButton.getAttribute('aria-expanded')==='true';
    menuButton.setAttribute('aria-expanded',String(!open));
    menuButton.setAttribute('aria-label',open?'Open menu':'Close menu');
    mobileNav.hidden=open;
  });
  Array.from(mobileNav.querySelectorAll('a')).forEach(function(a){a.addEventListener('click',closeMenu)});
  document.addEventListener('keydown',function(e){if(e.key==='Escape')closeMenu()});

  function track(event,label){
    if(typeof window.gtag==='function')window.gtag('event',event,{event_category:'virtual_edit_studio',event_label:label});
  }
  get('summary-cta').addEventListener('click',function(){track('virtual_bay_request_click',get('form-tier').value)});
  get('pilot-form').addEventListener('submit',function(){update();track('virtual_bay_pilot_submit',get('form-tier').value)});
})();