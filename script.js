
// ════════════════════════════════════════════
// CONFIGURAÇÃO
// ════════════════════════════════════════════
var cfg = JSON.parse(localStorage.getItem('imperioAdmCfg') || '{}');
cfg = Object.assign({storeName:'Império Lanches',storeAddr:'NATAL, RN',phone:'5584994994919',autoPrint:false,paper58:true,sound:true}, cfg);

var orders = JSON.parse(localStorage.getItem('imperioAdmOrders') || '[]');
var btDevice = null, btChar = null;
var printerConnected = false;
var soundEnabled = cfg.sound;
var selectedOrderId = null;
var currentFilter = 'all';
var orderCounter = orders.length > 0 ? Math.max(...orders.map(function(o){return o.num})) : 0;

// JSONBin config — mesmo BIN do admin-cloud.js
var BIN_ID = "69ff6740adc21f119a778293";
var MASTER_KEY = "$2a$10$zfLo4xQ0.IvfaaQaJbTDle3OU9eW24NU.iN7JbK9Ph9OpF0MiuRRu";
var API_URL = "https://api.jsonbin.io/v3/b/"+BIN_ID;
var lastCloudOrdersIds = [];

function saveOrders(){ localStorage.setItem('imperioAdmOrders', JSON.stringify(orders)); }
function saveCfg(){ localStorage.setItem('imperioAdmCfg', JSON.stringify(cfg)); }

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
    var data = json.record;
    if(!data || !data.orders || !data.orders.length){
      if(dot) dot.style.background = 'var(--green)';
      if(label) label.textContent = 'Conectado';
      return;
    }

    var newCount = 0;
    data.orders.forEach(function(co){
      // Evita duplicatas pelo _id
      if(lastCloudOrdersIds.indexOf(co._id) !== -1) return;
      // Verifica se já existe localmente pelo _id
      var exists = orders.some(function(o){ return o._cloudId === co._id; });
      if(exists) return;

      orderCounter++;
      var order = {
        num: orderCounter,
        customer: co.customer || 'Cliente',
        phone: co.phone || '',
        type: co.type || 'Delivery',
        address: co.address || '',
        items: (co.items || []).map(function(it){
          return {name: it.name || it, qty: it.qty || 1, price: it.price || 0, mods: it.modifiers || it.mods || []};
        }),
        payment: co.payment || 'PIX',
        total: co.total || 0,
        obs: co.obs || '',
        status: co.status || 'new',
        ts: co.ts || Date.now(),
        source: co.source || 'site',
        _cloudId: co._id
      };

      // Se o pedido veio com status "new", notificar
      if(order.status === 'new'){
        newCount++;
        orders.unshift(order);
        notifyNewOrder(order);
        if(cfg.autoPrint && printerConnected){
          setTimeout(function(){ printOrder(order.num); }, 1000);
        }
      } else {
        orders.unshift(order);
      }

      lastCloudOrdersIds.push(co._id);
    });

    // Manter no máximo 300 ids para não crescer infinito
    if(lastCloudOrdersIds.length > 300) lastCloudOrdersIds = lastCloudOrdersIds.slice(-200);

    saveOrders();
    refreshCurrentPage();

    if(dot) dot.style.background = 'var(--green)';
    if(label) label.textContent = 'Conectado';
    if(newCount > 0){
      toast('ok', newCount + ' novo(s) pedido(s)', 'Recebidos do site');
    }
  })
  .catch(function(e){
    console.error('[Admin] fetch err:', e);
    if(dot) dot.style.background = 'var(--red)';
    if(label) label.textContent = 'Erro';
    setTimeout(function(){
      if(dot) dot.style.background = 'var(--green)';
      if(label) label.textContent = 'Conectado';
    }, 3000);
  });
}

