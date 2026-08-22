'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, CircleGauge, Film, KeyRound, LoaderCircle, Play, RefreshCw, Save, ShieldCheck, UserRound } from 'lucide-react';
import { Route } from './routing';

type Profile = { name:string; maturity:string; accent:string; autoplay:boolean; dataSaver:boolean; subtitles:boolean };
type VideoFile = { index:number; name:string; size:number; path:string };
type Magnet = { id:number; filename:string; size:number; status:string; statusCode:number; downloaded?:number; downloadSpeed?:number; videoFiles:VideoFile[] };
const defaults:Profile={name:'Kheyflix Viewer',maturity:'16+',accent:'#e50914',autoplay:true,dataSaver:false,subtitles:true};
const storageKey='kheyflix.profile.v1';
const formatBytes=(bytes=0)=>bytes?`${(bytes/1024/1024/1024).toFixed(bytes>10*1024**3?1:2)} GB`:'—';

export default function ProfilePage({navigate}:{navigate:(route:Route)=>void}) {
  const [profile,setProfile]=useState<Profile>(()=>{try{const value=localStorage.getItem(storageKey);return value?{...defaults,...JSON.parse(value)}:defaults}catch{return defaults}}),[saved,setSaved]=useState(false);
  const [magnets,setMagnets]=useState<Magnet[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState('');
  const [magnet,setMagnet]=useState(''),[rights,setRights]=useState(false),[adding,setAdding]=useState(false),[notice,setNotice]=useState('');
  const loadLibrary=useCallback(async()=>{setLoading(true);setError('');try{const response=await fetch('/api/debrid/magnets',{cache:'no-store'});const data=await response.json();if(!response.ok)throw new Error(data.error?.message||'Media library unavailable.');setMagnets(data.magnets||[])}catch(reason){setError(reason instanceof Error?reason.message:'Media library unavailable.')}finally{setLoading(false)}},[]);
  useEffect(()=>{const timer=setTimeout(()=>void loadLibrary(),0);return()=>clearTimeout(timer)},[loadLibrary]);
  const save=()=>{localStorage.setItem(storageKey,JSON.stringify(profile));setSaved(true);setTimeout(()=>setSaved(false),1800)};
  const addMagnet=async(e:React.FormEvent)=>{e.preventDefault();setAdding(true);setNotice('');try{const response=await fetch('/api/debrid/magnets',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({magnet,rightsConfirmed:rights})});const data=await response.json();if(!response.ok)throw new Error(data.error?.message||'Magnet could not be added.');setMagnet('');setRights(false);setNotice(data.magnet.ready?'Media is ready to stream.':'Magnet added. AllDebrid is preparing the files.');await loadLibrary()}catch(reason){setNotice(reason instanceof Error?reason.message:'Magnet could not be added.')}finally{setAdding(false)}};
  return <section className="profile-page">
    <div className="profile-hero"><div className="profile-avatar" style={{background:`linear-gradient(135deg,${profile.accent},#191a20)`}}>{profile.name.slice(0,1).toUpperCase()}</div><div><p>KHEYFLIX PROFILE</p><h1>{profile.name}</h1><span>Your viewing preferences and authorized media library.</span></div></div>
    <div className="profile-layout">
      <section className="profile-panel" aria-labelledby="identity-title"><div className="panel-title"><UserRound/><div><h2 id="identity-title">Profile settings</h2><p>Saved privately on this device.</p></div></div>
        <label>Profile name<input value={profile.name} maxLength={32} onChange={e=>setProfile({...profile,name:e.target.value})}/></label>
        <div className="field-row"><label>Maturity limit<select value={profile.maturity} onChange={e=>setProfile({...profile,maturity:e.target.value})}><option>7+</option><option>13+</option><option>16+</option><option>18+</option></select></label><label>Profile color<input type="color" value={profile.accent} onChange={e=>setProfile({...profile,accent:e.target.value})}/></label></div>
        <div className="setting-list"><label><span><strong>Autoplay</strong><small>Start selected titles automatically</small></span><input type="checkbox" checked={profile.autoplay} onChange={e=>setProfile({...profile,autoplay:e.target.checked})}/></label><label><span><strong>Data saver</strong><small>Prefer efficient streaming quality</small></span><input type="checkbox" checked={profile.dataSaver} onChange={e=>setProfile({...profile,dataSaver:e.target.checked})}/></label><label><span><strong>Subtitles by default</strong><small>Enable available subtitle tracks</small></span><input type="checkbox" checked={profile.subtitles} onChange={e=>setProfile({...profile,subtitles:e.target.checked})}/></label></div>
        <button className="save-profile" type="button" onClick={save}>{saved?<Check/>:<Save/>}{saved?'Saved':'Save profile'}</button>
      </section>
      <section className="profile-panel library-panel" aria-labelledby="library-title"><div className="panel-title"><Film/><div><h2 id="library-title">Authorized media library</h2><p>AllDebrid magnets you are entitled to access.</p></div><button className="refresh-library" type="button" onClick={()=>void loadLibrary()} aria-label="Refresh media library"><RefreshCw className={loading?'spin':''}/></button></div>
        <div className="integration-note"><KeyRound/><p><strong>Server-side AllDebrid</strong><span>The key remains on the backend. Add only public-domain, Creative Commons, or personally licensed media.</span></p></div>
        <form className="magnet-form" onSubmit={addMagnet}><label>Magnet URI<textarea rows={3} value={magnet} onChange={e=>setMagnet(e.target.value)} placeholder="magnet:?xt=urn:btih:…" required/></label><label className="rights-confirm"><input type="checkbox" checked={rights} onChange={e=>setRights(e.target.checked)} required/><span><ShieldCheck/> I confirm I am authorized to stream this content.</span></label><button type="submit" disabled={adding||!rights}>{adding?<LoaderCircle className="spin"/>:<CircleGauge/>}{adding?'Adding…':'Add to library'}</button>{notice&&<p className="form-notice" role="status">{notice}</p>}</form>
        {loading?<div className="library-state"><LoaderCircle className="spin"/>Loading library…</div>:error?<div className="library-state error"><KeyRound/><strong>Library unavailable</strong><span>{error}</span></div>:magnets.length===0?<div className="library-state"><Film/><strong>No magnets yet</strong><span>Add an authorized magnet to begin.</span></div>:<div className="magnet-list">{magnets.map(item=><article key={item.id} className="magnet-item"><div className="magnet-summary"><div><strong>{item.filename}</strong><span>{formatBytes(item.size)} · {item.status}</span></div><b className={item.statusCode===4?'ready':''}>{item.statusCode===4?'READY':`${Math.round((item.downloaded||0)/(item.size||1)*100)}%`}</b></div>{item.statusCode!==4&&<progress value={item.downloaded||0} max={item.size||1}/>} {item.videoFiles.map(file=><button className="video-file" key={file.index} onClick={()=>navigate({section:'stream',id:String(item.id),file:file.index,title:file.name})}><span><Play fill="currentColor"/><span><strong>{file.name}</strong><small>{file.path} · {formatBytes(file.size)}</small></span></span><b>Play</b></button>)}</article>)}</div>}
      </section>
    </div>
  </section>;
}
