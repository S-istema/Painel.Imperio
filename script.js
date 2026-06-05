// ════════════════════════════════════════════
// CONFIGURAÇÃO
// ════════════════════════════════════════════
var cfg = JSON.parse(localStorage.getItem('imperioAdmCfg') || '{}');
cfg = Object.assign({
  storeName:'IMPERIO LANCHES', 
  storeAddr:'Rua Herminio Macedo de Carvalho', 
  cnpj:'59.527.486/0001-63', 
  phone:'84 99442-8496',
  autoPrint:false,
  paper58:true,
  sound:true,
  pixKey:'84994994919',
  pixCity:'Natal'
}, cfg);

var orders = JSON.parse(localStorage.getItem('imperioAdmOrders') || '[]');
var btDevice = null, btChar = null;
var printerConnected = false;
var soundEnabled = cfg.sound;
var selectedOrderId = null;
var currentFilter = 'all';
var orderCounter = orders.length > 0 ? Math.max.apply(null, orders.map(function(o){return o.num;})) : 0;

var BIN_ID = "6a22556df5f4af5e29bbf70d";
var MASTER_KEY = "$2a$10$oxPjSemP6.ZbivpbS4Ycp.GEfwwE5bV3K7ddo522WVY38ic838lr.";
var API_URL = "https://api.jsonbin.io/v3/b/"+BIN_ID;
var lastCloudOrdersIds = [];

var fetchErrors = 0; 
var fetchInterval = 6000;

function saveOrders(){ localStorage.setItem('imperioAdmOrders', JSON.stringify(orders)); }
function saveCfg(){ localStorage.setItem('imperioAdmCfg', JSON.stringify(cfg)); }

// ════════════════════════════════════════════
// VERIFICADOR DE SAÚDE DA IMPRESSORA
// ════════════════════════════════════════════
function checkPrinterHealth() {
  if (!btDevice) return;
  try {
    if (!btDevice.gatt || !btDevice.gatt.connected) {
      printerConnected = false;
      btChar = null;
      setPrinterStatus('', 'Desconectada');
      document.getElementById('printerStatusText').textContent = 'Desconectada';
    }
  } catch(e) {
    printerConnected = false;
    btChar = null;
    setPrinterStatus('', 'Desconectada');
    document.getElementById('printerStatusText').textContent = 'Erro';
  }
}

// ════════════════════════════════════════════
// BUSCAR PEDIDOS DA NUVEM (JSONBin)
// ════════════════════════════════════════════
function fetchCloudOrders(){
  var dot = document.getElementById('syncDot');
  var label = document.getElementById('syncLabel');
  if(dot) dot.style.background = 'var(--yellow)';
  if(label) label.textContent = 'Buscando...';

  fetch(API_URL+"/latest", {headers:{"X-Master-Key":MASTER_KEY}})
  .then(function(r){ return r.json(); })
  .then(function(json){
    fetchErrors = 0; 
    fetchInterval = 6000;
    var data = json.record;
    if(data && typeof data.orderCounter === "number" && data.orderCounter > orderCounter) orderCounter = data.orderCounter;
    
    if(!data || !data.orders || !data.orders.length){
      if(dot) dot.style.background = 'var(--green)'; if(label) label.textContent = 'Conectado'; 
      checkPrinterHealth(); 
      return;
    }

    var newCount = 0;
    data.orders.forEach(function(co){
      if(lastCloudOrdersIds.indexOf(co._id) !== -1) return;
      var exists = orders.some(function(o){ return o._cloudId === co._id; }); if(exists) return;
      var num = co.num || 0; if(num > orderCounter) orderCounter = num;
      
      var order = {
        num: num, customer: co.customer || 'Cliente', phone: co.phone || '',
        type: co.type || 'Delivery', address: co.address || '',
        items: (co.items || []).map(function(it){ return {name: it.name || it, qty: it.qty || 1, price: it.price || 0, mods: it.modifiers || it.mods || []}; }),
        payment: co.payment || 'PIX', total: co.total || 0, obs: co.obs || '',
        status: co.status || 'new', ts: co.ts || Date.now(), source: co.source || 'site', _cloudId: co._id
      };

      if(order.status === 'new'){
        newCount++; orders.unshift(order); notifyNewOrder(order);
        checkPrinterHealth(); 
        
        if(cfg.autoPrint && printerConnected){
          setTimeout(function(){ printOrder(order.num); }, 1000);
        } else if(cfg.autoPrint && !printerConnected) {
          toast('err', 'Impressora Caiu!', 'Pedido #'+order.num+' recebido, mas a impressora desconectou.');
        }
      } else { orders.unshift(order); }
      lastCloudOrdersIds.push(co._id);
    });

    if(lastCloudOrdersIds.length > 300) lastCloudOrdersIds = lastCloudOrdersIds.slice(-200);
    saveOrders(); refreshCurrentPage();
    if(dot) dot.style.background = 'var(--green)'; if(label) label.textContent = 'Conectado';
    if(newCount > 0) toast('ok', newCount + ' novo(s) pedido(s)', 'Recebidos do site');
  })
  .catch(function(e){
    console.error('[Admin] fetch err:', e);
    fetchErrors++;
    fetchInterval = Math.min(6000 + (fetchErrors * 3000), 30000);
    
    if(dot) dot.style.background = 'var(--red)'; if(label) label.textContent = 'Erro ('+fetchErrors+')';
    setTimeout(function(){ if(dot) dot.style.background = 'var(--green)'; if(label) label.textContent = 'Conectado'; }, 3000);
  });
}

function updateCloudStatus(cloudId, newStatus){
  if(!cloudId) return;
  fetch(API_URL+"/latest", {headers:{"X-Master-Key":MASTER_KEY}}).then(function(r){return r.json();}).then(function(json){
    var data = json.record;
    if(data.orders){ data.orders.forEach(function(o){ if(o._id === cloudId) o.status = newStatus; });
      fetch(API_URL, { method:"PUT", headers:{"Content-Type":"application/json","X-Master-Key":MASTER_KEY}, body:JSON.stringify(data) }); }
  }).catch(function(e){ console.error('[Admin] updateCloudStatus err:', e); });
}