// ════════════════════════════════════════════
// ATUALIZAR STATUS NA NUVEM
// ════════════════════════════════════════════
function updateCloudStatus(cloudId, newStatus){
  if(!cloudId) return;
  fetch(API_URL+"/latest", {headers:{"X-Master-Key":MASTER_KEY}})
  .then(function(r){return r.json();})
  .then(function(json){
    var data = json.record;
    if(data.orders){
      data.orders.forEach(function(o){
        if(o._id === cloudId) o.status = newStatus;
      });
      fetch(API_URL, {
        method:"PUT",
        headers:{"Content-Type":"application/json","X-Master-Key":MASTER_KEY},
        body:JSON.stringify(data)
      });
    }
  })
  .catch(function(e){ console.error('[Admin] updateCloudStatus err:', e); });
}

// ════════════════════════════════════════════
// NAVEGAÇÃO
// ════════════════════════════════════════════
function showPage(id){
  document.querySelectorAll('.page').forEach(function(p){p.classList.remove('active');});
  document.querySelectorAll('.nav-item').forEach(function(n){n.classList.remove('active');});
  document.getElementById('page-'+id).classList.add('active');
  document.getElementById('nav-'+id).classList.add('active');
  var titles = {dashboard:['Dashboard','Visão geral do negócio'],orders:['Pedidos','Gerenciar pedidos recebidos'],analytics:['Relatórios de Vendas','Análise de desempenho'],settings:['Configurações','Preferências do sistema']};
  document.getElementById('pageTitle').textContent = titles[id][0];
  document.getElementById('pageSubtitle').textContent = titles[id][1];
  if(id==='dashboard') renderDashboard();
  if(id==='orders') renderOrders();
  if(id==='analytics') renderAnalytics();
  if(id==='settings') loadSettings();
  if(window.innerWidth<=720) document.getElementById('sidebar').classList.remove('open');
}

function toggleSidebar(){ document.getElementById('sidebar').classList.toggle('open'); }

function refreshCurrentPage(){
  var active = document.querySelector('.page.active');
  if(!active) return;
  var id = active.id.replace('page-','');
  if(id==='dashboard') renderDashboard();
  if(id==='orders') renderOrders();
  if(id==='analytics') renderAnalytics();
}

// ════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════
function fmt(v){ return 'R$ '+Number(v).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}); }
function formatNum(v){ return Number(v).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}); }
function statusLabel(s){ return {new:'🔔 Novo',preparing:'🔥 Preparando',ready:'✅ Pronto',delivered:'📦 Entregue',cancelled:'❌ Cancelado'}[s]||s; }
function relTime(ts){
  var d=Date.now()-ts;
  if(d<60000) return 'agora';
  if(d<3600000) return Math.round(d/60000)+'min atrás';
  if(d<86400000) return Math.round(d/3600000)+'h atrás';
  return new Date(ts).toLocaleDateString('pt-BR');
}

var toastTimer;
function toast(type,title,sub){
  var el=document.getElementById('toast');
  var icon=document.getElementById('toastIcon');
  icon.className='fa-solid toast-icon '+type;
  icon.classList.add(type==='ok'?'fa-circle-check':type==='err'?'fa-circle-xmark':'fa-circle-info');
  document.getElementById('toastTitle').textContent=title;
  document.getElementById('toastSub').textContent=sub||'';
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer=setTimeout(function(){el.classList.remove('show');},3500);
}

