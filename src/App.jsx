import { useState, useRef, useEffect, useCallback } from "react"; // v2.1
import { MuscleMap, computeSessionMuscles, computeRecentMuscles } from "./muscleData";

// ─── CONFIG ───────────────────────────────────────────────────────────────────
// Remplace par ton domaine quand il sera configuré
const API = "http://51.159.146.5";

// ─── TOKENS ───────────────────────────────────────────────────────────────────
// Dark canvas + white cards — fitness app signature
const C = {
  // Canvas
  bg:"#0a0c12",        // near-black canvas
  surf:"#13161f",      // elevated surface
  surfHigh:"#1a1f2e",  // higher elevation
  // Borders
  bord:"rgba(255,255,255,0.08)",
  bordM:"rgba(255,255,255,0.14)",
  bordL:"rgba(255,255,255,0.22)",
  // Brand colors
  indigo:"#6366f1",    indigoD:"#4f46e5",  indigoL:"rgba(99,102,241,0.15)",
  blue:"#3b82f6",      blueD:"#2563eb",    blueL:"rgba(59,130,246,0.15)",
  green:"#10b981",     greenD:"#059669",   greenL:"rgba(16,185,129,0.15)",
  violet:"#8b5cf6",    violetD:"#7c3aed",  violetL:"rgba(139,92,246,0.15)",
  red:"#ef4444",       redD:"#dc2626",     redL:"rgba(239,68,68,0.15)",
  orange:"#f97316",    orangeD:"#ea580c",  orangeL:"rgba(249,115,22,0.15)",
  // Text
  t1:"#f9fafb",   t2:"#e5e7eb",   t3:"#9ca3af",   t4:"#6b7280",
  // Semantic aliases (for legacy compatibility)
  high:"#1a1f2e", blueL2:"rgba(59,130,246,0.12)", greenL2:"rgba(16,185,129,0.12)",
  orangeL2:"rgba(249,115,22,0.12)", redL2:"rgba(239,68,68,0.12)",
  dt1:"#f9fafb",  dt2:"#9ca3af",  dt3:"#4b5563",
};

// ─── LOCAL STORAGE helpers ────────────────────────────────────────────────────
const store = {
  get:(k)=>{ try{return JSON.parse(localStorage.getItem(k))}catch{return null} },
  set:(k,v)=>{ try{localStorage.setItem(k,JSON.stringify(v))}catch{} },
  del:(k)=>{ try{localStorage.removeItem(k)}catch{} },
};

// ─── API helpers ──────────────────────────────────────────────────────────────
async function apiFetch(path, opts={}, token=null) {
  const headers = { "Content-Type":"application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const r = await fetch(API+path, { ...opts, headers: { ...headers, ...(opts.headers||{}) } });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}

// ─── SYSTEM PROMPT ────────────────────────────────────────────────────────────
function durationGuidance(duration) {
  // Donne des règles de structure concrètes selon le temps disponible
  if (duration <= 20) return {
    label: "Express (≤20 min)",
    rules: `- MAX 4 exercices par séance, uniquement des mouvements composés (squat, pompes, rowing, fentes)
- 2-3 séries par exercice, pas de superset ni d'isolation
- Repos courts : 30-45 sec entre les séries
- Échauffement réduit à 3 minutes (mobilité essentielle uniquement)
- Pas de retour au calme détaillé, juste 2 étirements clés`,
  };
  if (duration <= 35) return {
    label: "Courte (21-35 min)",
    rules: `- 5 exercices maximum, priorité aux mouvements polyarticulaires
- 3 séries par exercice
- Repos 45-60 sec
- Échauffement 5 minutes
- Retour au calme 3-5 minutes (2-3 étirements)`,
  };
  if (duration <= 50) return {
    label: "Standard (36-50 min)",
    rules: `- 6 exercices, mélange composés + un peu d'isolation
- 3-4 séries par exercice
- Repos 60-90 sec selon l'exercice
- Échauffement complet 8-10 minutes
- Retour au calme complet 8-10 minutes`,
  };
  if (duration <= 70) return {
    label: "Longue (51-70 min)",
    rules: `- 7-8 exercices, structure complète avec accessoires (isolation incluse)
- 3-4 séries par exercice, certains exercices en superset possibles
- Repos 60-120 sec selon l'intensité
- Échauffement complet 10-12 minutes
- Retour au calme complet 10 minutes`,
  };
  return {
    label: "Complète (71-90 min)",
    rules: `- 8-10 exercices, programme complet avec accessoires et finishers
- 4 séries par exercice, supersets possibles en fin de séance
- Repos 90-120 sec sur les gros mouvements, 45-60 sec sur l'isolation
- Échauffement approfondi 12-15 minutes (mobilité + activation)
- Retour au calme complet 10-12 minutes`,
  };
}

function makePrompt(p, firstName) {
  const imc = (p.weight/((p.height/100)**2)).toFixed(1);
  const f = p.gender==="femme";
  const metab = f
    ? `Metabolisme FEMME: ${Math.round(10*p.weight+6.25*p.height-5*p.age-161)} kcal`
    : `Metabolisme HOMME: ${Math.round(10*p.weight+6.25*p.height-5*p.age+5)} kcal`;
  const duration = p.duration || 45;
  const dg = durationGuidance(duration);
  const age = p.age || 40;
  const weight = p.weight || 75;
  const ageCtx = age >= 85 ? `
AGE TRÈS AVANCÉ (${age} ans) — RÈGLES IMPÉRATIVES:
- Exercices uniquement en position assise ou allongée si besoin
- Intensité très faible, priorité absolue à la sécurité et l'autonomie
- Étirements doux, respiration, équilibre, coordination
- Éviter tout mouvement qui sollicite les articulations sous charge lourde
- Programme axé sur le maintien de la mobilité et prévention des chutes` :
  age >= 75 ? `
AGE AVANCÉ (${age} ans) — RÈGLES IMPORTANTES:
- Priorité équilibre, mobilité, prévention des chutes
- Exercices portés favorisés, éviter les sauts et impacts
- Récupération allongée entre les séries (2-3 min)
- Progressivité très prudente, jamais de max effort` :
  age >= 65 ? `
SENIOR (${age} ans) — ADAPTATIONS:
- Échauffement prolongé (15 min minimum)
- Priorité à la densité osseuse et à l'équilibre
- Charges modérées, technique irréprochable
- Récupération suffisante entre les séances (48-72h)` : "";
  const weightCtx = weight >= 150 ? `
POIDS ÉLEVÉ (${weight} kg) — ADAPTATIONS OBLIGATOIRES:
- Exercices portés uniquement au début (piscine, vélo, elliptique si disponible)
- Protéger genoux, hanches et dos : éviter les sauts et impacts
- Progression très lente, priorité à la régularité sur l'intensité
- Contrôle médical recommandé avant démarrage` :
  weight >= 120 ? `
SURPOIDS (${weight} kg) — ADAPTATIONS:
- Favoriser les exercices à faible impact articulaire
- Développer la mobilité avant d'augmenter les charges
- Cardio doux (marche, vélo) en complément` : "";
  return `Tu es un coach sportif expert pour adultes 40-70 ans. Tu t'adresses à ${firstName}.

PROFIL: ${p.gender||"non précisé"}, ${p.age} ans, ${p.weight}kg, ${p.height}cm, IMC ${imc}
${metab}
Objectif: ${p.goal} | Niveau: ${p.level} | ${p.days}j/semaine | Equipement: ${p.equip}
DURÉE DE SÉANCE DISPONIBLE: ${duration} minutes — type "${dg.label}"
${p.limits?"Limitations: "+p.limits:""} ${p.cardio?"| Cardio: "+p.cardio:""}
${f&&p.age>=50?"IMPORTANT: post-ménopause, priorité densité osseuse.":""}
${!f&&p.age>=50?"IMPORTANT: sarcopénie accélérée, fréquence stimulation critique.":""}

CONTRAINTE DE DURÉE — RÈGLES OBLIGATOIRES pour ${duration} minutes :
${dg.rules}
- Le nombre total d'exercices, de séries et les temps de repos doivent permettre de tenir RÉELLEMENT dans ${duration} minutes (échauffement + séance + retour au calme inclus). Calcule mentalement le temps total avant de répondre.

REGLES GÉNÉRALES:
- Programme précis et immédiatement applicable
- Exercices, séries, reps, temps de repos concrets
- Adapté au genre, âge, niveau, équipement ET durée disponible
${ageCtx}
${weightCtx}
${p.goal === "Yoga & Flexibilité" ? `
OBJECTIF YOGA — PROGRAMME SPÉCIFIQUE:
- Séquences de postures (asanas) adaptées au niveau
- Inclure: postures debout, au sol, d'équilibre, d'inversion si niveau le permet
- Toujours inclure: pranayama (respiration), échauffement doux, savasana final
- Nommer les postures en français avec le nom sanskrit entre parenthèses
- Insister sur l'alignement et la respiration plutôt que la performance
- Proposer des variantes accessibles pour chaque posture` : ""}
${p.goal === "Pilates" ? `
OBJECTIF PILATES — PROGRAMME SPÉCIFIQUE:
- Exercices centrés sur le gainage profond (transverse, plancher pelvien)
- Inclure: exercices au tapis, debout, avec accessoires si disponibles
- Toujours inclure: breathing (respiration latérale), neutral spine, imprinting
- Progresser du plus simple au plus complexe dans chaque séance
- Insister sur la qualité du mouvement et le contrôle plutôt que la répétition
- Adapter à la posture et aux éventuelles douleurs dorsales` : ""}
${p.goal === "Méditation & Bien-être" ? `
OBJECTIF MÉDITATION — PROGRAMME SPÉCIFIQUE:
- Séances de méditation guidée (pleine conscience, body scan, visualisation)
- Inclure: exercices de respiration (cohérence cardiaque, 4-7-8, box breathing)
- Intégrer: étirements doux, yoga nidra, relaxation musculaire progressive
- Durée adaptée au temps disponible (courte: 10 min, standard: 20-30 min)
- Proposer des techniques pour différents moments (matin, soir, stress aigu)` : ""}
- Réponds en français, tutoie ${firstName}, sois direct

IMPORTANT: Réponds UNIQUEMENT avec les balises ci-dessous. Pas de texte libre avant ou après. Pas de markdown (#, *, >, ---). Uniquement ces balises dans cet ordre exact:
[BILAN]analyse 2-3 phrases[/BILAN]
[CALS]BASE:NNN CIBLE:NNN PROT:NNNg[/CALS]
[STRAT]
- point 1
- point 2
[/STRAT]
[WEEK]
Lundi : Séance A
Mercredi : Séance B
[/WEEK]
[SESSION name="Séance A — Nom" color="bleu"]
[EX name="Nom exercice" sets="3" reps="10-12" rest="75s"]Description technique courte[/EX]
[/SESSION]
[PROG]progression en 2-3 phrases[/PROG]`;
}

// ─── PARSER ───────────────────────────────────────────────────────────────────
function parse(text) {
  if (!text) return null;
  
  // Clean markdown artifacts
  const clean = text.replace(/```[a-z]*/g, "").replace(/```/g, "").trim();
  
  const src = clean || text;
  
  const get = tag => {
    const m = src.match(new RegExp(`\\[${tag}\\]([\\s\\S]*?)\\[\\/${tag}\\]`, "i"));
    return m ? m[1].trim() : null;
  };
  
  // Parse calories - try multiple formats
  const cals = src.match(/\[CALS\]BASE:(\d+)\s+CIBLE:(\d+)\s+PROT:(\d+)g\[\/CALS\]/i)
    || src.match(/BASE\s*:\s*(\d+)[^\n]*CIBLE\s*:\s*(\d+)[^\n]*PROT\s*:\s*(\d+)/i);
  
  // Parse sessions - more permissive regex
  const sessions = [];
  const sr = /\[SESSION[^\]]*name="([^"]+)"[^\]]*(?:color="([^"]+)")?[^\]]*\]([\s\S]*?)\[\/SESSION\]/gi;
  let sm;
  while ((sm = sr.exec(src))) {
    const exs = [];
    const er = /\[EX[^\]]*name="([^"]+)"[^\]]*sets="([^"]+)"[^\]]*reps="([^"]+)"[^\]]*rest="([^"]+)"[^\]]*\]([\s\S]*?)\[\/EX\]/gi;
    let em;
    while ((em = er.exec(sm[3]))) {
      exs.push({name:em[1], sets:em[2], reps:em[3], rest:em[4], desc:em[5].trim()});
    }
    sessions.push({name:sm[1], color:sm[2]||"bleu", exs});
  }
  
  // Detect if this is a structured program
  const hasBilan = src.includes("[BILAN]");
  const hasSession = src.includes("[SESSION");
  const hasEX = src.includes("[EX ");
  const hasTags = hasBilan || hasSession || hasEX;
  
  // Consider parsed if we have any structure at all
  const isParsed = hasTags;
  
  return {
    bilan: get("BILAN"),
    strat: get("STRAT"),
    week: get("WEEK"),
    prog: get("PROG"),
    cals: cals ? {base:cals[1], cible:cals[2], prot:cals[3]} : null,
    sessions,
    raw: src,
    isParsed
  };
}

// ─── MARKDOWN ─────────────────────────────────────────────────────────────────
function MD({t}) {
  if (!t) return null;
  return <div>{t.split("\n").filter(l=>l.trim()).map((l,i)=>{
    if(l.startsWith("- ")||l.startsWith("• ")) return <div key={i} style={{display:"flex",gap:6,marginTop:3}}><span style={{color:C.blue}}>›</span><span style={{fontSize:13,color:C.t2,lineHeight:1.6}}>{l.slice(2)}</span></div>;
    if(/^\d+\./.test(l)) return <div key={i} style={{display:"flex",gap:6,marginTop:3}}><span style={{color:C.blue,fontSize:11,fontWeight:700,minWidth:14}}>{l.match(/^\d+/)[0]}.</span><span style={{fontSize:13,color:C.t2,lineHeight:1.6}}>{l.replace(/^\d+\.\s*/,"")}</span></div>;
    const parts=l.split(/\*\*([^*]+)\*\*/g);
    return <p key={i} style={{fontSize:13,color:"#374151",lineHeight:1.65,margin:"3px 0"}}>{parts.map((p,j)=>j%2?<strong key={j} style={{color:C.t1}}>{p}</strong>:p)}</p>;
  })}</div>;
}

// ─── INPUT COMPONENT ──────────────────────────────────────────────────────────
function Input({label,type="text",value,onChange,placeholder,error}) {
  return (
    <div style={{marginBottom:14}}>
      <div style={{fontSize:12,color:C.t3,marginBottom:5,fontWeight:600}}>{label}</div>
      <input type={type} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder}
        style={{width:"100%",background:"rgba(255,255,255,0.08)",border:`1.5px solid ${error?C.red:C.bord}`,borderRadius:11,
          padding:"12px 14px",color:C.t1,fontSize:14,fontFamily:"inherit",outline:"none",boxSizing:"border-box",
          transition:"border-color .15s"}}/>
      {error&&<div style={{fontSize:11,color:C.red,marginTop:4}}>{error}</div>}
    </div>
  );
}