// ════════════════════════════════════════════
// NAVEGAÇÃO
// ════════════════════════════════════════════
function showPage(id){
  document.querySelectorAll('.page').forEach(function(p){p.classList.remove('active');});
  document.querySelectorAll('.nav-item').forEach(function(n){n.classList.remove('active');});
  document.getElementById('page-'+id).classList.add('active'); document.getElementById('nav-'+id).classList.add('active');
  var titles = {dashboard:['Dashboard','Visão geral do negócio'],orders:['Pedidos','Gerenciar pedidos recebidos'],analytics:['Relatórios de Vendas','Análise de desempenho'],settings:['Configurações','Preferências do sistema']};
  document.getElementById('pageTitle').textContent = titles[id][0]; document.getElementById('pageSubtitle').textContent = titles[id][1];
  if(id==='dashboard') renderDashboard(); if(id==='orders') renderOrders(); if(id==='analytics') renderAnalytics(); if(id==='settings') loadSettings();
  if(window.innerWidth<=720) document.getElementById('sidebar').classList.remove('open');
}
function toggleSidebar(){ document.getElementById('sidebar').classList.toggle('open'); }
function refreshCurrentPage(){
  var active = document.querySelector('.page.active'); if(!active) return;
  var id = active.id.replace('page-','');
  if(id==='dashboard') renderDashboard(); if(id==='orders') renderOrders(); if(id==='analytics') renderAnalytics();
}

function fmt(v){ return 'R$ '+Number(v).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}); }
function formatNum(v){ return Number(v).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}); }
function statusLabel(s){ return {new:'🔔 Novo',preparing:'🔥 Preparando',ready:'✅ Pronto',delivered:'📦 Entrega',cancelled:'❌ Cancelado'}[s]||s; }
function relTime(ts){ var d=Date.now()-ts; if(d<60000) return 'agora'; if(d<3600000) return Math.round(d/60000)+'min atrás'; if(d<86400000) return Math.round(d/3600000)+'h atrás'; return new Date(ts).toLocaleDateString('pt-BR'); }
var toastTimer;
function toast(type,title,sub){
  var el=document.getElementById('toast'); var icon=document.getElementById('toastIcon');
  icon.className='fa-solid toast-icon '+type; icon.classList.add(type==='ok'?'fa-circle-check':type==='err'?'fa-circle-xmark':'fa-circle-info');
  document.getElementById('toastTitle').textContent=title; document.getElementById('toastSub').textContent=sub||'';
  el.classList.add('show'); clearTimeout(toastTimer); toastTimer=setTimeout(function(){el.classList.remove('show');},3500);
}

// ════════════════════════════════════════════
// DASHBOARD & PEDIDOS
// ════════════════════════════════════════════
function renderDashboard(){
  var today = new Date().toDateString();
  var todayOrders = orders.filter(function(o){ return new Date(o.ts).toDateString()===today && o.status!=='cancelled'; });
  var todayRev = todayOrders.reduce(function(a,b){return a+b.total;},0);
  var pending = orders.filter(function(o){ return ['new','preparing','ready'].indexOf(o.status)!==-1; });
  var ticket = todayOrders.length ? todayRev/todayOrders.length : 0;
  document.getElementById('statPedidos').textContent = todayOrders.length; document.getElementById('statVendas').textContent = fmt(todayRev);
  document.getElementById('statPendentes').textContent = pending.length; document.getElementById('statTicket').textContent = fmt(ticket);
  document.getElementById('trendPendentes').textContent = pending.length + ' abertos';
  var pb = document.getElementById('pendingBadge'); var newOrders = orders.filter(function(o){return o.status==='new';});
  if(newOrders.length){ pb.style.display='flex'; pb.textContent=newOrders.length; } else pb.style.display='none';
  var recent = orders.slice().sort(function(a,b){return b.ts-a.ts;}).slice(0,5);
  var el = document.getElementById('recentOrdersList');
  if(!recent.length){ el.innerHTML='<div class="empty-orders"><i class="fa-solid fa-bag-shopping"></i><p>Nenhum pedido ainda</p></div>'; return; }
  el.innerHTML = recent.map(function(o){
    var srcBadge = o.source==='site'?'<span class="order-source">SITE</span>':'';
    return '<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border);cursor:pointer" onclick="showPage(\'orders\');setTimeout(function(){selectOrder('+o.num+')},100)"><div style="display:flex;align-items:center;gap:10px"><div style="width:32px;height:32px;background:var(--bg-input);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;color:var(--primary)">#'+o.num+'</div><div><div style="font-size:12px;font-weight:700">'+o.customer+srcBadge+'</div><div style="font-size:10px;color:var(--text-faint)">'+relTime(o.ts)+' · '+o.type+'</div></div></div><div style="display:flex;align-items:center;gap:10px"><span class="order-status-badge badge-'+o.status+'">'+statusLabel(o.status)+'</span><span style="font-size:13px;font-weight:800;color:var(--primary)">'+fmt(o.total)+'</span></div></div>';
  }).join('');
}