// ════════════════════════════════════════════
// DASHBOARD
// ════════════════════════════════════════════
function renderDashboard(){
  var today = new Date().toDateString();
  var todayOrders = orders.filter(function(o){ return new Date(o.ts).toDateString()===today && o.status!=='cancelled'; });
  var todayRev = todayOrders.reduce(function(a,b){return a+b.total;},0);
  var pending = orders.filter(function(o){ return ['new','preparing','ready'].indexOf(o.status)!==-1; });
  var ticket = todayOrders.length ? todayRev/todayOrders.length : 0;

  document.getElementById('statPedidos').textContent = todayOrders.length;
  document.getElementById('statVendas').textContent = fmt(todayRev);
  document.getElementById('statPendentes').textContent = pending.length;
  document.getElementById('statTicket').textContent = fmt(ticket);
  document.getElementById('trendPendentes').textContent = pending.length + ' abertos';

  var pb = document.getElementById('pendingBadge');
  var newOrders = orders.filter(function(o){return o.status==='new';});
  if(newOrders.length){ pb.style.display='flex'; pb.textContent=newOrders.length; }
  else pb.style.display='none';

  var recent = orders.slice().sort(function(a,b){return b.ts-a.ts;}).slice(0,5);
  var el = document.getElementById('recentOrdersList');
  if(!recent.length){ el.innerHTML='<div class="empty-orders"><i class="fa-solid fa-bag-shopping"></i><p>Nenhum pedido ainda</p></div>'; return; }
  el.innerHTML = recent.map(function(o){
    var srcBadge = o.source==='site'?'<span class="order-source">SITE</span>':'';
    return '<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border);cursor:pointer" onclick="showPage(\'orders\');setTimeout(function(){selectOrder('+o.num+')},100)">'+
      '<div style="display:flex;align-items:center;gap:10px">'+
        '<div style="width:32px;height:32px;background:var(--bg-input);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;color:var(--primary)">#'+o.num+'</div>'+
        '<div><div style="font-size:12px;font-weight:700">'+o.customer+srcBadge+'</div><div style="font-size:10px;color:var(--text-faint)">'+relTime(o.ts)+' · '+o.type+'</div></div>'+
      '</div>'+
      '<div style="display:flex;align-items:center;gap:10px">'+
        '<span class="order-status-badge badge-'+o.status+'">'+statusLabel(o.status)+'</span>'+
        '<span style="font-size:13px;font-weight:800;color:var(--primary)">'+fmt(o.total)+'</span>'+
      '</div></div>';
  }).join('');
}

// ════════════════════════════════════════════
// PEDIDOS
// ════════════════════════════════════════════
function renderOrders(){
  var search = document.getElementById('orderSearch').value.toLowerCase();
  var filtered = orders.filter(function(o){
    if(currentFilter!=='all' && o.status!==currentFilter) return false;
    if(search && o.customer.toLowerCase().indexOf(search)===-1 && String(o.num).indexOf(search)===-1) return false;
    return true;
  }).sort(function(a,b){return b.ts-a.ts;});

  var el = document.getElementById('ordersList');
  if(!filtered.length){ el.innerHTML='<div class="empty-orders"><i class="fa-solid fa-bag-shopping"></i><p>Nenhum pedido encontrado</p></div>'; return; }
  el.innerHTML = filtered.map(function(o){
    var srcBadge = o.source==='site'?'<span class="order-source">SITE</span>':'';
    return '<div class="order-card '+o.status+' '+(selectedOrderId===o.num?'selected':'')+'" onclick="selectOrder('+o.num+')">'+
      '<div class="order-card-top">'+
        '<div class="order-num"><i class="fa-solid fa-hashtag" style="font-size:10px;color:var(--text-faint)"></i>'+o.num+' — '+o.customer+srcBadge+'</div>'+
        '<span class="order-status-badge badge-'+o.status+'">'+statusLabel(o.status)+'</span>'+
      '</div>'+
      '<div class="order-items-preview">'+o.items.map(function(i){return i.qty+'x '+i.name;}).join(' · ')+'</div>'+
      '<div class="order-card-bottom">'+
        '<div class="order-customer"><i class="fa-solid fa-'+(o.type==='Delivery'?'motorcycle':o.type==='Mesa'?'utensils':'store')+'"></i> '+o.type+'</div>'+
        '<div><div class="order-value">'+fmt(o.total)+'</div><div class="order-time">'+relTime(o.ts)+'</div></div>'+
      '</div></div>';
  }).join('');
  if(selectedOrderId) renderDetail(selectedOrderId);
}

function selectOrder(num){
  selectedOrderId = num;
  renderOrders();
  renderDetail(num);
}