// ─── AUTH SCREENS ─────────────────────────────────────────────────────────────
function AuthScreen({onAuth}) {
  const [mode,setMode]=useState("login"); // login | register
  const [form,setForm]=useState({email:"",password:"",firstName:"",lastName:"",confirmPassword:""});
  const [errors,setErrors]=useState({});
  const [loading,setLoading]=useState(false);
  const set=(k,v)=>setForm(f=>({...f,[k]:v}));

  const validate=()=>{
    const e={};
    if(!form.email.includes("@")) e.email="Email invalide";
    if(form.password.length<6) e.password="6 caractères minimum";
    if(mode==="register"){
      if(!form.firstName.trim()) e.firstName="Prénom requis";
      if(!form.lastName.trim()) e.lastName="Nom requis";
      if(form.password!==form.confirmPassword) e.confirmPassword="Les mots de passe ne correspondent pas";
    }
    return e;
  };

  const submit=async()=>{
    const e=validate();
    if(Object.keys(e).length){setErrors(e);return;}
    setLoading(true); setErrors({});
    try {
      const data=await apiFetch(
        mode==="login"?"/auth/login":"/auth/register",
        {method:"POST",body:JSON.stringify(
          mode==="login"
            ?{email:form.email,password:form.password}
            :{email:form.email,password:form.password,first_name:form.firstName,last_name:form.lastName}
        )}
      );
      store.set("token",data.token);
      store.set("user",data.user);
      onAuth(data.token,data.user);
    } catch(err){
      setErrors({form:err.message});
    }
    setLoading(false);
  };

  return (
    <div style={{minHeight:"100vh",background:C.bg,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"24px 16px",fontFamily:"system-ui,sans-serif"}}>
      <div style={{maxWidth:420,width:"100%"}}>
        <div style={{textAlign:"center",marginBottom:32}}>
          <div style={{width:72,height:72,borderRadius:20,background:"linear-gradient(135deg,#3b6ff0,#06b6d4)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:32,margin:"0 auto 14px",boxShadow:"0 8px 24px rgba(59,111,240,0.35)"}}>🧠</div>
          <h1 style={{fontSize:28,fontWeight:900,color:C.dt1,margin:"0 0 6px",letterSpacing:"-0.5px"}}>Coach IA</h1>
          <p style={{fontSize:14,color:C.dt2,margin:0}}>Programme sportif personnalisé par intelligence artificielle</p>
        </div>
        <div style={{background:"rgba(255,255,255,0.06)",borderRadius:20,padding:28,boxShadow:"0 4px 40px rgba(0,0,0,0.4)"}}>
          {/* Tabs */}
          <div style={{display:"flex",background:"rgba(255,255,255,0.08)",borderRadius:12,padding:4,marginBottom:24}}>
            {[["login","Se connecter"],["register","Créer un compte"]].map(([k,l])=>(
              <button key={k} onClick={()=>{setMode(k);setErrors({});}} style={{flex:1,padding:"10px",borderRadius:9,border:"none",cursor:"pointer",
                background:mode===k?C.blue:"transparent",color:mode===k?"#fff":C.t3,fontWeight:700,fontSize:13,
                boxShadow:mode===k?"0 2px 8px rgba(59,111,240,0.3)":"none",transition:"all .2s"}}>{l}</button>
            ))}
          </div>

          {errors.form&&<div style={{background:"rgba(240,96,96,0.1)",border:`1px solid ${C.red}33`,borderRadius:9,padding:"10px 12px",fontSize:13,color:C.red,marginBottom:14}}>{errors.form}</div>}

          {mode==="register"&&(
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              <Input label="Prénom" value={form.firstName} onChange={v=>set("firstName",v)} error={errors.firstName}/>
              <Input label="Nom" value={form.lastName} onChange={v=>set("lastName",v)} error={errors.lastName}/>
            </div>
          )}
          <Input label="Email" type="email" value={form.email} onChange={v=>set("email",v)} placeholder="prenom@exemple.fr" error={errors.email}/>
          <Input label="Mot de passe" type="password" value={form.password} onChange={v=>set("password",v)} placeholder="6 caractères minimum" error={errors.password}/>
          {mode==="register"&&<Input label="Confirmer le mot de passe" type="password" value={form.confirmPassword} onChange={v=>set("confirmPassword",v)} error={errors.confirmPassword}/>}

          <button onClick={submit} disabled={loading} style={{width:"100%",padding:"14px",background:loading?C.t4:"linear-gradient(135deg,#3b6ff0,#2563eb)",border:"none",borderRadius:12,color:"#fff",fontWeight:700,fontSize:14,cursor:loading?"not-allowed":"pointer",marginTop:8,boxShadow:loading?"none":"0 4px 16px rgba(59,111,240,0.35)",transition:"all .2s"}}>
            {loading?"Chargement...":(mode==="login"?"Se connecter →":"Créer mon compte →")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── PROFILE FORM ─────────────────────────────────────────────────────────────
const GOALS=[
  {id:"Recomposition corporelle",icon:"⚡",label:"Recomposition",sub:"Perdre du gras + muscle"},
  {id:"Prise de masse",icon:"💪",label:"Prise de masse",sub:"Construire du muscle"},
  {id:"Perte de poids",icon:"🔥",label:"Perte de poids",sub:"Réduire la masse grasse"},
  {id:"Force & Performance",icon:"🏋️",label:"Force",sub:"Charges maximales"},
  {id:"Callisthénie",icon:"🤸",label:"Callisthénie",sub:"Force au poids du corps, skills"},
  {id:"Santé & Longévité",icon:"🌿",label:"Santé",sub:"Rester en forme longtemps"},
  {id:"Endurance musculaire",icon:"🏃",label:"Endurance",sub:"Tenir plus longtemps"},
  {id:"Yoga & Flexibilité",icon:"🧘",label:"Yoga",sub:"Souplesse, équilibre, postures"},
  {id:"Pilates",icon:"🤸",label:"Pilates",sub:"Gainage, posture, respiration"},
  {id:"Méditation & Bien-être",icon:"☮️",label:"Méditation",sub:"Relaxation, pleine conscience"},
];
const LEVELS=[{id:"Débutant",l:"Débutant",s:"Moins de 1 an"},{id:"Intermédiaire",l:"Intermédiaire",s:"1 à 3 ans"},{id:"Confirmé",l:"Confirmé",s:"Plus de 3 ans"}];
const EQUIPS=[
  {id:"Salle complète",icon:"🏋️",l:"Salle complète",s:"Machines, barres, haltères, câbles"},
  {id:"Haltères + barre + banc",icon:"🥊",l:"Haltères + Barre",s:"Haltères, barre, banc"},
  {id:"2 haltères uniquement",icon:"🧳",l:"2 haltères",s:"À la maison"},
  {id:"Poids du corps",icon:"🏠",l:"Poids du corps",s:"Aucun matériel"},
  {id:"Barre de traction",icon:"🔝",l:"Barre de traction",s:"Pull-up bar + poids du corps"},
];

function Slider({label,val,min,max,unit,onChange}) {
  const pct=((val-min)/(max-min))*100;
  return (
    <div style={{marginBottom:16}}>
      <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
        <span style={{fontSize:13,color:"#374151",fontWeight:500}}>{label}</span>
        <span style={{fontSize:15,fontWeight:800,color:"#3b6ff0"}}>{val} {unit}</span>
      </div>
      <div style={{position:"relative",height:6,background:C.bord,borderRadius:6}}>
        <div style={{position:"absolute",left:0,top:0,height:"100%",width:`${pct}%`,background:"linear-gradient(90deg,#3b6ff0,#06b6d4)",borderRadius:6}}/>
        <input type="range" min={min} max={max} value={val} onChange={e=>onChange(+e.target.value)}
          style={{position:"absolute",inset:0,width:"100%",opacity:0,cursor:"pointer",height:"100%"}}/>
      </div>
    </div>
  );
}

function Opt({active,icon,label,sub,onClick,cols=2}) {
  return (
    <button onClick={onClick} style={{background:active?"#eef2ff":"#f9fafb",border:`1.5px solid ${active?"#3b6ff0":"#e8eaed"}`,borderRadius:12,padding:"12px 11px",cursor:"pointer",textAlign:"left",width:"100%",transition:"all .15s"}}>
      {icon&&<div style={{fontSize:18,marginBottom:3}}>{icon}</div>}
      <div style={{fontSize:12,fontWeight:700,color:active?"#3b6ff0":"#0f1117",marginBottom:2}}>{label}</div>
      {sub&&<div style={{fontSize:10,color:"#6b7280",lineHeight:1.4}}>{sub}</div>}
    </button>
  );
}

function ProfileForm({initialProfile,onDone,firstName}) {
  const [step,setStep]=useState(0);
  const [p,setP]=useState(initialProfile||{gender:"",age:40,weight:75,height:175,goal:"",level:"",days:3,duration:45,equip:"",limits:"",cardio:""});
  const s=(k,v)=>setP(prev=>({...prev,[k]:v}));

  const steps=[
    { title:`${firstName}, parlons de toi`,
      sub:"La formule métabolique est différente selon le genre",
      ok:!!p.gender,
      body:<>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:18}}>
          {[{id:"homme",icon:"♂️",label:"Homme"},{id:"femme",icon:"♀️",label:"Femme"}].map(o=>(
            <button key={o.id} onClick={()=>s("gender",o.id)} style={{background:p.gender===o.id?"#eef2ff":"#f9fafb",border:`2px solid ${p.gender===o.id?"#3b6ff0":"#e8eaed"}`,borderRadius:14,padding:"18px 10px",cursor:"pointer",textAlign:"center",width:"100%",transition:"all .2s"}}>
              <div style={{fontSize:30,marginBottom:6}}>{o.icon}</div>
              <div style={{fontSize:14,fontWeight:800,color:p.gender===o.id?"#3b6ff0":"#0f1117"}}>{o.label}</div>
            </button>
          ))}
        </div>
        <Slider label="Âge" val={p.age} min={18} max={100} unit="ans" onChange={v=>s("age",v)}/>
        <Slider label="Poids" val={p.weight} min={40} max={175} unit="kg" onChange={v=>s("weight",v)}/>
        <Slider label="Taille" val={p.height} min={140} max={210} unit="cm" onChange={v=>s("height",v)}/>
      </>
    },
    { title:"Objectif", sub:"L'objectif détermine la structure complète du programme", ok:!!p.goal,
      body:<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
        {GOALS.map(o=><Opt key={o.id} active={p.goal===o.id} icon={o.icon} label={o.label} sub={o.sub} onClick={()=>s("goal",o.id)}/>)}
      </div>
    },
    { title:"Niveau", sub:"Honnêteté = programme adapté = meilleurs résultats", ok:!!p.level,
      body:<div style={{display:"flex",flexDirection:"column",gap:8}}>
        {LEVELS.map(o=><Opt key={o.id} active={p.level===o.id} label={o.l} sub={o.s} onClick={()=>s("level",o.id)}/>)}
      </div>
    },
    { title:"Organisation & équipement", sub:"Pour un programme réellement réalisable", ok:!!p.equip,
      body:<>
        <Slider label="Jours/semaine" val={p.days} min={2} max={6} unit="j" onChange={v=>s("days",v)}/>
        <Slider label="Durée par séance" val={p.duration} min={15} max={90} unit="min" onChange={v=>s("duration",v)}/>
        <div style={{background:C.blue+"10",border:`1px solid ${C.blue}25`,borderRadius:9,padding:"9px 12px",fontSize:12,color:C.t2,marginBottom:16,lineHeight:1.5}}>
          💡 {p.duration<=20?"Séance express : exercices composés prioritaires, peu de repos.":
              p.duration<=35?"Séance courte : l'essentiel, sans superflu.":
              p.duration<=50?"Séance standard : équilibre complet entre volume et récupération.":
              p.duration<=70?"Séance longue : volume plus élevé, travail détaillé par groupe musculaire.":
              "Séance complète : volume maximal, échauffement approfondi, accessoires inclus."}
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {EQUIPS.map(o=><Opt key={o.id} active={p.equip===o.id} icon={o.icon} label={o.l} sub={o.s} onClick={()=>s("equip",o.id)}/>)}
        </div>
      </>
    },
    { title:"Informations complémentaires", sub:"Optionnel — mais précieux pour personnaliser", ok:true,
      body:<>
        <div style={{marginBottom:12}}>
          <div style={{fontSize:12,color:C.t3,marginBottom:6}}>Limitations physiques</div>
          <textarea value={p.limits} onChange={e=>s("limits",e.target.value)} placeholder="Ex: douleur genou, hernie L4-L5..."
            style={{width:"100%",background:"#f9fafb",border:"1.5px solid #e8eaed",borderRadius:10,padding:"10px 12px",color:"#0f1117",fontSize:13,resize:"vertical",minHeight:60,fontFamily:"inherit",boxSizing:"border-box"}}/>
        </div>
        <div>
          <div style={{fontSize:12,color:C.t3,marginBottom:6}}>Activité cardio actuelle</div>
          <textarea value={p.cardio} onChange={e=>s("cardio",e.target.value)} placeholder="Ex: running 2x/sem, natation..."
            style={{width:"100%",background:"#f9fafb",border:"1.5px solid #e8eaed",borderRadius:10,padding:"10px 12px",color:"#0f1117",fontSize:13,resize:"vertical",minHeight:50,fontFamily:"inherit",boxSizing:"border-box"}}/>
        </div>
      </>
    },
  ];

  const cur=steps[step]; const last=step===steps.length-1;
  return (
    <div style={{minHeight:"100vh",background:"linear-gradient(135deg,#0f1117,#1a1f2e)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"24px 16px",fontFamily:"system-ui,sans-serif"}}>
      <div style={{maxWidth:460,width:"100%"}}>
        <div style={{textAlign:"center",marginBottom:28}}>
          <div style={{width:60,height:60,borderRadius:18,background:"linear-gradient(135deg,#3b6ff0,#06b6d4)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:28,margin:"0 auto 12px",boxShadow:"0 8px 24px rgba(59,111,240,0.35)"}}>🏋️</div>
          <p style={{fontSize:13,color:"#9ca3af",margin:0}}>Programme personnalisé pour <strong style={{color:"#f9fafb"}}>{firstName}</strong></p>
        </div>
        <div style={{display:"flex",gap:4,marginBottom:20}}>
          {steps.map((_,i)=><div key={i} style={{flex:1,height:4,borderRadius:4,background:i<=step?"linear-gradient(90deg,#3b6ff0,#06b6d4)":"#e8eaed",transition:"all .3s"}}/>)}
        </div>
        <div style={{background:"#ffffff",borderRadius:20,padding:24,boxShadow:"0 8px 40px rgba(0,0,0,0.4)"}}>
          <div style={{fontSize:10,color:C.blue,fontWeight:700,textTransform:"uppercase",letterSpacing:".1em",marginBottom:4,display:"inline-block",background:"rgba(59,130,246,0.12)",padding:"2px 8px",borderRadius:6}}>Étape {step+1}/{steps.length}</div>
          <h2 style={{fontSize:18,fontWeight:800,color:"#0f1117",margin:"4px 0 3px",letterSpacing:"-0.3px"}}>{cur.title}</h2>
          <p style={{fontSize:12,color:"#6b7280",margin:"0 0 18px"}}>{cur.sub}</p>
          {cur.body}
          <div style={{display:"flex",gap:8,marginTop:18}}>
            {step>0&&<button onClick={()=>setStep(s=>s-1)} style={{flex:1,padding:"12px",background:"#f4f5f8",border:"1.5px solid #e8eaed",borderRadius:12,color:"#374151",fontWeight:700,fontSize:13,cursor:"pointer"}}>← Retour</button>}
            <button disabled={!cur.ok} onClick={()=>last?onDone(p):setStep(s=>s+1)}
              style={{flex:2,padding:"12px",background:cur.ok?"linear-gradient(135deg,#3b6ff0,#2563eb)":"#e8eaed",border:"none",borderRadius:12,color:cur.ok?"#fff":"#9ca3af",fontWeight:700,fontSize:13,cursor:cur.ok?"pointer":"not-allowed",boxShadow:cur.ok?"0 4px 14px rgba(59,111,240,0.35)":"none",transition:"all .2s"}}>
              {last?"🚀 Générer mon programme":"Continuer →"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── BIBLIOTHÈQUE VIDÉOS YOUTUBE ─────────────────────────────────────────────
// Clé = mots-clés de l'exercice (lowercase), Valeur = ID vidéo YouTube
const VIDEOS = {
  // Pectoraux
  "développé couché": "rT7DgGymasA",
  "développé haltères": "VmB1G1K7v94",
  "pompes": "IODxDxX7oi4",
  "écarté haltères": "eozdVDA78K0",
  "push up": "IODxDxX7oi4",
  "développé militaire": "2yjwXTZQDDI",
  // Dos
  "rowing haltères": "pYcpY20QaE8",
  "rowing": "pYcpY20QaE8",
  "tirage": "roCP0jMnf7o",
  "traction": "eGo4IYlbE5g",
  "pull up": "eGo4IYlbE5g",
  "deadlift": "op9kVnSso6Q",
  "soulevé de terre": "op9kVnSso6Q",
  // Épaules
  "élévations latérales": "3VcKaXpzqRo",
  "élévation latérale": "3VcKaXpzqRo",
  "oiseau": "bent-over-lateral-raise",
  "développé arnold": "6Z15_WdXmVw",
  // Biceps
  "curl haltères": "ykJmrZ5v0Oo",
  "curl biceps": "ykJmrZ5v0Oo",
  "curl marteau": "zC3nLlEvin4",
  "curl incliné": "soxrZlIl35U",
  // Triceps
  "extension triceps": "2-LAMcpzODU",
  "dips": "2z8JmcrW-As",
  "barre front": "d_KZxkY_0cM",
  // Abdominaux
  "crunch": "Xyd_fa5zoEU",
  "planche": "ASdvN_XEl_c",
  "relevé de jambes": "JB2oyawG9KI",
  "gainage": "ASdvN_XEl_c",
  "russian twist": "wkD8rjkodUI",
  "mountain climber": "nmwgirgXLYM",
  // Jambes
  "squat": "ultWZbUMPL8",
  "fente": "QOVaHwm-Q6U",
  "fentes": "QOVaHwm-Q6U",
  "leg press": "GvRgijoJ2xY",
  "leg curl": "1Tq3QdYUuHs",
  "leg extension": "swHtON5lBgk",
  "mollets": "gwLzBJYoWlQ",
  "hip thrust": "LM8XfLGFW6s",
  "romanian deadlift": "JCXUYuzwNrM",
  "sumo": "Pjl7whyek_M",
  // Yoga / Pilates
  "chien tête en bas": "AWTGEFKvl_A",
  "guerrier": "Mn6RSIRCV3w",
  "salutation au soleil": "bzwxkMUNKbw",
  "planche latérale": "K2TKbjH3MeA",
  "pont": "OoFJxTHVqMg",
  "cat cow": "kqnua4rHVVA",
  // Cardio
  "burpee": "dZgVxmf6jkA",
  "corde à sauter": "FJmRQ5iTXKE",
  "jumping jack": "iSSAk4XCsRA",
  "montées de genoux": "tx5rgpDANEQ",
};

function getVideoId(name) {
  return null; // Videos replaced by AI-generated technique descriptions
}


function YoutubeEmbed({videoId, title}) {
  // Videos replaced - component kept for compatibility but renders nothing
  return null;
}

function TechniqueTip({name, desc}) {
  const [expanded, setExpanded] = useState(false);
  const tips = {
    "Squat gobelet": "Pieds largeur d'épaules, orteils légèrement ouverts. Haltère contre la poitrine. Descends jusqu'à ce que les cuisses soient parallèles au sol en gardant le dos droit. Genoux dans l'axe des orteils.",
    "Développé militaire": "Haltères à hauteur d'épaules, paumes vers l'avant. Pousse verticalement sans cambrer le dos. Verrouille les coudes en haut. Descente lente et contrôlée.",
    "Rowing haltère": "Un genou et une main sur le banc. Dos plat, parallèle au sol. Tire le coude vers le haut en gardant le bras proche du corps. Squeeze l'omoplate en haut.",
    "Curl biceps": "Coudes fixes contre le buste. Monte en tournant légèrement le poignet. Descente lente sur 3 secondes. Ne balance pas le dos.",
    "Extension triceps": "Bras tendu au-dessus de la tête. Coude fixe. Descends l'haltère derrière la nuque. Pousse en contractant le triceps.",
    "Pompes": "Mains largeur d'épaules, corps gainé. Descends jusqu'à frôler le sol. Coudes à 45° du corps. Ne laisse pas les hanches s'affaisser.",
    "Planche": "Avant-bras au sol, coudes sous les épaules. Corps parfaitement aligné. Contracte les abdos et les fessiers. Respire normalement.",
    "Fentes marchées": "Grand pas en avant. Genou arrière proche du sol sans toucher. Genou avant dans l'axe du pied. Pousse sur le talon avant pour revenir.",
    "Soulevé de terre roumain": "Haltères devant les cuisses. Descends en gardant le dos plat et les haltères proches des jambes. Sens l'étirement dans les ischio-jambiers. Remonte en poussant les hanches.",
    "Hip thrust": "Épaules sur le banc, haltère sur le bassin. Pieds à plat. Pousse les hanches vers le haut en contractant les fessiers. Descente contrôlée.",
    "Élévations latérales": "Légère flexion des coudes. Monte les bras à hauteur d'épaules, pas plus haut. Descente lente. Contrôle le mouvement, ne balance pas.",
    "Développé couché": "Haltères à hauteur des pectoraux, coudes à 75°. Pousse en rapprochant légèrement les haltères en haut. Descente en 3 secondes.",
    "Burpees": "Debout → mains au sol → saut en planche → pompe → saut pieds vers les mains → saut vertical les bras en l'air. Enchaîne sans pause.",
    "Mountain climbers": "Position de pompe. Ramène alternativement les genoux vers la poitrine le plus vite possible. Garde les hanches basses et le dos plat.",
    "Squats sautés": "Descends en squat normal. Explose vers le haut en sautant. Atterris doucement en fléchissant les genoux. Enchaîne immédiatement.",
  };

  const tip = tips[name] || desc;
  if (!tip) return null;

  return (
    <div style={{background:"rgba(99,102,241,0.08)",border:"1px solid rgba(99,102,241,0.2)",borderRadius:10,padding:"10px 12px",marginBottom:10}}>
      <button onClick={()=>setExpanded(e=>!e)}
        style={{width:"100%",background:"none",border:"none",cursor:"pointer",display:"flex",alignItems:"center",gap:8,padding:0}}>
        <span style={{fontSize:14}}>💡</span>
        <span style={{fontSize:11,fontWeight:700,color:"#a5b4fc",flex:1,textAlign:"left"}}>Technique — {name}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2.5" style={{transform:expanded?"rotate(180deg)":"none",transition:"transform .2s",flexShrink:0}}><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      {expanded && (
        <p style={{fontSize:12,color:"#c7d2fe",lineHeight:1.65,margin:"8px 0 0"}}>{tip}</p>
      )}
    </div>
  );
}


function RestTimer({seconds,onDone,accent}) {
  const [rem,setRem]=useState(seconds);
  const [run,setRun]=useState(true);
  const ref=useRef(null);
  useEffect(()=>{
    if(!run)return;
    ref.current=setInterval(()=>setRem(r=>{if(r<=1){clearInterval(ref.current);onDone();return 0;}return r-1;}),1000);
    return()=>clearInterval(ref.current);
  },[run]);
  const pct=(rem/seconds)*100, r=36, circ=2*Math.PI*r;
  return (
    <div style={{textAlign:"center",padding:"14px 0"}}>
      <div style={{position:"relative",display:"inline-block"}}>
        <svg width={90} height={90} viewBox="0 0 80 80">
          <circle cx="40" cy="40" r={r} fill="none" stroke={C.bord} strokeWidth="6"/>
          <circle cx="40" cy="40" r={r} fill="none" stroke={accent} strokeWidth="6" strokeDasharray={circ} strokeDashoffset={circ*(1-pct/100)} strokeLinecap="round" transform="rotate(-90 40 40)" style={{transition:"stroke-dashoffset 1s linear"}}/>
        </svg>
        <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column"}}>
          <span style={{fontSize:22,fontWeight:800,color:accent}}>{rem}</span>
          <span style={{fontSize:9,color:C.t3}}>sec</span>
        </div>
      </div>
      <div style={{display:"flex",gap:8,justifyContent:"center",marginTop:10}}>
        <button onClick={()=>setRun(r=>!r)} style={{padding:"6px 14px",borderRadius:8,border:`1.5px solid ${accent}`,background:"transparent",color:accent,fontWeight:700,fontSize:12,cursor:"pointer"}}>{run?"Pause":"▶"}</button>
        <button onClick={onDone} style={{padding:"6px 14px",borderRadius:8,border:"none",background:accent,color:"#fff",fontWeight:700,fontSize:12,cursor:"pointer"}}>Passer →</button>
      </div>
    </div>
  );
}

// ─── SESSION BLOCK ────────────────────────────────────────────────────────────
function ExCard({ex,idx,accent,logData,onLogSet}) {
  const [open,setOpen]=useState(false);
  const [showTimer,setShowTimer]=useState(false);
  const [timerKey,setTimerKey]=useState(0);
  const totalSets=parseInt(ex.sets)||3;
  const restSecs=parseInt(ex.rest)||60;
  const doneSets=logData?logData.sets.filter(Boolean).length:0;
  const allDone=doneSets===totalSets;

  const handleSet=(i)=>{
    if(!logData)return;
    const ns=[...logData.sets]; ns[i]=!ns[i];
    onLogSet(ns,logData.weights);
    if(ns[i]){setShowTimer(true);setTimerKey(k=>k+1);}
  };
  const handleWeight=(i,v)=>{
    if(!logData)return;
    const nw=[...logData.weights]; nw[i]=Math.max(0,v);
    onLogSet(logData.sets,nw);
  };

  return (
    <div style={{background:allDone?accent+"20":"rgba(255,255,255,0.05)",border:`2px solid ${allDone?accent:open?accent+"66":"rgba(255,255,255,0.12)"}`,borderRadius:12,marginBottom:8,overflow:"hidden",transition:"all .2s"}}>
      <div style={{display:"flex",alignItems:"center",gap:10,padding:"12px 14px",cursor:"pointer"}} onClick={()=>setOpen(o=>!o)}>
        <div style={{width:32,height:32,borderRadius:"50%",background:allDone?accent:accent+"18",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,fontSize:12,color:allDone?"#fff":accent,flexShrink:0,transition:"all .3s"}}>
          {allDone?"✓":idx+1}
        </div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontWeight:700,fontSize:13,color:"#f9fafb",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{ex.name}</div>
        </div>
        <span style={{fontSize:11,fontWeight:700,color:accent,background:accent+"14",padding:"2px 9px",borderRadius:20,flexShrink:0}}>{ex.sets}×{ex.reps}</span>
        <span style={{fontSize:10,color:"#9ca3af",marginLeft:4,flexShrink:0}}>{ex.rest}</span>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={C.t3} strokeWidth="2.5" style={{transform:open?"rotate(180deg)":"none",transition:"transform .2s",flexShrink:0}}><polyline points="6 9 12 15 18 9"/></svg>
      </div>
      {open&&(
        <div style={{borderTop:`1px solid ${accent}22`}}>
          <TechniqueTip name={ex.name} desc={ex.desc}/>
          {ex.desc&&<div style={{padding:"12px 14px 10px"}}><p style={{fontSize:12,color:C.t2,lineHeight:1.65,margin:0}}>{ex.desc}</p></div>}
          {logData&&(
            <div style={{padding:"0 14px 14px"}}>
              <div style={{fontSize:10,fontWeight:700,color:accent,textTransform:"uppercase",letterSpacing:".08em",marginBottom:8}}>Séries — {doneSets}/{totalSets}</div>
              {Array.from({length:totalSets}).map((_,i)=>(
                <div key={i} style={{display:"flex",alignItems:"center",gap:8,marginBottom:7}}>
                  <button onClick={()=>handleSet(i)} style={{width:28,height:28,borderRadius:7,border:`2px solid ${logData.sets[i]?accent:"#d0d4e8"}`,background:logData.sets[i]?accent:"#f8f9fc",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,transition:"all .2s"}}>
                    {logData.sets[i]&&<span style={{color:"#fff",fontSize:12,fontWeight:800}}>✓</span>}
                  </button>
                  <span style={{fontSize:12,color:C.t3,width:52,flexShrink:0}}>Série {i+1}</span>
                  <div style={{display:"flex",alignItems:"center",gap:5,marginLeft:"auto"}}>
                    <button onClick={()=>handleWeight(i,(logData.weights[i]||0)-2.5)} style={{width:24,height:24,borderRadius:6,border:"1.5px solid rgba(255,255,255,0.1)",background:"rgba(255,255,255,0.06)",cursor:"pointer",fontWeight:700,fontSize:14,color:C.t2,display:"flex",alignItems:"center",justifyContent:"center"}}>−</button>
                    <span style={{fontSize:12,fontWeight:700,color:C.t1,minWidth:36,textAlign:"center"}}>{logData.weights[i]?`${logData.weights[i]}kg`:"—"}</span>
                    <button onClick={()=>handleWeight(i,(logData.weights[i]||0)+2.5)} style={{width:24,height:24,borderRadius:6,border:"1.5px solid rgba(255,255,255,0.1)",background:"rgba(255,255,255,0.06)",cursor:"pointer",fontWeight:700,fontSize:14,color:C.t2,display:"flex",alignItems:"center",justifyContent:"center"}}>+</button>
                  </div>
                </div>
              ))}
              {showTimer&&<RestTimer key={timerKey} seconds={restSecs} accent={accent} onDone={()=>setShowTimer(false)}/>}
              {!showTimer&&doneSets>0&&doneSets<totalSets&&(
                <button onClick={()=>{setShowTimer(true);setTimerKey(k=>k+1);}} style={{marginTop:8,width:"100%",padding:"8px",borderRadius:9,border:`1.5px solid ${accent}`,background:"transparent",color:accent,fontWeight:700,fontSize:12,cursor:"pointer"}}>
                  ⏱ Timer repos ({ex.rest})
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SessionBlock({session,accent,logData,onLogSet}) {
  const cols={bleu:C.blue,vert:C.green,violet:"#a78bfa",orange:C.orange};
  const color=cols[session.color]||accent;
  const [open,setOpen]=useState(true);
  const totalSets=session.exs.reduce((a,ex)=>a+parseInt(ex.sets||3),0);
  const doneSets=session.exs.reduce((a,ex)=>a+(logData[ex.name]?.sets.filter(Boolean).length||0),0);
  return (
    <div style={{background:"#ffffff",borderRadius:14,marginBottom:12,overflow:"hidden",boxShadow:"0 2px 12px rgba(0,0,0,0.08)"}}>
      <div style={{background:color+"10",borderBottom:`2px solid ${color}22`,padding:"13px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"pointer"}} onClick={()=>setOpen(o=>!o)}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <div style={{width:8,height:8,borderRadius:"50%",background:color}}/>
          <span style={{fontWeight:800,fontSize:14,color:"#0f1117"}}>{session.name}</span>
          <span style={{fontSize:11,color:"#9ca3af",marginLeft:4}}>{session.exs.length} exercices</span>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          {doneSets>0&&<span style={{fontSize:11,color:color,fontWeight:700}}>{doneSets}/{totalSets} séries</span>}
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={C.t3} strokeWidth="2.5" style={{transform:open?"rotate(180deg)":"none",transition:"transform .2s"}}><polyline points="6 9 12 15 18 9"/></svg>
        </div>
      </div>
      {open&&<div style={{padding:"10px"}}>
        {session.exs.map((ex,i)=>(
          <ExCard key={i} ex={ex} idx={i} accent={color}
            logData={logData[ex.name]||{sets:Array(parseInt(ex.sets)||3).fill(false),weights:Array(parseInt(ex.sets)||3).fill(0)}}
            onLogSet={(sets,weights)=>onLogSet(ex.name,sets,weights)}/>
        ))}
      </div>}
    </div>
  );
}

// ─── PROGRAM VIEW ─────────────────────────────────────────────────────────────
function ProgramView({parsed,profile,firstName}) {
  if(!parsed||parsed.sessions.length===0) return <div style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:13,padding:14}}><MD t={parsed?.raw}/></div>;
  const imc=(profile.weight/((profile.height/100)**2)).toFixed(1);
  return (
    <div>
      <div style={{background:"linear-gradient(135deg,#1e3a8a,#1e40af)",border:"1px solid rgba(59,111,240,0.3)",borderRadius:16,padding:18,marginBottom:14,boxShadow:"0 4px 24px rgba(59,111,240,0.2)"}}>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:10}}>
          <div><div style={{fontSize:10,color:"#93c5fd",fontWeight:700,textTransform:"uppercase",letterSpacing:".1em",marginBottom:3}}>Programme de {firstName}</div><div style={{fontSize:18,fontWeight:800,color:"#ffffff",letterSpacing:"-0.5px"}}>Ton plan personnalisé</div></div>
          <div style={{textAlign:"right"}}><div style={{fontSize:20,fontWeight:800,color:"#60a5fa"}}>{profile.age} ans</div><div style={{fontSize:10,color:"#93c5fd"}}>{profile.weight}kg · {profile.height}cm · IMC {imc}</div></div>
        </div>
        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
          {profile.gender&&<span style={{fontSize:11,fontWeight:700,color:profile.gender==="femme"?C.pink:C.blue,background:(profile.gender==="femme"?C.pink:C.blue)+"18",padding:"2px 9px",borderRadius:20}}>{profile.gender==="femme"?"♀ Femme":"♂ Homme"}</span>}
          {[profile.goal,profile.level,profile.days+"j/sem",(profile.duration||45)+" min/séance"].map(v=><span key={v} style={{fontSize:11,fontWeight:600,color:C.t2,background:"rgba(255,255,255,0.08)",padding:"2px 9px",borderRadius:20}}>{v}</span>)}
        </div>
      </div>
      {parsed.cals&&<div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:12}}>
        {[["Métabolisme",parsed.cals.base+" kcal",C.t2],["Objectif",parsed.cals.cible+" kcal",C.blue],["Protéines/j",parsed.cals.prot+"g",C.green]].map(([l,v,c])=>(
          <div key={l} style={{background:"#ffffff",borderRadius:12,padding:"13px 10px",textAlign:"center",boxShadow:"0 2px 8px rgba(0,0,0,0.07)"}}>
            <div style={{fontSize:14,fontWeight:800,color:c}}>{v}</div>
            <div style={{fontSize:9,color:C.t3,marginTop:3}}>{l}</div>
          </div>
        ))}
      </div>}
      {parsed.bilan&&<div style={{background:"#ffffff",borderRadius:14,padding:16,marginBottom:12,boxShadow:"0 2px 12px rgba(0,0,0,0.08)"}}><div style={{fontSize:10,color:"#6b7280",fontWeight:700,textTransform:"uppercase",letterSpacing:".1em",marginBottom:10}}>Analyse</div><MD t={parsed.bilan}/></div>}
      {parsed.strat&&<div style={{background:"#ffffff",borderRadius:14,padding:16,marginBottom:12,boxShadow:"0 2px 12px rgba(0,0,0,0.08)"}}><div style={{fontSize:10,color:"#6b7280",fontWeight:700,textTransform:"uppercase",letterSpacing:".1em",marginBottom:10}}>Stratégie</div><MD t={parsed.strat}/></div>}
      {parsed.week&&<div style={{background:"#ffffff",borderRadius:14,padding:16,marginBottom:12,boxShadow:"0 2px 12px rgba(0,0,0,0.08)"}}><div style={{fontSize:10,color:"#6b7280",fontWeight:700,textTransform:"uppercase",letterSpacing:".1em",marginBottom:10}}>Planning semaine</div><MD t={parsed.week}/></div>}
      {parsed.sessions.length>0&&<div style={{marginBottom:10}}><div style={{fontSize:10,color:C.t3,fontWeight:700,textTransform:"uppercase",letterSpacing:".08em",marginBottom:10}}>Séances</div></div>}
      {parsed.prog&&<div style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:12,padding:14}}><div style={{fontSize:10,color:"#6b7280",fontWeight:700,textTransform:"uppercase",letterSpacing:".1em",marginBottom:10}}>Progression 8 semaines</div><MD t={parsed.prog}/></div>}
    </div>
  );
}

// ─── BUBBLE ───────────────────────────────────────────────────────────────────
function Bubble({msg,profile,firstName,logData,onLogSet}) {
  if(msg.role==="user") return (
    <div style={{display:"flex",justifyContent:"flex-end",marginBottom:14}}>
      <div style={{maxWidth:"75%",background:"linear-gradient(135deg,#3b6ff0,#2563eb)",borderRadius:"16px 16px 4px 16px",padding:"12px 16px",fontSize:13,color:"#fff",lineHeight:1.6,boxShadow:"0 4px 16px rgba(59,111,240,0.3)"}}>{msg.content}</div>
    </div>
  );
  return (
    <div style={{display:"flex",gap:10,marginBottom:16,alignItems:"flex-start"}}>
      <div style={{width:32,height:32,borderRadius:10,background:"linear-gradient(135deg,#3b6ff0,#06b6d4)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,flexShrink:0,marginTop:2,boxShadow:"0 2px 8px rgba(59,111,240,0.3)"}}>🧠</div>
      <div style={{flex:1,minWidth:0}}>
        {msg.loading
          ?<div style={{background:"#ffffff",borderRadius:"4px 16px 16px 16px",padding:"14px 16px",display:"flex",gap:5,alignItems:"center",boxShadow:"0 2px 12px rgba(0,0,0,0.12)"}}>
            {[0,1,2].map(i=><div key={i} style={{width:7,height:7,borderRadius:"50%",background:C.blue,animation:"p 1.2s ease-in-out infinite",animationDelay:`${i*.2}s`}}/>)}
            <style>{`@keyframes p{0%,80%,100%{opacity:.3;transform:scale(.8)}40%{opacity:1;transform:scale(1)}}`}</style>
            <span style={{fontSize:12,color:C.t3,marginLeft:5}}>Génération en cours...</span>
          </div>
          :msg.parsed&&profile&&msg.parsed.isParsed
          ?<>
            <ProgramView parsed={msg.parsed} profile={profile} firstName={firstName}/>
            {msg.parsed.sessions.length>0&&logData&&(
              <div style={{marginTop:12}}>
                <div style={{fontSize:10,color:C.t3,fontWeight:700,textTransform:"uppercase",letterSpacing:".08em",marginBottom:10}}>Suivi des séances</div>
                {msg.parsed.sessions.map((sess,i)=>(
                  <SessionBlock key={i} session={sess} accent={C.blue} logData={logData} onLogSet={onLogSet}/>
                ))}
              </div>
            )}
          </>
          :<div style={{background:"#ffffff",borderRadius:"4px 16px 16px 16px",padding:"14px 16px",boxShadow:"0 2px 12px rgba(0,0,0,0.12)"}}><MD t={msg.content}/></div>
        }
      </div>
    </div>
  );
}


// ─── HIIT WOD (Freeletics-style) ─────────────────────────────────────────────
function speak(text) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utt = new SpeechSynthesisUtterance(text);
  utt.lang = "fr-FR"; utt.rate = 0.95; utt.pitch = 1.0; utt.volume = 1.0;
  const voices = window.speechSynthesis.getVoices();
  const frVoice = voices.find(v => v.lang.startsWith("fr") && !v.name.includes("Google")) || voices.find(v => v.lang.startsWith("fr"));
  if (frVoice) utt.voice = frVoice;
  window.speechSynthesis.speak(utt);
}

function SeanceTimer({seconds, label, accent, onDone}) {
  const safeSecs = (typeof seconds === "number" && seconds > 0 && !isNaN(seconds)) ? Math.round(seconds) : 45;
  const [rem, setRem] = useState(safeSecs);
  const [run, setRun] = useState(true);
  const endTime = useRef(Date.now() + safeSecs * 1000);
  const spoken10 = useRef(false);
  const spoken5 = useRef(false);

  useEffect(() => {
    if (!run) return;
    endTime.current = Date.now() + rem * 1000;
    const interval = setInterval(() => {
      const left = Math.max(0, Math.round((endTime.current - Date.now()) / 1000));
      setRem(left);
      if (left <= 10 && !spoken10.current) { spoken10.current = true; speak("10 secondes."); }
      if (left <= 5 && !spoken5.current) { spoken5.current = true; speak("5, 4, 3, 2, 1"); }
      if (left <= 0) {
        clearInterval(interval);
        speak("C'est reparti !");
        onDone && onDone();
      }
    }, 500);
    return () => clearInterval(interval);
  }, [run]);

  const pct = safeSecs > 0 ? (rem / safeSecs) : 0;
  const r = 40, circ = 2 * Math.PI * r;

  return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",padding:"16px 0"}}>
      <div style={{position:"relative",width:100,height:100,marginBottom:12}}>
        <svg width="100" height="100" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="8"/>
          <circle cx="50" cy="50" r={r} fill="none" stroke={rem<=5?"#ef4444":rem<=10?C.orange:accent}
            strokeWidth="8" strokeDasharray={circ} strokeDashoffset={circ*(1-pct)}
            strokeLinecap="round" transform="rotate(-90 50 50)" style={{transition:"stroke-dashoffset 0.5s"}}/>
        </svg>
        <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
          <div style={{fontSize:22,fontWeight:900,color:rem<=5?"#ef4444":accent}}>{rem}</div>
          <div style={{fontSize:9,color:"#6b7280"}}>sec</div>
        </div>
      </div>
      {label&&<div style={{fontSize:12,color:"#9ca3af",marginBottom:10,textAlign:"center"}}>{label}</div>}
      <div style={{display:"flex",gap:8}}>
        <button onClick={()=>{setRun(r=>!r);if(!run)endTime.current=Date.now()+rem*1000;}}
          style={{padding:"7px 16px",background:"rgba(255,255,255,0.1)",border:"none",borderRadius:8,color:"#9ca3af",fontSize:12,cursor:"pointer",fontWeight:600}}>
          {run?"⏸ Pause":"▶ Reprendre"}
        </button>
        <button onClick={()=>{onDone&&onDone();}}
          style={{padding:"7px 16px",background:accent+"22",border:"none",borderRadius:8,color:accent,fontSize:12,cursor:"pointer",fontWeight:600}}>
          Passer →
        </button>
      </div>
    </div>
  );
}


function HIITPanel({token, profile, firstName, onClose}) {
  const [screen, setScreen] = useState("config");
  const [wod, setWod] = useState(null);
  const [duree, setDuree] = useState(20);
  const [niveau, setNiveau] = useState("");
  const [focus, setFocus] = useState("");
  const [currentEx, setCurrentEx] = useState(0);
  const [currentRound, setCurrentRound] = useState(1);
  const [phase, setPhase] = useState("work");
  const [timeLeft, setTimeLeft] = useState(0);
  const [running, setRunning] = useState(false);
  const timerRef = useRef(null);
  const [rating, setRating] = useState(null);

  const focusOpts = [
    {id:"Corps entier",icon:"🌟",sub:"Full body explosif"},
    {id:"Haut du corps",icon:"💪",sub:"Bras, épaules, pectoraux"},
    {id:"Bas du corps",icon:"🦵",sub:"Jambes, fessiers, mollets"},
    {id:"Cardio pur",icon:"❤️",sub:"Endurance et brûle-graisses"},
    {id:"Gainage",icon:"⚡",sub:"Abdos, gainage, équilibre"},
  ];

  const parseExSecs = (s) => {
    if (!s) return 45;
    const str = String(s);
    const m = str.match(/(\d+)\s*(min|sec|s|seconde)/i);
    if (m) return m[2].toLowerCase().startsWith('m') ? parseInt(m[1])*60 : parseInt(m[1]);
    const n = parseInt(str.match(/(\d+)/)?.[1]);
    return (n && n > 0 && n < 600) ? n : 45;
  };
  const generate = async () => {
    setScreen("loading");
    const prompt = `Génère un WOD HIIT style Freeletics pour ${firstName}. Durée : ${duree} min | Niveau : ${niveau} | Focus : ${focus}${profile?` | Age : ${profile.age} ans, poids : ${profile.weight}kg`:""}. Réponds UNIQUEMENT en JSON valide sans markdown, sans apostrophes dans les valeurs, sans caractères spéciaux. Format : {"titre":"WOD du jour","format":"AMRAP 20min","rounds":4,"exercices":[{"nom":"Burpees","reps":"10","travail":40,"repos":0,"desc":"Technique"},{"nom":"Squats sautes","reps":"15","travail":35,"repos":10,"desc":"Technique"}],"repos_entre_rounds":60,"conseil":"Conseil cle"}`;
    try {
      const r = await fetch(API+"/api/coach",{method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${token}`},body:JSON.stringify({system:"Tu es un coach HIIT expert. Réponds UNIQUEMENT en JSON valide, sans markdown, sans apostrophes dans les clés.",messages:[{role:"user",content:prompt}],max_tokens:1500})});
      const data = await r.json();
      let text = data.content?.[0]?.text || "";
      text = text.replace(/```[\w]*/g,"").replace(/```/g,"").trim(); text = (text.match(/\{[\s\S]*\}/)||[text])[0];
      // Handle nested content structure
      let parsed;
      try { parsed = JSON.parse(text); } catch(jsonErr) {
        // Try to extract JSON from response
        const jParsed = text.match(/\{[\s\S]*\}/);
        if (jParsed) parsed = JSON.parse(jParsed[0]);
        else throw jsonErr;
      }
      setWod(parsed); setScreen("workout"); setCurrentEx(0); setCurrentRound(1); setPhase("work");
      setTimeLeft(parsed.exercices[0].travail || 40);
      speak(`WOD du jour : ${parsed.titre}. ${parsed.format}. C'est parti ${firstName} !`);
    } catch(e) { alert("Erreur : "+e.message); setScreen("config"); }
  };

  useEffect(() => {
    if (!running || screen !== "workout") return;
    timerRef.current = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) { clearInterval(timerRef.current); handleTimerEnd(); return 0; }
        if (t === 4) speak("3, 2, 1");
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [running, phase, currentEx, currentRound]);

  const handleTimerEnd = () => {
    if (!wod) return;
    const exs = wod.exercices;
    if (phase === "work") {
      const restTime = exs[currentEx]?.repos || 0;
      if (restTime > 0) { setPhase("rest"); setTimeLeft(restTime); setRunning(true); speak("Repos !"); }
      else goNextEx();
    } else if (phase === "rest") { goNextEx(); }
    else if (phase === "between") { setPhase("work"); setTimeLeft(exs[0].travail||40); setCurrentEx(0); setRunning(true); speak(`Round ${currentRound}. C'est parti !`); }
  };

  const goNextEx = () => {
    if (!wod) return;
    const exs = wod.exercices;
    const nextEx = currentEx + 1;
    if (nextEx >= exs.length) {
      const nextRound = currentRound + 1;
      if (nextRound > wod.rounds) { setScreen("done"); setRunning(false); speak(`WOD terminé ! Bravo ${firstName} !`);
        // Save HIIT session to localStorage
        try {
          const entry = {date:new Date().toISOString(),type:"hiit",sport:"hiit",titre:wod?.titre||"WOD HIIT",duree,objectif:focus,exercises:[{name:`WOD: ${wod?.format||"HIIT"}`,sets:[{reps:`${wod?.rounds} rounds`,weight:""}]}]};
          const sessions = JSON.parse(localStorage.getItem("coach_sessions")||"[]");
          sessions.unshift(entry);
          localStorage.setItem("coach_sessions",JSON.stringify(sessions.slice(0,50)));
        } catch {} }
      else { setCurrentRound(nextRound); setPhase("between"); setTimeLeft(wod.repos_entre_rounds||60); setRunning(true); speak(`Round ${currentRound} terminé ! Repos.`); }
    } else { setCurrentEx(nextEx); setPhase("work"); setTimeLeft(exs[nextEx].travail||40); setRunning(true); speak(`${exs[nextEx].nom}, ${exs[nextEx].reps} répétitions !`); }
  };

  const pct = wod ? (timeLeft / (phase==="between"?(wod.repos_entre_rounds||60):phase==="rest"?(wod.exercices[currentEx]?.repos||30):(wod.exercices[currentEx]?.travail||40))) * 100 : 0;
  const phaseColor = phase==="work"?"#dc2626":"#16a34a";
  const ratingOpts = [{id:"trop_facile",icon:"😴",label:"Trop facile",color:"#6b7280"},{id:"bien",icon:"💪",label:"Bien",color:"#16a34a"},{id:"difficile",icon:"🔥",label:"Difficile",color:"#ea6c00"},{id:"trop_dur",icon:"💀",label:"Trop dur",color:"#dc2626"}];

  return (
    <div style={{position:"fixed",top:0,left:0,right:0,bottom:0,background:"#0f1117",zIndex:200,display:"flex",flexDirection:"column",fontFamily:"system-ui,sans-serif"}}>
      <div style={{background:"linear-gradient(135deg,#7f1d1d,#dc2626)",padding:"13px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
        <div>
          <div style={{fontSize:16,fontWeight:800,color:"#fff"}}>⚡ WOD HIIT</div>
          <div style={{fontSize:11,color:"rgba(255,255,255,0.7)"}}>{screen==="workout"&&wod?`Round ${currentRound}/${wod.rounds} · ${wod.format}`:screen==="done"?"Terminé !":"Freeletics style"}</div>
        </div>
        <button onClick={onClose} style={{background:"rgba(255,255,255,0.15)",border:"none",borderRadius:8,padding:"6px 12px",color:"#fff",fontSize:12,cursor:"pointer"}}>Fermer</button>
      </div>

      {screen==="config"&&(
        <div style={{flex:1,overflowY:"scroll",padding:"20px 16px",WebkitOverflowScrolling:"touch"}}>
          <div style={{marginBottom:20}}>
            <div style={{fontSize:13,fontWeight:700,color:"#f9fafb",marginBottom:10}}>⏱ Durée</div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              {[10,15,20,25,30,45].map(d=>(
                <button key={d} onClick={()=>setDuree(d)} style={{background:duree===d?"rgba(220,38,38,0.3)":"rgba(255,255,255,0.07)",border:`1.5px solid ${duree===d?"#dc2626":"rgba(255,255,255,0.1)"}`,borderRadius:20,padding:"7px 14px",cursor:"pointer",fontSize:13,fontWeight:700,color:duree===d?"#fca5a5":"#9ca3af"}}>{d} min</button>
              ))}
            </div>
          </div>
          <div style={{marginBottom:20}}>
            <div style={{fontSize:13,fontWeight:700,color:"#f9fafb",marginBottom:10}}>📊 Niveau</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
              {[{id:"débutant",l:"Débutant"},{id:"intermédiaire",l:"Intermédiaire"},{id:"avancé",l:"Avancé"}].map(n=>(
                <button key={n.id} onClick={()=>setNiveau(n.id)} style={{background:niveau===n.id?"rgba(220,38,38,0.3)":"rgba(255,255,255,0.07)",border:`1.5px solid ${niveau===n.id?"#dc2626":"rgba(255,255,255,0.1)"}`,borderRadius:12,padding:"11px 8px",cursor:"pointer",textAlign:"center"}}>
                  <div style={{fontSize:12,fontWeight:700,color:niveau===n.id?"#fca5a5":"#f9fafb"}}>{n.l}</div>
                </button>
              ))}
            </div>
          </div>
          <div style={{marginBottom:24}}>
            <div style={{fontSize:13,fontWeight:700,color:"#f9fafb",marginBottom:10}}>🎯 Focus</div>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {focusOpts.map(f=>(
                <button key={f.id} onClick={()=>setFocus(f.id)} style={{background:focus===f.id?"rgba(220,38,38,0.2)":"rgba(255,255,255,0.06)",border:`1.5px solid ${focus===f.id?"#dc2626":"rgba(255,255,255,0.1)"}`,borderRadius:11,padding:"12px 14px",cursor:"pointer",display:"flex",alignItems:"center",gap:10}}>
                  <span style={{fontSize:20}}>{f.icon}</span>
                  <div>
                    <div style={{fontSize:13,fontWeight:700,color:focus===f.id?"#fca5a5":"#f9fafb"}}>{f.id}</div>
                    <div style={{fontSize:11,color:"#6b7280"}}>{f.sub}</div>
                  </div>
                  {focus===f.id&&<span style={{marginLeft:"auto",color:"#fca5a5"}}>✓</span>}
                </button>
              ))}
            </div>
          </div>
          <button onClick={generate} disabled={!niveau||!focus} style={{width:"100%",padding:"15px",background:niveau&&focus?"linear-gradient(135deg,#991b1b,#dc2626)":"rgba(255,255,255,0.08)",border:"none",borderRadius:12,color:"#fff",fontWeight:800,fontSize:16,cursor:niveau&&focus?"pointer":"not-allowed"}}>⚡ GÉNÉRER MON WOD</button>
        </div>
      )}

      {screen==="loading"&&(
        <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:16}}>
          <div style={{fontSize:48}}>⚡</div>
          <div style={{fontSize:16,fontWeight:700,color:"#f9fafb"}}>Génération du WOD...</div>
          <div style={{display:"flex",gap:5}}>{[0,1,2].map(i=><div key={i} style={{width:8,height:8,borderRadius:"50%",background:"#dc2626",animation:"p 1.2s ease-in-out infinite",animationDelay:`${i*.2}s`}}/>)}</div>
        </div>
      )}

      {screen==="workout"&&wod&&(
        <div style={{flex:1,display:"flex",flexDirection:"column",minHeight:0}}>
          <div style={{background:"#1a0000",padding:"20px 16px",display:"flex",flexDirection:"column",alignItems:"center",flexShrink:0}}>
            <div style={{position:"relative",width:140,height:140,marginBottom:10}}>
              <svg width="140" height="140" viewBox="0 0 140 140">
                <circle cx="70" cy="70" r="60" fill="none" stroke="#2a0000" strokeWidth="10"/>
                <circle cx="70" cy="70" r="60" fill="none" stroke={phaseColor} strokeWidth="10" strokeDasharray={`${2*Math.PI*60}`} strokeDashoffset={`${2*Math.PI*60*(1-pct/100)}`} strokeLinecap="round" transform="rotate(-90 70 70)" style={{transition:"stroke-dashoffset 1s linear"}}/>
              </svg>
              <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
                <div style={{fontSize:38,fontWeight:900,color:phaseColor}}>{timeLeft}</div>
                <div style={{fontSize:11,fontWeight:700,color:phaseColor}}>{phase==="work"?"GO !":phase==="rest"?"REPOS":"PAUSE"}</div>
              </div>
            </div>
            <div style={{fontSize:18,fontWeight:800,color:"#f9fafb",marginBottom:3}}>{phase==="between"?"Prépare-toi...":wod.exercices[currentEx]?.nom}</div>
            {phase==="work"&&<div style={{fontSize:14,color:"#9ca3af"}}>{wod.exercices[currentEx]?.reps} reps</div>}
            <div style={{fontSize:11,color:"#6b7280",marginTop:3}}>Round {currentRound}/{wod.rounds}</div>
          </div>
          <div style={{padding:"12px 16px",display:"flex",gap:8,flexShrink:0}}>
            {!running
              ?<button onClick={()=>{setRunning(true);speak(`${wod.exercices[0].nom}, ${wod.exercices[0].reps} reps. 3, 2, 1, go !`);}} style={{flex:1,padding:"13px",background:"linear-gradient(135deg,#991b1b,#dc2626)",border:"none",borderRadius:12,color:"#fff",fontWeight:800,fontSize:16,cursor:"pointer"}}>▶ GO !</button>
              :<button onClick={()=>{setRunning(false);clearInterval(timerRef.current);}} style={{flex:1,padding:"13px",background:"rgba(255,255,255,0.1)",border:"none",borderRadius:12,color:"#fff",fontWeight:700,fontSize:14,cursor:"pointer"}}>⏸ Pause</button>
            }
            <button onClick={()=>{clearInterval(timerRef.current);handleTimerEnd();}} style={{width:50,height:50,background:"rgba(255,255,255,0.08)",border:"none",borderRadius:12,color:"#9ca3af",fontSize:18,cursor:"pointer"}}>⏭</button>
          </div>
          <div style={{flex:1,overflowY:"scroll",padding:"0 16px 16px",WebkitOverflowScrolling:"touch"}}>
            {wod.exercices.map((ex,i)=>(
              <div key={i} style={{background:i===currentEx&&phase==="work"?"rgba(220,38,38,0.15)":"rgba(255,255,255,0.04)",border:`1px solid ${i===currentEx&&phase==="work"?"#dc2626":"rgba(255,255,255,0.08)"}`,borderRadius:10,padding:"10px 12px",marginBottom:6,display:"flex",alignItems:"center",gap:10}}>
                <div style={{width:24,height:24,borderRadius:"50%",background:i<currentEx?"#16a34a":i===currentEx?"#dc2626":"rgba(255,255,255,0.1)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,fontSize:10,fontWeight:800,color:"#fff"}}>{i<currentEx?"✓":i+1}</div>
                <div style={{flex:1}}>
                  <div style={{fontSize:13,fontWeight:700,color:"#f9fafb"}}>{ex.nom}</div>
                  <div style={{fontSize:11,color:"#6b7280"}}>{ex.reps} · {ex.travail}s</div>
                </div>
              </div>
            ))}
            {wod.conseil&&<div style={{background:"rgba(22,163,74,0.1)",border:"1px solid rgba(22,163,74,0.2)",borderRadius:10,padding:"10px",marginTop:8,fontSize:12,color:"#86efac"}}>💡 {wod.conseil}</div>}
          </div>
        </div>
      )}

      {screen==="done"&&(
        <div style={{flex:1,overflowY:"scroll",padding:"32px 16px",WebkitOverflowScrolling:"touch",textAlign:"center"}}>
          <div style={{fontSize:56,marginBottom:12}}>🏆</div>
          <div style={{fontSize:22,fontWeight:900,color:"#f9fafb",marginBottom:6}}>WOD TERMINÉ !</div>
          <div style={{fontSize:13,color:"#9ca3af",marginBottom:28}}>Bravo {firstName} — {wod?.rounds} rounds en {duree} min !</div>
          <div style={{fontSize:14,fontWeight:700,color:"#f9fafb",marginBottom:14}}>Comment c'était ?</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:20}}>
            {ratingOpts.map(r=>(
              <button key={r.id} onClick={()=>setRating(r.id)} style={{background:rating===r.id?r.color+"30":"rgba(255,255,255,0.06)",border:`2px solid ${rating===r.id?r.color:"rgba(255,255,255,0.1)"}`,borderRadius:14,padding:"14px 10px",cursor:"pointer",textAlign:"center"}}>
                <div style={{fontSize:26,marginBottom:5}}>{r.icon}</div>
                <div style={{fontSize:12,fontWeight:700,color:rating===r.id?r.color:"#f9fafb"}}>{r.label}</div>
              </button>
            ))}
          </div>
          {rating&&<div style={{background:"rgba(22,163,74,0.1)",border:"1px solid rgba(22,163,74,0.2)",borderRadius:12,padding:"10px",marginBottom:16,fontSize:12,color:"#86efac"}}>✓ Évaluation enregistrée — prochain WOD adapté</div>}
          <button onClick={onClose} style={{width:"100%",padding:"13px",background:"linear-gradient(135deg,#991b1b,#dc2626)",border:"none",borderRadius:12,color:"#fff",fontWeight:700,fontSize:14,cursor:"pointer"}}>Retour à l'accueil</button>
        </div>
      )}
    </div>
  );
}

// ─── SÉANCE DU JOUR ───────────────────────────────────────────────────────────
function SeanceExCard({ex, idx, accent, onSaveWeight, savedWeight, onLogSet}) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const totalSets = parseInt(String(ex.sets))||3;
  const restSecs = parseInt(String(ex.rest))||60;
  const defaultReps = String(ex.reps||"").split("-")[0]||"10";
  const [sets, setSets] = useState(Array(totalSets).fill(false));
  const [weights, setWeights] = useState(Array(totalSets).fill(savedWeight||""));
  const [repsArr, setRepsArr] = useState(Array(totalSets).fill(defaultReps));
  const [showRest, setShowRest] = useState(false);

  const handleWeight = (i, val) => {
    setWeights(prev => prev.map((w,j) => j===i ? val : (j>i && !sets[j] ? val : w)));
  };
  const handleReps = (i, val) => setRepsArr(prev => prev.map((r,j) => j===i ? val : r));

  const handleSet = (i) => {
    const ns = sets.map((s,j) => j===i ? !s : s);
    setSets(ns);
    const done = ns.filter(Boolean).length;
    if (ns[i]) {
      if (ns.every(Boolean)) {
        setDone(true); setShowRest(false);
        speak("Exercice terminé ! Bien joué.");
        if (weights[i] && onSaveWeight) onSaveWeight(ex.name, weights[i]);
        if (onLogSet) onLogSet(ex.name, weights.map((w,j)=>({weight:w, reps:repsArr[j], done:ns[j]})));
      } else {
        setShowRest(true);
        speak(`Série ${done} terminée. Repos ${restSecs} secondes.`);
      }
    } else {
      setShowRest(false);
    }
  };

  const weightOpts = ["",...[0.5,1,1.5,2,2.5,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,22,24,25,26,28,30,32,34,35,38,40,42,44,45,48,50,55,60,65,70,75,80,90,100]];
  const repsOpts = Array.from({length:30},(_,i)=>String(i+1));

  return (
    <div style={{background:done?accent+"22":"rgba(255,255,255,0.08)",border:`1.5px solid ${done?accent:open?accent+"66":"rgba(255,255,255,0.2)"}`,borderRadius:12,marginBottom:10}}>
      <div style={{display:"flex",alignItems:"center",gap:10,padding:"12px 14px",cursor:"pointer"}} onClick={()=>setOpen(o=>!o)}>
        <div style={{width:30,height:30,borderRadius:"50%",background:done?accent:accent+"22",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,fontSize:13,color:done?"#fff":accent,flexShrink:0}}>{done?"✓":idx+1}</div>
        <div style={{flex:1}}>
          <div style={{fontWeight:700,fontSize:14,color:"#f9fafb"}}>{ex.name}</div>
          <div style={{fontSize:11,color:"#9ca3af"}}>{ex.sets} × {ex.reps} · {ex.rest}{savedWeight?` · ${savedWeight}kg`:""}</div>
        </div>
        <span style={{fontSize:11,color:accent,fontWeight:700}}>{sets.filter(Boolean).length}/{totalSets}</span>
      </div>
      {open && (
        <div style={{borderTop:"1px solid rgba(255,255,255,0.1)",padding:"12px 14px"}}>
          {ex.desc&&<p style={{fontSize:12,color:"#9ca3af",marginBottom:10,lineHeight:1.5}}>{ex.desc}</p>}
          <TechniqueTip name={ex.name} desc={ex.desc}/>
          <div style={{fontSize:11,fontWeight:700,color:accent,marginBottom:8}}>{sets.filter(Boolean).length}/{totalSets} séries complétées</div>
          {sets.map((s,i)=>(
            <div key={i} style={{display:"flex",alignItems:"center",gap:8,padding:"9px 12px",background:s?"rgba(99,102,241,0.15)":"rgba(255,255,255,0.05)",border:`1px solid ${s?accent:"rgba(255,255,255,0.1)"}`,borderRadius:10,marginBottom:6}}>
              <button onClick={()=>handleSet(i)} style={{width:30,height:30,borderRadius:"50%",background:s?accent:"transparent",border:`2px solid ${s?accent:"rgba(255,255,255,0.3)"}`,color:"#fff",fontWeight:800,fontSize:13,cursor:"pointer",flexShrink:0}}>
                {s?"✓":i+1}
              </button>
              <div style={{flex:1,fontSize:12,color:s?"#f9fafb":"#9ca3af",fontWeight:600}}>Série {i+1}</div>
              <div style={{display:"flex",gap:6}}>
                <div>
                  <div style={{fontSize:9,color:"#6b7280",textAlign:"center",marginBottom:2}}>Reps</div>
                  <select value={repsArr[i]} onChange={e=>handleReps(i,e.target.value)}
                    style={{background:"rgba(255,255,255,0.1)",border:`1px solid ${s?accent:"rgba(255,255,255,0.2)"}`,borderRadius:8,padding:"5px 4px",color:"#f9fafb",fontSize:13,fontWeight:700,textAlign:"center",outline:"none",width:52,cursor:"pointer"}}>
                    {repsOpts.map(n=><option key={n} value={n} style={{background:"#1a1f2e"}}>{n}</option>)}
                  </select>
                </div>
                <div>
                  <div style={{fontSize:9,color:"#6b7280",textAlign:"center",marginBottom:2}}>kg</div>
                  <select value={weights[i]} onChange={e=>handleWeight(i,e.target.value)}
                    style={{background:"rgba(255,255,255,0.1)",border:`1px solid ${s?accent:"rgba(255,255,255,0.2)"}`,borderRadius:8,padding:"5px 4px",color:weights[i]?"#f9fafb":"#6b7280",fontSize:13,fontWeight:700,textAlign:"center",outline:"none",width:60,cursor:"pointer"}}>
                    <option value="" style={{background:"#1a1f2e"}}>— kg</option>
                    {weightOpts.slice(1).map(w=><option key={w} value={String(w)} style={{background:"#1a1f2e"}}>{w}kg</option>)}
                  </select>
                </div>
              </div>
            </div>
          ))}
          {showRest&&(
            <SeanceTimer key={sets.filter(Boolean).length} seconds={restSecs} label={`Repos — ${ex.rest}`} accent={accent} onDone={()=>setShowRest(false)}/>
          )}
        </div>
      )}
    </div>
  );
}


function SeancePanel({token, profile, firstName, onClose, sendToChat, initialSport}) {
  const [screen, setScreen] = useState(initialSport?"config":"sport"); // sport | config | loading | seance | resume
  const [sport, setSport] = useState(initialSport||null);
  const [muscles, setMuscles] = useState([]);
  const [seanceType, setSeanceType] = useState("");
  const [duree, setDuree] = useState(30);
  const [objectif, setObjectif] = useState("");
  const [equip, setEquip] = useState(profile?.equip ? [profile.equip] : ["Poids du corps"]);
  const [resumeData, setResumeData] = useState(null);
  const [seanceData, setSeanceData] = useState(null);
  const [phase, setPhase] = useState("warmup");
  const [warmupTimer, setWarmupTimer] = useState(false);
  const [warmupExIdx, setWarmupExIdx] = useState(0);
  const [cooldownExIdx, setCooldownExIdx] = useState(0);
  const [cooldownTimer, setCooldownTimer] = useState(false);
  const [savedWeights, setSavedWeights] = useState({});
  const [sessionLog, setSessionLog] = useState([]);
  const [seanceStart, setSeanceStart] = useState(null);
  const [rating, setRating] = useState(null); // [{name, sets:[{weight,reps}]}]

  // Load saved weights on mount
  useEffect(() => {
    try {
      const w = JSON.parse(localStorage.getItem("exercise_weights") || "{}");
      setSavedWeights(w);
    } catch {}
    // Check for in-progress session
    try {
      const inProgress = localStorage.getItem("coach_session_inprogress");
      if (inProgress) {
        const session = JSON.parse(inProgress);
        if (session && session.seanceData && session.sport) {
          setResumeData(session);
          setScreen("resume");
        }
      }
    } catch {}
  }, []);

  const saveWeight = (exerciseName, weight) => {
    const key = exerciseName.toLowerCase().trim();
    const updated = {...savedWeights, [key]: weight};
    setSavedWeights(updated);
    try { localStorage.setItem("exercise_weights", JSON.stringify(updated)); } catch {}
  };

  const getWeight = (exerciseName) => {
    if (!exerciseName) return null;
    return savedWeights[exerciseName.toLowerCase().trim()] || null;
  };

  const saveInProgress = (log, data) => {
    try {
      const inProgress = {
        savedAt: new Date().toISOString(),
        sport, seanceType, duree, objectif, equip,
        seanceData: data || seanceData,
        phase,
        sessionLog: log
      };
      localStorage.setItem("coach_session_inprogress", JSON.stringify(inProgress));
    } catch {}
  };

  const clearInProgress = () => {
    try { localStorage.removeItem("coach_session_inprogress"); } catch {}
  };

  const handleLogSet = (exerciseName, sets) => {
    setSessionLog(prev => {
      const existing = prev.findIndex(e => e.name === exerciseName);
      let updated;
      if (existing >= 0) {
        updated = [...prev];
        updated[existing] = {name: exerciseName, sets};
      } else {
        updated = [...prev, {name: exerciseName, sets}];
      }
      // Auto-save in-progress session
      saveInProgress(updated, null);
      // Auto-save to journal
      try {
        const entry = {
          date: new Date().toISOString(),
          type: "seance",
          sport: sport || "musculation",
          titre: seanceData?.titre || `Séance ${sport}`,
          duree, objectif, muscles,
          exercises: updated,
          status: "in_progress"
        };
        const sessions = JSON.parse(localStorage.getItem("coach_sessions") || "[]");
        const today = new Date().toDateString();
        const todayIdx = sessions.findIndex(s => new Date(s.date).toDateString() === today && s.sport === sport);
        if (todayIdx >= 0) sessions[todayIdx] = entry;
        else sessions.unshift(entry);
        localStorage.setItem("coach_sessions", JSON.stringify(sessions.slice(0, 100)));
      } catch {}
      return updated;
    });
  };

  const saveSession = async () => {
    if (sessionLog.length === 0) return;
    const entry = {
      date: new Date().toISOString(),
      type: "seance",
      sport: sport || "musculation",
      titre: seanceData?.titre || `Séance ${sport}`,
      duree,
      objectif,
      muscles,
      exercises: sessionLog
    };
    try {
      await apiFetch("/api/session", {
        method: "POST",
        body: JSON.stringify(entry)
      }, token);
    } catch {}
    // Save to localStorage and clear in-progress
    try {
      entry.status = "completed";
      const sessions = JSON.parse(localStorage.getItem("coach_sessions") || "[]");
      const today = new Date().toDateString();
      const todayIdx = sessions.findIndex(s => new Date(s.date).toDateString() === today && s.sport === entry.sport);
      if (todayIdx >= 0) sessions[todayIdx] = entry;
      else sessions.unshift(entry);
      localStorage.setItem("coach_sessions", JSON.stringify(sessions.slice(0, 100)));
      clearInProgress(); // Session terminée, on efface l'en-cours
    } catch {}
  };

  // Sports disponibles
  const sports = [
    {id:"musculation", icon:"💪", label:"Musculation", cat:"force"},
    {id:"calistenie", icon:"🤸", label:"Callisthénie", cat:"force"},
    {id:"running", icon:"🏃", label:"Running", cat:"cardio"},
    {id:"velo", icon:"🚴", label:"Vélo", cat:"cardio"},
    {id:"natation", icon:"🏊", label:"Natation", cat:"cardio"},
    {id:"hiit", icon:"🔥", label:"HIIT", cat:"cardio"},
    {id:"yoga", icon:"🧘", label:"Yoga", cat:"souplesse"},
    {id:"pilates", icon:"🤸", label:"Pilates", cat:"souplesse"},
    {id:"crossfit", icon:"🏋️", label:"CrossFit", cat:"force"},
    {id:"marche", icon:"🚶", label:"Marche / Rando", cat:"cardio"},
  ];

  // Options spécifiques par sport
  const sportOptions = {
    musculation: {
      label:"Groupes musculaires",
      multi: true,
      opts: [
        {id:"Pectoraux",icon:"💪"},{id:"Dos",icon:"🔙"},{id:"Épaules",icon:"🏋️"},
        {id:"Biceps",icon:"💪"},{id:"Triceps",icon:"🤜"},{id:"Abdominaux",icon:"⚡"},
        {id:"Quadriceps",icon:"🦵"},{id:"Ischio-jambiers",icon:"🦵"},{id:"Fessiers",icon:"🍑"},
        {id:"Corps entier",icon:"🌟"},{id:"Mollets",icon:"🦶"},
      ]
    },
    running: {
      label:"Type de séance",
      multi: false,
      opts: [
        {id:"Endurance fondamentale",icon:"🏃",sub:"Allure confortable, longue durée"},
        {id:"Fractionné court",icon:"⚡",sub:"Intervalles 30s/30s ou 1min/1min"},
        {id:"Fractionné long",icon:"🔥",sub:"Intervalles 3-5 min à allure soutenue"},
        {id:"Tempo run",icon:"📈",sub:"Allure seuil pendant 20-40 min"},
        {id:"Récupération active",icon:"🌿",sub:"Très allure légère, récupération"},
        {id:"Côtes / dénivelé",icon:"🏔️",sub:"Montées et descentes, force-endurance"},
      ]
    },
    velo: {
      label:"Type de séance",
      multi: false,
      opts: [
        {id:"Sortie endurance",icon:"🚴",sub:"Allure modérée, longue distance"},
        {id:"Intervalles haute intensité",icon:"🔥",sub:"Efforts courts et intenses"},
        {id:"Sweet spot",icon:"📈",sub:"Zone 3-4, amélioration FTP"},
        {id:"Récupération",icon:"🌿",sub:"Sortie légère, jambes qui tournent"},
        {id:"Côtes",icon:"🏔️",sub:"Travail en montée, force"},
      ]
    },
    natation: {
      label:"Type de séance",
      multi: false,
      opts: [
        {id:"Endurance nage",icon:"🏊",sub:"Crawl continu, rythme régulier"},
        {id:"Technique",icon:"💧",sub:"Exercices de nage, drill"},
        {id:"Fractionné",icon:"⚡",sub:"Séries avec récupération"},
        {id:"Nage complète",icon:"🌊",sub:"Tous les styles"},
      ]
    },
    hiit: {
      label:"Format de séance",
      multi: false,
      opts: [
        {id:"Tabata",icon:"⚡",sub:"20s effort / 10s repos × 8"},
        {id:"Circuit training",icon:"🔄",sub:"Enchaînement d'exercices"},
        {id:"AMRAP",icon:"💪",sub:"Maximum de tours en temps limité"},
        {id:"EMOM",icon:"⏱️",sub:"Un exercice par minute"},
        {id:"Cardio brûle-graisses",icon:"🔥",sub:"Rythme élevé continu"},
      ]
    },
    yoga: {
      label:"Style de yoga",
      multi: false,
      opts: [
        {id:"Yoga dynamique",icon:"🔥",sub:"Vinyasa, enchaînements fluides"},
        {id:"Yoga doux",icon:"🌿",sub:"Yin, étirements profonds"},
        {id:"Yoga équilibre",icon:"🧘",sub:"Postures d'équilibre et gainage"},
        {id:"Yoga matin",icon:"☀️",sub:"Réveil du corps, énergie"},
        {id:"Yoga récupération",icon:"🌙",sub:"Détente, retour au calme"},
      ]
    },
    pilates: {
      label:"Focus Pilates",
      multi: false,
      opts: [
        {id:"Gainage profond",icon:"💪",sub:"Transverse, plancher pelvien"},
        {id:"Dos et posture",icon:"🔙",sub:"Colonne vertébrale, alignement"},
        {id:"Membres inférieurs",icon:"🦵",sub:"Hanches, fessiers, jambes"},
        {id:"Pilates complet",icon:"🌟",sub:"Corps entier, équilibre"},
        {id:"Pilates doux",icon:"🌿",sub:"Adapté débutant ou récupération"},
      ]
    },
    crossfit: {
      label:"Type de WOD",
      multi: false,
      opts: [
        {id:"WOD force",icon:"🏋️",sub:"Mouvements lourds, haltérophilie"},
        {id:"WOD cardio",icon:"🔥",sub:"Burpees, box jumps, corde"},
        {id:"WOD mixte",icon:"⚡",sub:"Force + cardio combinés"},
        {id:"Benchmark WOD",icon:"📈",sub:"Cindy, Fran, Grace..."},
        {id:"Skill + WOD",icon:"🎯",sub:"Apprentissage technique + conditionnement"},
      ]
    },
    marche: {
      label:"Type de sortie",
      multi: false,
      opts: [
        {id:"Marche active",icon:"🚶",sub:"Allure soutenue, bras actifs"},
        {id:"Randonnée",icon:"🏔️",sub:"Sentier avec dénivelé"},
        {id:"Marche nordique",icon:"🎿",sub:"Avec bâtons, haut du corps"},
        {id:"Récupération douce",icon:"🌿",sub:"Lente, anti-courbatures"},
      ]
    },
    calistenie: {
      label:"Niveau & focus",
      multi: false,
      opts: [
        {id:"Débutant — Fondamentaux",icon:"🌱",sub:"Pompes, dips banc, squats, gainages"},
        {id:"Intermédiaire — Force",icon:"💪",sub:"Dips, traction aidée, pike push-up"},
        {id:"Avancé — Skills",icon:"⭐",sub:"Muscle-up, planche, L-sit, pistol squat"},
        {id:"Poussée (Push)",icon:"🤜",sub:"Pompes, dips, pike, handstand push-up"},
        {id:"Tirage (Pull)",icon:"🤛",sub:"Tractions, rows, australian pull-up"},
        {id:"Jambes & gainage",icon:"🦵",sub:"Pistol squat, nordic curl, L-sit"},
        {id:"Full body",icon:"🌟",sub:"Équilibre poussée + tirage + jambes"},
        {id:"Mobilité & souplesse",icon:"🧘",sub:"Travail articulaire, prérequis skills"},
      ]
    },
  };

  const toggleMuscle = (id) => setMuscles(prev => prev.includes(id) ? prev.filter(m=>m!==id) : [...prev, id]);
  const currentOpts = sport ? sportOptions[sport] : null;
  const canGenerate = sport && duree && objectif && (sport!=="musculation" || muscles.length>0) && (sport==="musculation" || seanceType);
  const isCardio = sport && ["running","velo","natation","marche"].includes(sport);
  const needsWeights = sport === "musculation";

  const generate = async () => {
    if (!canGenerate) return;
    setScreen("loading");
    const equipStr = equip.length > 0 ? equip.join(", ") : (profile?.equip || "Poids du corps");
    const warmupMins2 = duree <= 20 ? 3 : duree <= 35 ? 5 : duree <= 50 ? 7 : 10;
    const cooldownMins2 = duree <= 20 ? 2 : duree <= 35 ? 4 : 5;
    const mainMins2 = duree - warmupMins2 - cooldownMins2;

    // Build context based on sport type
    const sportLabel = sport === "musculation"
      ? `Musculation — ${muscles.join(", ")}`
      : sport === "calistenie"
      ? `Callisthénie — ${seanceType}`
      : seanceType;
    const sportContext = sport === "musculation"
      ? `Équipement : ${equipStr}`
      : sport === "calistenie"
      ? `Callisthénie (poids du corps uniquement, pas de matériel de salle nécessaire). Niveau/focus : ${seanceType}. Proposer des variantes adaptées au niveau avec progressions (ex: si débutant → pompes genoux → pompes normales → pompes déclinées). Indiquer clairement les variantes pour chaque exercice selon le niveau.`
      : `Sport : ${sport}. Pas besoin d'équipement de salle.`;

    // ── Load history for variety & progressive overload ──
    let historyContext = "";
    try {
      const sessions = JSON.parse(localStorage.getItem("coach_sessions") || "[]");
      const sameSport = sessions.filter(s => s.sport === sport).slice(0, 5);
      if (sameSport.length > 0) {
        const recentExos = sameSport.flatMap(s => (s.exercises || []).map(e => e.name)).filter(Boolean);
        const uniqueRecent = [...new Set(recentExos)].slice(0, 12);
        const lastWeights = {};
        sameSport[0]?.exercises?.forEach(e => {
          if (e.sets?.length > 0) {
            const w = e.sets.find(s => s.weight)?.weight;
            if (w) lastWeights[e.name] = w;
          }
        });
        historyContext = `
HISTORIQUE (${sameSport.length} dernières séances ${sport}) :
- Exercices récents à VARIER ou alterner : ${uniqueRecent.join(", ")}
- Charges dernière séance : ${Object.entries(lastWeights).map(([n,w])=>`${n}: ${w}kg`).join(", ") || "première séance"}
RÈGLES DE PROGRESSION :
- Ne pas répéter exactement les mêmes exercices que la dernière séance
- Si des charges sont connues, proposer +1 à +2.5kg ou +1-2 reps
- Alterner les patterns musculaires (push/pull, haut/bas, bilatéral/unilatéral)`;
      }
    } catch {}

    const prompt = `Tu es un coach sportif expert. Génère une séance unique pour ${firstName}.
DURÉE TOTALE STRICTE : ${duree} min = échauffement ${warmupMins2} min + séance ${mainMins2} min + retour au calme ${cooldownMins2} min.
Ne pas dépasser ${duree} min. Pour ${mainMins2} min de séance principale : musculation ${Math.max(3,Math.floor(mainMins2/8))} exercices (8min/exercice : 3 séries + repos + installation). Respecter strictement ce nombre.par exercice avec repos). Ne pas depasser cette limite.
Sport : ${sportLabel} | Objectif : ${objectif} | ${sportContext}
${profile ? `Niveau : ${profile.level} | Age : ${profile.age} ans` : ""}
${historyContext}

Réponds UNIQUEMENT avec ce format JSON, sans texte autour :
{
  "titre": "Titre court de la séance",
  "warmup": {
    "duree": ${warmupMins2},
    "exercices": ["exercice 1 - Xsec", "exercice 2 - Xsec", "exercice 3 - Xsec"]
  },
  "main": [
    {"name": "Nom exercice", "sets": "3", "reps": "10-12", "rest": "75s", "desc": "Technique courte"},
    {"name": "Nom exercice", "sets": "3", "reps": "10-12", "rest": "60s", "desc": "Technique courte"}
  ],
  "cooldown": {
    "duree": ${cooldownMins2},
    "exercices": ["étirement 1 - Xsec", "étirement 2 - Xsec", "étirement 3 - Xsec"]
  },
  "conseil": "Un conseil clé pour cette séance en une phrase."
}`;

    try {
      const r = await fetch(API+"/api/coach", {
        method:"POST",
        headers:{"Content-Type":"application/json","Authorization":`Bearer ${token}`},
        body:JSON.stringify({system:"Tu es un coach sportif expert. Réponds UNIQUEMENT en JSON valide, sans markdown.",messages:[{role:"user",content:prompt}],max_tokens:2000})
      });
      const data = await r.json();
      let text = data.content?.[0]?.text || "";
      text = text.replace(/```[\w]*/g,"").replace(/```/g,"").trim(); text = (text.match(/\{[\s\S]*\}/)||[text])[0];
      // Handle nested content structure
      let parsed;
      try { parsed = JSON.parse(text); } catch(jsonErr) {
        // Try to extract JSON from response
        const jParsed = text.match(/\{[\s\S]*\}/);
        if (jParsed) parsed = JSON.parse(jParsed[0]);
        else throw jsonErr;
      }
      // Validate structure
      if (!parsed.main || !Array.isArray(parsed.main) || parsed.main.length === 0) {
        throw new Error("Structure invalide: pas d exercices dans main");
      }
      // Normalize: convert number sets/reps to strings, fix rest format
      parsed.main = parsed.main.map(ex => ({
        ...ex,
        name: ex.name || ex.nom || "Exercice",
        sets: String(ex.sets || "3"),
        reps: String(ex.reps || "10"),
        rest: String(ex.rest || "60s").replace(" sec","s").replace(" secondes","s"),
        desc: ex.desc || ex.description || ""
      }));
      // Add defaults if missing
      if (!parsed.warmup) parsed.warmup = {duree: warmupMins2, exercices: ["Échauffement général - 60sec", "Mobilité articulaire - 60sec", "Montée de genoux - 45sec"]};
      if (!parsed.cooldown) parsed.cooldown = {duree: cooldownMins2, exercices: ["Étirement quadriceps - 30sec", "Étirement ischio-jambiers - 30sec", "Respiration profonde - 60sec"]};
      // Normalize warmup/cooldown exercices
      if (parsed.warmup && !Array.isArray(parsed.warmup.exercices)) parsed.warmup.exercices = [];
      if (parsed.cooldown && !Array.isArray(parsed.cooldown.exercices)) parsed.cooldown.exercices = [];
      setSeanceData(parsed);
      setScreen("seance");
      setPhase("warmup");
      // Save initial in-progress
      try {
        localStorage.setItem("coach_session_inprogress", JSON.stringify({
          savedAt: new Date().toISOString(),
          sport, seanceType, duree, objectif, equip,
          seanceData: parsed, phase: "warmup", sessionLog: []
        }));
      } catch {}
      // Save initial in-progress state
      try {
        const inProgress = {
          savedAt: new Date().toISOString(),
          sport, seanceType, duree, objectif, equip,
          seanceData: parsed, phase: "warmup", sessionLog: []
        };
        localStorage.setItem("coach_session_inprogress", JSON.stringify(inProgress));
      } catch {}
    } catch(e) {
      setScreen("config");
      alert("Erreur de génération : " + e.message + "\n\nEssaie à nouveau.");
    }
  };

  const phaseColors = {warmup:C.orange, main:C.blue, cooldown:C.green};
  const phaseLabels = {warmup:"🔥 Échauffement", main:"💪 Séance principale", cooldown:"🧘 Retour au calme"};

  const handleClose = () => { saveSession(); onClose(); };

  return (
    <div style={{position:"fixed",top:0,left:0,right:0,bottom:0,background:C.bg,zIndex:200,display:"flex",flexDirection:"column",fontFamily:"system-ui,sans-serif"}}>
      {/* Header */}
      <div style={{background:`linear-gradient(135deg,#064e3b,#059669)`,padding:"14px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
        <div>
          <div style={{fontSize:16,fontWeight:800,color:"#fff"}}>⚡ Séance du jour</div>
          <div style={{fontSize:11,color:"rgba(255,255,255,0.65)"}}>{screen==="seance"&&seanceData ? seanceData.titre : screen==="config"?`${sport} · Config`:"Choisis ton sport"}</div>
        </div>
        <div style={{display:"flex",gap:6}}>
          {screen==="seance"&&<button onClick={()=>setScreen("config")} style={{background:"rgba(255,255,255,0.15)",border:"none",borderRadius:8,padding:"6px 10px",color:"#fff",fontSize:13,cursor:"pointer"}} title="Modifier durée/équipement">⚙️</button>}
          {screen==="seance"&&<button onClick={()=>setScreen("sport")} style={{background:"rgba(255,255,255,0.15)",border:"none",borderRadius:8,padding:"6px 10px",color:"#fff",fontSize:12,cursor:"pointer"}}>↺</button>}
          <button onClick={handleClose} style={{background:"rgba(255,255,255,0.15)",border:"none",borderRadius:8,padding:"6px 10px",color:"#fff",fontSize:12,cursor:"pointer"}}>✕</button>
        </div>
      </div>

      {/* Resume screen */}
      {screen==="resume" && resumeData && (
        <div style={{flex:1,overflowY:"scroll",padding:"24px 16px",WebkitOverflowScrolling:"touch",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",textAlign:"center"}}>
          <div style={{fontSize:48,marginBottom:16}}>⏸️</div>
          <div style={{fontSize:18,fontWeight:800,color:"#f9fafb",marginBottom:8}}>Séance en cours</div>
          <div style={{fontSize:13,color:"#9ca3af",marginBottom:6}}>
            {resumeData.seanceData?.titre || `Séance ${resumeData.sport}`}
          </div>
          <div style={{fontSize:11,color:"#6b7280",marginBottom:28}}>
            Commencée {new Date(resumeData.savedAt).toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"})} · {resumeData.sessionLog?.length || 0} exercice{resumeData.sessionLog?.length !== 1 ? "s" : ""} enregistré{resumeData.sessionLog?.length !== 1 ? "s" : ""}
          </div>
          <button onClick={()=>{
            setSport(resumeData.sport);
            setSeanceType(resumeData.seanceType);
            setDuree(resumeData.duree);
            setObjectif(resumeData.objectif);
            setEquip(resumeData.equip || ["Poids du corps"]);
            setSeanceData(resumeData.seanceData);
            setSessionLog(resumeData.sessionLog || []);
            setPhase(resumeData.phase || "main");
            setScreen("seance");
          }} style={{width:"100%",padding:"14px",background:`linear-gradient(135deg,#059669,#10b981)`,border:"none",borderRadius:12,color:"#fff",fontWeight:700,fontSize:15,cursor:"pointer",marginBottom:12,boxShadow:"0 4px 20px rgba(16,185,129,0.3)"}}>
            ▶ Reprendre ma séance
          </button>
          <button onClick={()=>{
            clearInProgress();
            setResumeData(null);
            setScreen("sport");
          }} style={{width:"100%",padding:"12px",background:"rgba(255,255,255,0.07)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:12,color:"#9ca3af",fontWeight:600,fontSize:13,cursor:"pointer"}}>
            Ignorer · Commencer une nouvelle séance
          </button>
        </div>
      )}

      {/* Sport selection screen */}
      {screen==="sport" && (
        <div style={{flex:1,overflowY:"scroll",padding:"16px",WebkitOverflowScrolling:"touch",height:"100%"}}>
          <div style={{fontSize:13,fontWeight:700,color:"#f9fafb",marginBottom:14}}>🏃 Quel sport aujourd'hui ?</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:20}}>
            {[
              {id:"musculation",icon:"💪",label:"Musculation",sub:"Renforcement musculaire"},
              {id:"running",icon:"🏃",label:"Running",sub:"Course à pied"},
              {id:"velo",icon:"🚴",label:"Vélo",sub:"Cyclisme"},
              {id:"natation",icon:"🏊",label:"Natation",sub:"Piscine / eau"},
              {id:"hiit",icon:"🔥",label:"HIIT",sub:"Haute intensité"},
              {id:"yoga",icon:"🧘",label:"Yoga",sub:"Souplesse & méditation"},
              {id:"pilates",icon:"🤸",label:"Pilates",sub:"Gainage & posture"},
              {id:"crossfit",icon:"🏋️",label:"CrossFit",sub:"Force fonctionnelle"},
              {id:"marche",icon:"🚶",label:"Marche / Rando",sub:"Récupération active"},
            ].map(s=>(
              <button key={s.id} onClick={()=>{setSport(s.id);setMuscles([]);setSeanceType("");setObjectif("");setScreen("config");}}
                style={{background:"rgba(255,255,255,0.06)",border:"1.5px solid rgba(255,255,255,0.12)",borderRadius:14,padding:"16px 12px",cursor:"pointer",textAlign:"center"}}>
                <div style={{fontSize:28,marginBottom:6}}>{s.icon}</div>
                <div style={{fontSize:13,fontWeight:700,color:"#f9fafb",marginBottom:2}}>{s.label}</div>
                <div style={{fontSize:10,color:"#6b7280"}}>{s.sub}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Config screen */}
      {screen==="config" && currentOpts && (
        <div style={{flex:1,overflowY:"scroll",padding:"16px",WebkitOverflowScrolling:"touch",height:"100%"}}>
          <button onClick={()=>setScreen("sport")} style={{background:"rgba(255,255,255,0.08)",border:"none",borderRadius:8,padding:"6px 12px",color:"#9ca3af",fontSize:12,cursor:"pointer",marginBottom:16}}>← Changer de sport</button>

          {/* Durée */}
          <div style={{marginBottom:20}}>
            <div style={{fontSize:13,fontWeight:700,color:"#f9fafb",marginBottom:10}}>⏱ Durée disponible</div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              {[10,15,20,30,45,60,75,90].map(d=>(
                <button key={d} onClick={()=>setDuree(d)} style={{background:duree===d?"rgba(59,111,240,0.25)":"rgba(255,255,255,0.07)",border:`1.5px solid ${duree===d?"#3b6ff0":"rgba(255,255,255,0.1)"}`,borderRadius:20,padding:"7px 14px",cursor:"pointer",fontSize:13,fontWeight:700,color:duree===d?"#93c5fd":"#9ca3af"}}>
                  {d} min
                </button>
              ))}
            </div>
          </div>

          {/* Options spécifiques au sport */}
          <div style={{marginBottom:20}}>
            <div style={{fontSize:13,fontWeight:700,color:"#f9fafb",marginBottom:10}}>{currentOpts.label}</div>
            <div style={{display:"grid",gridTemplateColumns:currentOpts.multi?"1fr 1fr 1fr":"1fr",gap:8}}>
              {currentOpts.opts.map(o=>(
                <button key={o.id}
                  onClick={()=>currentOpts.multi ? toggleMuscle(o.id) : setSeanceType(o.id)}
                  style={{background:(currentOpts.multi?muscles.includes(o.id):seanceType===o.id)?"rgba(22,163,74,0.2)":"rgba(255,255,255,0.06)",
                    border:`1.5px solid ${(currentOpts.multi?muscles.includes(o.id):seanceType===o.id)?"#16a34a":"rgba(255,255,255,0.1)"}`,
                    borderRadius:12,padding:currentOpts.multi?"10px 8px":"12px 14px",cursor:"pointer",
                    textAlign:currentOpts.multi?"center":"left",display:currentOpts.multi?"block":"flex",alignItems:"center",gap:10}}>
                  {o.icon&&<span style={{fontSize:currentOpts.multi?20:18,marginBottom:currentOpts.multi?4:0,flexShrink:0,display:"block"}}>{o.icon}</span>}
                  <div>
                    <div style={{fontSize:currentOpts.multi?10:13,fontWeight:700,color:(currentOpts.multi?muscles.includes(o.id):seanceType===o.id)?"#86efac":"#f9fafb",lineHeight:1.3}}>{o.id}</div>
                    {o.sub&&<div style={{fontSize:10,color:"#6b7280",marginTop:2}}>{o.sub}</div>}
                  </div>
                  {!currentOpts.multi&&seanceType===o.id&&<span style={{marginLeft:"auto",color:"#86efac",fontSize:16}}>✓</span>}
                </button>
              ))}
            </div>
          </div>

          {/* Équipement - multi-select + custom */}
          {/* Équipement — affiché uniquement si pertinent */}
          {(()=>{
            const noEquip = ["running","velo","natation","marche"];
            const caliEquip = ["calistenie"];
            const hiitEquip = ["hiit","crossfit"];
            if(noEquip.includes(sport)) return null;
            
            const equipOpts = caliEquip.includes(sport) ? [
              {id:"Poids du corps",icon:"🤸",sub:"Aucun matériel"},
              {id:"Barre de traction",icon:"🔝",sub:"Pull-up bar"},
              {id:"Anneaux",icon:"⭕",sub:"Gymnastic rings"},
              {id:"Parallettes",icon:"⚡",sub:"Barres basses"},
              {id:"Élastiques",icon:"🎗️",sub:"Assistance"},
            ] : hiitEquip.includes(sport) ? [
              {id:"Poids du corps",icon:"🤸",sub:"Aucun matériel"},
              {id:"Haltères",icon:"🏋️",sub:"Légers à modérés"},
              {id:"Kettlebell",icon:"🔔",sub:"Poids russe"},
              {id:"Élastiques",icon:"🎗️",sub:"Bandes de résistance"},
              {id:"Corde à sauter",icon:"🪢",sub:"Cardio intense"},
              {id:"Banc / Step",icon:"🪜",sub:"Box jumps, step"},
            ] : sport === "yoga" || sport === "pilates" ? [
              {id:"Tapis",icon:"🟩",sub:"Tapis de sol"},
              {id:"Bloc yoga",icon:"🧱",sub:"Support postures"},
              {id:"Sangle yoga",icon:"🎗️",sub:"Étirements assistés"},
              {id:"Bolster",icon:"🛏️",sub:"Relaxation"},
            ] : [
              {id:"Poids du corps",icon:"🤸",sub:"Aucun matériel"},
              {id:"Haltères",icon:"🏋️",sub:"Paire ou plusieurs"},
              {id:"Barre + disques",icon:"⚖️",sub:"Barre olympique"},
              {id:"Machines salle",icon:"🏢",sub:"Accès salle de sport"},
              {id:"Élastiques",icon:"🎗️",sub:"Bandes de résistance"},
              {id:"Kettlebell",icon:"🔔",sub:"Poids russe"},
              {id:"Banc",icon:"🛋️",sub:"Banc de musculation"},
              {id:"Barre de traction",icon:"🔝",sub:"Pull-up bar"},
            ];
            return (
              <div style={{marginBottom:20}}>
                <div style={{fontSize:13,fontWeight:700,color:"#f9fafb",marginBottom:10}}>🏋️ Équipement disponible</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
                  {equipOpts.map(e=>(
                    <button key={e.id} onClick={()=>setEquip(eq=>eq.includes(e.id)?eq.filter(x=>x!==e.id):[...eq,e.id])}
                      style={{background:equip.includes(e.id)?"rgba(59,111,240,0.2)":"rgba(255,255,255,0.06)",border:`1.5px solid ${equip.includes(e.id)?"#3b6ff0":"rgba(255,255,255,0.1)"}`,borderRadius:12,padding:"10px",cursor:"pointer",textAlign:"left",display:"flex",alignItems:"center",gap:8}}>
                      <span style={{fontSize:18,flexShrink:0}}>{e.icon}</span>
                      <div>
                        <div style={{fontSize:12,fontWeight:700,color:equip.includes(e.id)?"#93c5fd":"#f9fafb"}}>{e.id}</div>
                        <div style={{fontSize:10,color:"#6b7280"}}>{e.sub}</div>
                      </div>
                    </button>
                  ))}
                </div>
                <div style={{display:"flex",gap:8}}>
                  <input id="custom-equip" type="text" placeholder="Autre matériel..."
                    style={{flex:1,background:"rgba(255,255,255,0.07)",border:"1px solid rgba(255,255,255,0.15)",borderRadius:10,padding:"9px 12px",color:"#f9fafb",fontSize:12,outline:"none"}}/>
                  <button onClick={()=>{const v=document.getElementById("custom-equip").value.trim();if(v){setEquip(eq=>[...eq,v]);document.getElementById("custom-equip").value="";}}}
                    style={{background:"rgba(59,111,240,0.3)",border:"none",borderRadius:10,padding:"9px 14px",color:"#93c5fd",fontWeight:700,fontSize:12,cursor:"pointer"}}>+ Ajouter</button>
                </div>
                {equip.filter(e=>!equipOpts.map(o=>o.id).includes(e)).map(e=>(
                  <div key={e} style={{display:"inline-flex",alignItems:"center",gap:6,background:"rgba(59,111,240,0.15)",border:"1px solid rgba(59,111,240,0.3)",borderRadius:20,padding:"4px 10px",marginTop:6,marginRight:6}}>
                    <span style={{fontSize:12,color:"#93c5fd"}}>{e}</span>
                    <button onClick={()=>setEquip(eq=>eq.filter(x=>x!==e))} style={{background:"none",border:"none",color:"#6b7280",cursor:"pointer",fontSize:14,padding:0}}>×</button>
                  </div>
                ))}
              </div>
            );
          })()}
          <div style={{marginBottom:20}}>
            <div style={{fontSize:13,fontWeight:700,color:"#f9fafb",marginBottom:4}}>🎯 Objectifs <span style={{fontSize:10,color:"#6b7280",fontWeight:400}}>(plusieurs possibles)</span></div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
              {[
                {id:"Prise de masse",icon:"💪",sub:"Volume musculaire"},
                {id:"Force maximale",icon:"⚡",sub:"Charges lourdes"},
                {id:"Perte de poids",icon:"🔥",sub:"Brûler des calories"},
                {id:"Endurance musculaire",icon:"🏃",sub:"Résistance longue"},
                {id:"Récupération",icon:"🌿",sub:"Séance douce"},
                {id:"Souplesse",icon:"🧘",sub:"Mobilité & étirements"},
                {id:"Cardio",icon:"❤️",sub:"Condition physique"},
                {id:"Performance",icon:"🏆",sub:"Sport spécifique"},
              ].map(o=>{
                const selected = objectif.split(",").map(s=>s.trim()).filter(Boolean).includes(o.id);
                return (
                  <button key={o.id} onClick={()=>{
                    const current = objectif.split(",").map(s=>s.trim()).filter(Boolean);
                    const updated = selected ? current.filter(x=>x!==o.id) : [...current, o.id];
                    setObjectif(updated.join(", "));
                  }}
                    style={{background:selected?"rgba(234,108,0,0.2)":"rgba(255,255,255,0.06)",border:`1.5px solid ${selected?"#ea6c00":"rgba(255,255,255,0.1)"}`,borderRadius:12,padding:"10px",cursor:"pointer",textAlign:"center"}}>
                    <div style={{fontSize:18,marginBottom:3}}>{o.icon}</div>
                    <div style={{fontSize:11,fontWeight:700,color:selected?"#fdba74":"#f9fafb"}}>{o.id}</div>
                    <div style={{fontSize:10,color:"#6b7280"}}>{o.sub}</div>
                  </button>
                );
              })}
            </div>
            {/* Custom objectif */}
            <div style={{display:"flex",gap:8}}>
              <input id="custom-obj" type="text" placeholder="Autre objectif..."
                style={{flex:1,background:"rgba(255,255,255,0.07)",border:"1px solid rgba(255,255,255,0.15)",borderRadius:10,padding:"9px 12px",color:"#f9fafb",fontSize:12,outline:"none"}}/>
              <button onClick={()=>{const v=document.getElementById("custom-obj").value.trim();if(v){setObjectif(o=>o?o+", "+v:v);document.getElementById("custom-obj").value="";}}}
                style={{background:"rgba(234,108,0,0.3)",border:"none",borderRadius:10,padding:"9px 14px",color:"#fdba74",fontWeight:700,fontSize:12,cursor:"pointer"}}>+ Ajouter</button>
            </div>
          </div>

          <button onClick={generate} disabled={!canGenerate}
            style={{width:"100%",padding:"14px",background:canGenerate?"#16a34a":"rgba(255,255,255,0.08)",border:"none",borderRadius:12,color:"#fff",fontWeight:700,fontSize:15,cursor:canGenerate?"pointer":"not-allowed",marginBottom:20}}>
            ⚡ Générer ma séance
          </button>
        </div>
      )}

      {/* Loading */}
      {screen==="loading" && (
        <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:16}}>
          <div style={{fontSize:44}}>⚡</div>
          <div style={{fontSize:15,fontWeight:700,color:C.t1}}>Génération de ta séance...</div>
          <div style={{display:"flex",gap:5}}>
            {[0,1,2].map(i=><div key={i} style={{width:8,height:8,borderRadius:"50%",background:C.blue,animation:"p 1.2s ease-in-out infinite",animationDelay:`${i*.2}s`}}/>)}
          </div>
          <style>{`@keyframes p{0%,80%,100%{opacity:.3;transform:scale(.8)}40%{opacity:1;transform:scale(1)}}`}</style>
        </div>
      )}

      {/* Séance screen */}
      {screen==="seance" && seanceData && (
        <div style={{flex:1,display:"flex",flexDirection:"column",minHeight:0,overflow:"hidden"}}>
          {/* Progress bar header */}
          <div style={{background:C.surfHigh,borderBottom:"1px solid rgba(255,255,255,0.08)",padding:"10px 14px",flexShrink:0}}>
            <div style={{display:"flex",gap:4,marginBottom:5}}>
              {["warmup","main","cooldown"].map((p,i)=>(
                <div key={p} onClick={()=>setPhase(p)} style={{flex:p==="main"?3:1,height:3,borderRadius:2,background:phase===p?phaseColors[p]:i<["warmup","main","cooldown"].indexOf(phase)?"rgba(255,255,255,0.3)":"rgba(255,255,255,0.12)",cursor:"pointer",transition:"background .3s"}}/>
              ))}
            </div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{fontSize:10,fontWeight:700,color:phaseColors[phase]}}>{phaseLabels[phase]}</div>
              <div style={{display:"flex",gap:6}}>
                {["warmup","main","cooldown"].map((p,i)=>(
                  <button key={p} onClick={()=>setPhase(p)} style={{padding:"3px 10px",borderRadius:20,border:"none",background:phase===p?phaseColors[p]+"28":"transparent",color:phase===p?phaseColors[p]:"#6b7280",fontSize:9,fontWeight:700,cursor:"pointer"}}>
                    {p==="warmup"?"🔥 Éch.":p==="main"?"💪 Main":"🧘 Retour"}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div style={{flex:1,overflowY:"auto",padding:"14px 14px 30px",WebkitOverflowScrolling:"touch",minHeight:0}}>
            {/* Warmup */}
            {phase==="warmup" && (
              <div>
                {/* Progress bar */}
                <div style={{display:"flex",gap:4,marginBottom:12}}>
                  {seanceData.warmup.exercices.map((_,i)=>(
                    <div key={i} style={{flex:1,height:4,borderRadius:2,background:i<warmupExIdx?C.orange:i===warmupExIdx?"rgba(249,115,22,0.5)":"rgba(255,255,255,0.1)"}}/>
                  ))}
                </div>

                {/* Current exercise hero */}
                <div style={{background:`linear-gradient(180deg,${C.orange}18,transparent)`,border:`1px solid ${C.orange}33`,borderRadius:14,padding:"16px",marginBottom:12,textAlign:"center"}}>
                  <div style={{fontSize:9,color:C.orange,fontWeight:700,textTransform:"uppercase",letterSpacing:".1em",marginBottom:8}}>
                    Exercice {warmupExIdx+1}/{seanceData.warmup.exercices.length}
                  </div>
                  <div style={{fontSize:18,fontWeight:800,color:"#f9fafb",marginBottom:6}}>
                    {seanceData.warmup.exercices[warmupExIdx]?.split(" - ")[0] || seanceData.warmup.exercices[warmupExIdx]}
                  </div>
                  <div style={{fontSize:13,color:C.orange,fontWeight:700,marginBottom:12}}>
                    {seanceData.warmup.exercices[warmupExIdx]?.match(/\d+\s*(sec|min)/i)?.[0] || "45 sec"}
                  </div>
                  {warmupTimer
                    ? <SeanceTimer
                        key={warmupExIdx}
                        seconds={parseExSecs(seanceData.warmup.exercices[warmupExIdx])}
                        label={seanceData.warmup.exercices[warmupExIdx]?.split(" - ")[0]}
                        accent={C.orange}
                        onDone={()=>{
                          const next = warmupExIdx + 1;
                          if (next < seanceData.warmup.exercices.length) {
                            setWarmupExIdx(next);
                            speak(seanceData.warmup.exercices[next]?.split(" - ")[0] || "Exercice suivant");
                          } else {
                            setWarmupTimer(false);
                            setWarmupExIdx(0);
                            setSeanceStart(Date.now());
                            setPhase("main");
                            speak(`Échauffement terminé. Séance principale. ${seanceData.main.length} exercices. C'est parti ${firstName} !`);
                          }
                        }}
                      />
                    : <button onClick={()=>{
                        setWarmupTimer(true);
                        speak(seanceData.warmup.exercices[warmupExIdx]?.split(" - ")[0] || "C'est parti");
                      }} style={{padding:"10px 24px",background:C.orange,border:"none",borderRadius:10,color:"#fff",fontWeight:700,fontSize:13,cursor:"pointer"}}>
                        ▶ Lancer
                      </button>
                  }
                </div>

                {/* Exercise list */}
                <div style={{display:"flex",flexDirection:"column",gap:5}}>
                  {seanceData.warmup.exercices.map((ex,i)=>(
                    <div key={i} onClick={()=>{setWarmupExIdx(i);setWarmupTimer(false);}}
                      style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",
                        background:i===warmupExIdx?C.orange+"18":i<warmupExIdx?"rgba(255,255,255,0.03)":"rgba(255,255,255,0.05)",
                        border:`1px solid ${i===warmupExIdx?C.orange+"44":"rgba(255,255,255,0.08)"}`,
                        borderRadius:10,cursor:"pointer",opacity:i<warmupExIdx?0.5:1}}>
                      <div style={{width:22,height:22,borderRadius:"50%",background:i<warmupExIdx?C.green:i===warmupExIdx?C.orange:"rgba(255,255,255,0.1)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:800,color:"#fff",flexShrink:0}}>
                        {i<warmupExIdx?"✓":i+1}
                      </div>
                      <span style={{fontSize:12,color:i===warmupExIdx?"#f9fafb":"#9ca3af",flex:1}}>{ex}</span>
                    </div>
                  ))}
                </div>

                <button onClick={()=>{setPhase("main");setWarmupExIdx(0);setWarmupTimer(false);speak(`Séance principale. ${seanceData.main.length} exercices. C'est parti, ${firstName} !`);}}
                  style={{width:"100%",marginTop:14,padding:"12px",background:C.green,border:"none",borderRadius:10,color:"#fff",fontWeight:700,fontSize:13,cursor:"pointer"}}>
                  Passer à la séance principale →
                </button>
              </div>
            )}

            {/* Main */}
            {phase==="main" && (
              <div>
                {seanceData.conseil&&(
                  <div style={{background:"rgba(16,185,129,0.1)",border:"1px solid rgba(16,185,129,0.2)",borderRadius:10,padding:"8px 12px",marginBottom:12,fontSize:11,color:"#34d399"}}>
                    💡 {seanceData.conseil}
                  </div>
                )}
                {isCardio ? (
                  <div>
                    <div style={{background:"rgba(59,130,246,0.1)",border:"1px solid rgba(59,130,246,0.2)",borderRadius:12,padding:14,marginBottom:12,textAlign:"center"}}>
                      <div style={{fontSize:12,color:"#93c5fd",marginBottom:4,fontWeight:600}}>🏃 {seanceType}</div>
                      <div style={{fontSize:28,fontWeight:900,color:"#60a5fa"}}>{duree-(duree<=20?3:duree<=35?5:8)-(duree<=20?2:duree<=35?3:5)} min</div>
                      <div style={{fontSize:10,color:"#6b7280",marginTop:2}}>durée séance principale</div>
                    </div>
                    {seanceData.main.map((ex,i)=>(
                      <div key={i} style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.09)",borderRadius:12,padding:"12px 14px",marginBottom:8}}>
                        <div style={{display:"flex",alignItems:"center",gap:10}}>
                          <div style={{width:26,height:26,borderRadius:"50%",background:"rgba(59,130,246,0.2)",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,fontSize:11,color:"#60a5fa",flexShrink:0}}>{i+1}</div>
                          <div style={{flex:1}}>
                            <div style={{fontWeight:700,fontSize:13,color:"#f9fafb"}}>{ex.name}</div>
                            <div style={{fontSize:11,color:"#9ca3af",marginTop:1}}>{ex.reps}</div>
                          </div>
                        </div>
                        {ex.desc&&<p style={{fontSize:11,color:"#9ca3af",lineHeight:1.6,margin:"8px 0 0"}}>{ex.desc}</p>}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div>
                    {/* Active exercise - first uncompleted */}
                    {seanceData.main.map((ex,i)=>{
                      console.log("Rendering ex:", i, ex.name, ex.sets, ex.reps);
                      return <SeanceExCard key={i} ex={ex} idx={i} accent={C.indigo}
                        savedWeight={getWeight(ex.name)}
                        onSaveWeight={saveWeight}
                        onLogSet={handleLogSet}/>;
                    })}
                  </div>
                )}
                <button onClick={()=>{setPhase("cooldown");saveSession();speak(`Excellent travail ! Place au retour au calme. ${seanceData.cooldown.duree} minutes d'étirements.`);}} style={{width:"100%",marginTop:12,padding:"12px",background:C.green,border:"none",borderRadius:10,color:"#fff",fontWeight:700,fontSize:13,cursor:"pointer"}}>
                  Retour au calme →
                </button>
              </div>
            )}

            {/* Cooldown */}
            {phase==="cooldown" && (
              <div>
                <div style={{background:"rgba(16,185,129,0.1)",border:"1px solid rgba(16,185,129,0.2)",borderRadius:14,padding:"16px",marginBottom:12,textAlign:"center"}}>
                  <div style={{fontSize:9,color:C.green,fontWeight:700,textTransform:"uppercase",letterSpacing:".1em",marginBottom:4}}>Retour au calme — {seanceData.cooldown.duree} min</div>
                  <div style={{fontSize:11,color:C.t4}}>Étirements et récupération — ne zappe pas cette étape !</div>
                </div>
                <div style={{fontSize:9,color:C.t4,fontWeight:700,textTransform:"uppercase",letterSpacing:".06em",marginBottom:8}}>Étirements</div>
                {/* Progress */}
                <div style={{display:"flex",gap:4,marginBottom:12}}>
                  {seanceData.cooldown.exercices.map((_,i)=>(
                    <div key={i} style={{flex:1,height:4,borderRadius:2,background:i<cooldownExIdx?C.green:i===cooldownExIdx?"rgba(16,185,129,0.5)":"rgba(255,255,255,0.1)"}}/>
                  ))}
                </div>
                {/* Current exercise */}
                <div style={{background:"rgba(16,185,129,0.1)",border:"1px solid rgba(16,185,129,0.2)",borderRadius:14,padding:"16px",marginBottom:12,textAlign:"center"}}>
                  <div style={{fontSize:9,color:C.green,fontWeight:700,textTransform:"uppercase",marginBottom:8}}>
                    Étirement {cooldownExIdx+1}/{seanceData.cooldown.exercices.length}
                  </div>
                  <div style={{fontSize:16,fontWeight:800,color:"#f9fafb",marginBottom:6}}>
                    {seanceData.cooldown.exercices[cooldownExIdx]?.split(" - ")[0]}
                  </div>
                  <div style={{fontSize:13,color:C.green,fontWeight:700,marginBottom:12}}>
                    {seanceData.cooldown.exercices[cooldownExIdx]?.match(/\d+\s*(sec|min)/i)?.[0] || "30 sec"}
                  </div>
                  {cooldownTimer
                    ? <SeanceTimer
                        key={"cool-"+cooldownExIdx}
                        seconds={parseExSecs(seanceData.cooldown.exercices[cooldownExIdx])}
                        label={seanceData.cooldown.exercices[cooldownExIdx]?.split(" - ")[0]}
                        accent={C.green}
                        onDone={()=>{
                          const next = cooldownExIdx + 1;
                          if (next < seanceData.cooldown.exercices.length) {
                            setCooldownExIdx(next);
                            speak(seanceData.cooldown.exercices[next]?.split(" - ")[0] || "Étirement suivant");
                          } else {
                            setCooldownTimer(false);
                          }
                        }}
                      />
                    : <button onClick={()=>{setCooldownTimer(true);speak(seanceData.cooldown.exercices[cooldownExIdx]?.split(" - ")[0]||"C'est parti");}}
                        style={{padding:"10px 24px",background:C.green,border:"none",borderRadius:10,color:"#fff",fontWeight:700,fontSize:13,cursor:"pointer"}}>
                        ▶ Lancer
                      </button>
                  }
                </div>
                {/* Exercise list */}
                {seanceData.cooldown.exercices.map((ex,i)=>(
                  <div key={i} onClick={()=>{setCooldownExIdx(i);setCooldownTimer(false);}}
                    style={{display:"flex",alignItems:"center",gap:10,padding:"9px 12px",
                      background:i===cooldownExIdx?C.green+"18":i<cooldownExIdx?"rgba(255,255,255,0.03)":"rgba(255,255,255,0.05)",
                      border:"1px solid "+(i===cooldownExIdx?C.green+"44":"rgba(255,255,255,0.08)"),
                      borderRadius:10,marginBottom:5,cursor:"pointer",opacity:i<cooldownExIdx?0.5:1}}>
                    <div style={{width:22,height:22,borderRadius:"50%",background:i<cooldownExIdx?C.green:i===cooldownExIdx?"rgba(16,185,129,0.3)":"rgba(255,255,255,0.1)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:800,color:"#fff",flexShrink:0}}>
                      {i<cooldownExIdx?"✓":i+1}
                    </div>
                    <span style={{fontSize:12,color:i===cooldownExIdx?"#f9fafb":"#9ca3af",flex:1}}>{ex}</span>
                  </div>
                ))}
                <div style={{marginTop:24,textAlign:"center",padding:"20px"}}>
                  <div style={{fontSize:48,marginBottom:12}}>🏆</div>
                  <div style={{fontSize:18,fontWeight:800,color:"#f9fafb",marginBottom:6}}>Séance terminée !</div>
                  {(()=>{
                    const totalVol = sessionLog.reduce((acc,ex)=>acc+(ex.sets||[]).reduce((a,s)=>a+(parseFloat(s.weight)||0)*(parseFloat(s.reps)||0),0),0);
                    const duration = seanceStart ? Math.round((Date.now()-seanceStart)/60000) : null;
                    return (totalVol>0||duration) ? (
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:16,width:"100%"}}>
                        {duration&&<div style={{background:"rgba(99,102,241,0.15)",border:"1px solid rgba(99,102,241,0.3)",borderRadius:12,padding:"12px",textAlign:"center"}}>
                          <div style={{fontSize:22,fontWeight:900,color:"#818cf8"}}>{duration}</div>
                          <div style={{fontSize:10,color:"#6b7280",marginTop:2}}>min</div>
                        </div>}
                        {totalVol>0&&<div style={{background:"rgba(16,185,129,0.15)",border:"1px solid rgba(16,185,129,0.3)",borderRadius:12,padding:"12px",textAlign:"center"}}>
                          <div style={{fontSize:22,fontWeight:900,color:"#34d399"}}>{totalVol>=1000?(totalVol/1000).toFixed(1)+"t":Math.round(totalVol)+"kg"}</div>
                          <div style={{fontSize:10,color:"#6b7280",marginTop:2}}>volume</div>
                        </div>}
                      </div>
                    ) : null;
                  })()}
                  {(()=>{ const rm = computeSessionMuscles({ muscles, sport, duree }); return Object.keys(rm).length>0 ? (
                    <div style={{marginBottom:18}}>
                      <div style={{fontSize:13,fontWeight:700,color:C.t2,marginBottom:10}}>Muscles travaillés</div>
                      <MuscleMap gender={profile?.gender==="femme"?"female":"male"} data={rm} height={230} />
                    </div>
                  ) : null; })()}
                  <div style={{fontSize:18,fontWeight:800,color:C.t1,marginBottom:6}}>Séance terminée !</div>
                  <div style={{fontSize:13,color:C.t3,marginBottom:20}}>Bravo {firstName} — excellent travail !</div>
                  {/* Rating */}
                  <div style={{fontSize:13,fontWeight:700,color:C.t2,marginBottom:12}}>Comment c'était ?</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:20}}>
                    {[{id:"facile",icon:"😴",l:"Trop facile",c:"#6b7280"},{id:"bien",icon:"💪",l:"Bien",c:C.green},{id:"dur",icon:"🔥",l:"Difficile",c:C.orange},{id:"epuise",icon:"💀",l:"Trop dur",c:C.red}].map(r=>(
                      <button key={r.id} onClick={()=>{setRating(r.id);saveSession();speak(`${r.l} ! Bien joue ${firstName}.`);}} style={{background:rating===r.id?r.c:`${r.c}22`,border:`2px solid ${rating===r.id?r.c:r.c+"55"}`,borderRadius:14,padding:"16px 8px",cursor:"pointer",textAlign:"center"}}>
                        <div style={{fontSize:28,marginBottom:6}}>{r.icon}</div>
                        <div style={{fontSize:11,fontWeight:700,color:r.c}}>{r.l}</div>
                      </button>
                    ))}
                  </div>
                  <button onClick={onClose} style={{padding:"12px 32px",background:C.indigo,border:"none",borderRadius:12,color:"#fff",fontWeight:700,fontSize:14,cursor:"pointer"}}>
                    Retour à l'accueil
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
function NutritionDisplay({text}) {
  if (!text) return null;
  
  // Parse and render the nutrition plan cleanly
  const lines = text.split(String.fromCharCode(10));
  const elements = [];
  let i = 0;
  
  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line || line === '---' || line === '***') { i++; continue; }
    
    // H1/H2/H3
    if (line.startsWith('### ')) {
      elements.push(
        <div key={i} style={{fontSize:12,fontWeight:800,color:"#1f2937",textTransform:"uppercase",letterSpacing:".08em",marginTop:16,marginBottom:8,borderBottom:"2px solid #e8eaed",paddingBottom:4}}>
          {line.replace(/^#+\s*/,'')}
        </div>
      );
    } else if (line.startsWith('## ')) {
      elements.push(
        <div key={i} style={{fontSize:14,fontWeight:800,color:"#1f2937",marginTop:20,marginBottom:8}}>
          {line.replace(/^#+\s*/,'')}
        </div>
      );
    } else if (line.startsWith('# ')) {
      elements.push(
        <div key={i} style={{fontSize:16,fontWeight:900,color:"#0f1117",marginBottom:12}}>
          {line.replace(/^#+\s*/,'')}
        </div>
      );
    // Table rows
    } else if (line.startsWith('|') && line.endsWith('|')) {
      if (line.includes('---')) { i++; continue; } // skip separator
      const cells = line.split('|').filter(c=>c.trim());
      const isHeader = i > 0 && lines[i-1]?.trim() === '' || elements.length === 0;
      elements.push(
        <div key={i} style={{display:"grid",gridTemplateColumns:`repeat(${cells.length},1fr)`,gap:1,marginBottom:1}}>
          {cells.map((c,j)=>(
            <div key={j} style={{background:j===0?"#f4f5f8":"#ffffff",padding:"7px 10px",fontSize:12,color:"#374151",fontWeight:j===0?600:400,borderRadius:j===0?"6px 0 0 6px":j===cells.length-1?"0 6px 6px 0":0,border:"1px solid #e8eaed"}}>
              {c.trim().replace(/\*\*/g,'')}
            </div>
          ))}
        </div>
      );
    // Bullet points
    } else if (line.startsWith('- ') || line.startsWith('• ')) {
      elements.push(
        <div key={i} style={{display:"flex",gap:8,marginBottom:4}}>
          <span style={{color:"#3b6ff0",fontWeight:700,flexShrink:0}}>›</span>
          <span style={{fontSize:13,color:"#374151",lineHeight:1.5}}>{line.replace(/^[-•]\s*/,'').replace(/\*\*/g,'')}</span>
        </div>
      );
    // Bold text
    } else if (line.includes('**')) {
      elements.push(
        <p key={i} style={{fontSize:13,color:"#374151",lineHeight:1.6,margin:"4px 0"}}
          dangerouslySetInnerHTML={{__html:line.replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>')}}/> 
      );
    // Regular text
    } else if (line.length > 0) {
      elements.push(
        <p key={i} style={{fontSize:13,color:"#374151",lineHeight:1.6,margin:"3px 0"}}>{line}</p>
      );
    }
    i++;
  }
  
  return (
    <div style={{background:"#ffffff",borderRadius:14,padding:16,boxShadow:"0 2px 12px rgba(0,0,0,0.08)"}}>
      {elements}
    </div>
  );
}


// ─── NUTRITION PANEL ──────────────────────────────────────────────────────────
function NutritionPanel({token, profile, firstName, onClose, sendToChat}) {
  const [mode, setMode] = useState("frigo"); // frigo | courses | semaine
  const [ingredients, setIngredients] = useState("");
  const [budget, setBudget] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const imc = profile ? (profile.weight/((profile.height/100)**2)).toFixed(1) : "?";

  const modeLabels = {
    frigo: { icon:"🧊", label:"J'ai dans mon frigo", placeholder:"Ex: poulet, riz, courgettes, oeufs, fromage blanc..." },
    courses: { icon:"🛒", label:"Je vais faire les courses", placeholder:"Ex: budget 50€, j'aime le poulet et le poisson..." },
    semaine: { icon:"📅", label:"Plan semaine complet", placeholder:"Contraintes, allergies, préférences..." },
  };

  const generate = async () => {
    setLoading(true); setResult(null);
    const modeLabel = modeLabels[mode].label;
    const cals = profile ? Math.round(
      profile.gender === "femme"
        ? (10*profile.weight + 6.25*profile.height - 5*profile.age - 161) * 1.55
        : (10*profile.weight + 6.25*profile.height - 5*profile.age + 5) * 1.55
    ) : 2000;
    const prot = profile ? Math.round(profile.weight * 2) : 150;

    const prompt = mode === "frigo"
      ? `En tant que nutritionniste expert, génère 3 repas équilibrés pour ${firstName} en utilisant ces ingrédients disponibles : ${ingredients}. Profil : ${profile?.goal}, ${profile?.age} ans, ${profile?.weight}kg, objectif ${cals} kcal/jour et ${prot}g de protéines. Pour chaque repas : nom, ingrédients et quantités précises, valeurs nutritionnelles (kcal, protéines, glucides, lipides), temps de préparation et instructions simples.`
      : mode === "courses"
      ? `Génère une liste de courses pour une semaine pour ${firstName}. Profil : ${profile?.goal}, ${profile?.age} ans, ${profile?.weight}kg, objectif ${cals} kcal/jour et ${prot}g de protéines/jour. Contraintes/préférences : ${ingredients || budget || "aucune"}. Inclus : liste de courses organisée par rayon, 5 repas types avec recettes simples, macros journaliers moyens.`
      : `Génère un plan de repas complet pour la semaine pour ${firstName}. Profil : ${profile?.goal}, ${profile?.age} ans, ${profile?.weight}kg, objectif ${cals} kcal/jour et ${prot}g de protéines. Notes : ${ingredients || "aucune"}. Inclus : 7 jours de repas (petit-déjeuner, déjeuner, dîner, collation), macros par jour, liste de courses.`;

    try {
      const r = await fetch(API+"/api/coach", {
        method:"POST",
        headers:{"Content-Type":"application/json","Authorization":`Bearer ${token}`},
        body:JSON.stringify({system:`Tu es un nutritionniste expert. Réponds en français de façon claire et pratique. Structure bien avec des sections. Adapte toujours à l'objectif sportif de l'utilisateur.`,messages:[{role:"user",content:prompt}],max_tokens:1500})
      });
      const data = await r.json();
      const text = data.content?.[0]?.text || "Erreur de génération";
      setResult(text);
    } catch(e) {
      setResult("Erreur : " + e.message);
    }
    setLoading(false);
  };

  const sendChat = () => {
    if (result) {
      sendToChat("Voici mon plan nutrition : " + result.slice(0, 200) + "... Comment l'adapter à mon programme sportif ?");
      onClose();
    }
  };

  return (
    <div style={{position:"fixed",inset:0,background:C.bg,zIndex:200,display:"flex",flexDirection:"column",fontFamily:"system-ui,sans-serif"}}>
      <div style={{background:`linear-gradient(135deg,#064e3b,#16a34a)`,padding:"14px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
        <div>
          <div style={{fontSize:16,fontWeight:800,color:"#fff"}}>🥗 Coach Nutrition</div>
          <div style={{fontSize:11,color:"rgba(255,255,255,0.65)"}}>Repas adaptés à ton profil · {imc} IMC</div>
        </div>
        <button onClick={onClose} style={{background:"rgba(255,255,255,0.15)",border:"none",borderRadius:8,padding:"6px 12px",color:"#fff",fontSize:12,cursor:"pointer"}}>✕</button>
      </div>

      <div style={{flex:1,overflowY:"scroll",padding:"16px",WebkitOverflowScrolling:"touch"}}>
        {/* Mode selector */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:16}}>
          {Object.entries(modeLabels).map(([k,v])=>(
            <button key={k} onClick={()=>{setMode(k);setResult(null);}} style={{background:mode===k?C.green+"18":C.surf,border:`1.5px solid ${mode===k?C.green:C.bord}`,borderRadius:11,padding:"10px 8px",cursor:"pointer",textAlign:"center"}}>
              <div style={{fontSize:20,marginBottom:4}}>{v.icon}</div>
              <div style={{fontSize:10,fontWeight:700,color:mode===k?C.green:C.t2,lineHeight:1.3}}>{v.label}</div>
            </button>
          ))}
        </div>

        {/* Macros recap */}
        {profile && (
          <div style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:11,padding:"12px",marginBottom:14}}>
            <div style={{fontSize:10,color:C.t3,fontWeight:700,textTransform:"uppercase",letterSpacing:".06em",marginBottom:8}}>Tes objectifs nutritionnels</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
              {[
                ["Calories cible", Math.round((profile.gender==="femme"?(10*profile.weight+6.25*profile.height-5*profile.age-161):(10*profile.weight+6.25*profile.height-5*profile.age+5))*1.55)+" kcal", C.blue],
                ["Protéines", Math.round(profile.weight*2)+"g/j", C.green],
                ["Objectif", profile.goal, C.orange],
              ].map(([l,v,c])=>(
                <div key={l} style={{background:C.bg,borderRadius:9,padding:"8px",textAlign:"center"}}>
                  <div style={{fontSize:13,fontWeight:800,color:c}}>{v}</div>
                  <div style={{fontSize:9,color:C.t3,marginTop:2}}>{l}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Input */}
        <div style={{marginBottom:14}}>
          <div style={{fontSize:12,color:C.t3,marginBottom:6}}>{modeLabels[mode].label}</div>
          <textarea value={ingredients} onChange={e=>setIngredients(e.target.value)}
            placeholder={modeLabels[mode].placeholder}
            style={{width:"100%",background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:9,padding:"10px 12px",color:C.t1,fontSize:13,resize:"vertical",minHeight:90,fontFamily:"inherit",boxSizing:"border-box"}}/>
        </div>

        <button onClick={generate} disabled={loading} style={{width:"100%",padding:"13px",background:loading?C.high:C.green,border:"none",borderRadius:11,color:"#fff",fontWeight:700,fontSize:14,cursor:loading?"not-allowed":"pointer",marginBottom:16}}>
          {loading?"⏳ Génération en cours...":"🍽️ Générer mes repas"}
        </button>

        {/* Result */}
        {result && (
          <div style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:12,padding:14,marginBottom:12}}>
            <div style={{fontSize:10,color:C.green,fontWeight:700,textTransform:"uppercase",letterSpacing:".06em",marginBottom:10}}>Ton plan nutrition</div>
            <NutritionDisplay text={result}/>
            <button onClick={sendChat} style={{marginTop:14,width:"100%",padding:"10px",background:C.blue,border:"none",borderRadius:10,color:"#fff",fontWeight:700,fontSize:13,cursor:"pointer"}}>
              💬 Discuter avec mon coach
            </button>
          </div>
        )}
      </div>
    </div>
  );
}


// ─── JOURNAL ──────────────────────────────────────────────────────────────────
function Journal({token, onClose}) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Load from API
    apiFetch("/api/sessions", {}, token).then(data => {
      if (data?.sessions) setEntries(data.sessions);
      else {
        // Fallback: localStorage
        try {
          const local = JSON.parse(localStorage.getItem("coach_sessions") || "[]");
          setEntries(local);
        } catch {}
      }
    }).catch(() => {
      try {
        const local = JSON.parse(localStorage.getItem("coach_sessions") || "[]");
        setEntries(local);
      } catch {}
    }).finally(() => setLoading(false));
  }, [token]);

  const sportIcon = (sport) => {
    const icons = {musculation:"💪",running:"🏃",velo:"🚴",natation:"🏊",hiit:"🔥",yoga:"🧘",pilates:"🤸",crossfit:"🏋️",marche:"🚶"};
    return icons[sport] || "⚡";
  };

  const formatDate = (iso) => {
    try {
      return new Date(iso).toLocaleDateString("fr-FR", {weekday:"short", day:"numeric", month:"short"});
    } catch { return iso; }
  };

  const typeLabel = (e) => {
    if (e.type === "hiit") return "WOD HIIT";
    if (e.type === "seance") return `Séance · ${e.sport}`;
    return e.titre || "Séance";
  };

  return (
    <div style={{position:"fixed",inset:0,background:C.bg,zIndex:200,display:"flex",flexDirection:"column",fontFamily:"system-ui,sans-serif"}}>
      <div style={{background:"linear-gradient(135deg,#1a1f2e,#252a3a)",borderBottom:"1px solid rgba(255,255,255,0.08)",padding:"14px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
        <div>
          <div style={{fontSize:16,fontWeight:800,color:"#fff"}}>📊 Journal d'entraînement</div>
          <div style={{fontSize:11,color:"rgba(255,255,255,0.5)"}}>{entries.length} séance{entries.length!==1?"s":""} enregistrée{entries.length!==1?"s":""}</div>
        </div>
        <button onClick={onClose} style={{background:"rgba(255,255,255,0.1)",border:"none",borderRadius:8,padding:"6px 12px",color:"#fff",fontSize:12,cursor:"pointer"}}>✕</button>
      </div>

      <div style={{flex:1,overflowY:"scroll",padding:"16px",WebkitOverflowScrolling:"touch"}}>
        {loading && (
          <div style={{textAlign:"center",padding:40,color:C.t4}}>Chargement...</div>
        )}
        {!loading && entries.length === 0 && (
          <div style={{textAlign:"center",padding:40}}>
            <div style={{fontSize:40,marginBottom:12}}>📋</div>
            <div style={{fontSize:14,fontWeight:700,color:C.t2,marginBottom:6}}>Aucune séance enregistrée</div>
            <div style={{fontSize:12,color:C.t4}}>Tes séances apparaîtront ici automatiquement</div>
          </div>
        )}
        {!loading && entries.map((e, i) => (
          <div key={i} style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.09)",borderRadius:14,padding:"14px",marginBottom:10}}>
            {/* Header */}
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
              <div style={{width:36,height:36,borderRadius:10,background:"rgba(99,102,241,0.2)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>
                {sportIcon(e.sport)}
              </div>
              <div style={{flex:1}}>
                <div style={{fontSize:13,fontWeight:700,color:"#f9fafb"}}>{e.titre || typeLabel(e)}</div>
                <div style={{fontSize:11,color:"#9ca3af",marginTop:1}}>{formatDate(e.date)} · {e.duree} min</div>
              </div>
              {e.objectif && (
                <div style={{fontSize:9,color:"#a5b4fc",background:"rgba(99,102,241,0.15)",borderRadius:20,padding:"3px 8px",fontWeight:600}}>
                  {e.objectif.split(" — ")[0]}
                </div>
              )}
            </div>
            {/* Exercises */}
            {e.exercises && e.exercises.length > 0 && (
              <div style={{borderTop:"1px solid rgba(255,255,255,0.07)",paddingTop:10}}>
                <div style={{fontSize:9,color:"#6b7280",fontWeight:700,textTransform:"uppercase",letterSpacing:".06em",marginBottom:8}}>
                  {e.exercises.length} exercice{e.exercises.length!==1?"s":""}
                </div>
                {e.exercises.map((ex, j) => (
                  <div key={j} style={{display:"flex",alignItems:"center",gap:8,marginBottom:5}}>
                    <div style={{width:4,height:4,borderRadius:"50%",background:"#6366f1",flexShrink:0}}/>
                    <div style={{flex:1,fontSize:12,color:"#e5e7eb"}}>{ex.name}</div>
                    <div style={{fontSize:11,color:"#9ca3af"}}>
                      {ex.sets?.map((s,k) => s.weight ? `${s.weight}kg` : "—").filter((v,k,a)=>a.indexOf(v)===k).join(" / ")}
                    </div>
                    <div style={{fontSize:10,color:"#6b7280"}}>
                      {ex.sets?.length} séries
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}


function ProgramDashboard({parsed, profile, firstName, token, logData, onLogSet, onBack}) {
  const [tab, setTab] = useState("analyse"); // analyse | seances | progression | nutrition
  const [showChat, setShowChat] = useState(false);
  const [chatMsgs, setChatMsgs] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const chatBottom = useRef(null);

  useEffect(()=>{ chatBottom.current?.scrollIntoView({behavior:"smooth"}); },[chatMsgs]);

  const imc = (profile.weight/((profile.height/100)**2)).toFixed(1);
  const cols = {bleu:"#3b6ff0",vert:"#16a34a",violet:"#7c3aed",orange:"#ea6c00"};

  const sendChat = async(msg) => {
    const newMsgs = [...chatMsgs, {role:"user",content:msg}];
    setChatMsgs([...newMsgs, {role:"assistant",content:"",loading:true}]);
    setChatBusy(true); setChatInput("");
    try {
      const r = await fetch(API+"/api/coach", {
        method:"POST",
        headers:{"Content-Type":"application/json","Authorization":`Bearer ${token}`},
        body: JSON.stringify({
          system: `Tu es un coach sportif expert. ${firstName} a un programme personnalisé. Réponds en français, de façon directe et pratique.`,
          messages: [...newMsgs],
          max_tokens: 800
        })
      });
      const data = await r.json();
      const reply = data.content?.[0]?.text || "Erreur";
      setChatMsgs(prev => [...prev.slice(0,-1), {role:"assistant",content:reply}]);
    } catch(e) {
      setChatMsgs(prev => [...prev.slice(0,-1), {role:"assistant",content:"Erreur: "+e.message}]);
    }
    setChatBusy(false);
  };

  const tabs = [
    {id:"analyse",label:"📊 Analyse"},
    {id:"seances",label:"💪 Séances"},
    {id:"progression",label:"📈 Progression"},
  ];

  return (
    <div style={{minHeight:"100vh",background:"#0f1117",fontFamily:"system-ui,sans-serif"}}>
      
      {/* Header */}
      <div style={{background:"linear-gradient(135deg,#1e3a8a,#1d4ed8)",padding:"20px 20px 0"}}>
        <div style={{maxWidth:720,margin:"0 auto"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
            <button onClick={onBack} style={{background:"rgba(255,255,255,0.15)",border:"none",borderRadius:8,padding:"6px 12px",color:"#fff",fontSize:12,cursor:"pointer",fontWeight:600}}>← Accueil</button>
            <div style={{fontSize:12,color:"rgba(255,255,255,0.6)"}}>Programme de {firstName}</div>
          </div>
          
          {/* Dashboard KPIs */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:12,marginBottom:20}}>
            {[
              {label:"Âge",val:profile.age+" ans",icon:"👤"},
              {label:"IMC",val:imc,icon:"⚖️"},
              {label:"Objectif",val:profile.goal?.split(" ")[0]||"",icon:"🎯"},
              {label:"Séances/sem",val:profile.days+"j",icon:"📅"},
            ].map(k=>(
              <div key={k.label} style={{background:"rgba(255,255,255,0.1)",borderRadius:12,padding:"12px 10px",textAlign:"center"}}>
                <div style={{fontSize:18,marginBottom:4}}>{k.icon}</div>
                <div style={{fontSize:16,fontWeight:800,color:"#fff"}}>{k.val}</div>
                <div style={{fontSize:10,color:"rgba(255,255,255,0.6)"}}>{k.label}</div>
              </div>
            ))}
          </div>

          {/* Macros */}
          {parsed?.cals&&(
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:20}}>
              {[
                {label:"Métabolisme",val:parsed.cals.base+" kcal",color:"rgba(255,255,255,0.7)"},
                {label:"Objectif calorique",val:parsed.cals.cible+" kcal",color:"#60a5fa"},
                {label:"Protéines/jour",val:parsed.cals.prot+"g",color:"#86efac"},
              ].map(m=>(
                <div key={m.label} style={{background:"rgba(255,255,255,0.08)",borderRadius:12,padding:"12px",textAlign:"center"}}>
                  <div style={{fontSize:18,fontWeight:800,color:m.color}}>{m.val}</div>
                  <div style={{fontSize:10,color:"rgba(255,255,255,0.5)",marginTop:3}}>{m.label}</div>
                </div>
              ))}
            </div>
          )}

          {/* Tabs */}
          <div style={{display:"flex",gap:2}}>
            {tabs.map(t=>(
              <button key={t.id} onClick={()=>setTab(t.id)} style={{padding:"10px 16px",background:"transparent",border:"none",cursor:"pointer",fontSize:13,fontWeight:700,color:tab===t.id?"#fff":"rgba(255,255,255,0.5)",borderBottom:tab===t.id?"3px solid #60a5fa":"3px solid transparent",transition:"all .2s"}}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div style={{maxWidth:720,margin:"0 auto",padding:"20px 16px",paddingBottom:100}}>
        
        {/* Analyse tab */}
        {tab==="analyse"&&(
          <div>
            {parsed?.bilan&&(
              <div style={{background:"rgba(255,255,255,0.06)",borderRadius:16,padding:"20px",marginBottom:14,boxShadow:"0 2px 12px rgba(0,0,0,0.4)"}}>
                <div style={{fontSize:11,color:"#9ca3af",fontWeight:700,textTransform:"uppercase",letterSpacing:".1em",marginBottom:10}}>🔍 Bilan personnalisé</div>
                <p style={{fontSize:14,color:"#f9fafb",lineHeight:1.7,margin:0}}>{parsed.bilan}</p>
              </div>
            )}
            {parsed?.strat&&(
              <div style={{background:"rgba(255,255,255,0.06)",borderRadius:16,padding:"20px",marginBottom:14,boxShadow:"0 2px 12px rgba(0,0,0,0.4)"}}>
                <div style={{fontSize:11,color:"#9ca3af",fontWeight:700,textTransform:"uppercase",letterSpacing:".1em",marginBottom:12}}>⚡ Stratégie</div>
                <MD t={parsed.strat}/>
              </div>
            )}
            {parsed?.week&&(
              <div style={{background:"rgba(255,255,255,0.06)",borderRadius:16,padding:"20px",boxShadow:"0 2px 12px rgba(0,0,0,0.4)"}}>
                <div style={{fontSize:11,color:"#9ca3af",fontWeight:700,textTransform:"uppercase",letterSpacing:".1em",marginBottom:12}}>📅 Planning semaine</div>
                <MD t={parsed.week}/>
              </div>
            )}
          </div>
        )}

        {/* Séances tab */}
        {tab==="seances"&&(
          <div>
            {parsed?.sessions?.length>0 ? parsed.sessions.map((s,i)=>(
              <SessionBlock key={i} session={s} accent={cols[s.color]||"#3b6ff0"} logData={logData} onLogSet={onLogSet}/>
            )) : (
              <div style={{textAlign:"center",padding:"40px",color:"#9ca3af"}}>
                <div style={{fontSize:40,marginBottom:12}}>📋</div>
                <div>Aucune séance trouvée dans ce programme.</div>
              </div>
            )}
          </div>
        )}

        {/* Progression tab */}
        {tab==="progression"&&(
          <div>
            {parsed?.prog&&(
              <div style={{background:"rgba(255,255,255,0.06)",borderRadius:16,padding:"20px",boxShadow:"0 2px 12px rgba(0,0,0,0.4)"}}>
                <div style={{fontSize:11,color:"#9ca3af",fontWeight:700,textTransform:"uppercase",letterSpacing:".1em",marginBottom:12}}>📈 Progression sur 8 semaines</div>
                <MD t={parsed.prog}/>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Chat button */}
      <div style={{position:"fixed",bottom:20,right:20,zIndex:50}}>
        <button onClick={()=>setShowChat(true)} style={{background:"linear-gradient(135deg,#3b6ff0,#2563eb)",border:"none",borderRadius:16,padding:"14px 20px",color:"#fff",fontWeight:700,fontSize:14,cursor:"pointer",boxShadow:"0 8px 24px rgba(59,111,240,0.45)",display:"flex",alignItems:"center",gap:8}}>
          💬 Parler à mon coach
        </button>
      </div>

      {/* Chat panel */}
      {showChat&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",zIndex:200,display:"flex",alignItems:"flex-end"}}>
          <div style={{width:"100%",maxHeight:"70vh",background:"#1a1f2e",borderRadius:"20px 20px 0 0",display:"flex",flexDirection:"column"}}>
            <div style={{padding:"16px 20px",borderBottom:"1px solid #252a38",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
              <div style={{fontSize:15,fontWeight:800,color:"#f9fafb"}}>💬 Mon coach</div>
              <button onClick={()=>setShowChat(false)} style={{background:"rgba(255,255,255,0.08)",border:"none",borderRadius:8,padding:"6px 12px",color:"#9ca3af",cursor:"pointer",fontSize:12}}>Fermer</button>
            </div>
            <div style={{flex:1,overflowY:"auto",padding:"16px",WebkitOverflowScrolling:"touch"}}>
              {chatMsgs.length===0&&(
                <div style={{textAlign:"center",padding:"20px",color:"#9ca3af",fontSize:13}}>
                  Pose une question sur ton programme, ta nutrition, tes exercices...
                </div>
              )}
              {chatMsgs.map((m,i)=>(
                <div key={i} style={{display:"flex",justifyContent:m.role==="user"?"flex-end":"flex-start",marginBottom:10}}>
                  <div style={{maxWidth:"80%",background:m.role==="user"?"linear-gradient(135deg,#3b6ff0,#2563eb)":"#ffffff",borderRadius:m.role==="user"?"16px 16px 4px 16px":"4px 16px 16px 16px",padding:"10px 14px",fontSize:13,color:m.role==="user"?"#fff":"#1f2937",lineHeight:1.5,boxShadow:m.role==="assistant"?"0 2px 8px rgba(0,0,0,0.1)":"none"}}>
                    {m.loading?<span style={{color:"#9ca3af"}}>...</span>:m.content}
                  </div>
                </div>
              ))}
              <div ref={chatBottom}/>
            </div>
            <div style={{padding:"12px 16px",borderTop:"1px solid #252a38",display:"flex",gap:8,flexShrink:0}}>
              <input value={chatInput} onChange={e=>setChatInput(e.target.value)}
                onKeyDown={e=>e.key==="Enter"&&!chatBusy&&chatInput.trim()&&sendChat(chatInput)}
                placeholder="Ta question..." disabled={chatBusy}
                style={{flex:1,background:"rgba(255,255,255,0.07)",border:"1.5px solid rgba(255,255,255,0.1)",borderRadius:12,padding:"10px 14px",color:"#f9fafb",fontSize:13,fontFamily:"inherit",outline:"none"}}/>
              <button onClick={()=>chatInput.trim()&&!chatBusy&&sendChat(chatInput)} disabled={chatBusy||!chatInput.trim()}
                style={{width:42,height:42,borderRadius:12,background:chatBusy||!chatInput.trim()?"rgba(255,255,255,0.08)":"linear-gradient(135deg,#3b6ff0,#2563eb)",border:"none",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


// ─── PLAN DE PRÉPARATION ─────────────────────────────────────────────────────
function PrepPanel({token, profile, firstName, onClose}) {
  const [step, setStep] = useState("sport"); // sport | params | result
  const [sport, setSport] = useState(null);
  const [objective, setObjective] = useState("");
  const [weeks, setWeeks] = useState(12);
  const [currentLevel, setCurrentLevel] = useState("");
  const [targetTime, setTargetTime] = useState("");
  const [loading, setLoading] = useState(false);
  const [plan, setPlan] = useState(null);
  const [activeWeek, setActiveWeek] = useState(0);

  const sports = [
    {
      id:"running", icon:"🏃", label:"Running",
      objectives:[
        {id:"5km",label:"5 km",icon:"🏅"},
        {id:"10km",label:"10 km",icon:"🥈"},
        {id:"semi",label:"Semi-marathon",icon:"🥇"},
        {id:"marathon",label:"Marathon",icon:"🏆"},
        {id:"trail",label:"Trail",icon:"🏔️"},
      ]
    },
    {
      id:"triathlon", icon:"🏊", label:"Triathlon",
      objectives:[
        {id:"S",label:"Triathlon S (sprint)",icon:"⚡"},
        {id:"M",label:"Triathlon M (olympique)",icon:"🥇"},
        {id:"L",label:"Triathlon L (half)",icon:"🏆"},
        {id:"XL",label:"Ironman",icon:"🔱"},
      ]
    },
    {
      id:"cyclisme", icon:"🚴", label:"Cyclisme",
      objectives:[
        {id:"granfondo",label:"Gran Fondo / Cyclosportive",icon:"🚴"},
        {id:"100km",label:"100 km",icon:"🏅"},
        {id:"col",label:"Ascension de col",icon:"🏔️"},
        {id:"critérium",label:"Critérium / Course",icon:"🏆"},
      ]
    },
    {
      id:"natation", icon:"🏊", label:"Natation",
      objectives:[
        {id:"1km",label:"1 km en continu",icon:"💧"},
        {id:"2km",label:"2 km open water",icon:"🌊"},
        {id:"10km",label:"10 km / Marathon nage",icon:"🏆"},
      ]
    },
    {
      id:"musculation", icon:"💪", label:"Musculation",
      objectives:[
        {id:"prise_masse",label:"Prise de masse",icon:"📈"},
        {id:"seche",label:"Sèche / Définition",icon:"🔥"},
        {id:"force",label:"Force maximale",icon:"🏋️"},
        {id:"recompo",label:"Recomposition corporelle",icon:"⚡"},
      ]
    },
  ];

  const weekOptions = [4,6,8,10,12,16,20,24];
  const levelOptions = [
    {id:"débutant",label:"Débutant",sub:"Je commence"},
    {id:"intermédiaire",label:"Intermédiaire",sub:"Pratique régulière"},
    {id:"avancé",label:"Avancé",sub:"Compétiteur"},
  ];

  const selectedSport = sports.find(s=>s.id===sport);

  const generate = async () => {
    setLoading(true);
    const age = profile?.age || 40;
    const weight = profile?.weight || 75;
    const isEndurance = ["running","triathlon","cyclisme","natation"].includes(sport);

    const prompt = `Tu es un coach expert en préparation sportive. Génère un plan pour ${firstName}.
Sport : ${sport} | Objectif : ${objective} | Durée : ${weeks} semaines | Niveau : ${currentLevel}
${targetTime?`Objectif visé : ${targetTime}`:""}
${profile?`Profil : ${age} ans, ${weight}kg`:""}

Réponds UNIQUEMENT en JSON valide, sans markdown, sans apostrophes dans les valeurs texte :
{
  "titre": "Plan Marathon 16 semaines",
  "resume": "Description courte du plan",
  "phases": [
    {"nom": "Phase 1 - Fondation", "semaines": "1-4", "objectif": "Base aerobie", "volume": "30-40km/sem"},
    {"nom": "Phase 2 - Developpement", "semaines": "5-8", "objectif": "Volume progressif", "volume": "40-55km/sem"},
    {"nom": "Phase 3 - Specifique", "semaines": "9-12", "objectif": "Allure cible", "volume": "55-65km/sem"},
    {"nom": "Phase 4 - Affutage", "semaines": "13-${weeks}", "objectif": "Reduction et recup", "volume": "30-40km/sem"}
  ],
  "semaine_type": [
    {"phase": "Fondation", "jours": [
      {"jour": "Lundi", "type": "Repos", "detail": "Recuperation"},
      {"jour": "Mardi", "type": "Endurance", "detail": "45 min Z2", "duree": 45},
      {"jour": "Mercredi", "type": "Repos", "detail": ""},
      {"jour": "Jeudi", "type": "Fractionne", "detail": "8x400m recup 1min", "duree": 50},
      {"jour": "Samedi", "type": "Sortie longue", "detail": "1h15 Z2", "duree": 75}
    ]},
    {"phase": "Specifique", "jours": [
      {"jour": "Mardi", "type": "Endurance", "detail": "1h allure cible", "duree": 60},
      {"jour": "Jeudi", "type": "Fractionne", "detail": "3x3km allure cible", "duree": 65},
      {"jour": "Samedi", "type": "Sortie longue", "detail": "2h Z2 avec 30min allure cible", "duree": 120}
    ]}
  ],
  "conseils_cles": ["Conseil 1 important", "Conseil 2 important", "Conseil 3 important"],
  "nutrition": "Conseils nutrition adaptes",
  "materiel": ["Element 1", "Element 2"]
}`;

    try {
      const r = await fetch(API+"/api/coach", {
        method:"POST",
        headers:{"Content-Type":"application/json","Authorization":`Bearer ${token}`},
        body:JSON.stringify({
          system:"Tu es un coach expert en préparation sportive. Réponds UNIQUEMENT en JSON valide sans markdown.",
          messages:[{role:"user",content:prompt}],
          max_tokens:3000
        })
      });
      const data = await r.json();
      let text = data.content?.[0]?.text || "";
      text = text.replace(/```[\w]*/g,"").replace(/```/g,"").trim(); text = (text.match(/\{[\s\S]*\}/)||[text])[0];
      // Handle nested content structure
      let parsed;
      try { parsed = JSON.parse(text); } catch(jsonErr) {
        // Try to extract JSON from response
        const jParsed = text.match(/\{[\s\S]*\}/);
        if (jParsed) parsed = JSON.parse(jParsed[0]);
        else throw jsonErr;
      }
      setPlan(parsed);
      setStep("result");
    } catch(e) {
      alert("Erreur : " + e.message);
    }
    setLoading(false);
  };

  const typeColors = {
    "Repos":"#6b7280", "Récupération":"#6b7280",
    "Endurance":"#3b6ff0", "Endurance longue":"#1d4ed8",
    "Fractionné":"#ea6c00", "Tempo":"#dc2626",
    "Sortie longue":"#7c3aed",
    "Force":"#16a34a", "Hypertrophie":"#16a34a",
    "Cardio":"#0891b2",
  };

  const getTypeColor = (type) => {
    for (const [k,v] of Object.entries(typeColors)) {
      if (type?.toLowerCase().includes(k.toLowerCase())) return v;
    }
    return "#6b7280";
  };

  return (
    <div style={{position:"fixed",inset:0,background:"#0f1117",zIndex:200,display:"flex",flexDirection:"column",fontFamily:"system-ui,sans-serif",overflow:"hidden"}}>
      {/* Header */}
      <div style={{background:"linear-gradient(135deg,#2e1065,#4c1d95)",padding:"14px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
        <div>
          <div style={{fontSize:16,fontWeight:800,color:"#fff"}}>🎯 Plan de Préparation</div>
          <div style={{fontSize:11,color:"rgba(255,255,255,0.6)"}}>
            {step==="result"&&plan?plan.titre:`Étape ${step==="sport"?"1":step==="params"?"2":"3"}/3`}
          </div>
        </div>
        <div style={{display:"flex",gap:8}}>
          {step==="params"&&<button onClick={()=>setStep("sport")} style={{background:"rgba(255,255,255,0.15)",border:"none",borderRadius:8,padding:"6px 12px",color:"#fff",fontSize:12,cursor:"pointer"}}>← Retour</button>}
          {step==="result"&&<button onClick={()=>setStep("sport")} style={{background:"rgba(255,255,255,0.15)",border:"none",borderRadius:8,padding:"6px 12px",color:"#fff",fontSize:12,cursor:"pointer"}}>↺ Nouveau</button>}
          <button onClick={onClose} style={{background:"rgba(255,255,255,0.15)",border:"none",borderRadius:8,padding:"6px 12px",color:"#fff",fontSize:12,cursor:"pointer"}}>Fermer</button>
        </div>
      </div>

      {/* Step 1: Sport choice */}
      {step==="sport"&&(
        <div style={{flex:1,overflowY:"scroll",padding:"20px 16px",WebkitOverflowScrolling:"touch"}}>
          <div style={{fontSize:14,fontWeight:700,color:"#f9fafb",marginBottom:16}}>Quel est ton objectif ?</div>
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            {sports.map(s=>(
              <div key={s.id}>
                <div style={{fontSize:11,color:"#6b7280",fontWeight:700,textTransform:"uppercase",letterSpacing:".08em",marginBottom:8}}>{s.icon} {s.label}</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                  {s.objectives.map(o=>(
                    <button key={o.id} onClick={()=>{setSport(s.id);setObjective(o.id);setStep("params");}}
                      style={{background:"rgba(255,255,255,0.06)",border:"1.5px solid rgba(255,255,255,0.1)",borderRadius:12,padding:"14px 12px",cursor:"pointer",textAlign:"left",display:"flex",alignItems:"center",gap:10}}>
                      <span style={{fontSize:22,flexShrink:0}}>{o.icon}</span>
                      <div style={{fontSize:13,fontWeight:700,color:"#f9fafb"}}>{o.label}</div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Step 2: Parameters */}
      {step==="params"&&(
        <div style={{flex:1,overflowY:"scroll",padding:"20px 16px",WebkitOverflowScrolling:"touch"}}>
          <div style={{fontSize:14,fontWeight:700,color:"#f9fafb",marginBottom:20}}>
            {selectedSport?.objectives.find(o=>o.id===objective)?.icon} {selectedSport?.objectives.find(o=>o.id===objective)?.label}
          </div>

          {/* Durée */}
          <div style={{marginBottom:20}}>
            <div style={{fontSize:13,fontWeight:700,color:"#f9fafb",marginBottom:10}}>📅 Durée de préparation</div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              {weekOptions.map(w=>(
                <button key={w} onClick={()=>setWeeks(w)}
                  style={{background:weeks===w?"rgba(124,58,237,0.3)":"rgba(255,255,255,0.07)",border:`1.5px solid ${weeks===w?"#7c3aed":"rgba(255,255,255,0.1)"}`,borderRadius:20,padding:"8px 14px",cursor:"pointer",fontSize:13,fontWeight:700,color:weeks===w?"#c4b5fd":"#9ca3af"}}>
                  {w} sem.
                </button>
              ))}
            </div>
          </div>

          {/* Niveau */}
          <div style={{marginBottom:20}}>
            <div style={{fontSize:13,fontWeight:700,color:"#f9fafb",marginBottom:10}}>📊 Ton niveau actuel</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
              {levelOptions.map(l=>(
                <button key={l.id} onClick={()=>setCurrentLevel(l.id)}
                  style={{background:currentLevel===l.id?"rgba(124,58,237,0.3)":"rgba(255,255,255,0.07)",border:`1.5px solid ${currentLevel===l.id?"#7c3aed":"rgba(255,255,255,0.1)"}`,borderRadius:12,padding:"12px 8px",cursor:"pointer",textAlign:"center"}}>
                  <div style={{fontSize:13,fontWeight:700,color:currentLevel===l.id?"#c4b5fd":"#f9fafb",marginBottom:3}}>{l.label}</div>
                  <div style={{fontSize:10,color:"#6b7280"}}>{l.sub}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Temps cible (si endurance) */}
          {["running","triathlon","cyclisme"].includes(sport)&&(
            <div style={{marginBottom:20}}>
              <div style={{fontSize:13,fontWeight:700,color:"#f9fafb",marginBottom:6}}>🎯 Temps / objectif visé <span style={{color:"#6b7280",fontWeight:400}}>(optionnel)</span></div>
              <input value={targetTime} onChange={e=>setTargetTime(e.target.value)}
                placeholder={sport==="running"&&objective==="marathon"?"Ex: 3h30":sport==="running"&&objective==="trail"?"Ex: 6h, sub-8h...":"Ex: 4h, sub-40min..."}
                style={{width:"100%",background:"rgba(255,255,255,0.07)",border:"1.5px solid rgba(255,255,255,0.1)",borderRadius:11,padding:"12px 14px",color:"#f9fafb",fontSize:14,fontFamily:"inherit",outline:"none",boxSizing:"border-box",marginBottom:10}}/>
              {sport==="running"&&objective==="trail"&&(
                <input value={targetTime} onChange={e=>setTargetTime(e.target.value)}
                  placeholder="Distance du trail : Ex: 42km, 80km, UTMB 170km..."
                  style={{width:"100%",background:"rgba(255,255,255,0.07)",border:"1.5px solid rgba(255,255,255,0.1)",borderRadius:11,padding:"12px 14px",color:"#f9fafb",fontSize:14,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/>
              )}
            </div>
          )}

          <button onClick={generate} disabled={!currentLevel||loading}
            style={{width:"100%",padding:"14px",background:currentLevel&&!loading?"linear-gradient(135deg,#4c1d95,#7c3aed)":"rgba(255,255,255,0.08)",border:"none",borderRadius:12,color:"#fff",fontWeight:700,fontSize:15,cursor:currentLevel&&!loading?"pointer":"not-allowed",boxShadow:currentLevel&&!loading?"0 4px 20px rgba(124,58,237,0.4)":"none"}}>
            {loading?"⏳ Génération du plan...":"🎯 Générer mon plan complet"}
          </button>
        </div>
      )}

      {/* Step 3: Result */}
      {step==="result"&&plan&&(
        <div style={{flex:1,overflowY:"auto",display:"flex",flexDirection:"column"}}>
          <div style={{background:"linear-gradient(135deg,#2e1065,#4c1d95)",padding:"16px",flexShrink:0}}>
            <div style={{fontSize:13,color:"rgba(255,255,255,0.7)",marginBottom:8}}>{plan.resume}</div>
            <div style={{display:"flex",gap:6,overflowX:"auto"}}>
              {plan.phases?.map((p,i)=>(
                <div key={i} style={{background:"rgba(255,255,255,0.1)",borderRadius:10,padding:"8px 12px",flexShrink:0}}>
                  <div style={{fontSize:11,fontWeight:700,color:"#c4b5fd"}}>{p.nom}</div>
                  <div style={{fontSize:10,color:"rgba(255,255,255,0.5)"}}>{p.semaines}</div>
                </div>
              ))}
            </div>
          </div>
          <div style={{flex:1,overflowY:"auto",padding:"16px"}}>
            {plan.conseils_cles?.map((c,i)=>(
              <div key={i} style={{display:"flex",gap:8,marginBottom:8,background:"rgba(124,58,237,0.08)",borderRadius:10,padding:"10px 12px"}}>
                <div style={{color:"#7c3aed",fontWeight:800}}>{"→"}</div>
                <div style={{fontSize:12,color:"#9ca3af"}}>{c}</div>
              </div>
            ))}
            {plan.semaine_type?.map((st,i)=>(
              <div key={i} style={{marginBottom:14}}>
                <div style={{fontSize:11,fontWeight:700,color:"#c4b5fd",marginBottom:8}}>{"📅 "}{st.phase}</div>
                {st.jours?.map((s,j)=>(
                  <div key={j} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 12px",background:"rgba(255,255,255,0.05)",borderRadius:10,marginBottom:5}}>
                    <div style={{width:64,flexShrink:0}}>
                      <div style={{fontSize:11,color:"#6b7280"}}>{s.jour}</div>
                      {s.duree&&<div style={{fontSize:10,color:"#4b5563"}}>{s.duree}{"min"}</div>}
                    </div>
                    <div style={{flex:1}}>
                      <div style={{fontSize:10,fontWeight:700,color:getTypeColor(s.type),marginBottom:2}}>{s.type}</div>
                      {s.detail&&<div style={{fontSize:11,color:"#9ca3af"}}>{s.detail}</div>}
                    </div>
                  </div>
                ))}
              </div>
            ))}
            {plan.nutrition&&(
              <div style={{background:"rgba(22,163,74,0.1)",border:"1px solid rgba(22,163,74,0.2)",borderRadius:12,padding:"12px",marginBottom:10}}>
                <div style={{fontSize:11,fontWeight:700,color:"#86efac",marginBottom:6}}>{"🥗 Nutrition"}</div>
                <div style={{fontSize:12,color:"#9ca3af"}}>{plan.nutrition}</div>
              </div>
            )}
            {plan.materiel?.length>0&&(
              <div style={{background:"rgba(59,111,240,0.1)",border:"1px solid rgba(59,111,240,0.2)",borderRadius:12,padding:"12px",marginBottom:20}}>
                <div style={{fontSize:11,fontWeight:700,color:"#93c5fd",marginBottom:6}}>{"🎒 Matériel"}</div>
                <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                  {plan.materiel.map((m,i)=>(
                    <span key={i} style={{background:"rgba(59,111,240,0.15)",color:"#93c5fd",fontSize:11,padding:"4px 10px",borderRadius:20}}>{m}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      {/* Loading */}
      {loading&&(
        <div style={{position:"absolute",inset:0,background:"rgba(15,17,23,0.9)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:16,zIndex:10}}>
          <div style={{fontSize:44}}>🎯</div>
          <div style={{fontSize:15,fontWeight:700,color:"#f9fafb"}}>Génération du plan...</div>
          <div style={{fontSize:12,color:"#6b7280",textAlign:"center",maxWidth:240}}>L'IA construit ton plan semaine par semaine</div>
          <div style={{display:"flex",gap:5}}>
            {[0,1,2].map(i=><div key={i} style={{width:8,height:8,borderRadius:"50%",background:"#7c3aed",animation:"p 1.2s ease-in-out infinite",animationDelay:`${i*.2}s`}}/>)}
          </div>
        </div>
      )}
    </div>
  );
}


// ─── HOME SCREEN ─────────────────────────────────────────────────────────────

function BodyWeightTracker({onClose}) {
  const [entries, setEntries] = useState([]);
  const [input, setInput] = useState("");
  const [unit, setUnit] = useState("kg");

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("coach_weight_log") || "[]");
      setEntries(saved);
    } catch {}
  }, []);

  const save = () => {
    const val = parseFloat(input.replace(",","."));
    if (!val || val < 20 || val > 300) return;
    const entry = {date: new Date().toISOString(), weight: val, unit};
    const updated = [entry, ...entries].slice(0, 365);
    setEntries(updated);
    try { localStorage.setItem("coach_weight_log", JSON.stringify(updated)); } catch {}
    setInput("");
  };

  const last30 = entries.slice(0, 30).reverse();
  const weights = last30.map(e => e.weight);
  const minW = weights.length > 0 ? Math.min(...weights) - 1 : 50;
  const maxW = weights.length > 0 ? Math.max(...weights) + 1 : 100;
  const range = maxW - minW || 1;
  const W = 300, H = 120;

  const toX = (i) => (i / Math.max(weights.length - 1, 1)) * (W - 20) + 10;
  const toY = (w) => H - ((w - minW) / range) * (H - 20) - 10;

  const trend = weights.length >= 2 ? (weights[weights.length-1] - weights[0]).toFixed(1) : null;

  return (
    <div style={{position:"fixed",inset:0,background:C.bg,zIndex:200,display:"flex",flexDirection:"column",fontFamily:"system-ui,sans-serif"}}>
      <div style={{background:"linear-gradient(135deg,#1e3a5f,#2563eb)",padding:"14px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
        <div>
          <div style={{fontSize:16,fontWeight:800,color:"#fff"}}>⚖️ Poids corporel</div>
          <div style={{fontSize:11,color:"rgba(255,255,255,0.6)"}}>{entries.length} mesure{entries.length!==1?"s":""} enregistrée{entries.length!==1?"s":""}</div>
        </div>
        <button onClick={onClose} style={{background:"rgba(255,255,255,0.15)",border:"none",borderRadius:8,padding:"6px 12px",color:"#fff",fontSize:12,cursor:"pointer"}}>✕</button>
      </div>

      <div style={{flex:1,overflowY:"auto",padding:"16px"}}>
        {/* Saisie */}
        <div style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:14,padding:"16px",marginBottom:16}}>
          <div style={{fontSize:13,fontWeight:700,color:"#f9fafb",marginBottom:12}}>Peser aujourd'hui</div>
          <div style={{display:"flex",gap:8}}>
            <input type="number" value={input} onChange={e=>setInput(e.target.value)}
              placeholder="Ex: 78.5" step="0.1"
              style={{flex:1,background:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.2)",borderRadius:10,padding:"10px 14px",color:"#f9fafb",fontSize:16,fontWeight:700,outline:"none"}}/>
            <select value={unit} onChange={e=>setUnit(e.target.value)}
              style={{background:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.2)",borderRadius:10,padding:"10px",color:"#f9fafb",fontSize:14,outline:"none",cursor:"pointer"}}>
              <option value="kg">kg</option>
              <option value="lbs">lbs</option>
            </select>
            <button onClick={save}
              style={{padding:"10px 18px",background:"#2563eb",border:"none",borderRadius:10,color:"#fff",fontWeight:700,fontSize:14,cursor:"pointer"}}>
              ✓
            </button>
          </div>
        </div>

        {/* Résumé */}
        {entries.length > 0 && (
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:16}}>
            <div style={{background:"rgba(255,255,255,0.06)",borderRadius:12,padding:"12px",textAlign:"center"}}>
              <div style={{fontSize:20,fontWeight:900,color:"#60a5fa"}}>{entries[0].weight}</div>
              <div style={{fontSize:10,color:"#6b7280",marginTop:2}}>Actuel</div>
            </div>
            {entries.length >= 7 && (
              <div style={{background:"rgba(255,255,255,0.06)",borderRadius:12,padding:"12px",textAlign:"center"}}>
                <div style={{fontSize:20,fontWeight:900,color:parseFloat(trend)<0?C.green:parseFloat(trend)>0?C.orange:"#9ca3af"}}>
                  {trend > 0 ? "+"+trend : trend} kg
                </div>
                <div style={{fontSize:10,color:"#6b7280",marginTop:2}}>30 jours</div>
              </div>
            )}
            <div style={{background:"rgba(255,255,255,0.06)",borderRadius:12,padding:"12px",textAlign:"center"}}>
              <div style={{fontSize:20,fontWeight:900,color:"#9ca3af"}}>{Math.min(...entries.map(e=>e.weight))}</div>
              <div style={{fontSize:10,color:"#6b7280",marginTop:2}}>Min</div>
            </div>
          </div>
        )}

        {/* Graphique */}
        {weights.length >= 2 && (
          <div style={{background:"rgba(255,255,255,0.04)",borderRadius:14,padding:"16px",marginBottom:16}}>
            <div style={{fontSize:11,fontWeight:700,color:"#6b7280",marginBottom:10,textTransform:"uppercase"}}>Évolution — 30 jours</div>
            <svg width="100%" viewBox={"0 0 "+W+" "+H} style={{overflow:"visible"}}>
              {/* Grid lines */}
              {[0,0.25,0.5,0.75,1].map((t,i)=>(
                <line key={i} x1={10} y1={H-t*(H-20)-10} x2={W-10} y2={H-t*(H-20)-10}
                  stroke="rgba(255,255,255,0.05)" strokeWidth="1"/>
              ))}
              {/* Line */}
              <polyline
                points={weights.map((w,i)=>toX(i)+","+toY(w)).join(" ")}
                fill="none" stroke="#3b82f6" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
              {/* Area */}
              <polyline
                points={"10,"+H+" "+weights.map((w,i)=>toX(i)+","+toY(w)).join(" ")+" "+(W-10)+","+H}
                fill="rgba(59,130,246,0.1)" stroke="none"/>
              {/* Dots */}
              {weights.map((w,i)=>(
                <circle key={i} cx={toX(i)} cy={toY(w)} r="4" fill="#3b82f6"/>
              ))}
            </svg>
          </div>
        )}

        {/* Historique */}
        <div style={{fontSize:11,fontWeight:700,color:"#6b7280",textTransform:"uppercase",marginBottom:8}}>Historique</div>
        {entries.slice(0,10).map((e,i)=>(
          <div key={i} style={{display:"flex",alignItems:"center",padding:"10px 14px",background:"rgba(255,255,255,0.04)",borderRadius:10,marginBottom:6}}>
            <div style={{flex:1,fontSize:12,color:"#9ca3af"}}>
              {new Date(e.date).toLocaleDateString("fr-FR",{weekday:"short",day:"numeric",month:"short"})}
            </div>
            <div style={{fontSize:15,fontWeight:700,color:"#f9fafb"}}>{e.weight} {e.unit}</div>
            {i>0 && (
              <div style={{fontSize:11,marginLeft:8,color:e.weight<entries[i-1]?.weight?C.green:e.weight>entries[i-1]?.weight?C.orange:"#6b7280",width:40,textAlign:"right"}}>
                {e.weight<entries[i-1]?.weight?"▼ "+(entries[i-1].weight-e.weight).toFixed(1):e.weight>entries[i-1]?.weight?"▲ "+(e.weight-entries[i-1].weight).toFixed(1):"="}
              </div>
            )}
          </div>
        ))}
        {entries.length === 0 && (
          <div style={{textAlign:"center",padding:"40px 20px",color:"#6b7280",fontSize:13}}>
            Aucune mesure. Commence maintenant !
          </div>
        )}
      </div>
    </div>
  );
}


function MuscleScreen({ profile, onClose }) {
  const [days, setDays] = useState(7);
  const [gender, setGender] = useState(profile?.gender === "femme" ? "female" : "male");
  const [sessions, setSessions] = useState([]);
  useEffect(() => {
    try { setSessions(JSON.parse(localStorage.getItem("coach_sessions") || "[]")); } catch {}
  }, []);
  const data = computeRecentMuscles(sessions, days);
  const nb = sessions.filter(s => s && s.type !== "weight" && (!s.date || Date.now() - new Date(s.date).getTime() < days*864e5)).length;
  const worked = Object.keys(data).length;
  const LEG = [["#2b3242","Non travaillé"],["rgba(16,185,129,0.35)","1×"],["rgba(16,185,129,0.65)","2×"],["#10b981","3×+"]];
  return (
    <div style={{position:"fixed",inset:0,background:C.bg,zIndex:200,display:"flex",flexDirection:"column",fontFamily:"system-ui,sans-serif"}}>
      <div style={{background:"linear-gradient(135deg,#064e3b,#059669)",padding:"14px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
        <div>
          <div style={{fontSize:16,fontWeight:800,color:"#fff"}}>💪 Muscles travaillés</div>
          <div style={{fontSize:11,color:"rgba(255,255,255,0.65)"}}>{nb} séance{nb!==1?"s":""} · {worked} groupe{worked!==1?"s":""} sollicité{worked!==1?"s":""}</div>
        </div>
        <button onClick={onClose} style={{background:"rgba(255,255,255,0.15)",border:"none",borderRadius:8,padding:"6px 12px",color:"#fff",fontSize:12,cursor:"pointer"}}>✕</button>
      </div>
      <div style={{flex:1,overflowY:"auto",padding:"16px"}}>
        <div style={{display:"flex",gap:8,marginBottom:12}}>
          {[[7,"7 jours"],[30,"30 jours"],[3650,"Tout"]].map(([d,l])=>(
            <button key={d} onClick={()=>setDays(d)} style={{flex:1,padding:9,borderRadius:10,cursor:"pointer",fontSize:13,fontWeight:700,
              background:days===d?"rgba(16,185,129,0.18)":C.surf,border:`1.5px solid ${days===d?C.green:C.bord}`,color:days===d?"#6ee7b7":C.t2}}>{l}</button>
          ))}
        </div>
        <div style={{display:"flex",gap:8,marginBottom:16}}>
          {[["male","Homme"],["female","Femme"]].map(([g,l])=>(
            <button key={g} onClick={()=>setGender(g)} style={{flex:1,padding:8,borderRadius:10,cursor:"pointer",fontSize:13,fontWeight:700,
              background:gender===g?"rgba(16,185,129,0.18)":C.surf,border:`1.5px solid ${gender===g?C.green:C.bord}`,color:gender===g?"#6ee7b7":C.t2}}>{l}</button>
          ))}
        </div>
        {nb===0 ? (
          <div style={{textAlign:"center",padding:"48px 20px"}}>
            <div style={{fontSize:44,marginBottom:12}}>🗺️</div>
            <div style={{fontSize:14,fontWeight:700,color:C.t2,marginBottom:6}}>Aucune séance sur la période</div>
            <div style={{fontSize:13,color:C.t4}}>Termine une séance pour voir tes muscles se colorer ici.</div>
          </div>
        ) : (
          <>
            <div style={{background:C.surf,border:`1px solid ${C.bord}`,borderRadius:16,padding:"16px 8px",marginBottom:16}}>
              <MuscleMap gender={gender} data={data} height={320} />
            </div>
            <div style={{display:"flex",gap:12,justifyContent:"center",flexWrap:"wrap"}}>
              {LEG.map(([c,l])=>(
                <div key={l} style={{display:"flex",alignItems:"center",gap:6,fontSize:12,color:C.t3}}>
                  <span style={{width:14,height:14,borderRadius:4,background:c,border:`1px solid ${C.bordM}`}}/>{l}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
function HomeScreen({firstName, profile, hasProgram, onProgram, onSeance, onPrep, onHIIT, onNutrition, onProfil, onWeight, onMuscles}) {
  const sports = [
    {id:"musculation",icon:"💪",label:"Musculation"},{id:"calistenie",icon:"🤸",label:"Callisthénie"},
    {id:"running",icon:"🏃",label:"Running"},{id:"velo",icon:"🚴",label:"Vélo"},
    {id:"natation",icon:"🏊",label:"Natation"},{id:"yoga",icon:"🧘",label:"Yoga"},
    {id:"pilates",icon:"🤸",label:"Pilates"},{id:"crossfit",icon:"🏋️",label:"CrossFit"},
    {id:"hiit",icon:"🔥",label:"HIIT"},{id:"marche",icon:"🚶",label:"Marche"},
  ];

  const today = new Date().toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long"});

  return (
    <div style={{minHeight:"100vh",background:C.bg,fontFamily:"system-ui,-apple-system,sans-serif",display:"flex",flexDirection:"column"}}>
      {/* Header */}
      <div style={{background:C.surfHigh,borderBottom:"1px solid rgba(255,255,255,0.1)",padding:"14px 20px",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:32,height:32,borderRadius:10,background:`linear-gradient(135deg,${C.indigo},${C.blue})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16}}>🧠</div>
          <div>
            <div style={{fontSize:14,fontWeight:700,color:C.t1,letterSpacing:"-0.3px"}}>Coach IA</div>
            <div style={{fontSize:10,color:C.t4,textTransform:"capitalize"}}>{today}</div>
          </div>
        </div>
        <div style={{width:32,height:32,borderRadius:"50%",background:C.surfHigh,border:"1.5px solid rgba(255,255,255,0.1)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,color:C.t3,fontWeight:700}}>
          {firstName?firstName[0].toUpperCase():"?"}
        </div>
      </div>

      {/* Scrollable content */}
      <div style={{flex:1,overflowY:"auto",WebkitOverflowScrolling:"touch",padding:"20px 16px 100px"}}>
        
        {/* Greeting */}
        <div style={{marginBottom:24}}>
          <div style={{fontSize:13,color:C.t4,marginBottom:3}}>Que fais-tu aujourd'hui ?</div>
          <div style={{fontSize:26,fontWeight:800,color:C.t1,letterSpacing:"-0.5px"}}>Bonjour {firstName || "Champion"} 👋</div>
        </div>

        {/* Main cards 2-col */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
          {/* Programme */}
          <button onClick={onProgram} style={{background:`linear-gradient(135deg,#1e3a8a,${C.blue})`,border:"none",borderRadius:18,padding:"20px 16px",cursor:"pointer",textAlign:"left",position:"relative",overflow:"hidden",boxShadow:`0 8px 24px rgba(37,99,235,0.3)`}}>
            <div style={{position:"absolute",top:-15,right:-15,width:70,height:70,borderRadius:"50%",background:"rgba(255,255,255,0.06)"}}/>
            <div style={{fontSize:28,marginBottom:8}}>📋</div>
            <div style={{fontSize:13,fontWeight:800,color:"#fff",marginBottom:3,letterSpacing:"-0.3px"}}>Programme</div>
            <div style={{fontSize:10,color:"rgba(255,255,255,0.6)",marginBottom:10,lineHeight:1.4}}>{profile?.goal||"Personnalisé"}</div>
            <div style={{fontSize:10,color:"rgba(255,255,255,0.85)",fontWeight:700,background:"rgba(255,255,255,0.15)",display:"inline-block",borderRadius:8,padding:"3px 9px"}}>{hasProgram?"Voir →":"Générer →"}</div>
          </button>

          {/* Séance */}
          <button onClick={()=>onSeance(null)} style={{background:`linear-gradient(135deg,#064e3b,${C.green})`,border:"none",borderRadius:18,padding:"20px 16px",cursor:"pointer",textAlign:"left",position:"relative",overflow:"hidden",boxShadow:`0 8px 24px rgba(5,150,105,0.3)`}}>
            <div style={{position:"absolute",top:-15,right:-15,width:70,height:70,borderRadius:"50%",background:"rgba(255,255,255,0.06)"}}/>
            <div style={{fontSize:28,marginBottom:8}}>⚡</div>
            <div style={{fontSize:13,fontWeight:800,color:"#fff",marginBottom:3,letterSpacing:"-0.3px"}}>Séance du jour</div>
            <div style={{fontSize:10,color:"rgba(255,255,255,0.6)",marginBottom:10,lineHeight:1.4}}>Sur mesure · Maintenant</div>
            <div style={{fontSize:10,color:"rgba(255,255,255,0.85)",fontWeight:700,background:"rgba(255,255,255,0.15)",display:"inline-block",borderRadius:8,padding:"3px 9px"}}>Choisir →</div>
          </button>
        </div>

        {/* Préparation full-width */}
        <button onClick={onPrep} style={{width:"100%",background:`linear-gradient(135deg,#2e1065,${C.violet})`,border:"none",borderRadius:18,padding:"18px 20px",cursor:"pointer",textAlign:"left",display:"flex",alignItems:"center",gap:14,marginBottom:12,boxShadow:`0 8px 24px rgba(124,58,237,0.25)`}}>
          <div style={{fontSize:34}}>🎯</div>
          <div style={{flex:1}}>
            <div style={{fontSize:14,fontWeight:800,color:"#fff",marginBottom:3,letterSpacing:"-0.3px"}}>Plan de Préparation</div>
            <div style={{fontSize:11,color:"rgba(255,255,255,0.6)"}}>Marathon, triathlon, musculation... X semaines sur mesure</div>
          </div>
          <div style={{background:"rgba(255,255,255,0.15)",borderRadius:10,padding:"6px 12px",fontSize:11,color:"#fff",fontWeight:700,flexShrink:0}}>Créer →</div>
        </button>

        {/* HIIT */}
        <button onClick={onHIIT} style={{width:"100%",background:`linear-gradient(135deg,#7f1d1d,${C.red})`,border:"none",borderRadius:18,padding:"16px 20px",cursor:"pointer",textAlign:"left",display:"flex",alignItems:"center",gap:14,marginBottom:24,boxShadow:`0 8px 24px rgba(220,38,38,0.25)`}}>
          <div style={{fontSize:30}}>🔥</div>
          <div style={{flex:1}}>
            <div style={{fontSize:13,fontWeight:800,color:"#fff",marginBottom:2,letterSpacing:"-0.3px"}}>WOD HIIT — Freeletics Style</div>
            <div style={{fontSize:11,color:"rgba(255,255,255,0.6)"}}>Timer · Coaching vocal · Évaluation</div>
          </div>
          <div style={{background:"rgba(255,255,255,0.15)",borderRadius:10,padding:"5px 10px",fontSize:11,color:"#fff",fontWeight:700,flexShrink:0}}>GO →</div>
        </button>

        {/* Muscles travaillés */}
        <button onClick={onMuscles} style={{width:"100%",background:`linear-gradient(135deg,#064e3b,${C.green})`,border:"none",borderRadius:18,padding:"16px 20px",cursor:"pointer",textAlign:"left",display:"flex",alignItems:"center",gap:14,marginBottom:24,boxShadow:`0 8px 24px rgba(5,150,105,0.25)`}}>
          <div style={{fontSize:30}}>💪</div>
          <div style={{flex:1}}>
            <div style={{fontSize:13,fontWeight:800,color:"#fff",marginBottom:2,letterSpacing:"-0.3px"}}>Muscles travaillés</div>
            <div style={{fontSize:11,color:"rgba(255,255,255,0.6)"}}>Silhouette interactive · groupes sollicités par séance</div>
          </div>
          <div style={{background:"rgba(255,255,255,0.15)",borderRadius:10,padding:"5px 10px",fontSize:11,color:"#fff",fontWeight:700,flexShrink:0}}>Voir →</div>
        </button>

        {/* Sports rapide */}
        <div style={{marginBottom:8}}>
          <div style={{fontSize:11,color:C.t4,fontWeight:700,textTransform:"uppercase",letterSpacing:".08em",marginBottom:12}}>Accès rapide par sport</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8}}>
            {sports.map(s=>(
              <button key={s.id} onClick={()=>onSeance(s.id)}
                style={{background:C.surfHigh,border:"1px solid rgba(255,255,255,0.1)",borderRadius:14,padding:"12px 6px",cursor:"pointer",textAlign:"center",transition:"all .15s"}}
                onTouchStart={e=>{e.currentTarget.style.background=C.bordM;}}
                onTouchEnd={e=>{e.currentTarget.style.background=C.surfHigh;}}>
                <div style={{fontSize:20,marginBottom:5}}>{s.icon}</div>
                <div style={{fontSize:9,fontWeight:600,color:C.t3}}>{s.label}</div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom nav */}
      <div style={{position:"fixed",bottom:0,left:0,right:0,background:"rgba(255,255,255,0.06)",borderTop:"1px solid rgba(255,255,255,0.1)",padding:"8px 0 20px",display:"flex",zIndex:100}}>
        {[
          {icon:"🏠",label:"Accueil",active:true,fn:null},
          {icon:"📋",label:"Programme",active:false,fn:onProgram},
          {icon:"⚖️",label:"Poids",active:false,fn:onWeight},
          {icon:"🥗",label:"Nutrition",active:false,fn:onNutrition},
          {icon:"⚙️",label:"Profil",active:false,fn:onProfil},
        ].map((item,i)=>(
          <button key={i} onClick={item.fn} style={{flex:1,background:"none",border:"none",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:4,padding:"4px 0"}}>
            <div style={{fontSize:20,lineHeight:1}}>{item.icon}</div>
            <div style={{fontSize:9,fontWeight:item.active?700:500,color:item.active?C.indigo:C.t4}}>{item.label}</div>
            {item.active&&<div style={{width:4,height:4,borderRadius:"50%",background:C.indigo}}/>}
          </button>
        ))}
      </div>
    </div>
  );
}


export default function App() {
  const [token,setToken]=useState(()=>store.get("token"));
  const [user,setUser]=useState(()=>store.get("user"));
  const [profile,setProfile]=useState(null);
  const [msgs,setMsgs]=useState([]);
  const [input,setInput]=useState("");
  const [busy,setBusy]=useState(false);
  const [week,setWeek]=useState(1);
  const [showEquip,setShowEquip]=useState(false);
  const [equipOverride,setEquipOverride]=useState(null);
  const [showJournal,setShowJournal]=useState(false);
  const [showNutrition,setShowNutrition]=useState(false);
  const [homeScreen,setHomeScreen]=useState(true); // true=home, false=chat
  const [showDashboard,setShowDashboard]=useState(false);
  const [dashboardParsed,setDashboardParsed]=useState(null);
  const [showSeance,setShowSeance]=useState(false);
  const [initialSport,setInitialSport]=useState(null);
  const [showPrep,setShowPrep]=useState(false);
  const [showWeight,setShowWeight]=useState(false);
  const [showHIIT,setShowHIIT]=useState(false);
  const [showMuscles,setShowMuscles]=useState(false);
  const [logData,setLogData]=useState({});
  const [loading,setLoading]=useState(true);
  const [screen,setScreen]=useState("loading"); // loading|form|chat
  const bottom=useRef(null);
  const inp=useRef(null);

  useEffect(()=>{bottom.current?.scrollIntoView({behavior:"smooth"});},[msgs]);

  // Register PWA service worker
  useEffect(()=>{
    if("serviceWorker" in navigator){
      navigator.serviceWorker.register("/sw.js").catch(()=>{});
    }
  },[]);

  // Load user data on mount
  useEffect(()=>{
    if(!token){setScreen("auth");setLoading(false);return;}
    apiFetch("/api/profile",{},token).then(data=>{
      if(data.profile){
        setProfile(data.profile);
        if(data.chatHistory?.length>0){
          const restored=data.chatHistory.map(m=>({...m,parsed:m.role==="assistant"?parse(m.content):null}));
          setMsgs(restored);
        }
        // Always show home screen first
        setScreen("chat");
        setHomeScreen(true);
      } else {
        setScreen("form");
      }
    }).catch(()=>{
      store.del("token"); store.del("user");
      setToken(null); setUser(null); setScreen("auth");
    }).finally(()=>setLoading(false));
  },[token]);

  // Load workout logs
  useEffect(()=>{
    if(!token)return;
    apiFetch("/api/logs",{},token).then(data=>{
      const today=new Date().toISOString().split("T")[0];
      const todayLogs=(data.logs||[]).filter(l=>l.date===today);
      const ld={};
      todayLogs.forEach(l=>{
        ld[l.exercise_name]={sets:Array(l.sets_total).fill(false).map((_,i)=>i<l.sets_done),weights:JSON.parse(l.weights||"[]")};
      });
      setLogData(ld);
    }).catch(()=>{});
  },[token]);

  const handleAuth=(tk,u)=>{setToken(tk);setUser(u);setScreen("form");};
  const handleLogout=()=>{store.del("token");store.del("user");setToken(null);setUser(null);setProfile(null);setMsgs([]);setScreen("auth");};

  const handleProfileDone=async(p)=>{
    setProfile(p);
    await apiFetch("/api/profile",{method:"PUT",body:JSON.stringify(p)},token).catch(()=>{});
    setScreen("chat");
    const g=p.gender==="homme"?"Homme":p.gender==="femme"?"Femme":"";
    const userMsg=`Génère mon programme complet. ${g?g+", ":""}${p.age} ans, ${p.weight}kg, ${p.height}cm. Objectif : ${p.goal}. Niveau : ${p.level}. ${p.days} jours/semaine. Équipement : ${p.equip}.${p.limits?" Limitations : "+p.limits+".":""}${p.cardio?" Cardio : "+p.cardio+".":""}`;
    setMsgs([{role:"user",content:userMsg},{role:"assistant",content:"",loading:true}]);
    setBusy(true);
    try {
      const r=await apiFetch("/api/coach",{method:"POST",body:JSON.stringify({system:makePrompt(p,user?.first_name||""),messages:[{role:"user",content:userMsg}],max_tokens:1500})},token);
      const reply=r.content?.[0]?.text||"";
      const newMsgs=[{role:"user",content:userMsg},{role:"assistant",content:reply,parsed:parse(reply)}];
      setMsgs(newMsgs);
      await apiFetch("/api/chat",{method:"POST",body:JSON.stringify({messages:newMsgs.filter(m=>!m.loading).map(m=>({role:m.role,content:m.content}))})},token).catch(()=>{});
      await apiFetch("/api/program",{method:"POST",body:JSON.stringify({content:reply})},token).catch(()=>{});
      // Show dashboard after generation
      const p = parse(reply);
      if(p&&p.isParsed){setDashboardParsed(p);setShowDashboard(true);}
    } catch(e){
      setMsgs(prev=>[...prev.slice(0,-1),{role:"assistant",content:`Erreur : ${e.message}`}]);
    }
    setBusy(false);
  };

  const buildApiMsgs=(newMsg)=>{
    const clean=msgs.filter(m=>!m.loading&&m.content?.trim()&&m.role).map(m=>({role:m.role,content:m.content}));
    const alt=[];
    for(const m of clean){if(!alt.length||alt[alt.length-1].role!==m.role)alt.push(m);}
    if(alt[alt.length-1]?.role==="user")alt[alt.length-1]={role:"user",content:newMsg};
    else alt.push({role:"user",content:newMsg});
    return alt;
  };

  const send=async(userText)=>{
    const apiMsgs=buildApiMsgs(userText);
    setMsgs(prev=>[...prev.filter(m=>!m.loading),{role:"user",content:userText},{role:"assistant",content:"",loading:true}]);
    setBusy(true); setInput("");
    try {
      const r=await apiFetch("/api/coach",{method:"POST",body:JSON.stringify({system:makePrompt(profile,user?.first_name||""),messages:apiMsgs,max_tokens:1500})},token);
      const reply=r.content?.[0]?.text||"";
      setMsgs(prev=>{
        const newMsgs=[...prev.slice(0,-1),{role:"assistant",content:reply,parsed:parse(reply)}];
        apiFetch("/api/chat",{method:"POST",body:JSON.stringify({messages:newMsgs.filter(m=>!m.loading).map(m=>({role:m.role,content:m.content}))})},token).catch(()=>{});
        // Auto-show dashboard if this is a program
        const p = parse(reply);
        if(p&&p.isParsed){
          setDashboardParsed(p);
          setShowDashboard(true);
        }
        return newMsgs;
      });
    } catch(e){
      setMsgs(prev=>[...prev.slice(0,-1),{role:"assistant",content:`Erreur : ${e.message}`}]);
    }
    setBusy(false);
    setTimeout(()=>bottom.current?.scrollIntoView({behavior:"smooth"}),100);
  };

  const handleLogSet=useCallback(async(exName,sets,weights)=>{
    const newLd={...logData,[exName]:{sets,weights}};
    setLogData(newLd);
    const today=new Date().toISOString().split("T")[0];
    const sessEx=msgs.flatMap(m=>m.parsed?.sessions||[]).flatMap(s=>s.exs).find(e=>e.name===exName);
    await apiFetch("/api/logs",{method:"POST",body:JSON.stringify({date:today,exercise_name:exName,sets_done:sets.filter(Boolean).length,sets_total:sets.length,weights,session_type:(sessEx && sessEx.session_type)||""})},token).catch(()=>{});
  },[logData,msgs,token]);

  const rawName = user?.first_name||"";
  const firstName = rawName ? rawName.charAt(0).toUpperCase() + rawName.slice(1).toLowerCase() : "";

  // Show dashboard if requested
  if(showDashboard&&dashboardParsed&&profile) return (
    <ProgramDashboard
      parsed={dashboardParsed}
      profile={profile}
      firstName={firstName}
      token={token}
      logData={logData}
      onLogSet={handleLogSet}
      onBack={()=>setShowDashboard(false)}
    />
  );

  if(loading||screen==="loading") return (
    <div style={{minHeight:"100vh",background:C.bg,display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{textAlign:"center"}}>
        <div style={{fontSize:44,marginBottom:16}}>🧠</div>
        <div style={{fontSize:14,color:C.t3}}>Chargement...</div>
      </div>
    </div>
  );

  if(screen==="auth") return <AuthScreen onAuth={handleAuth}/>;
  if(screen==="form"||!profile) return <ProfileForm initialProfile={profile} onDone={handleProfileDone} firstName={user?.first_name||"toi"}/>;

  const equipOpts=[
    {id:null,icon:"🔄",label:"Mon équipement habituel"},
    {id:"Salle complète",icon:"🏋️",label:"Salle complète"},
    {id:"Haltères + barre + banc",icon:"🥊",label:"Haltères + Barre"},
    {id:"2 haltères uniquement",icon:"🧳",label:"2 haltères"},
    {id:"Poids du corps",icon:"🏠",label:"Poids du corps"},
  ];

  return (
    <div style={{minHeight:"100vh",background:C.bg,display:"flex",flexDirection:"column",fontFamily:"system-ui,sans-serif"}}>
      {showJournal&&<Journal token={token} onClose={()=>setShowJournal(false)}/>}
      {showSeance&&<SeancePanel token={token} profile={profile} firstName={firstName} initialSport={initialSport} onClose={()=>setShowSeance(false)} sendToChat={send}/>}
      {showHIIT&&<HIITPanel token={token} profile={profile} firstName={firstName} onClose={()=>setShowHIIT(false)}/>}
      {showWeight&&<BodyWeightTracker onClose={()=>setShowWeight(false)}/>}
      {showPrep&&<PrepPanel token={token} profile={profile} firstName={firstName} onClose={()=>setShowPrep(false)}/>}
      {showMuscles&&<MuscleScreen profile={profile} onClose={()=>setShowMuscles(false)}/>}
      {showNutrition&&<NutritionPanel token={token} profile={profile} firstName={firstName} onClose={()=>setShowNutrition(false)} sendToChat={send}/>}

      {/* Main content - no old header */}
      <div style={{flex:1,overflowY:"auto",background:C.bg}}>
        <div style={{maxWidth:680,margin:"0 auto"}}>
          {homeScreen&&(
            <HomeScreen
              firstName={firstName}
              profile={profile}
              hasProgram={msgs.length>0}
              onProgram={()=>{
                if(msgs.length>0){
                  // Find the last parsed program
                  const lastProg = [...msgs].reverse().find(m=>m.parsed&&m.parsed.isParsed);
                  if(lastProg){
                    setDashboardParsed(lastProg.parsed);
                    setShowDashboard(true);
                    return;
                  }
                  // Try any assistant message with content
                  const lastAssist = [...msgs].reverse().find(m=>m.role==="assistant"&&m.content&&m.content.length>100);
                  if(lastAssist){
                    const p = parse(lastAssist.content);
                    if(p){
                      setDashboardParsed(p);
                      setShowDashboard(true);
                      return;
                    }
                  }
                }
                // No program yet - generate one
                setHomeScreen(false);
                const g=profile.gender==="homme"?"Homme":profile.gender==="femme"?"Femme":"";
                const userMsg=`Génère mon programme complet. ${g?g+", ":""}${profile.age} ans, ${profile.weight}kg, ${profile.height}cm. Objectif : ${profile.goal}. Niveau : ${profile.level}. ${profile.days} jours/semaine. Équipement : ${profile.equip}.${profile.limits?" Limitations : "+profile.limits+".":""}${profile.cardio?" Cardio : "+profile.cardio+".":""}`;
                send(userMsg);
              }}
              onSeance={(sport)=>{setInitialSport(sport||null);setShowSeance(true);}}
              onPrep={()=>setShowPrep(true)}
              onHIIT={()=>setShowHIIT(true)}
              onNutrition={()=>setShowNutrition(true)}
              onProfil={()=>setScreen("form")}
              onWeight={()=>setShowWeight(true)}
              onMuscles={()=>setShowMuscles(true)}
            />
          )}
          {!homeScreen&&msgs.map((m,i)=><Bubble key={i} msg={m} profile={profile} firstName={firstName} logData={logData} onLogSet={handleLogSet}/>)}
          {msgs.length===0&&!homeScreen&&(
            <div style={{textAlign:"center",padding:"60px 20px",color:"#6b7280"}}>Génération en cours...</div>
          )}
          <div ref={bottom}/>
        </div>
      </div>

      {/* Equip panel */}
      {showEquip&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.75)",zIndex:100,display:"flex",alignItems:"flex-end"}} onClick={()=>setShowEquip(false)}>
          <div style={{width:"100%",background:"rgba(255,255,255,0.06)",borderRadius:"17px 17px 0 0",padding:"20px 15px 28px"}} onClick={e=>e.stopPropagation()}>
            <div style={{fontSize:14,fontWeight:800,color:C.t1,marginBottom:3}}>Équipement cette semaine</div>
            <div style={{fontSize:11,color:C.t3,marginBottom:14}}>Le coach adapte toutes tes séances en conséquence</div>
            {equipOpts.map(o=>(
              <button key={String(o.id)} onClick={()=>{setShowEquip(false);setEquipOverride(o.id);send(o.id?`Je n'ai accès qu'à : ${o.id}. Adapte toutes mes séances.`:`Reviens à mon équipement habituel : ${profile.equip}.`);}}
                style={{background:equipOverride===o.id?C.blue+"18":C.bg,border:`1.5px solid ${equipOverride===o.id?C.blue:C.bord}`,borderRadius:10,padding:"11px 13px",cursor:"pointer",display:"flex",alignItems:"center",gap:10,marginBottom:6,width:"100%",color:C.t1,fontSize:13,fontWeight:600}}>
                <span style={{fontSize:17}}>{o.icon}</span>{o.label}
                {equipOverride===o.id&&<span style={{marginLeft:"auto",fontSize:11,color:C.blue,fontWeight:700}}>Actif ✓</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Toolbar */}
      {!busy&&msgs.length>1&&(
        <div style={{borderTop:"1px solid #252a38",background:"#1a1f2e"}}>
          <div style={{padding:"10px 16px 0",maxWidth:680,margin:"0 auto"}}>
            <div style={{display:"flex",gap:6,overflowX:"auto",paddingBottom:8}}>
              {[
                {label:equipOverride?"🔧 Équipement modifié":"🔧 Changer équipement",fn:()=>setShowEquip(true),hi:!!equipOverride},
                {label:`📈 Évoluer sem. ${week+1}`,fn:()=>{setWeek(w=>w+1);send(`Semaine ${week+1}. Fais évoluer progressivement : charges, volume, variantes.`);}},
                {label:"🔀 Variantes +/- difficiles",fn:()=>send("Pour chaque exercice, donne 2 variantes : une plus facile et une plus difficile.")},
                {label:"📋 Journal",fn:()=>setShowJournal(true)},
              {label:"🥗 Nutrition",fn:()=>setShowNutrition(true)},
              {label:"⚡ Séance du jour",fn:()=>setShowSeance(true)},
              ].map(a=>(
                <button key={a.label} onClick={a.fn} style={{flexShrink:0,background:a.hi?C.orange+"18":C.surf,border:`1px solid ${a.hi?C.orange:C.bord}`,borderRadius:16,padding:"6px 11px",color:a.hi?C.orange:C.t2,fontSize:11,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap"}}>{a.label}</button>
              ))}
            </div>
          </div>
          <div style={{padding:"0 13px",maxWidth:640,margin:"0 auto"}}>
            <div style={{display:"flex",gap:6,overflowX:"auto",paddingBottom:10}}>
              {["Quoi manger avant et après ?","Comment progresser ?","Plan nutrition cette semaine","J'ai une douleur à..."].map(q=>(
                <button key={q} onClick={()=>{setInput(q);setTimeout(()=>inp.current?.focus(),50);}}
                  style={{flexShrink:0,background:"transparent",border:"1px solid rgba(255,255,255,0.08)",borderRadius:20,padding:"5px 12px",color:"#6b7280",fontSize:11,cursor:"pointer",whiteSpace:"nowrap",transition:"all .15s"}}
                  onMouseEnter={e=>{e.currentTarget.style.color="#93c5fd";e.currentTarget.style.borderColor="rgba(147,197,253,0.3)";}}
                  onMouseLeave={e=>{e.currentTarget.style.color="#6b7280";e.currentTarget.style.borderColor="rgba(255,255,255,0.08)";}}
                >{q}</button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Input */}
      <div style={{background:"#1a1f2e",borderTop:"1px solid #252a38",padding:"12px 16px",flexShrink:0}}>
        <div style={{maxWidth:680,margin:"0 auto",display:"flex",gap:10,alignItems:"center"}}>
          <input ref={inp} value={input} onChange={e=>setInput(e.target.value)}
            onKeyDown={e=>e.key==="Enter"&&!e.shiftKey&&!busy&&input.trim()&&send(input)}
            placeholder="Pose une question à ton coach..." disabled={busy}
            style={{flex:1,background:"rgba(255,255,255,0.07)",border:"1.5px solid rgba(255,255,255,0.1)",borderRadius:14,padding:"12px 16px",color:"#f9fafb",fontSize:14,fontFamily:"inherit",outline:"none",transition:"border-color .15s"}}/>
          <button onClick={()=>input.trim()&&!busy&&send(input)} disabled={busy||!input.trim()}
            style={{width:46,height:46,borderRadius:13,background:busy||!input.trim()?"rgba(255,255,255,0.08)":"linear-gradient(135deg,#3b6ff0,#2563eb)",border:"none",cursor:busy||!input.trim()?"not-allowed":"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,boxShadow:busy||!input.trim()?"none":"0 4px 14px rgba(59,111,240,0.4)",transition:"all .2s"}}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          </button>
        </div>
      </div>
    </div>
  );
}