function renderOrders(){
  var search = document.getElementById('orderSearch').value.toLowerCase();
  var filtered = orders.filter(function(o){ if(currentFilter!=='all' && o.status!==currentFilter) return false; if(search && o.customer.toLowerCase().indexOf(search)===-1 && String(o.num).indexOf(search)===-1) return false; return true; }).sort(function(a,b){return b.ts-a.ts;});
  var el = document.getElementById('ordersList');
  if(!filtered.length){ el.innerHTML='<div class="empty-orders"><i class="fa-solid fa-bag-shopping"></i><p>Nenhum pedido encontrado</p></div>'; return; }
  el.innerHTML = filtered.map(function(o){
    var srcBadge = o.source==='site'?'<span class="order-source">SITE</span>':'';
    return '<div class="order-card '+o.status+' '+(selectedOrderId===o.num?'selected':'')+'" onclick="selectOrder('+o.num+')"><div class="order-card-top"><div class="order-num"><i class="fa-solid fa-hashtag" style="font-size:10px;color:var(--text-faint)"></i>'+o.num+' — '+o.customer+srcBadge+'</div><span class="order-status-badge badge-'+o.status+'">'+statusLabel(o.status)+'</span></div><div class="order-items-preview">'+o.items.map(function(i){return i.qty+'x '+i.name;}).join(' · ')+'</div><div class="order-card-bottom"><div class="order-customer"><i class="fa-solid fa-'+(o.type==='Delivery'?'motorcycle':o.type==='Mesa'?'utensils':'store')+'"></i> '+o.type+'</div><div><div class="order-value">'+fmt(o.total)+'</div><div class="order-time">'+relTime(o.ts)+'</div></div></div></div>';
  }).join('');
  if(selectedOrderId) renderDetail(selectedOrderId);
}
function selectOrder(num){ 
  if(selectedOrderId === num){
    selectedOrderId = null; 
    renderOrders(); 
    document.getElementById('orderDetail').innerHTML = '<div class="detail-empty"><i class="fa-solid fa-hand-pointer"></i><p style="font-size:12px">Selecione um pedido</p></div>';
    return; 
  }
  selectedOrderId = num; 
  renderOrders(); 
  renderDetail(num); 
}

function renderDetail(num){
  var o = orders.find(function(x){return x.num===num;});
  if(!o){ document.getElementById('orderDetail').innerHTML='<div class="detail-empty"><i class="fa-solid fa-hand-pointer"></i><p style="font-size:12px">Selecione um pedido</p></div>'; return; }
  var el = document.getElementById('orderDetail');
  var nextActions = { new: '<button class="btn-status preparing-btn" onclick="updateStatus('+o.num+',\'preparing\')"><i class="fa-solid fa-fire-burner"></i> Iniciar Preparo</button>', preparing: '<button class="btn-status ready-btn" onclick="updateStatus('+o.num+',\'ready\')"><i class="fa-solid fa-bell"></i> Marcar Pronto</button>', ready: '<button class="btn-status delivered-btn" onclick="updateStatus('+o.num+',\'delivered\')"><i class="fa-solid fa-check-double"></i> Saiu para Entrega</button>', delivered: '', cancelled: '' };
  var srcLabel = o.source==='site'?'<div class="detail-info-row"><i class="fa-solid fa-globe" style="color:var(--blue)"></i><span style="color:var(--blue)">Pedido recebido pelo site</span></div>':'';
  el.innerHTML = '<div class="detail-header"><div><div class="detail-num">Pedido #'+o.num+'</div><div class="detail-time">'+new Date(o.ts).toLocaleString('pt-BR')+'</div></div><span class="order-status-badge badge-'+o.status+'">'+statusLabel(o.status)+'</span></div>'+srcLabel+'<div class="detail-section"><div class="detail-section-title"><i class="fa-solid fa-user"></i> Cliente</div><div class="detail-info-row"><i class="fa-solid fa-user"></i>'+o.customer+'</div><div class="detail-info-row"><i class="fa-solid fa-phone"></i>'+(o.phone||'—')+'</div><div class="detail-info-row"><i class="fa-solid fa-'+(o.type==='Delivery'?'motorcycle':o.type==='Mesa'?'utensils':'store')+'"></i>'+o.type+(o.address?' · '+o.address:'')+'</div>'+(o.obs?'<div class="detail-info-row"><i class="fa-solid fa-note-sticky"></i><span style="color:var(--yellow)">'+o.obs+'</span></div>':'')+'</div><div class="detail-section"><div class="detail-section-title"><i class="fa-solid fa-list"></i> Itens</div>'+o.items.map(function(i){ var mods = (i.mods&&i.mods.length) ? '<div class="detail-item-mods">'+i.mods.join(', ')+'</div>' : ''; return '<div class="detail-item"><div class="detail-item-left"><div class="detail-item-name">'+i.qty+'x '+i.name+'</div>'+mods+'</div><div class="detail-item-price">'+fmt(i.price)+'</div></div>'; }).join('')+'</div><div class="detail-total-box"><div class="detail-total-row grand"><span>Total</span><span>'+fmt(o.total)+'</span></div></div><div class="detail-info-row" style="margin-bottom:12px"><i class="fa-solid fa-credit-card" style="color:var(--green)"></i><span style="color:var(--green);font-weight:700">'+o.payment+'</span></div><div class="detail-actions">'+(nextActions[o.status]||'')+'<button class="btn-print" onclick="printOrder('+o.num+')"><i class="fa-solid fa-print"></i> Imprimir 2 Vias</button>'+(o.status!=='delivered'&&o.status!=='cancelled'?'<button class="btn-cancel-order" onclick="updateStatus('+o.num+',\'cancelled\')"><i class="fa-solid fa-xmark"></i> Cancelar Pedido</button>':'')+'</div>';
}
function filterOrders(f,el){ currentFilter = f; document.querySelectorAll('.filter-tab').forEach(function(t){t.classList.remove('active');}); el.classList.add('active'); renderOrders(); }
function searchOrders(){ renderOrders(); }
function updateStatus(num,status){ var o = orders.find(function(x){return x.num===num;}); if(!o) return; o.status = status; saveOrders(); renderOrders(); renderDashboard(); toast('ok','Status atualizado','Pedido #'+num+' → '+statusLabel(status)); if(o._cloudId) updateCloudStatus(o._cloudId, status); }