function renderDetail(num){
  var o = orders.find(function(x){return x.num===num;});
  if(!o){ document.getElementById('orderDetail').innerHTML='<div class="detail-empty"><i class="fa-solid fa-hand-pointer"></i><p style="font-size:12px">Selecione um pedido</p></div>'; return; }
  var el = document.getElementById('orderDetail');

  var nextActions = {
    new: '<button class="btn-status preparing-btn" onclick="updateStatus('+o.num+',\'preparing\')"><i class="fa-solid fa-fire-burner"></i> Iniciar Preparo</button>',
    preparing: '<button class="btn-status ready-btn" onclick="updateStatus('+o.num+',\'ready\')"><i class="fa-solid fa-bell"></i> Marcar Pronto</button>',
    ready: '<button class="btn-status delivered-btn" onclick="updateStatus('+o.num+',\'delivered\')"><i class="fa-solid fa-check-double"></i> Confirmar Entrega</button>',
    delivered: '', cancelled: ''
  };

  var srcLabel = o.source==='site'?'<div class="detail-info-row"><i class="fa-solid fa-globe" style="color:var(--blue)"></i><span style="color:var(--blue)">Pedido recebido pelo site</span></div>':'';

  el.innerHTML =
    '<div class="detail-header"><div><div class="detail-num">Pedido #'+o.num+'</div><div class="detail-time">'+new Date(o.ts).toLocaleString('pt-BR')+'</div></div><span class="order-status-badge badge-'+o.status+'">'+statusLabel(o.status)+'</span></div>'+
    srcLabel+
    '<div class="detail-section"><div class="detail-section-title"><i class="fa-solid fa-user"></i> Cliente</div>'+
      '<div class="detail-info-row"><i class="fa-solid fa-user"></i>'+o.customer+'</div>'+
      '<div class="detail-info-row"><i class="fa-solid fa-phone"></i>'+(o.phone||'—')+'</div>'+
      '<div class="detail-info-row"><i class="fa-solid fa-'+(o.type==='Delivery'?'motorcycle':o.type==='Mesa'?'utensils':'store')+'"></i>'+o.type+(o.address?' · '+o.address:'')+'</div>'+
      (o.obs?'<div class="detail-info-row"><i class="fa-solid fa-note-sticky"></i><span style="color:var(--yellow)">'+o.obs+'</span></div>':'')+
    '</div>'+
    '<div class="detail-section"><div class="detail-section-title"><i class="fa-solid fa-list"></i> Itens</div>'+
      o.items.map(function(i){
        var mods = (i.mods&&i.mods.length) ? '<div class="detail-item-mods">'+i.mods.join(', ')+'</div>' : '';
        return '<div class="detail-item"><div class="detail-item-left"><div class="detail-item-name">'+i.qty+'x '+i.name+'</div>'+mods+'</div><div class="detail-item-price">'+fmt(i.price)+'</div></div>';
      }).join('')+
    '</div>'+
    '<div class="detail-total-box"><div class="detail-total-row grand"><span>Total</span><span>'+fmt(o.total)+'</span></div></div>'+
    '<div class="detail-info-row" style="margin-bottom:12px"><i class="fa-solid fa-credit-card" style="color:var(--green)"></i><span style="color:var(--green);font-weight:700">'+o.payment+'</span></div>'+
    '<div class="detail-actions">'+
      (nextActions[o.status]||'')+
      '<button class="btn-print" onclick="printOrder('+o.num+')"><i class="fa-solid fa-print"></i> Imprimir Cupom</button>'+
      (o.status!=='delivered'&&o.status!=='cancelled'?'<button class="btn-cancel-order" onclick="updateStatus('+o.num+',\'cancelled\')"><i class="fa-solid fa-xmark"></i> Cancelar Pedido</button>':'')+
    '</div>';
}

function filterOrders(f,el){
  currentFilter = f;
  document.querySelectorAll('.filter-tab').forEach(function(t){t.classList.remove('active');});
  el.classList.add('active');
  renderOrders();
}
function searchOrders(){ renderOrders(); }

function updateStatus(num,status){
  var o = orders.find(function(x){return x.num===num;});
  if(!o) return;
  o.status = status;
  saveOrders();
  renderOrders();
  renderDashboard();
  toast('ok','Status atualizado','Pedido #'+num+' → '+statusLabel(status));
  // Atualizar na nuvem também
  if(o._cloudId) updateCloudStatus(o._cloudId, status);
}

