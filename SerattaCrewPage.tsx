import React, { useState, useEffect, useCallback } from 'react';
import { useContext } from 'react';
import { AuthContext } from './SerattaCrewApp';

// En el repo seratta-crew el supabase viene del contexto
function useAuth() {
  return useContext(AuthContext) || {};
}

// ══ PALETA MOBILE — más grande, más legible ══
const C = {
  bg:     '#08080f',
  bg2:    '#0f0f1a',
  bg3:    '#161624',
  gold:   '#FFB547',
  green:  '#00E676',
  red:    '#FF5252',
  blue:   '#448AFF',
  purple: '#B388FF',
  t1:     '#ffffff',
  t2:     '#A0A0B8',
  t3:     '#50506A',
};
const fmt = (n:number) => `$${Math.round(n).toLocaleString('es-CO')}`;

// Agrupa las distribuciones del TipNetwork de Nexum por factura → propina neta del mesero por mesa.
// Cada propina se reparte en varios pools; aquí sumamos lo que le tocó al empleado en cada cuenta.
function agruparPropinas(rows:any[]) {
  const map = new Map<string, any>();
  for (const r of rows) {
    const k = r.factura_id;
    const prev = map.get(k);
    if (prev) {
      prev.mi_propina += Number(r.employee_amount || 0);
      if (!prev.pools.includes(r.pool_name)) prev.pools.push(r.pool_name);
    } else {
      map.set(k, {
        factura_id:    k,
        mesa_num:      r.mesa_num,
        factura_total: Number(r.factura_total || 0),
        pct_propina:   r.pct_propina,
        tip_amount:    Number(r.tip_amount || 0),
        created_at:    r.created_at,
        mi_propina:    Number(r.employee_amount || 0),
        pools:         [r.pool_name],
      });
    }
  }
  return Array.from(map.values());
}

type Tab = 'home' | 'wallet' | 'performance' | 'propinas';