// ════════════════════════════════════════════
// NOVO PEDIDO MANUAL & ANALYTICS
// ════════════════════════════════════════════
function openAddOrder(){ document.getElementById('addOrderModal').style.display='flex'; }
function closeAddOrder(){ document.getElementById('addOrderModal').style.display='none'; }
function addOrderManual(){
  var customer = document.getElementById('new-customer').value.trim(); var itemsRaw = document.getElementById('new-items').value.trim(); var total = parseFloat(document.getElementById('new-total').value)||0;
  if(!customer){ toast('err','Campo obrigatório','Informe o nome do cliente'); return; } if(!itemsRaw){ toast('err','Campo obrigatório','Informe os itens do pedido'); return; } if(!total){ toast('err','Campo obrigatório','Informe o valor total'); return; }
  var items = itemsRaw.split('\n').filter(Boolean).map(function(line){ var m = line.match(/^(\d+)x?\s+(.+?)\s*[-–]\s*R?\$?\s*([\d.,]+)/i); if(m) return {qty:parseInt(m[1]),name:m[2].trim(),price:parseFloat(m[3].replace(',','.')),mods:[]}; return {qty:1,name:line.trim(),price:total,mods:[]}; });
  var type = document.getElementById('new-type').value; var address = '';
  if(type==='Delivery') address = document.getElementById('new-address').value.trim(); else if(type==='Mesa') address = 'Mesa ' + (document.getElementById('new-table').value.trim()||'?'); else address = 'Retirada no local';
  fetch(API_URL+"/latest",{headers:{"X-Master-Key":MASTER_KEY}}).then(function(r){return r.json();}).then(function(json){ var data = json.record; if(typeof data.orderCounter === "number" && data.orderCounter > orderCounter) orderCounter = data.orderCounter; orderCounter++; data.orderCounter = orderCounter; fetch(API_URL,{ method:"PUT", headers:{"Content-Type":"application/json","X-Master-Key":MASTER_KEY}, body:JSON.stringify(data) }).catch(function(){}); var order = { num: orderCounter, customer: customer, phone: document.getElementById('new-phone').value.trim(), type: type, address: address, items: items, payment: document.getElementById('new-payment').value, total: total, obs: document.getElementById('new-obs').value.trim(), status: 'new', ts: Date.now(), source: 'manual' }; orders.unshift(order); saveOrders(); closeAddOrder(); showPage('orders'); selectOrder(orderCounter); toast('ok','Pedido #'+orderCounter+' criado!',customer+' — '+fmt(total)); notifyNewOrder(order); if(cfg.autoPrint && printerConnected) printOrder(orderCounter); }).catch(function(){ orderCounter++; var order = { num: orderCounter, customer: customer, phone: document.getElementById('new-phone').value.trim(), type: type, address: address, items: items, payment: document.getElementById('new-payment').value, total: total, obs: document.getElementById('new-obs').value.trim(), status: 'new', ts: Date.now(), source: 'manual' }; orders.unshift(order); saveOrders(); closeAddOrder(); showPage('orders'); selectOrder(orderCounter); toast('ok','Pedido #'+orderCounter+' criado!',customer+' — '+fmt(total)); notifyNewOrder(order); });
}
function renderAnalytics(){
  var now=Date.now(), weekAgo=now-7*86400000, monthAgo=now-30*86400000; var valid=orders.filter(function(o){return o.status!=='cancelled';}); var weekOrders=valid.filter(function(o){return o.ts>weekAgo;}); var monthOrders=valid.filter(function(o){return o.ts>monthAgo;});
  document.getElementById('weekTotal').textContent = fmt(weekOrders.reduce(function(a,b){return a+b.total;},0)); document.getElementById('monthTotal').textContent = fmt(monthOrders.reduce(function(a,b){return a+b.total;},0)); document.getElementById('totalCustomers').textContent = Object.keys(valid.reduce(function(m,o){m[o.phone||o.customer]=1;return m;},{})).length;
  var itemMap={}; valid.forEach(function(o){o.items.forEach(function(i){itemMap[i.name]=(itemMap[i.name]||0)+i.qty;});}); var sorted=Object.entries(itemMap).sort(function(a,b){return b[1]-a[1];}); document.getElementById('topItem').textContent = sorted[0]?sorted[0][0].split(' ').slice(0,2).join(' '):'—';
  var days=[]; for(var i=6;i>=0;i--){var d=new Date(now-i*86400000);days.push({label:d.toLocaleDateString('pt-BR',{weekday:'short'}),rev:0,date:d.toDateString()});} valid.forEach(function(o){var ds=new Date(o.ts).toDateString();var d=days.find(function(x){return x.date===ds;});if(d)d.rev+=o.total;}); var maxRev=Math.max.apply(null,days.map(function(d){return d.rev;}))||1; document.getElementById('barChart').innerHTML=days.map(function(d){ return '<div class="bar-wrap"><div class="bar-val">'+(d.rev>0?fmt(d.rev).replace('R$ ',''):'' )+'</div><div class="bar" style="height:'+Math.round((d.rev/maxRev)*90)+'px" title="'+fmt(d.rev)+'"></div><div class="bar-label">'+d.label+'</div></div>'; }).join('');
  var rankColors=['gold','silver','bronze']; document.getElementById('topItemsList').innerHTML=sorted.slice(0,6).map(function(item,i){ return '<div class="top-item-row"><div class="top-item-rank '+(rankColors[i]||'')+'">'+(i+1)+'</div><div class="top-item-name">'+item[0]+'</div><div class="top-item-bar-wrap"><div class="top-item-bar" style="width:'+Math.round(item[1]/sorted[0][1]*100)+'%"></div></div><div class="top-item-count">'+item[1]+'x</div></div>'; }).join('') || '<p style="font-size:11px;color:var(--text-faint)">Sem dados</p>';
  var payMap={}; valid.forEach(function(o){payMap[o.payment]=(payMap[o.payment]||0)+o.total;}); var total=Object.values(payMap).reduce(function(a,b){return a+b;},0)||1; var icons={PIX:'🟢',Dinheiro:'💵','Cartão de Crédito':'💳','Cartão de Débito':'💳'}; document.getElementById('paymentBreakdown').innerHTML=Object.entries(payMap).sort(function(a,b){return b[1]-a[1];}).map(function(e){ return '<div class="payment-breakdown-row"><div style="font-size:14px;width:20px">'+(icons[e[0]]||'💳')+'</div><div style="flex:1"><div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:4px"><span style="font-weight:700">'+e[0]+'</span><span style="color:var(--primary);font-weight:800">'+fmt(e[1])+'</span></div><div class="payment-bar-wrap"><div class="payment-bar" style="width:'+Math.round(e[1]/total*100)+'%"></div></div></div><div style="font-size:10px;color:var(--text-faint);width:30px;text-align:right">'+Math.round(e[1]/total*100)+'%</div></div>'; }).join('') || '<p style="font-size:11px;color:var(--text-faint)">Sem dados</p>';
}