// ════════════════════════════════════════════
// NOVO PEDIDO MANUAL
// ════════════════════════════════════════════
function openAddOrder(){ document.getElementById('addOrderModal').style.display='flex'; }
function closeAddOrder(){ document.getElementById('addOrderModal').style.display='none'; }

function addOrderManual(){
  var customer = document.getElementById('new-customer').value.trim();
  var itemsRaw = document.getElementById('new-items').value.trim();
  var total = parseFloat(document.getElementById('new-total').value)||0;
  if(!customer){ toast('err','Campo obrigatório','Informe o nome do cliente'); return; }
  if(!itemsRaw){ toast('err','Campo obrigatório','Informe os itens do pedido'); return; }
  if(!total){ toast('err','Campo obrigatório','Informe o valor total'); return; }

  var items = itemsRaw.split('\n').filter(Boolean).map(function(line){
    var m = line.match(/^(\d+)x?\s+(.+?)\s*[-–]\s*R?\$?\s*([\d.,]+)/i);
    if(m) return {qty:parseInt(m[1]),name:m[2].trim(),price:parseFloat(m[3].replace(',','.')),mods:[]};
    return {qty:1,name:line.trim(),price:total,mods:[]};
  });

  var type = document.getElementById('new-type').value;
  var address = '';
  if(type==='Delivery') address = document.getElementById('new-address').value.trim();
  else if(type==='Mesa') address = 'Mesa ' + (document.getElementById('new-table').value.trim()||'?');
  else address = 'Retirada no local';

  orderCounter++;
  var order = {
    num: orderCounter, customer: customer,
    phone: document.getElementById('new-phone').value.trim(),
    type: type, address: address, items: items,
    payment: document.getElementById('new-payment').value,
    total: total, obs: document.getElementById('new-obs').value.trim(),
    status: 'new', ts: Date.now(), source: 'manual'
  };
  orders.unshift(order); saveOrders();
  closeAddOrder(); showPage('orders'); selectOrder(orderCounter);
  toast('ok','Pedido criado!','#'+orderCounter+' — '+customer);
  notifyNewOrder(order);
  if(cfg.autoPrint && printerConnected) printOrder(orderCounter);
}

// ════════════════════════════════════════════
// ANALYTICS
// ════════════════════════════════════════════
function renderAnalytics(){
  var now=Date.now(), weekAgo=now-7*86400000, monthAgo=now-30*86400000;
  var valid=orders.filter(function(o){return o.status!=='cancelled';});
  var weekOrders=valid.filter(function(o){return o.ts>weekAgo;});
  var monthOrders=valid.filter(function(o){return o.ts>monthAgo;});
  document.getElementById('weekTotal').textContent = fmt(weekOrders.reduce(function(a,b){return a+b.total;},0));
  document.getElementById('monthTotal').textContent = fmt(monthOrders.reduce(function(a,b){return a+b.total;},0));
  document.getElementById('totalCustomers').textContent = Object.keys(valid.reduce(function(m,o){m[o.phone||o.customer]=1;return m;},{})).length;

  var itemMap={};
  valid.forEach(function(o){o.items.forEach(function(i){itemMap[i.name]=(itemMap[i.name]||0)+i.qty;});});
  var sorted=Object.entries(itemMap).sort(function(a,b){return b[1]-a[1];});
  document.getElementById('topItem').textContent = sorted[0]?sorted[0][0].split(' ').slice(0,2).join(' '):'—';

  var days=[];
  for(var i=6;i>=0;i--){var d=new Date(now-i*86400000);days.push({label:d.toLocaleDateString('pt-BR',{weekday:'short'}),rev:0,date:d.toDateString()});}
  valid.forEach(function(o){var ds=new Date(o.ts).toDateString();var d=days.find(function(x){return x.date===ds;});if(d)d.rev+=o.total;});
  var maxRev=Math.max.apply(null,days.map(function(d){return d.rev;}))||1;
  document.getElementById('barChart').innerHTML=days.map(function(d){
    return '<div class="bar-wrap"><div class="bar-val">'+(d.rev>0?fmt(d.rev).replace('R$ ',''):'' )+'</div><div class="bar" style="height:'+Math.round((d.rev/maxRev)*90)+'px" title="'+fmt(d.rev)+'"></div><div class="bar-label">'+d.label+'</div></div>';
  }).join('');

  var rankColors=['gold','silver','bronze'];
  document.getElementById('topItemsList').innerHTML=sorted.slice(0,6).map(function(item,i){
    return '<div class="top-item-row"><div class="top-item-rank '+(rankColors[i]||'')+'">'+(i+1)+'</div><div class="top-item-name">'+item[0]+'</div><div class="top-item-bar-wrap"><div class="top-item-bar" style="width:'+Math.round(item[1]/sorted[0][1]*100)+'%"></div></div><div class="top-item-count">'+item[1]+'x</div></div>';
  }).join('') || '<p style="font-size:11px;color:var(--text-faint)">Sem dados</p>';

  var payMap={};
  valid.forEach(function(o){payMap[o.payment]=(payMap[o.payment]||0)+o.total;});
  var total=Object.values(payMap).reduce(function(a,b){return a+b;},0)||1;
  var icons={PIX:'🟢',Dinheiro:'💵','Cartão de Crédito':'💳','Cartão de Débito':'💳'};
  document.getElementById('paymentBreakdown').innerHTML=Object.entries(payMap).sort(function(a,b){return b[1]-a[1];}).map(function(e){
    return '<div class="payment-breakdown-row"><div style="font-size:14px;width:20px">'+(icons[e[0]]||'💳')+'</div><div style="flex:1"><div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:4px"><span style="font-weight:700">'+e[0]+'</span><span style="color:var(--primary);font-weight:800">'+fmt(e[1])+'</span></div><div class="payment-bar-wrap"><div class="payment-bar" style="width:'+Math.round(e[1]/total*100)+'%"></div></div></div><div style="font-size:10px;color:var(--text-faint);width:30px;text-align:right">'+Math.round(e[1]/total*100)+'%</div></div>';
  }).join('') || '<p style="font-size:11px;color:var(--text-faint)">Sem dados</p>';
}

