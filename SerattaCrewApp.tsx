import React, { useEffect, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import SerattaCrewPage from './SerattaCrewPage'

// ══ Supabase — mismo proyecto que Nexum V4 ══
// La anon key es pública (segura para el cliente); se puede sobreescribir con VITE_SUPABASE_ANON_KEY.
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt4YXhqdHR2a2FlZXdzamJwZXJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkxMTc0MjgsImV4cCI6MjA4NDY5MzQyOH0.fMINxNqrLT6f8lNPrpRZYPpm6IjTlKg6wAH7aAlfz_o'

const supabase = createClient(
  'https://kxaxjttvkaeewsjbpert.supabase.co',
  import.meta.env.VITE_SUPABASE_ANON_KEY || SUPABASE_ANON_KEY
)

// Context de auth
export const AuthContext = React.createContext<any>(null)

export default function SerattaCrewApp() {
  const [session, setSession]   = useState<any>(null)
  const [profile, setProfile]   = useState<any>(null)
  const [loading, setLoading]   = useState(true)
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [logging, setLogging]   = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      if (data.session) fetchProfile(data.session.user.id)
      else setLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s)
      if (s) fetchProfile(s.user.id)
      else { setProfile(null); setLoading(false) }
    })
    return () => subscription.unsubscribe()
  }, [])

  const fetchProfile = async (userId: string) => {
    const { data } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle()
    setProfile(data)
    setLoading(false)
  }

  const signIn = async () => {
    setLogging(true); setError('')
    const { error: e } = await supabase.auth.signInWithPassword({ email, password })
    if (e) setError('Email o contraseña incorrectos')
    setLogging(false)
  }

  const signOut = () => supabase.auth.signOut()

  // Loading
  if (loading) return (
    <div style={{ background:'#08080f', height:'100vh', display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:12 }}>
      <div style={{ fontSize:40 }}>⚡</div>
      <div style={{ color:'#FFB547', fontSize:14, fontWeight:700 }}>Seratta Crew</div>
    </div>
  )

  // Login
  if (!session) return (
    <div style={{ background:'#08080f', minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', padding:24, fontFamily:"'DM Sans',sans-serif" }}>
      <div style={{ width:'100%', maxWidth:360 }}>
        {/* Logo */}
        <div style={{ textAlign:'center', marginBottom:36 }}>
          <div style={{ fontSize:52, marginBottom:8 }}>⚡</div>
          <div style={{ fontFamily:"'Syne',sans-serif", fontSize:28, fontWeight:900, color:'#fff' }}>Seratta</div>
          <div style={{ fontSize:14, color:'#FFB547', fontWeight:700 }}>CREW</div>
          <div style={{ fontSize:12, color:'#50506A', marginTop:6 }}>Tu panel de rendimiento y propinas</div>
        </div>

        {/* Form */}
        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
          <div>
            <div style={{ fontSize:11, color:'#50506A', fontWeight:700, marginBottom:4, textTransform:'uppercase' }}>Email</div>
            <input
              type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="tu@seratta.co"
              style={{ width:'100%', padding:'14px 16px', borderRadius:12, border:'1px solid rgba(255,255,255,0.12)', background:'rgba(255,255,255,0.05)', color:'#fff', fontSize:15, outline:'none' }}
            />
          </div>
          <div>
            <div style={{ fontSize:11, color:'#50506A', fontWeight:700, marginBottom:4, textTransform:'uppercase' }}>Contraseña</div>
            <input
              type="password" value={password} onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              onKeyDown={e => e.key === 'Enter' && signIn()}
              style={{ width:'100%', padding:'14px 16px', borderRadius:12, border:'1px solid rgba(255,255,255,0.12)', background:'rgba(255,255,255,0.05)', color:'#fff', fontSize:15, outline:'none' }}
            />
          </div>
          {error && <div style={{ color:'#FF5252', fontSize:12, textAlign:'center' }}>{error}</div>}
          <button onClick={signIn} disabled={logging}
            style={{ width:'100%', padding:'16px', borderRadius:12, border:'none', background:logging?'#1e1e2e':'linear-gradient(135deg,#FFB547,#d4943a)', color:'#000', fontSize:16, fontWeight:700, cursor:'pointer', marginTop:4 }}>
            {logging ? 'Ingresando...' : 'Entrar →'}
          </button>
        </div>

        <div style={{ textAlign:'center', marginTop:24, fontSize:11, color:'#50506A' }}>
          OMM · Grupo Seratta · Bogotá
        </div>
      </div>
    </div>
  )

  return (
    <AuthContext.Provider value={{ profile: { ...profile, full_name: profile?.full_name || session.user.email }, signOut, supabase }}>
      <SerattaCrewPage />
    </AuthContext.Provider>
  )
}