// ════════════════════════════════════════════
// SETTINGS
// ════════════════════════════════════════════
function loadSettings(){
  document.getElementById('cfg-storeName').value=cfg.storeName;
  document.getElementById('cfg-storeAddr').value=cfg.storeAddr;
  if(document.getElementById('cfg-cnpj')) document.getElementById('cfg-cnpj').value=cfg.cnpj; 
  document.getElementById('cfg-phone').value=cfg.phone;
  document.getElementById('cfg-autoPrint').checked=cfg.autoPrint;
  document.getElementById('cfg-paper58').checked=cfg.paper58;
  document.getElementById('cfg-sound').checked=cfg.sound;
  if(document.getElementById('cfg-pixKey')) document.getElementById('cfg-pixKey').value=cfg.pixKey||'';
  if(document.getElementById('cfg-pixCity')) document.getElementById('cfg-pixCity').value=cfg.pixCity||'Natal';
}
function saveSettings(){
  cfg.storeName=document.getElementById('cfg-storeName').value; cfg.storeAddr=document.getElementById('cfg-storeAddr').value;
  if(document.getElementById('cfg-cnpj')) cfg.cnpj=document.getElementById('cfg-cnpj').value;
  cfg.phone=document.getElementById('cfg-phone').value; cfg.autoPrint=document.getElementById('cfg-autoPrint').checked;
  cfg.paper58=document.getElementById('cfg-paper58').checked; cfg.sound=document.getElementById('cfg-sound').checked;
  if(document.getElementById('cfg-pixKey')) cfg.pixKey=document.getElementById('cfg-pixKey').value.trim();
  if(document.getElementById('cfg-pixCity')) cfg.pixCity=document.getElementById('cfg-pixCity').value.trim()||'Natal';
  saveCfg(); toast('ok','Configurações salvas!','Todas as preferências foram atualizadas');
}

// ════════════════════════════════════════════
// BLUETOOTH PRINTER
// ════════════════════════════════════════════
async function connectPrinter(){
  if(!navigator.bluetooth){ toast('err','Bluetooth indisponível','Use Chrome/Edge em HTTPS ou Android'); return; }
  try{
    setPrinterStatus('connecting','Conectando...');
    btDevice = await navigator.bluetooth.requestDevice({ acceptAllDevices:true, optionalServices:['000018f0-0000-1000-8000-00805f9b34fb','e7810a71-73ae-499d-8c15-faa9aef0c3f2','00001101-0000-1000-8000-00805f9b34fb'] });
    var server = await btDevice.gatt.connect(); var services = await server.getPrimaryServices(); btChar = null;
    for(var s=0; s<services.length; s++){ var chars = await services[s].getCharacteristics(); for(var c=0; c<chars.length; c++){ if(chars[c].properties.write || chars[c].properties.writeWithoutResponse){ btChar = chars[c]; break; } } if(btChar) break; }
    if(!btChar) throw new Error("Nenhuma característica de escrita encontrada.");
    printerConnected=true; setPrinterStatus('connected',btDevice.name||'Impressora BT'); document.getElementById('printerStatusText').textContent=btDevice.name||'Conectada'; toast('ok','Impressora conectada!',btDevice.name||'Dispositivo Bluetooth');
    btDevice.addEventListener('gattserverdisconnected',function(){ printerConnected=false;btChar=null; setPrinterStatus('','Não conectada'); document.getElementById('printerStatusText').textContent='Desconectada'; toast('err','Impressora desconectada','Clique para reconectar'); });
  }catch(e){ setPrinterStatus('','Não conectada'); if(e.name!=='NotFoundError') toast('err','Erro ao conectar',e.message); }
}
function setPrinterStatus(cls,name){ var dot=document.getElementById('printerDot'); dot.className='printer-dot'+(cls?' '+cls:''); document.getElementById('printerName').textContent=name; }
async function sendToPrinter(data){
  if(!btChar){toast('err','Impressora não conectada','Conecte a impressora primeiro');return false;}
  try{ var chunkSize = 20; for(var i=0; i<data.length; i+=chunkSize){ var chunk = data.slice(i, i+chunkSize); if(btChar.properties.writeWithoutResponse) await btChar.writeValueWithoutResponse(chunk); else await btChar.writeValue(chunk); await new Promise(function(r){setTimeout(r, 50);}); } return true; }
  catch(e){ console.error(e); toast('err','Erro na impressora','Verifique se está ligada e com papel'); return false; }
}

// ════════════════════════════════════════════
// GERAÇÃO DO CUPOM
// ════════════════════════════════════════════
function cleanForPrinter(str){ if(!str) return ''; str = str.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); str = str.replace(/[^\x20-\x7E]/g, ''); return str; }
function cleanForPix(str){ if(!str) return ''; str = str.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); return str; }
function concatBytes() { var totalLen = 0; for (var i = 0; i < arguments.length; i++) totalLen += arguments[i].length; var result = new Uint8Array(totalLen); var offset = 0; for (var i = 0; i < arguments.length; i++) { result.set(arguments[i], offset); offset += arguments[i].length; } return result; }