// ════════════════════════════════════════════
// SETTINGS
// ════════════════════════════════════════════
function loadSettings(){
  document.getElementById('cfg-storeName').value=cfg.storeName;
  document.getElementById('cfg-storeAddr').value=cfg.storeAddr;
  document.getElementById('cfg-phone').value=cfg.phone;
  document.getElementById('cfg-autoPrint').checked=cfg.autoPrint;
  document.getElementById('cfg-paper58').checked=cfg.paper58;
  document.getElementById('cfg-sound').checked=cfg.sound;
}
function saveSettings(){
  cfg.storeName=document.getElementById('cfg-storeName').value;
  cfg.storeAddr=document.getElementById('cfg-storeAddr').value;
  cfg.phone=document.getElementById('cfg-phone').value;
  cfg.autoPrint=document.getElementById('cfg-autoPrint').checked;
  cfg.paper58=document.getElementById('cfg-paper58').checked;
  cfg.sound=document.getElementById('cfg-sound').checked;
  saveCfg(); toast('ok','Configurações salvas!','Todas as preferências foram atualizadas');
}

// ════════════════════════════════════════════
// BLUETOOTH PRINTER (Web Bluetooth API)
// ════════════════════════════════════════════
async function connectPrinter(){
  if(!navigator.bluetooth){ toast('err','Bluetooth indisponível','Use Chrome/Edge em HTTPS ou Android'); return; }
  try{
    setPrinterStatus('connecting','Conectando...');
    btDevice = await navigator.bluetooth.requestDevice({
      acceptAllDevices:true,
      optionalServices:['000018f0-0000-1000-8000-00805f9b34fb','e7810a71-73ae-499d-8c15-faa9aef0c3f2','00001101-0000-1000-8000-00805f9b34fb']
    });
    var server = await btDevice.gatt.connect();
    var service,chars;
    var uuids=['000018f0-0000-1000-8000-00805f9b34fb','e7810a71-73ae-499d-8c15-faa9aef0c3f2'];
    for(var i=0;i<uuids.length;i++){try{service=await server.getPrimaryService(uuids[i]);break;}catch(e){}}
    if(!service){var svcs=await server.getPrimaryServices();service=svcs[0];}
    chars=await service.getCharacteristics();
    btChar=chars.find(function(c){return c.properties.write||c.properties.writeWithoutResponse;})||chars[0];
    printerConnected=true;
    setPrinterStatus('connected',btDevice.name||'Impressora BT');
    document.getElementById('printerStatusText').textContent=btDevice.name||'Conectada';
    toast('ok','Impressora conectada!',btDevice.name||'Dispositivo Bluetooth');
    btDevice.addEventListener('gattserverdisconnected',function(){
      printerConnected=false;btChar=null;
      setPrinterStatus('','Não conectada');
      document.getElementById('printerStatusText').textContent='Não conectada';
      toast('err','Impressora desconectada','Clique para reconectar');
    });
  }catch(e){
    setPrinterStatus('','Não conectada');
    if(e.name!=='NotFoundError') toast('err','Erro Bluetooth',e.message||String(e));
  }
}