export default function SerattaCrewPage() {
  const { profile, signOut, supabase } = useAuth();
  const nombre = profile?.full_name || profile?.nombre_completo || 'Mesero';
  const inicial = nombre.charAt(0).toUpperCase();

  const [tab, setTab]           = useState<Tab>('home');
  const [wallet, setWallet]     = useState<any>(null);
  const [movimientos, setMovs]  = useState<any[]>([]);
  const [ranking, setRanking]   = useState<any[]>([]);
  const [propinas, setPropinas] = useState<any[]>([]);
  const [resumen, setResumen]   = useState<any>(null);
  const [solicitud, setSolicitud]     = useState<any>(null);
  const [solicitando, setSolicitando] = useState(false);
  const [loading, setLoading]   = useState(true);
  const [toast, setToast]       = useState('');

  const show = (m:string) => { setToast(m); setTimeout(()=>setToast(''),3000); };
  const hoy = new Date().toISOString().split('T')[0];

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [wl, mv, rk, pr, rs, sc] = await Promise.all([
      // Wallet de este mesero
      supabase.from('vista_wallet_empleado').select('*').eq('empleado_nombre', nombre).maybeSingle(),
      // Últimos movimientos del wallet
      supabase.from('wallet_ledger').select('*').eq('empleado_nombre', nombre).order('created_at', {ascending:false}).limit(20),
      // Ranking del día
      supabase.from('vista_ranking_period').select('*').eq('fecha', hoy).order('total_ganado', {ascending:false}).limit(20),
      // Propinas del día — TipNetwork de Nexum (lo que realmente entra al wallet del mesero)
      supabase.from('vista_tip_distribuciones').select('*').eq('empleado_nombre', nombre).eq('fecha', hoy).eq('wallet_enabled', true).order('created_at', {ascending:false}),
      // Resumen del día (ventas)
      supabase.from('vista_ventas_mesero').select('*').eq('fecha', hoy).eq('nombre', nombre).maybeSingle(),
      // Solicitud de retiro en curso (pendiente o aprobada)
      supabase.from('propinas_solicitudes_cobro').select('*').eq('mesero_nombre', nombre).in('estado', ['pendiente','aprobada']).order('solicitada_en', {ascending:false}).limit(1).maybeSingle(),
    ]);
    if (wl.data)   setWallet(wl.data);
    if (mv.data)   setMovs(mv.data);
    if (rk.data)   setRanking(rk.data);
    if (pr.data)   setPropinas(agruparPropinas(pr.data));
    if (rs.data)   setResumen(rs.data);
    setSolicitud(sc?.data || null);
    setLoading(false);
  }, [nombre, hoy]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Realtime — wallet actualizado
  useEffect(() => {
    const ch = supabase.channel('crew-wallet-' + nombre)
      .on('postgres_changes', { event:'INSERT', schema:'public', table:'wallet_ledger',
          filter:`empleado_nombre=eq.${nombre}` }, (p) => {
        fetchData();
        show(`💰 +${fmt((p.new as any).monto)} nuevo en tu wallet`);
        // Vibrar el celular
        if ('vibrate' in navigator) navigator.vibrate([200, 100, 200]);
      })
      .on('postgres_changes', { event:'INSERT', schema:'public', table:'flow_alertas',
          filter:`mesero=eq.${nombre}` }, (p) => {
        show(`🍽️ ${(p.new as any).plato} listo — Mesa ${(p.new as any).mesa_num}`);
        if ('vibrate' in navigator) navigator.vibrate([300]);
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [nombre, fetchData]);

  // Registrar Service Worker
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }, []);

  // Solicitar retiro anticipado de propinas → gerencia lo aprueba desde el módulo Propinas de Nexum
  const solicitarRetiro = async () => {
    if (solicitando) return;
    if (solicitud) { show('Ya tienes una solicitud en proceso'); return; }
    const monto = wallet?.disponible_retiro || 0;
    if (!wallet?.puede_retirar || monto <= 0) { show('Aún no puedes retirar'); return; }
    setSolicitando(true);
    const { error } = await supabase.from('propinas_solicitudes_cobro').insert({
      restaurante_id: wallet.restaurante_id,
      mesero_id:      profile?.id || null,
      mesero_nombre:  nombre,
      monto,
    });
    setSolicitando(false);
    if (error) { show('No se pudo enviar la solicitud'); return; }
    show('✅ Solicitud de retiro enviada a gerencia');
    fetchData();
  };

  // Posición en ranking del día
  const miRankingPos = ranking.findIndex(r => r.empleado_nombre === nombre);
  const totalPropinasHoy = propinas.reduce((s,p)=>s+(p.mi_propina||0), 0);

  return (
    <div style={{
      minHeight:'100vh', background:C.bg, color:C.t1,
      fontFamily:"'DM Sans',sans-serif",
      maxWidth:430, margin:'0 auto',
      display:'flex', flexDirection:'column',
      paddingBottom:80, // espacio para nav inferior
    }}>
      {toast && (
        <div style={{position:'fixed',top:16,left:'50%',transform:'translateX(-50%)',
          background:'#1e1e2e',border:`1px solid ${C.gold}`,color:'#fff',
          padding:'10px 20px',borderRadius:50,fontSize:13,fontWeight:700,zIndex:9999,
          whiteSpace:'nowrap',boxShadow:'0 4px 20px rgba(0,0,0,0.5)'}}>
          {toast}
        </div>
      )}

      {/* ── HEADER ── */}
      <div style={{
        background:C.bg2, padding:'20px 20px 16px',
        borderBottom:`1px solid rgba(255,255,255,0.07)`,
        position:'sticky', top:0, zIndex:10,
      }}>
        <div style={{display:'flex',alignItems:'center',gap:12}}>
          <div style={{
            width:44,height:44,borderRadius:'50%',flexShrink:0,
            background:`linear-gradient(135deg,${C.gold},#d4943a)`,
            display:'flex',alignItems:'center',justifyContent:'center',
            fontSize:20,fontWeight:900,color:'#000',
          }}>{inicial}</div>
          <div style={{flex:1}}>
            <div style={{fontSize:16,fontWeight:700}}>{nombre}</div>
            <div style={{fontSize:11,color:C.t3}}>Seratta Crew · OMM Bogotá</div>
          </div>
          {/* Saldo disponible en el header */}
          <div style={{textAlign:'right'}}>
            <div style={{fontSize:10,color:C.t3}}>Disponible</div>
            <div style={{fontFamily:"'Syne',sans-serif",fontSize:20,fontWeight:900,color:C.gold}}>
              {fmt(wallet?.disponible_retiro || 0)}
            </div>
          </div>
        </div>
      </div>

      {/* ── HOME ── */}
      {tab === 'home' && (
        <div style={{padding:'20px 16px',display:'flex',flexDirection:'column',gap:14}}>

          {/* Banner wallet */}
          <div style={{
            background:`linear-gradient(135deg,rgba(255,181,71,0.15),rgba(255,181,71,0.05))`,
            border:`1px solid ${C.gold}30`,borderRadius:20,padding:'18px 20px',
          }}>
            <div style={{fontSize:11,color:C.gold,fontWeight:700,textTransform:'uppercase',letterSpacing:'.1em',marginBottom:4}}>
              💰 Tu wallet hoy
            </div>
            <div style={{fontFamily:"'Syne',sans-serif",fontSize:36,fontWeight:900,color:C.gold,lineHeight:1}}>
              {fmt(wallet?.ganado_hoy || 0)}
            </div>
            <div style={{fontSize:12,color:C.t2,marginTop:6}}>Ganado hoy en propinas</div>
            <div style={{display:'flex',gap:10,marginTop:12}}>
              <div style={{flex:1,background:'rgba(255,255,255,0.05)',borderRadius:10,padding:'8px 10px'}}>
                <div style={{fontSize:9,color:C.t3,marginBottom:2}}>DISPONIBLE</div>
                <div style={{fontSize:14,fontWeight:700,color:C.green}}>{fmt(wallet?.disponible_retiro || 0)}</div>
              </div>
              <div style={{flex:1,background:'rgba(255,255,255,0.05)',borderRadius:10,padding:'8px 10px'}}>
                <div style={{fontSize:9,color:C.t3,marginBottom:2}}>PENDIENTE</div>
                <div style={{fontSize:14,fontWeight:700,color:C.gold}}>{fmt(wallet?.pendiente_cierre || 0)}</div>
              </div>
              <div style={{flex:1,background:'rgba(255,255,255,0.05)',borderRadius:10,padding:'8px 10px'}}>
                <div style={{fontSize:9,color:C.t3,marginBottom:2}}>TOTAL</div>
                <div style={{fontSize:14,fontWeight:700,color:C.blue}}>{fmt(wallet?.total_historico || 0)}</div>
              </div>
            </div>
            {wallet?.puede_retirar && (
              <div style={{marginTop:10,padding:'8px 12px',background:`${C.green}15`,border:`1px solid ${C.green}30`,borderRadius:10,fontSize:11,color:C.green,fontWeight:700,textAlign:'center'}}>
                ✓ Puedes solicitar retiro — saldo ≥ $200.000
              </div>
            )}
          </div>

          {/* Performance del día */}
          <div style={{background:C.bg2,border:`1px solid rgba(255,255,255,0.07)`,borderRadius:16,padding:'16px 18px'}}>
            <div style={{fontSize:12,fontWeight:700,marginBottom:12}}>📊 Tu día</div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
              {[
                {l:'Ventas cobradas',  v:fmt(resumen?.ventas_totales||0),    c:C.blue},
                {l:'Ticket promedio',  v:fmt(resumen?.ticket_promedio||0),   c:C.purple},
                {l:'Cuentas',          v:resumen?.cuentas||0,                 c:C.t1},
                {l:'Propinas hoy',    v:fmt(totalPropinasHoy),               c:C.gold},
              ].map(m=>(
                <div key={m.l} style={{background:C.bg3,borderRadius:10,padding:'10px 12px'}}>
                  <div style={{fontSize:9,color:C.t3,marginBottom:3,textTransform:'uppercase'}}>{m.l}</div>
                  <div style={{fontSize:16,fontWeight:700,color:m.c}}>{m.v}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Ranking del día */}
          {ranking.length > 0 && (
            <div style={{background:C.bg2,border:`1px solid rgba(255,255,255,0.07)`,borderRadius:16,padding:'16px 18px'}}>
              <div style={{fontSize:12,fontWeight:700,marginBottom:12}}>🏆 Tu posición hoy</div>
              {ranking.slice(0,5).map((r,i)=>{
                const esTu = r.empleado_nombre === nombre;
                return (
                  <div key={`${r.empleado_nombre}-${r.pool_code}`}
                    style={{
                      display:'flex',alignItems:'center',gap:10,
                      padding:'8px 10px',borderRadius:10,marginBottom:6,
                      background:esTu?`${C.gold}10`:'transparent',
                      border:esTu?`1px solid ${C.gold}30`:'1px solid transparent',
                    }}>
                    <div style={{width:28,height:28,borderRadius:8,background:i===0?`${C.gold}20`:C.bg3,display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,fontWeight:900,color:i===0?C.gold:C.t3,flexShrink:0}}>
                      {i===0?'🥇':i===1?'🥈':i===2?'🥉':`${i+1}`}
                    </div>
                    <div style={{flex:1}}>
                      <div style={{fontSize:12,fontWeight:esTu?700:400,color:esTu?C.t1:C.t2}}>{r.empleado_nombre}{esTu?' (tú)':''}</div>
                      <div style={{fontSize:9,color:C.t3}}>{r.pool_code?.replace(/_/g,' ')}</div>
                    </div>
                    <div style={{fontFamily:"'Syne',sans-serif",fontSize:14,fontWeight:700,color:esTu?C.gold:C.t2}}>{fmt(r.total_ganado||0)}</div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Acceso rápido */}
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
            {[
              {emoji:'💳',l:'Mi Wallet',     t:'wallet',     c:C.gold},
              {emoji:'📊',l:'Rendimiento',   t:'performance',c:C.blue},
              {emoji:'💰',l:'Propinas',      t:'propinas',   c:C.green},
              {emoji:'🔔',l:'Notificaciones',t:'home',       c:C.purple},
            ].map(b=>(
              <button key={b.l} onClick={()=>setTab(b.t as Tab)}
                style={{padding:'16px',borderRadius:14,border:`1px solid ${b.c}20`,background:`${b.c}08`,cursor:'pointer',textAlign:'center',transition:'all .15s',
                  display:'flex',flexDirection:'column',alignItems:'center',gap:6}}>
                <span style={{fontSize:24}}>{b.emoji}</span>
                <span style={{fontSize:11,fontWeight:700,color:b.c}}>{b.l}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── WALLET ── */}
      {tab === 'wallet' && (
        <div style={{padding:'20px 16px'}}>
          <div style={{fontFamily:"'Syne',sans-serif",fontSize:18,fontWeight:900,marginBottom:4}}>💳 Mi Wallet</div>
          <div style={{fontSize:11,color:C.t2,marginBottom:20}}>Mínimo de retiro: $200.000 · SLA 2 días</div>

          {/* Saldo grande */}
          <div style={{background:`linear-gradient(135deg,${C.gold}20,${C.gold}05)`,border:`1px solid ${C.gold}30`,borderRadius:20,padding:'24px 20px',textAlign:'center',marginBottom:16}}>
            <div style={{fontSize:11,color:C.gold,fontWeight:700,textTransform:'uppercase',marginBottom:6}}>Saldo disponible</div>
            <div style={{fontFamily:"'Syne',sans-serif",fontSize:44,fontWeight:900,color:C.gold}}>{fmt(wallet?.disponible_retiro||0)}</div>
            {solicitud ? (
              <div style={{marginTop:14,padding:'12px 16px',borderRadius:12,background:`${C.gold}15`,border:`1px solid ${C.gold}30`,fontSize:12,color:C.gold,fontWeight:700}}>
                🔄 Solicitud de {fmt(solicitud.monto)} {solicitud.estado==='aprobada' ? 'aprobada — en pago' : 'en revisión por gerencia'}
              </div>
            ) : wallet?.puede_retirar ? (
              <button onClick={solicitarRetiro} disabled={solicitando}
                style={{marginTop:14,padding:'12px 32px',borderRadius:50,border:'none',background:solicitando?'#1e1e2e':`linear-gradient(135deg,${C.green},#009944)`,color:'#000',fontSize:14,fontWeight:700,cursor:solicitando?'default':'pointer'}}>
                {solicitando ? 'Enviando...' : 'Solicitar retiro'}
              </button>
            ) : (
              <div style={{marginTop:10,fontSize:11,color:C.t3}}>
                Necesitas ${fmt(200000 - (wallet?.disponible_retiro||0))} más para retirar
              </div>
            )}
          </div>

          {/* Estados del wallet */}
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:20}}>
            {[
              {l:'Ganado hoy',       v:wallet?.ganado_hoy||0,       c:C.gold},
              {l:'Pendiente cierre', v:wallet?.pendiente_cierre||0, c:'#FFB547'},
              {l:'Total histórico',  v:wallet?.total_historico||0,  c:C.blue},
              {l:'Total pagado',     v:wallet?.total_pagado||0,     c:C.green},
            ].map(m=>(
              <div key={m.l} style={{background:C.bg2,borderRadius:12,padding:'12px 14px',border:`1px solid rgba(255,255,255,0.07)`}}>
                <div style={{fontSize:9,color:C.t3,textTransform:'uppercase',marginBottom:4}}>{m.l}</div>
                <div style={{fontFamily:"'Syne',sans-serif",fontSize:18,fontWeight:900,color:m.c}}>{fmt(m.v)}</div>
              </div>
            ))}
          </div>

          {/* Movimientos */}
          <div style={{fontFamily:"'Syne',sans-serif",fontSize:14,fontWeight:900,marginBottom:10}}>Últimos movimientos</div>
          {movimientos.length === 0 ? (
            <div style={{textAlign:'center',padding:40,color:C.t3}}>Sin movimientos aún</div>
          ) : (
            movimientos.map(mv=>{
              const esCredito = mv.monto > 0;
              const estados: any = {GENERATED:'⏳',AVAILABLE:'✅',REQUESTED:'🔄',PAID:'💚',HELD:'🔒'};
              return (
                <div key={mv.id} style={{display:'flex',alignItems:'center',gap:12,padding:'12px 14px',background:C.bg2,borderRadius:12,marginBottom:8,border:`1px solid rgba(255,255,255,0.05)`}}>
                  <div style={{width:36,height:36,borderRadius:10,background:esCredito?`${C.green}15`:`${C.red}15`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,flexShrink:0}}>
                    {esCredito?'💰':'💸'}
                  </div>
                  <div style={{flex:1}}>
                    <div style={{fontSize:11,fontWeight:600,marginBottom:1}}>{mv.pool_code?.replace(/_/g,' ')||mv.tipo}</div>
                    <div style={{fontSize:9,color:C.t3}}>{estados[mv.estado]||'⏳'} {mv.estado} · {new Date(mv.created_at).toLocaleDateString('es-CO',{day:'numeric',month:'short'})}</div>
                  </div>
                  <div style={{fontFamily:"'Syne',sans-serif",fontSize:16,fontWeight:900,color:esCredito?C.green:C.red}}>
                    {esCredito?'+':''}{fmt(mv.monto)}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ── PERFORMANCE ── */}
      {tab === 'performance' && (
        <div style={{padding:'20px 16px'}}>
          <div style={{fontFamily:"'Syne',sans-serif",fontSize:18,fontWeight:900,marginBottom:4}}>📊 Mi Rendimiento</div>
          <div style={{fontSize:11,color:C.t2,marginBottom:20}}>Hoy · {new Date().toLocaleDateString('es-CO',{weekday:'long',day:'numeric',month:'long'})}</div>

          {/* Ventas del día */}
          <div style={{background:C.bg2,border:`1px solid rgba(255,255,255,0.07)`,borderRadius:16,padding:'18px',marginBottom:14}}>
            <div style={{fontSize:12,fontWeight:700,color:C.blue,marginBottom:14}}>💼 Ventas cobradas</div>
            <div style={{fontFamily:"'Syne',sans-serif",fontSize:40,fontWeight:900,color:C.blue,marginBottom:4}}>
              {fmt(resumen?.ventas_totales||0)}
            </div>
            <div style={{fontSize:11,color:C.t3,marginBottom:12}}>{resumen?.cuentas||0} cuentas · ticket promedio {fmt(resumen?.ticket_promedio||0)}</div>
            {/* Barra de % del día */}
            <div style={{fontSize:10,color:C.t3,marginBottom:4}}>Tu % del total del día: {resumen?.pct_ventas_dia||0}%</div>
            <div style={{height:6,background:C.bg3,borderRadius:3,overflow:'hidden'}}>
              <div style={{height:'100%',width:`${resumen?.pct_ventas_dia||0}%`,background:C.blue,borderRadius:3}}/>
            </div>
          </div>

          {/* Propinas por pool */}
          <div style={{background:C.bg2,border:`1px solid rgba(255,255,255,0.07)`,borderRadius:16,padding:'18px',marginBottom:14}}>
            <div style={{fontSize:12,fontWeight:700,marginBottom:12}}>💰 Propinas por pool</div>
            {ranking.filter(r=>r.empleado_nombre===nombre).length === 0 ? (
              <div style={{textAlign:'center',padding:20,color:C.t3,fontSize:12}}>Sin propinas distribuidas hoy</div>
            ) : (
              ranking.filter(r=>r.empleado_nombre===nombre).map(r=>(
                <div key={r.pool_code} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 0',borderBottom:`1px solid rgba(255,255,255,0.04)`}}>
                  <div style={{flex:1}}>
                    <div style={{fontSize:11,fontWeight:600}}>{r.pool_code.replace(/_/g,' ')}</div>
                    <div style={{fontSize:9,color:C.t3}}>Score: {parseFloat(r.score_promedio||0).toFixed(3)} · {r.pct_del_pool}% del pool</div>
                  </div>
                  <div style={{fontFamily:"'Syne',sans-serif",fontSize:15,fontWeight:900,color:C.gold}}>{fmt(r.total_ganado||0)}</div>
                </div>
              ))
            )}
          </div>

          {/* Satisfacción placeholder */}
          <div style={{background:C.bg2,border:`1px solid rgba(255,255,255,0.07)`,borderRadius:16,padding:'18px'}}>
            <div style={{fontSize:12,fontWeight:700,marginBottom:12}}>⭐ Satisfacción del cliente</div>
            <div style={{textAlign:'center',padding:16,color:C.t3,fontSize:12}}>
              Las encuestas X-Care de tus mesas aparecerán aquí
            </div>
          </div>
        </div>
      )}

      {/* ── PROPINAS ── */}
      {tab === 'propinas' && (
        <div style={{padding:'20px 16px'}}>
          <div style={{fontFamily:"'Syne',sans-serif",fontSize:18,fontWeight:900,marginBottom:4}}>💰 Mis propinas</div>
          <div style={{fontSize:11,color:C.t2,marginBottom:20}}>Detalle de hoy</div>

          <div style={{background:`${C.gold}10`,border:`1px solid ${C.gold}30`,borderRadius:16,padding:'16px 18px',textAlign:'center',marginBottom:16}}>
            <div style={{fontSize:10,color:C.gold,fontWeight:700,textTransform:'uppercase',marginBottom:4}}>Total propinas hoy</div>
            <div style={{fontFamily:"'Syne',sans-serif",fontSize:36,fontWeight:900,color:C.gold}}>{fmt(totalPropinasHoy)}</div>
            <div style={{fontSize:11,color:C.t3,marginTop:4}}>{propinas.length} cuenta{propinas.length!==1?'s':''} con propina</div>
          </div>

          {propinas.length === 0 ? (
            <div style={{textAlign:'center',padding:40,color:C.t3}}>
              <div style={{fontSize:40,marginBottom:10}}>💰</div>
              <div>Sin propinas registradas hoy</div>
              <div style={{fontSize:11,marginTop:6}}>Se registran automáticamente al cobrar cuentas</div>
            </div>
          ) : (
            propinas.map(p=>(
              <div key={p.factura_id} style={{background:C.bg2,border:`1px solid rgba(255,255,255,0.07)`,borderRadius:12,padding:'12px 14px',marginBottom:8,display:'flex',alignItems:'center',gap:12}}>
                <div style={{width:36,height:36,borderRadius:10,background:`${C.gold}15`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,flexShrink:0}}>💰</div>
                <div style={{flex:1}}>
                  <div style={{fontSize:11,fontWeight:600}}>Mesa {p.mesa_num||'—'}</div>
                  <div style={{fontSize:9,color:C.t3}}>
                    {p.created_at ? new Date(p.created_at).toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit'}) : '—'} · {p.pct_propina}% · {p.pools.join(' · ')}
                  </div>
                </div>
                <div>
                  <div style={{fontFamily:"'Syne',sans-serif",fontSize:16,fontWeight:900,color:C.gold}}>{fmt(p.mi_propina||0)}</div>
                  <div style={{fontSize:9,color:C.t3,textAlign:'right'}}>de {fmt(p.factura_total||0)}</div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* ── NAV INFERIOR — estilo app nativa ── */}
      <div style={{
        position:'fixed', bottom:0, left:'50%', transform:'translateX(-50%)',
        width:'100%', maxWidth:430,
        background:C.bg2, borderTop:`1px solid rgba(255,255,255,0.1)`,
        display:'flex', paddingBottom:'env(safe-area-inset-bottom)',
        zIndex:100,
      }}>
        {[
          {id:'home',        emoji:'🏠', l:'Inicio'},
          {id:'wallet',      emoji:'💳', l:'Wallet'},
          {id:'performance', emoji:'📊', l:'Rendimiento'},
          {id:'propinas',    emoji:'💰', l:'Propinas'},
        ].map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id as Tab)}
            style={{
              flex:1, padding:'10px 4px 8px', background:'none', border:'none', cursor:'pointer',
              display:'flex', flexDirection:'column', alignItems:'center', gap:3,
              borderTop:`2px solid ${tab===t.id?C.gold:'transparent'}`,
              transition:'all .15s',
            }}>
            <span style={{fontSize:20}}>{t.emoji}</span>
            <span style={{fontSize:9,fontWeight:700,color:tab===t.id?C.gold:C.t3}}>{t.l}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