var ESC_INIT=new Uint8Array([0x1B,0x40]),ESC_BOLD=new Uint8Array([0x1B,0x45,0x01]),ESC_NORMAL=new Uint8Array([0x1B,0x45,0x00]);
var ESC_CENTER=new Uint8Array([0x1B,0x61,0x01]),ESC_LEFT=new Uint8Array([0x1B,0x61,0x00]);
var ESC_LG=new Uint8Array([0x1D,0x21,0x11]),ESC_SM=new Uint8Array([0x1D,0x21,0x00]);
var ESC_CUT=new Uint8Array([0x1D,0x56,0x00]),LF=new Uint8Array([0x0A]);

function fmtDate(ts){ var d = new Date(ts); return String(d.getDate()).padStart(2,'0')+'/'+String(d.getMonth()+1).padStart(2,'0')+'/'+d.getFullYear()+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0')+'h'; }

// ════════════════════════════════════════════
// QR CODE ESC/POS (Modelo 2)
// ════════════════════════════════════════════
function buildQR(text) {
  var enc = new TextEncoder();
  var dataBytes = enc.encode(text);
  var dataLen = dataBytes.length;
  var paramLen = dataLen + 3;
  var pL = paramLen & 0xFF;
  var pH = (paramLen >> 8) & 0xFF;
  var QR_MODEL = new Uint8Array([0x1D, 0x28, 0x6B, 0x04, 0x00, 0x31, 0x41, 0x32, 0x30]);
  var QR_SIZE = new Uint8Array([0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x43, 0x06]);
  var QR_ERR = new Uint8Array([0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x45, 0x31]);
  var storeHeader = new Uint8Array([0x1D, 0x28, 0x6B, pL, pH, 0x31, 0x50, 0x30]);
  var storeData = concatBytes(storeHeader, dataBytes);
  var QR_PRINT = new Uint8Array([0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x51, 0x30]);
  return concatBytes(QR_MODEL, QR_SIZE, QR_ERR, storeData, QR_PRINT);
}

// ════════════════════════════════════════════
// PAYLOAD PIX (BRCode / EMV padrão Banco Central)
// ════════════════════════════════════════════
function pixTLV(id, value) {
  var len = value.length.toString().padStart(2, '0');
  return id + len + value;
}

function crc16CCITT(str) {
  var crc = 0xFFFF;
  for (var i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (var j = 0; j < 8; j++) {
      if (crc & 0x8000) {
        crc = (crc << 1) ^ 0x1021;
      } else {
        crc = crc << 1;
      }
      crc &= 0xFFFF;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function buildPixPayload(order) {
  var pixKey = cfg.pixKey || '';
  var valor = Number(order.total || 0).toFixed(2);
  var nome = cleanForPix(cfg.storeName || 'IMPERIO LANCHES').substring(0, 25);
  var cidade = cleanForPix(cfg.pixCity || 'Natal').substring(0, 15);

  // ID 00 - Payload Format Indicator
  var id00 = pixTLV('00', '01');

  // ID 26 - Merchant Account Information (PIX)
  var id26_00 = pixTLV('00', 'br.gov.bcb.pix');
  var id26_01 = pixTLV('01', pixKey);
  var id26_02 = pixTLV('02', 'Pedido #' + order.num);
  var id26 = pixTLV('26', id26_00 + id26_01 + id26_02);

  // ID 52 - Merchant Category Code
  var id52 = pixTLV('52', '0000');

  // ID 53 - Transaction Currency (986 = BRL)
  var id53 = pixTLV('53', '986');

  // ID 54 - Transaction Amount
  var id54 = pixTLV('54', valor);

  // ID 58 - Country Code
  var id58 = pixTLV('58', 'BR');

  // ID 59 - Merchant Name
  var id59 = pixTLV('59', nome);

  // ID 60 - Merchant City
  var id60 = pixTLV('60', cidade);

  // ID 62 - Additional Data Field Template
  var id62_05 = pixTLV('05', '***' + order.num);
  var id62 = pixTLV('62', id62_05);

  // Montar payload sem CRC
  var payload = id00 + id26 + id52 + id53 + id54 + id58 + id59 + id60 + id62;

  // ID 63 - CRC16 (placeholder + cálculo)
  payload += '6304';
  var crc = crc16CCITT(payload);
  payload += crc;

  return payload;
}

// ════════════════════════════════════════════
// CUPOM VIA COZINHA (sem QR Code)
// ════════════════════════════════════════════
function buildCouponOwner(o){
  var enc=new TextEncoder(), lines=[], w=cfg.paper58?32:42;
  function divider(ch){return (ch||'-').repeat(w);} function rowLR(l,r){var sp=Math.max(1,w-l.length-r.length);return l+' '.repeat(sp)+r;} function push(){for(var i=0;i<arguments.length;i++)lines.push(arguments[i]);}
  
  push(ESC_INIT, ESC_CENTER, ESC_LG, ESC_BOLD, enc.encode('IMPERIO LANCHES\n'));
  push(ESC_SM, ESC_NORMAL, enc.encode('CNPJ: 59.527.486/0001-63\n'));
  push(enc.encode('TELEFONE: 84 99442-8496\n'));
  push(enc.encode('Rua Herminio Macedo de Carvalho\n'));
  push(ESC_LEFT, enc.encode(divider('=')+'\n'));
  push(ESC_CENTER, ESC_BOLD, enc.encode('PEDIDO #'+o.num+'\n'));
  push(ESC_NORMAL, ESC_LEFT, enc.encode(divider('=')+'\n'));
  if(o.address) push(ESC_BOLD, enc.encode('ENDERECO: '), ESC_NORMAL, enc.encode(cleanForPrinter(o.address)+'\n'));
  
  push(LF, enc.encode(divider('-')+'\n'));
  var items = o.items || []; items.forEach(function(i){ var name=(i.qty+'x '+cleanForPrinter(i.name || 'Item')).slice(0,w-8); var val='R$'+Number(i.price || 0).toFixed(2).replace('.', ','); push(enc.encode(rowLR(name, val)+'\n')); var mods = i.mods || []; if(mods.length) mods.forEach(function(mod){ push(enc.encode('  + '+cleanForPrinter(mod)+'\n')); }); });
  
  push(enc.encode(divider('-')+'\n'));
  if(o.obs) push(ESC_BOLD, enc.encode('OBS: '), ESC_NORMAL, enc.encode(cleanForPrinter(o.obs)+'\n'));
  var totalFmt = 'R$'+Number(o.total || 0).toFixed(2).replace('.', ',');
  push(ESC_BOLD, enc.encode('VALOR TOTAL: '+totalFmt+'\n'), ESC_NORMAL);
  push(ESC_BOLD, enc.encode('FORMA DE PAGAMENTO: '+cleanForPrinter(o.payment).toUpperCase()+'\n'), ESC_NORMAL);
  push(LF, enc.encode(fmtDate(o.ts)+'\n')); push(LF,LF,ESC_CUT);
  return concatBytes.apply(null, lines);
}

// ════════════════════════════════════════════
// CUPOM VIA CLIENTE (QR Code PIX se pagamento=PIX)
// ════════════════════════════════════════════
function buildCouponClient(o){
  var enc=new TextEncoder(), lines=[], w=cfg.paper58?32:42;
  function divider(ch){return (ch||'-').repeat(w);} function rowLR(l,r){var sp=Math.max(1,w-l.length-r.length);return l+' '.repeat(sp)+r;} function push(){for(var i=0;i<arguments.length;i++)lines.push(arguments[i]);}
  
  push(ESC_INIT, ESC_CENTER, ESC_LG, ESC_BOLD, enc.encode('IMPERIO LANCHES\n'));
  push(ESC_SM, ESC_NORMAL, enc.encode('CNPJ: 59.527.486/0001-63\n'));
  push(enc.encode('TELEFONE: 84 99442-8496\n'));
  push(enc.encode('Rua Herminio Macedo de Carvalho\n'));
  push(ESC_LEFT, enc.encode(divider('=')+'\n'));
  push(ESC_CENTER, ESC_BOLD, enc.encode('PEDIDO #'+o.num+'\n'));
  push(ESC_NORMAL, ESC_LEFT, enc.encode(divider('=')+'\n'));
  if(o.address) push(ESC_BOLD, enc.encode('ENDERECO: '), ESC_NORMAL, enc.encode(cleanForPrinter(o.address)+'\n'));
  
  push(LF, enc.encode(divider('-')+'\n'));
  var items = o.items || []; items.forEach(function(i){ var name=(i.qty+'x '+cleanForPrinter(i.name || 'Item')).slice(0,w-8); var val='R$'+Number(i.price || 0).toFixed(2).replace('.', ','); push(enc.encode(rowLR(name, val)+'\n')); });
  
  push(enc.encode(divider('-')+'\n'));
  if(o.obs) push(ESC_BOLD, enc.encode('OBS: '), ESC_NORMAL, enc.encode(cleanForPrinter(o.obs)+'\n'));
  var totalFmt = 'R$'+Number(o.total || 0).toFixed(2).replace('.', ',');
  push(ESC_BOLD, enc.encode('VALOR TOTAL: '+totalFmt+'\n'), ESC_NORMAL);
  push(ESC_BOLD, enc.encode('FORMA DE PAGAMENTO: '+cleanForPrinter(o.payment).toUpperCase()+'\n'), ESC_NORMAL);

  // ── QR CODE: somente PIX com chave configurada ──
  var isPix = (o.payment || '').toUpperCase().indexOf('PIX') !== -1;
  if (isPix && cfg.pixKey) {
    push(LF, ESC_CENTER, ESC_BOLD, enc.encode('PAGUE VIA PIX\n'), ESC_NORMAL);
    push(enc.encode('Escaneie o QR Code abaixo\n'));
    push(LF);
    var pixPayload = buildPixPayload(o);
    push(buildQR(pixPayload));
    push(LF);
  }

  push(ESC_LEFT, enc.encode(fmtDate(o.ts)+'\n')); push(LF,LF,ESC_CUT);
  return concatBytes.apply(null, lines);
}

async function printOrder(num){
  var o=orders.find(function(x){return x.num===num;}); if(!o)return;
  if(!printerConnected){toast('err','Impressora não conectada','Conecte a impressora Bluetooth primeiro');return;}
  try {
    toast('info','Imprimindo...','Enviando 2 vias');
    await sendToPrinter(buildCouponOwner(o));
    await new Promise(function(r){setTimeout(r, 1500);});
    await sendToPrinter(buildCouponClient(o));
    toast('ok','2 Vias Impressas!','Cozinha e Cliente');
  } catch(e) { toast('err','Erro ao imprimir','Verifique a impressora: '+e.message); }
}

async function printTest(){
  if(!printerConnected){toast('err','Impressora não conectada','Conecte a impressora Bluetooth primeiro');return;}
  var enc=new TextEncoder();
  // Via 1: Cozinha
  var cupom1 = concatBytes(ESC_INIT,ESC_CENTER,ESC_BOLD,ESC_LG,enc.encode('VIA 1 - COZINHA\n'),ESC_SM,ESC_NORMAL,enc.encode('Teste OK\n'),ESC_CUT);
  // Via 2: Cliente com QR Code PIX de teste
  var testOrder = {num: 999, total: 1.00, customer: 'TESTE', payment: 'PIX'};
  var cupom2 = concatBytes(
    ESC_INIT, ESC_CENTER, ESC_BOLD, ESC_LG, enc.encode('VIA 2 - CLIENTE\n'), ESC_SM, ESC_NORMAL, enc.encode('Teste QR Code PIX\n'), LF,
    enc.encode('R$ 1,00 (teste)\n'), LF
  );
  if (cfg.pixKey) {
    cupom2 = concatBytes(cupom2, buildQR(buildPixPayload(testOrder)), LF);
  } else {
    cupom2 = concatBytes(cupom2, enc.encode('[SEM CHAVE PIX CONFIGURADA]\n'), LF);
  }
  cupom2 = concatBytes(cupom2, ESC_CUT);

  await sendToPrinter(cupom1); await new Promise(function(r){setTimeout(r, 1500);}); await sendToPrinter(cupom2);
  toast('ok','Teste impresso!','Verifique as 2 vias');
}

// ════════════════════════════════════════════
// NOTIFICAÇÕES & SOM & DADOS & RESET
// ════════════════════════════════════════════
function notifyNewOrder(o){ var al=document.getElementById('newOrderAlert'); document.getElementById('newOrderText').textContent='Novo pedido #'+o.num+' — '+o.customer+' — '+fmt(o.total)+(o.source==='site'?' (Site)':''); al.classList.add('show'); setTimeout(function(){al.classList.remove('show');},5000); if(soundEnabled) playBell(); }
function playBell(){ try{ var ctx=new AudioContext(), osc=ctx.createOscillator(), gain=ctx.createGain(); osc.connect(gain);gain.connect(ctx.destination); osc.frequency.setValueAtTime(880,ctx.currentTime); osc.frequency.setValueAtTime(1100,ctx.currentTime+0.1); osc.frequency.setValueAtTime(880,ctx.currentTime+0.2); gain.gain.setValueAtTime(0.4,ctx.currentTime); gain.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+0.5); osc.start();osc.stop(ctx.currentTime+0.5); }catch(e){} }
function toggleSound(){ soundEnabled=!soundEnabled; var btn=document.getElementById('soundBtn'); btn.innerHTML=soundEnabled?'<i class="fa-solid fa-volume-high"></i> <span>Som</span>':'<i class="fa-solid fa-volume-xmark"></i> <span>Mudo</span>'; btn.style.color=soundEnabled?'':'var(--red)'; }
function exportJSON(){ var data={orders:orders,config:cfg,exportedAt:new Date().toISOString()}; var blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}); var a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='pedidos_'+Date.now()+'.json';a.click(); toast('ok','Exportado!','Arquivo JSON baixado'); }
function clearLocalData(){ if(!confirm('Tem certeza? Todos os pedidos LOCAIS serão apagados!\n\nPedidos na nuvem NÃO serão afetados.'))return; orders=[];orderCounter=0;saveOrders(); refreshCurrentPage();toast('ok','Dados limpos','Pedidos locais removidos'); }

var ADMIN_PASS_RESET = "1204";
function showResetConfirm(){ document.getElementById('resetStep1').style.display = 'none'; document.getElementById('resetStep2').style.display = 'block'; document.getElementById('resetError').textContent = ''; setTimeout(function(){ var inp = document.getElementById('resetPassword'); if(inp) inp.focus(); }, 100); }
function cancelReset(){ document.getElementById('resetStep1').style.display = 'block'; document.getElementById('resetStep2').style.display = 'none'; document.getElementById('resetPassword').value = ''; document.getElementById('resetError').textContent = ''; }
function executeFullReset(){
  var pass = document.getElementById('resetPassword').value, errEl = document.getElementById('resetError');
  if(pass !== ADMIN_PASS_RESET){ errEl.textContent = 'Senha incorreta!'; document.getElementById('resetPassword').value = ''; document.getElementById('resetPassword').focus(); return; }
  errEl.textContent = ''; document.getElementById('resetPassword').value = ''; document.getElementById('resetPassword').placeholder = 'Processando...'; document.getElementById('resetPassword').disabled = true;
  var resetData = { aberto: true, aviso: "", taxa: 0, tempo: "30-45 min", desativados: [], desativadosOpts: [], orders: [], orderCounter: 1 };
  fetch(API_URL, { method: "PUT", headers: { "Content-Type": "application/json", "X-Master-Key": MASTER_KEY }, body: JSON.stringify(resetData) }).then(function(res){ if(!res.ok) throw new Error("HTTP " + res.status); return res.json(); }).then(function(){ orders = []; orderCounter = 0; lastCloudOrdersIds = []; localStorage.removeItem('imperioAdmOrders'); localStorage.removeItem('imperioAdmCfg'); cancelReset(); document.getElementById('resetPassword').placeholder = '••••••'; document.getElementById('resetPassword').disabled = false; loadSettings(); renderDashboard(); refreshCurrentPage(); toast('ok', 'Sistema resetado!', 'Nuvem + local limpos — Counter voltou para 1'); var body = document.querySelector('.main'); body.style.transition = 'opacity 0.3s'; body.style.opacity = '0'; setTimeout(function(){ body.style.opacity = '1'; }, 300); }).catch(function(e){ errEl.textContent = 'Erro na nuvem: ' + (e.message || 'Verifique a conexão'); document.getElementById('resetPassword').placeholder = '••••••'; document.getElementById('resetPassword').disabled = false; });
}

// ════════════════════════════════════════════
// INIT (ROBUSTO)
// ════════════════════════════════════════════
renderDashboard();
fetch(API_URL+"/latest",{headers:{"X-Master-Key":MASTER_KEY}}).then(function(r){return r.json();}).then(function(json){
  var data = json.record; if(typeof data.orderCounter === "number" && data.orderCounter > orderCounter) orderCounter = data.orderCounter;
}).catch(function(){});

fetchCloudOrders();
setInterval(function(){ fetchCloudOrders(); }, fetchInterval);

document.addEventListener('visibilitychange', function() {
  if (!document.hidden) {
    fetchCloudOrders(); 
    checkPrinterHealth(); 
  }
});