function setPrinterStatus(cls,name){
  var dot=document.getElementById('printerDot');
  dot.className='printer-dot'+(cls?' '+cls:'');
  document.getElementById('printerName').textContent=name;
}

async function sendToPrinter(data){
  if(!btChar){toast('err','Impressora não conectada','Conecte a impressora primeiro');return false;}
  try{
    for(var i=0;i<data.length;i+=512){
      var chunk=data.slice(i,i+512);
      if(btChar.properties.writeWithoutResponse) await btChar.writeValueWithoutResponse(chunk);
      else await btChar.writeValue(chunk);
      await new Promise(function(r){setTimeout(r,50);});
    }
    return true;
  }catch(e){toast('err','Erro ao imprimir',e.message);return false;}
}

// ESC/POS
var ESC_INIT=[0x1B,0x40],ESC_BOLD=[0x1B,0x45,0x01],ESC_NORMAL=[0x1B,0x45,0x00];
var ESC_CENTER=[0x1B,0x61,0x01],ESC_LEFT=[0x1B,0x61,0x00];
var ESC_LG=[0x1D,0x21,0x11],ESC_SM=[0x1D,0x21,0x00];
var ESC_CUT=[0x1D,0x56,0x00],LF=[0x0A];

function buildCoupon(o){
  var enc=new TextEncoder();
  var lines=[];
  var w=cfg.paper58?32:42;
  function center(s){var pad=Math.floor((w-s.length)/2);return ' '.repeat(Math.max(0,pad))+s;}
  function divider(ch){return (ch||'-').repeat(w);}
  function rowLR(l,r){var sp=Math.max(1,w-l.length-r.length);return l+' '.repeat(sp)+r;}

  function push(){for(var i=0;i<arguments.length;i++)lines.push(arguments[i]);}

  push(ESC_INIT);
  push(ESC_CENTER,ESC_LG,ESC_BOLD,enc.encode(cfg.storeName.toUpperCase().slice(0,14)+'\n'));
  push(ESC_SM,ESC_NORMAL,enc.encode(center(cfg.storeAddr)+'\n'));
  push(ESC_LEFT,enc.encode(divider('=')+'\n'));
  push(ESC_CENTER,ESC_BOLD,ESC_LG,enc.encode('PEDIDO #'+o.num+'\n'));
  push(ESC_SM,ESC_NORMAL,ESC_LEFT,enc.encode(divider('=')+'\n'));
  push(LF,enc.encode('Data: '+new Date(o.ts).toLocaleString('pt-BR')+'\n'));
  push(enc.encode('Cliente: '+o.customer+'\n'));
  if(o.phone) push(enc.encode('Fone: '+o.phone+'\n'));
  push(enc.encode('Tipo: '+o.type+(o.address?' - '+o.address:'')+'\n'));
  push(enc.encode('Pagamento: '+o.payment+'\n'));
  if(o.obs) push(enc.encode('Obs: '+o.obs+'\n'));
  push(LF,enc.encode(divider()+'\n'),ESC_BOLD,enc.encode(rowLR('ITEM','TOTAL')+'\n'),ESC_NORMAL,enc.encode(divider()+'\n'));
  o.items.forEach(function(i){
    var name=(i.qty+'x '+i.name).slice(0,w-8);
    var val='R$'+formatNum(i.price);
    push(enc.encode(rowLR(name,val)+'\n'));
    if(i.mods&&i.mods.length){
      i.mods.forEach(function(mod){
        push(enc.encode('  + '+mod+'\n'));
      });
    }
  });
  push(enc.encode(divider('=')+'\n'),ESC_BOLD,enc.encode(rowLR('TOTAL','R$'+formatNum(o.total))+'\n'),ESC_NORMAL);
  push(LF,ESC_CENTER,enc.encode('Obrigado pela preferencia!\n'),enc.encode('Volte sempre!\n'));
  push(LF,LF,LF,ESC_CUT);
  return new Uint8Array(lines);
}

async function printOrder(num){
  var o=orders.find(function(x){return x.num===num;});
  if(!o)return;
  if(!printerConnected){toast('err','Impressora não conectada','Conecte a impressora Bluetooth primeiro');return;}
  var ok=await sendToPrinter(buildCoupon(o));
  if(ok) toast('ok','Cupom impresso!','Pedido #'+num+' enviado para a impressora');
}

async function printTest(){
  if(!printerConnected){toast('err','Impressora não conectada','Conecte a impressora Bluetooth primeiro');return;}
  var enc=new TextEncoder();
  var lines=[].concat(ESC_INIT,ESC_CENTER,ESC_BOLD,ESC_LG,enc.encode('TESTE OK\n'),ESC_SM,ESC_NORMAL,enc.encode('Impressora funcionando!\n'),ESC_CUT);
  await sendToPrinter(new Uint8Array(lines));
}

// ════════════════════════════════════════════
// NOTIFICAÇÕES & SOM
// ════════════════════════════════════════════
function notifyNewOrder(o){
  var al=document.getElementById('newOrderAlert');
  document.getElementById('newOrderText').textContent='Novo pedido #'+o.num+' — '+o.customer+' — '+fmt(o.total)+(o.source==='site'?' (Site)':'');
  al.classList.add('show');
  setTimeout(function(){al.classList.remove('show');},5000);
  if(soundEnabled) playBell();
}

function playBell(){
  try{
    var ctx=new AudioContext();
    var osc=ctx.createOscillator();
    var gain=ctx.createGain();
    osc.connect(gain);gain.connect(ctx.destination);
    osc.frequency.setValueAtTime(880,ctx.currentTime);
    osc.frequency.setValueAtTime(1100,ctx.currentTime+0.1);
    osc.frequency.setValueAtTime(880,ctx.currentTime+0.2);
    gain.gain.setValueAtTime(0.4,ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+0.5);
    osc.start();osc.stop(ctx.currentTime+0.5);
  }catch(e){}
}

function toggleSound(){
  soundEnabled=!soundEnabled;
  var btn=document.getElementById('soundBtn');
  btn.innerHTML=soundEnabled?'<i class="fa-solid fa-volume-high"></i> <span>Som</span>':'<i class="fa-solid fa-volume-xmark"></i> <span>Mudo</span>';
  btn.style.color=soundEnabled?'':'var(--red)';
}

// ════════════════════════════════════════════
// DADOS
// ════════════════════════════════════════════
function exportJSON(){
  var data={orders:orders,config:cfg,exportedAt:new Date().toISOString()};
  var blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  var a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='pedidos_'+Date.now()+'.json';a.click();
  toast('ok','Exportado!','Arquivo JSON baixado');
}
function clearLocalData(){
  if(!confirm('Tem certeza? Todos os pedidos LOCAIS serão apagados!\n\nPedidos na nuvem NÃO serão afetados.'))return;
  orders=[];orderCounter=0;saveOrders();
  refreshCurrentPage();toast('ok','Dados limpos','Pedidos locais removidos');
}

// ════════════════════════════════════════════
// INIT
// ════════════════════════════════════════════
renderDashboard();

// Buscar pedidos da nuvem imediatamente e a cada 6 segundos
fetchCloudOrders();
setInterval(fetchCloudOrders, 6000);